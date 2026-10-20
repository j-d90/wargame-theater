import { describe, expect, it } from 'vitest';
import {
  activeFormations,
  alive,
  applyCommand,
  breakDown,
  cloneWorld,
  frontier,
  hashState,
  rollup,
  run,
  step,
  summarize,
  theaterUnits,
  type WorldState,
} from '../src/index.ts';
import { duelWorld, placeAt } from './duel.ts';
import { bigBattleWorld } from './bigbattle.ts';

const f = (w: WorldState, id: string) => w.formations[id]!;

/** b1 and r1 face each other 12 km apart; b2 and r2 far away. */
function faceOff(mutate?: Parameters<typeof duelWorld>[0]): WorldState {
  const w = duelWorld(mutate);
  placeAt(w, 'b1', 50, 0);
  placeAt(w, 'r1', 62, 0);
  placeAt(w, 'b2', 0, 200);
  placeAt(w, 'r2', 100, 200);
  for (const n of Object.values(w.supply.nodes)) n.position = n.side === 'blue' ? { x: 40, y: 10 } : { x: 70, y: 10 };
  return w;
}

const open = (w: WorldState, id = 'b1') => applyCommand(w, { type: 'openBattle', formation: id });
const battleId = (w: WorldState) => Object.keys(w.battles)[0]!;
const sideStrength = (w: WorldState, side: string) => activeFormations(w).filter((u) => u.side === side).reduce((s, u) => s + u.stats.strength, 0);

describe('breaking a division down into battalions', () => {
  it('splits its stats exactly by battalion weight, under brigades from its composition', () => {
    const w = faceOff();
    const before = { ...f(w, 'b1').stats };
    breakDown(w, 'b1');
    // test-division: 1st Brigade (2 tank, 1 mech), 2nd Brigade (2 mech, 1 infantry), Artillery (2).
    expect(f(w, 'b1').childIds).toEqual(['b1/1', 'b1/2', 'b1/a']);
    expect(f(w, 'b1/1').childIds).toEqual(['b1/1/mech-1', 'b1/1/tk-1', 'b1/1/tk-2']);
    expect(f(w, 'b1/1/tk-2').name).toBe('1-2 Tk');
    expect(f(w, 'b1/a/arty-1').tacticalType).toBe('artillery-battalion');
    const parts = frontier(w, 'b1');
    expect(parts).toHaveLength(8);
    for (const key of ['strength', 'establishment', 'stock', 'stockCap', 'supplyPerTick'] as const) {
      expect(parts.reduce((s, p) => s + p.stats[key], 0)).toBe(before[key]);
    }
    expect(rollup(w, 'b1')).toEqual(before);
    // Artillery is lighter than a tank battalion.
    expect(f(w, 'b1/a/arty-1').stats.strength).toBeLessThan(f(w, 'b1/1/tk-1').stats.strength);
  });
});

