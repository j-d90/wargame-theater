import { describe, expect, it } from 'vitest';
import { latLonToXY, loadScenario } from '@tow/content';
import {
  TICKS_PER_DAY,
  applyCommand,
  cloneWorld,
  createWorld,
  distanceKm,
  hashState,
  planPath,
  run,
  terrainSpeedAt,
  type TerrainGrid,
  type WorldState,
} from '../src/index.ts';
import { chainWorld, tinyWorld } from './helpers.ts';

/**
 * 10 x 6 cells of 10 km. A water wall in column 4 blocks rows 0-4; row 5 is the
 * only way around. Column 7 is rough ground.
 *
 *   ....~..^..
 *   ....~..^..
 *   ....~..^..
 *   ....~..^..
 *   ....~..^..
 *   .......^..
 */
function wallTerrain(fill = '.'): TerrainGrid {
  const rows = [0, 1, 2, 3, 4, 5].map((r) =>
    [...Array(10).keys()].map((c) => (c === 4 && r < 5 ? '~' : c === 7 ? '^' : fill)).join(''),
  );
  return { cellKm: 10, cols: 10, rows: 6, cells: rows.join(''), speeds: { '.': 1000, '^': 500, '~': 0 }, defense: { '.': 1000, '^': 1300, '~': 1000 } };
}

function withTerrain(terrain: TerrainGrid): WorldState {
  const w = chainWorld();
  w.terrain = terrain;
  w.formations['a']!.position = { x: 15, y: 15 };
  w.formations['b']!.position = { x: 25, y: 25 };
  for (const n of Object.values(w.supply.nodes)) n.position = { x: 15, y: 15 };
  return w;
}

const pos = (w: WorldState, id: string) => w.formations[id]!.position;
const move = (w: WorldState, id: string, x: number, y: number) => applyCommand(w, { type: 'move', formation: id, to: { x, y } });

/** Every point along every leg of the path is on passable ground. */
function pathStaysOnLand(w: WorldState, from: { x: number; y: number }, path: { x: number; y: number }[]): boolean {
  let prev = from;
  for (const wp of path) {
    const d = distanceKm(prev, wp);
    for (let k = 0; k <= Math.ceil(d); k++) {
      const t = d === 0 ? 0 : k / Math.ceil(d);
      const p = { x: prev.x + (wp.x - prev.x) * t, y: prev.y + (wp.y - prev.y) * t };
      if (terrainSpeedAt(w, p) === 0) return false;
    }
    prev = wp;
  }
  return true;
}

