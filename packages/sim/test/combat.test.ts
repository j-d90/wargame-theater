import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_DAY,
  applyCommand,
  combatPhase,
  isActive,
  objectivesPhase,
  protection,
  run,
  step,
  type WorldState,
} from '../src/index.ts';
import { duelWorld, placeAt } from './duel.ts';

const f = (w: WorldState, id: string) => w.formations[id]!;

/** b1 and r1 within contact range; b2 and r2 far away. */
function faceOff(mutate?: Parameters<typeof duelWorld>[0]): WorldState {
  const w = duelWorld(mutate);
  placeAt(w, 'b1', 50, 0);
  placeAt(w, 'r1', 60, 0);
  placeAt(w, 'b2', 0, 200);
  placeAt(w, 'r2', 100, 200);
  for (const n of Object.values(w.supply.nodes)) n.position = n.side === 'blue' ? { x: 40, y: 10 } : { x: 70, y: 10 };
  return w;
}

describe('contact and fire', () => {
  it('formations of opposing sides within contact range fight; others do not', () => {
    const w = faceOff();
    combatPhase(w);
    expect(w.contacts).toEqual([['b1', 'r1']]);
    expect(f(w, 'b1').inContact).toBe(true);
    expect(f(w, 'b2').inContact).toBe(false);
    run(w, TICKS_PER_DAY);
    expect(f(w, 'b1').stats.strength).toBeLessThan(1200);
    expect(f(w, 'r1').stats.strength).toBeLessThan(1200);
    expect(f(w, 'b2').stats.strength).toBe(1200);
    expect(w.sides['blue']!.losses).toBe(1200 - f(w, 'b1').stats.strength);
  });

  it('higher quality inflicts more losses and takes fewer', () => {
    const w = faceOff();
    f(w, 'b1').stats.quality = 3000;
    run(w, TICKS_PER_DAY / 2);
    const blueLost = 1200 - f(w, 'b1').stats.strength;
    const redLost = 1200 - f(w, 'r1').stats.strength;
    expect(redLost).toBeGreaterThan(2 * blueLost);
  });

  it('digging in and rough ground protect the defender', () => {
    const w = faceOff();
    const open = protection(w, f(w, 'r1'));
    f(w, 'r1').fortification = 800;
    expect(protection(w, f(w, 'r1'))).toBeCloseTo(open * 1.8, 6);
    w.terrain = { cellKm: 1000, cols: 1, rows: 1, cells: '^', speeds: { '^': 600 }, defense: { '^': 1300 }, regions: null };
    expect(protection(w, f(w, 'r1'))).toBeCloseTo(1.3 * 1.8, 6);
  });

  it('stationary formations dig in; moving ones lose it', () => {
    const w = duelWorld();
    run(w, 10);
    expect(f(w, 'b2').fortification).toBe(10 * w.rules.fortifyPerTick);
    applyCommand(w, { type: 'move', formation: 'b2', to: { x: -50, y: 40 } });
    step(w);
    expect(f(w, 'b2').fortification).toBe(0);
  });

  it('contact pins a moving formation; a retreat order still moves', () => {
    const w = faceOff();
    applyCommand(w, { type: 'move', formation: 'b1', to: { x: 50, y: -100 } });
    step(w); // establishes contact
    const pinned = { ...f(w, 'b1').position };
    step(w);
    expect(f(w, 'b1').position).toEqual(pinned);
    applyCommand(w, { type: 'move', formation: 'b1', to: { x: 0, y: 0 }, kind: 'retreat' });
    step(w);
    expect(f(w, 'b1').position.x).toBeLessThan(pinned.x);
  });
});

describe('breaking and surrender', () => {
  it('a formation whose morale breaks in contact falls back', () => {
    const w = faceOff();
    f(w, 'r1').stats.morale = 310;
    f(w, 'b1').stats.quality = 3000;
    for (let t = 0; t < 40 && f(w, 'r1').status === 'active'; t++) step(w);
    expect(f(w, 'r1').status).toBe('retreating');
    expect(f(w, 'r1').order?.kind).toBe('retreat');
    run(w, TICKS_PER_DAY);
    expect(f(w, 'r1').position.x).toBeGreaterThan(60); // pulled back away from b1
  });

  it('a collapsing formation in contact surrenders; prisoners go to the captor', () => {
    const w = faceOff();
    f(w, 'b1').stats.quality = 5000;
    f(w, 'r1').stats.morale = 100;
    const before = f(w, 'r1').stats.strength;
    for (let t = 0; t < 2 * TICKS_PER_DAY && f(w, 'r1').status !== 'surrendered'; t++) step(w);
    expect(f(w, 'r1').status).toBe('surrendered');
    expect(isActive(w, 'r1')).toBe(false);
    const red = w.sides['red']!;
    expect(red.surrendered + red.losses).toBe(before);
    expect(w.sides['blue']!.prisonersTaken).toBe(red.surrendered);
    expect(() => applyCommand(w, { type: 'move', formation: 'r1', to: { x: 0, y: 0 } })).toThrow(/not an active formation/);
  });
});

describe('objectives', () => {
  it('change hands only when one side alone is within the radius', () => {
    const w = duelWorld();
    placeAt(w, 'b1', 60, 25);
    placeAt(w, 'r1', 300, 300);
    placeAt(w, 'r2', 300, 340);
    objectivesPhase(w);
    expect(w.objectives['town']!.holder).toBe('blue');
    expect(w.objectives['town']!.capturedTick).toBe(0);
    placeAt(w, 'r1', 62, 22); // both present: no change
    objectivesPhase(w);
    expect(w.objectives['town']!.holder).toBe('blue');
  });
});