describe('opening and closing a detailed battle', () => {
  it('needs the formation to be in contact with the enemy', () => {
    const w = faceOff();
    expect(() => open(w, 'b2')).toThrow(/not in contact/);
    expect(Object.keys(w.battles)).toEqual([]);
  });

  it('takes in everything linked by contact and fights it battalion by battalion', () => {
    const w = faceOff();
    open(w);
    const b = w.battles[battleId(w)]!;
    expect(b.roots).toEqual(['b1', 'r1']);
    expect(b.startStrength).toEqual({ blue: 1200, red: 1200 });
    expect(f(w, 'b1').battle).toBe(b.id);
    expect(frontier(w, 'b1').every((p) => p.echelon === 'battalion')).toBe(true);
    // Deployed facing each other: blue's direct-fire line is east of its artillery.
    expect(f(w, 'b1/1/tk-1').position.x).toBeGreaterThan(f(w, 'b1/a/arty-1').position.x);
    expect(f(w, 'r1/1/tk-1').position.x).toBeLessThan(f(w, 'r1/a/arty-1').position.x);
    // Far-away formations are untouched.
    expect(f(w, 'b2').battle).toBeNull();
    expect(f(w, 'b2').childIds).toEqual([]);
  });

  it('collapses back to exactly the formation it was when closed straight away', () => {
    const w = faceOff();
    const before = { b1: { ...f(w, 'b1').stats }, r1: { ...f(w, 'r1').stats } };
    open(w);
    applyCommand(w, { type: 'closeBattle', battle: battleId(w) });
    expect(Object.keys(w.battles)).toEqual([]);
    expect(f(w, 'b1').aggregated).toBe(true);
    expect(f(w, 'b1').battle).toBeNull();
    expect(f(w, 'b1').stats).toEqual(before.b1);
    expect(f(w, 'r1').stats).toEqual(before.r1);
  });

  it('keeps every point of strength accounted for through a fight and back', () => {
    const w = faceOff();
    step(w);
    open(w);
    applyCommand(w, { type: 'move', formation: 'b1', to: { x: 80, y: 0 }, kind: 'attack' });
    run(w, 24);
    const inBattle = { blue: sideStrength(w, 'blue'), red: sideStrength(w, 'red') };
    applyCommand(w, { type: 'closeBattle', battle: battleId(w) });
    for (const side of ['blue', 'red'] as const) {
      expect(sideStrength(w, side)).toBe(inBattle[side]);
      const s = w.sides[side]!;
      expect(sideStrength(w, side) + s.losses + s.surrendered).toBe(s.initialStrength);
    }
    expect(w.sides['red']!.losses).toBeGreaterThan(0);
    // Expanding again reuses the battalions generated the first time.
    const count = Object.keys(w.formations).length;
    open(w);
    expect(Object.keys(w.formations).length).toBe(count);
  });

  it('is deterministic, including across a snapshot taken mid-battle', () => {
    const play = () => {
      const w = faceOff();
      step(w, [{ type: 'openBattle', formation: 'b1' }, { type: 'move', formation: 'b1', to: { x: 80, y: 0 }, kind: 'attack' }]);
      run(w, 30);
      return w;
    };
    const a = play();
    const b = play();
    expect(hashState(a)).toBe(hashState(b));
    const c = cloneWorld(a);
    run(a, 30);
    run(c, 30);
    expect(hashState(c)).toBe(hashState(a));
  });

  it('pulls in formations that come within contact range', () => {
    const w = faceOff();
    open(w);
    placeAt(w, 'r2', 58, 14);
    step(w);
    expect(w.battles[battleId(w)]!.roots).toEqual(['b1', 'r1', 'r2']);
    expect(f(w, 'r2').childIds.length).toBeGreaterThan(0);
  });

  it('closes by itself once the two sides have been apart for a while', () => {
    const w = faceOff();
    open(w);
    for (const p of frontier(w, 'r1')) p.position = { x: p.position.x + 60, y: p.position.y };
    run(w, w.rules.battleIdleTicks + 1);
    expect(Object.keys(w.battles)).toEqual([]);
    expect(f(w, 'r1').aggregated).toBe(true);
  });

  it('refuses to expand or collapse part of a battle', () => {
    const w = faceOff();
    open(w);
    expect(() => applyCommand(w, { type: 'aggregate', formation: 'b1/1' })).toThrow(/close the battle first/);
    expect(() => applyCommand(w, { type: 'expand', formation: 'b1' })).toThrow(/close the battle first/);
  });
});

describe('orders in a detailed battle', () => {
  it('a theater order to the division becomes intent its battalions follow', () => {
    const w = faceOff();
    open(w);
    applyCommand(w, { type: 'move', formation: 'b1', to: { x: 20, y: 0 }, kind: 'retreat' });
    expect(f(w, 'b1').order?.kind).toBe('retreat');
    const x0 = f(w, 'b1').position.x;
    run(w, 8);
    for (const p of frontier(w, 'b1')) expect(p.order?.kind ?? 'arrived').not.toBe('attack');
    expect(f(w, 'b1').position.x).toBeLessThan(x0);
  });

  it('attacking battalions close on the enemy and stop within range', () => {
    const w = faceOff();
    open(w);
    applyCommand(w, { type: 'move', formation: 'b1', to: { x: 80, y: 0 }, kind: 'attack' });
    run(w, 40);
    const tank = f(w, 'b1/1/tk-1');
    const nearest = Math.min(...frontier(w, 'r1').filter(alive).map((e) => Math.hypot(e.position.x - tank.position.x, e.position.y - tank.position.y)));
    expect(nearest).toBeLessThanOrEqual(6);
    expect(tank.inContact).toBe(true);
  });

  it('direct orders put a battalion under the player until handed back', () => {
    // No AI on either side: the player commands both.
    const w = faceOff();
    open(w);
    applyCommand(w, { type: 'move', formation: 'b1', to: { x: 80, y: 0 }, kind: 'attack' });
    applyCommand(w, { type: 'tacticalOrder', formation: 'b1/1/tk-1', order: 'hold' });
    const at = { ...f(w, 'b1/1/tk-1').position };
    run(w, 12);
    expect(f(w, 'b1/1/tk-1').position).toEqual(at);
    expect(f(w, 'b1/1/tk-2').position.x).toBeGreaterThan(at.x);
    applyCommand(w, { type: 'tacticalOrder', formation: 'b1/1/tk-1', order: 'auto' });
    run(w, 8);
    expect(f(w, 'b1/1/tk-1').position.x).toBeGreaterThan(at.x);
    expect(() => applyCommand(w, { type: 'tacticalOrder', formation: 'b2', order: 'hold' })).toThrow(/not a unit in a detailed battle/);
  });
});

