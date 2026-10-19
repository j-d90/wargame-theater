import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, airPhase, applyCommand, dailyAirPhase, linkThroughput, run } from '../src/index.ts';
import { duelWorld } from './duel.ts';

const withAir = (blue: number, red: number) =>
  duelWorld((raw) => {
    raw.sides![0]!.air = { sortiesPerDay: blue, quality: 2000 };
    raw.sides![1]!.air = { sortiesPerDay: red, quality: 500 };
  });

describe('air power', () => {
  it('superiority follows effort times quality, and counter-air wears down the enemy pool', () => {
    const w = withAir(1000, 1000);
    applyCommand(w, { type: 'setAirAllocation', side: 'blue', allocation: { counterAir: 1000, interdiction: 0, attrition: 0, support: 0 } });
    dailyAirPhase(w);
    expect(w.sides['blue']!.air!.superiority).toBe(800); // 1000x2000 vs 1000x500
    expect(w.sides['red']!.air!.pool).toBeLessThan(1000);
    const pool = w.sides['red']!.air!.pool;
    run(w, 5 * TICKS_PER_DAY);
    expect(w.sides['red']!.air!.pool).toBeLessThan(pool);
  });

  it('attrition strikes only the enemy and costs it morale', () => {
    const w = withAir(2000, 0);
    applyCommand(w, { type: 'setAirAllocation', side: 'blue', allocation: { counterAir: 0, interdiction: 0, attrition: 1000, support: 0 } });
    run(w, 3 * TICKS_PER_DAY);
    expect(w.formations['r1']!.stats.strength).toBeLessThan(1200);
    expect(w.formations['r1']!.stats.morale).toBeLessThan(1000);
    expect(w.formations['b1']!.stats.strength).toBe(1200);
  });

  it('interdiction damages enemy links with diminishing returns, and damage is repaired', () => {
    const w = withAir(2000, 0);
    applyCommand(w, { type: 'setAirAllocation', side: 'blue', allocation: { counterAir: 0, interdiction: 1000, attrition: 0, support: 0 } });
    run(w, 2 * TICKS_PER_DAY);
    const red = w.supply.links['red-road']!;
    expect(red.damage).toBeGreaterThan(0);
    expect(red.damage).toBeLessThan(1000);
    expect(w.supply.links['blue-road']!.damage).toBe(0);
    expect(linkThroughput(red)).toBeLessThan(60);
    applyCommand(w, { type: 'setAirAllocation', side: 'blue', allocation: { counterAir: 1000, interdiction: 0, attrition: 0, support: 0 } });
    const damaged = red.damage;
    run(w, 2 * TICKS_PER_DAY);
    expect(red.damage).toBeLessThan(damaged);
  });

  it('close support raises ground fire, capped', () => {
    const w = withAir(5000, 0);
    applyCommand(w, { type: 'setAirAllocation', side: 'blue', allocation: { counterAir: 0, interdiction: 0, attrition: 0, support: 1000 } });
    dailyAirPhase(w);
    expect(w.sides['blue']!.air!.supportBonus).toBe(w.rules.supportCap);
    airPhase(w);
  });

  it('rejects allocations that do not sum to 1000', () => {
    const w = withAir(100, 100);
    expect(() => applyCommand(w, { type: 'setAirAllocation', side: 'blue', allocation: { counterAir: 500, interdiction: 0, attrition: 0, support: 0 } })).toThrow(/1000/);
  });
});