describe('movement', () => {
  it('moves in a straight line at march speed when there is no map', () => {
    const w = chainWorld();
    move(w, 'a', 1 + 100, 0);
    run(w, TICKS_PER_DAY);
    expect(pos(w, 'a').x).toBeCloseTo(1 + 40, 6); // test-division marches 40 km/day by default
    expect(pos(w, 'a').y).toBe(0);
    run(w, 2 * TICKS_PER_DAY);
    expect(pos(w, 'a')).toEqual({ x: 101, y: 0 });
    expect(w.formations['a']!.order).toBeNull();
  });

  it('routes around impassable terrain and arrives', () => {
    const w = withTerrain(wallTerrain());
    move(w, 'a', 55, 15);
    const order = w.formations['a']!.order!;
    expect(pathStaysOnLand(w, { x: 15, y: 15 }, order.path)).toBe(true);
    expect(order.path.some((p) => p.y >= 50)).toBe(true); // through the gap in row 5
    expect(order.path.at(-1)).toEqual({ x: 55, y: 15 });
    run(w, 5 * TICKS_PER_DAY);
    expect(pos(w, 'a')).toEqual({ x: 55, y: 15 });
  });

  it('rejects destinations in water, off the map, or cut off, without changing anything', () => {
    const w = withTerrain(wallTerrain());
    move(w, 'a', 25, 15);
    const order = structuredClone(w.formations['a']!.order);
    expect(() => move(w, 'a', 45, 15)).toThrow(/can't reach/);
    expect(() => move(w, 'a', 500, 15)).toThrow(/can't reach/);
    w.terrain = { ...w.terrain!, cells: w.terrain!.cells.slice(0, 54) + '~' + w.terrain!.cells.slice(55) }; // close the gap
    expect(() => move(w, 'a', 55, 15)).toThrow(/can't reach/);
    expect(w.formations['a']!.order).toEqual(order);
  });

  it('is slower on rough ground and when readiness is low', () => {
    const rough = withTerrain(wallTerrain('^'));
    move(rough, 'a', 15, 55);
    run(rough, TICKS_PER_DAY);
    expect(pos(rough, 'a').y - 15).toBeCloseTo(20, 6); // 40 km/day x 0.5

    const tired = withTerrain(wallTerrain());
    tired.formations['a']!.stats.readiness = 300; // mobility 500 permille below the 600 threshold
    move(tired, 'a', 15, 55);
    run(tired, TICKS_PER_DAY);
    expect(pos(tired, 'a').y - 15).toBeLessThan(25);
    expect(pos(tired, 'a').y - 15).toBeGreaterThan(15);
  });

  it('halt stops a formation where it is', () => {
    const w = chainWorld();
    move(w, 'a', 200, 0);
    run(w, 10);
    applyCommand(w, { type: 'halt', formation: 'a' });
    const here = { ...pos(w, 'a') };
    run(w, TICKS_PER_DAY);
    expect(pos(w, 'a')).toEqual(here);
  });

  it('only active formations take move orders', () => {
    const w = tinyWorld();
    expect(() => move(w, 'bde-1-1', 0, 0)).toThrow(/not an active formation/);
    expect(() => move(w, 'i-corps', 0, 0)).toThrow(/not an active formation/);
  });

  it('cuts off supply once a formation moves out of range of its node', () => {
    const w = chainWorld();
    move(w, 'b', 2 + 400, 0);
    run(w, 9 * TICKS_PER_DAY); // past 150 km by day 4, then 3 days of carried stock run out
    const b = w.formations['b']!.stats;
    expect(b.stock).toBe(0);
    expect(b.readiness).toBeLessThan(1000);
    expect(w.formations['a']!.stats.readiness).toBe(1000);
  });

  it('a starving formation slows down and eventually stops', () => {
    const w = chainWorld();
    w.supply.nodes['depot-b']!.disrupted = true;
    move(w, 'b', 2 + 1000, 0);
    let last = pos(w, 'b').x;
    const daily: number[] = [];
    for (let d = 0; d < 12; d++) {
      run(w, TICKS_PER_DAY);
      daily.push(pos(w, 'b').x - last);
      last = pos(w, 'b').x;
    }
    expect(daily[0]).toBeCloseTo(40, 6);
    expect(daily.at(-1)).toBe(0);
  });
});

describe('movement with level of detail', () => {
  it('expanding a moving block shifts its parts with it and hands down the order', () => {
    const w = tinyWorld();
    const before = { b1: { ...pos(w, 'bde-1-1') }, b2: { ...pos(w, 'bde-1-2') }, div: { ...pos(w, 'div-1') } };
    move(w, 'div-1', before.div.x + 30, before.div.y);
    run(w, TICKS_PER_DAY / 4);
    const dx = pos(w, 'div-1').x - before.div.x;
    expect(dx).toBeGreaterThan(0);
    w.schedule = [];
    applyCommand(w, { type: 'expand', formation: 'div-1' });
    expect(pos(w, 'bde-1-1').x).toBeCloseTo(before.b1.x + dx, 3);
    expect(pos(w, 'bde-1-2').x).toBeCloseTo(before.b2.x + dx, 3);
    expect(w.formations['bde-1-1']!.order!.destination.x).toBeCloseTo(before.b1.x + 30, 3);
    run(w, 2 * TICKS_PER_DAY);
    expect(pos(w, 'bde-1-1').x).toBeCloseTo(before.b1.x + 30, 3);
  });

  it('aggregating places the block at the strength-weighted centre and drops part orders', () => {
    const w = tinyWorld();
    w.schedule = [];
    applyCommand(w, { type: 'expand', formation: 'div-1' });
    move(w, 'bde-1-1', 0, 0);
    applyCommand(w, { type: 'aggregate', formation: 'div-1' });
    const b1 = pos(w, 'bde-1-1');
    const b2 = pos(w, 'bde-1-2');
    expect(pos(w, 'div-1').x).toBeCloseTo((b1.x * 400 + b2.x * 360) / 760, 3);
    expect(w.formations['bde-1-1']!.order).toBeNull();
    expect(w.formations['div-1']!.order).toBeNull();
  });
});

describe('movement on the Gulf map', () => {
  const resolved = loadScenario('gulf-sandbox');
  const sandbox = () => createWorld(resolved);
  const kuwait = latLonToXY(resolved.map!.frame, 29.34, 47.66); // Al Jahra, just inland of Kuwait Bay
  const gulf = latLonToXY(resolved.map!.frame, 27.3, 50.6);

  it('plans an overland path and never routes through the Gulf', () => {
    const w = sandbox();
    const from = pos(w, 'div-e2');
    const path = planPath(w, from, kuwait)!;
    expect(path).not.toBeNull();
    expect(pathStaysOnLand(w, from, path)).toBe(true);
    expect(terrainSpeedAt(w, kuwait)).toBeGreaterThan(0);
    expect(terrainSpeedAt(w, gulf)).toBe(0);
    expect(() => move(w, 'div-e2', gulf.x, gulf.y)).toThrow(/can't reach/);
  });

  it('is deterministic with orders, including across a mid-move snapshot', () => {
    const play = () => {
      const w = sandbox();
      move(w, 'div-w1', kuwait.x, kuwait.y);
      move(w, 'div-c1', kuwait.x - 100, kuwait.y);
      run(w, 3 * TICKS_PER_DAY);
      applyCommand(w, { type: 'expand', formation: 'div-c1' });
      applyCommand(w, { type: 'setDisrupted', target: { kind: 'link', id: 'road-hafar-rafha' }, disrupted: true });
      return w;
    };
    const a = play();
    const b = play();
    expect(hashState(a)).toBe(hashState(b));

    const restored = cloneWorld(a);
    run(a, 7 * TICKS_PER_DAY);
    run(restored, 7 * TICKS_PER_DAY);
    expect(hashState(restored)).toBe(hashState(a));
    expect(pos(a, 'div-w1')).not.toEqual(pos(sandbox(), 'div-w1'));
  });
});