describe('detailed fire', () => {
  it('matches aggregate fire when every battalion can reach the enemy', () => {
    // With ranges long enough for everyone, total fire is the aggregate formula's.
    const lost = (detailed: boolean, seed: number) => {
      const w = faceOff();
      w.seed = seed;
      w.rng = {};
      for (const t of Object.values(w.tactical.types)) t.rangeKm = 100;
      if (detailed) open(w);
      step(w);
      // Damage below a whole point is carried; count it.
      const hurt = (id: string) => frontier(w, id).reduce((sum, p) => sum + p.stats.establishment - p.stats.strength + p.lossCarry, 0);
      return { blue: hurt('b1'), red: hurt('r1') };
    };
    let agg = 0;
    let det = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = lost(false, seed);
      const d = lost(true, seed);
      agg += a.blue + a.red;
      det += d.blue + d.red;
    }
    expect(det).toBeGreaterThan(agg * 0.95);
    expect(det).toBeLessThan(agg * 1.05);
  });

  it('a battalion out of range of everything neither fires nor is fired on', () => {
    const w = faceOff();
    open(w);
    const far = f(w, 'b1/2/inf-1');
    far.position = { x: 0, y: 100 };
    step(w);
    expect(far.inContact).toBe(false);
    expect(far.stats.strength).toBe(far.stats.establishment);
  });

  it('a division whose morale breaks falls back as a whole', () => {
    const w = faceOff();
    open(w);
    for (const p of frontier(w, 'r1')) p.stats.morale = 250;
    applyCommand(w, { type: 'move', formation: 'b1', to: { x: 80, y: 0 }, kind: 'attack' });
    run(w, 20);
    const parts = frontier(w, 'r1').filter(alive);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.status === 'retreating' || p.order?.kind === 'retreat')).toBe(true);
  });
});

describe('summaries', () => {
  it('show a battle as its divisions at theater level and its battalions in the tactical detail', () => {
    const w = faceOff();
    open(w);
    const id = battleId(w);
    const s = summarize(w, { battle: id });
    expect(s.battles.map((b) => b.id)).toEqual([id]);
    expect(s.active.map((u) => u.id)).toEqual(['b1', 'b2', 'r1', 'r2']);
    const b1 = s.active.find((u) => u.id === 'b1')!;
    expect(b1.battle).toBe(id);
    expect(b1.strength).toBe(1200);
    expect(s.tactical?.units).toHaveLength(16);
    expect(s.tactical?.units.find((u) => u.id === 'b1/a/arty-1')?.rangeKm).toBeGreaterThan(10);
    expect(summarize(w).tactical).toBeNull();
    expect(theaterUnits(w).map((u) => u.id)).toEqual(['b1', 'b2', 'r1', 'r2']);
  });
});

describe('level switching speed', () => {
  it('opens and closes a 2,000-battalion battle well inside the 200 ms budget', () => {
    const w = bigBattleWorld(125);
    expect(Object.values(w.battles)[0]!.roots).toHaveLength(250);
    expect(activeFormations(w).length).toBe(2000);
    // Reopen to time a warm switch, as in play.
    applyCommand(w, { type: 'closeBattle', battle: battleId(w) });
    let t = performance.now();
    open(w, 'b0');
    const openMs = performance.now() - t;
    t = performance.now();
    applyCommand(w, { type: 'closeBattle', battle: battleId(w) });
    const closeMs = performance.now() - t;
    expect(openMs).toBeLessThan(200);
    expect(closeMs).toBeLessThan(200);
  });
});
