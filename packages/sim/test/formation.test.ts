import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_DAY,
  activeFormations,
  aggregate,
  cloneWorld,
  expand,
  frontier,
  isActive,
  rollup,
  run,
  type WorldState,
} from '../src/index.ts';
import { tinyWorld } from './helpers.ts';

const activeIds = (w: WorldState) => activeFormations(w).map((f) => f.id);
const stats = (w: WorldState, id: string) => w.formations[id]!.stats;

describe('formation tree', () => {
  it('builds parent/child links and starts div-1 aggregated', () => {
    const w = tinyWorld();
    expect(w.formations['i-corps']!.childIds).toEqual(['div-1', 'div-2', 'div-3']);
    expect(w.formations['div-1']!.aggregated).toBe(true);
    expect(activeIds(w)).toEqual(['div-1', 'div-2', 'div-3']);
    expect(isActive(w, 'bde-1-1')).toBe(false);
    expect(isActive(w, 'i-corps')).toBe(false); // expanded container
  });

  it('aggregates by summing extensive stats and strength-weighting intensive ones', () => {
    const w = tinyWorld();
    const s = stats(w, 'div-1');
    expect(s.strength).toBe(400 + 360);
    expect(s.stockCap).toBe(864 + 864);
    expect(s.readiness).toBe(953); // (400*1000 + 360*900) / 760, rounded
    expect(s.morale).toBe(1000);
  });

  it('expand then aggregate with no ticks in between is an exact round trip', () => {
    const w = tinyWorld();
    const before = cloneWorld(w);
    expand(w, 'div-1');
    expect(activeIds(w)).toEqual(['bde-1-1', 'bde-1-2', 'div-2', 'div-3']);
    expect(stats(w, 'bde-1-2')).toEqual(before.formations['bde-1-2']!.stats);
    aggregate(w, 'div-1');
    expect(w).toEqual(before);
  });

  it('pushes changes made while aggregated back down on expand, conserving totals', () => {
    const w = tinyWorld();
    // Starve 1st Division (3 days of carried stock) for four days while it is a single block.
    w.supply.nodes['fwd-depot-a']!.disrupted = true;
    run(w, 4 * TICKS_PER_DAY);
    const agg = { ...stats(w, 'div-1') };
    expect(agg.readiness).toBeLessThan(w.formations['div-1']!.baseline!.readiness);

    expand(w, 'div-1');
    const b1 = stats(w, 'bde-1-1');
    const b2 = stats(w, 'bde-1-2');
    expect(b1.strength + b2.strength).toBe(agg.strength);
    expect(b1.stock + b2.stock).toBe(agg.stock);
    expect(b1.stockCap + b2.stockCap).toBe(agg.stockCap);
    expect(b1.supplyPerTick + b2.supplyPerTick).toBe(agg.supplyPerTick);
    expect(b1.stock).toBeLessThanOrEqual(b1.stockCap);
    expect(b2.stock).toBeLessThanOrEqual(b2.stockCap);
    // Weighted readiness of the children matches the aggregate (within rounding).
    expect(Math.abs(rollup(w, 'div-1').readiness - agg.readiness)).toBeLessThanOrEqual(1);
    // The brigade that started lower is still lower.
    expect(b2.readiness).toBeLessThan(b1.readiness);
  });

  it('splits partially drawn-down stock in proportion on expand', () => {
    const w = tinyWorld();
    w.supply.nodes['fwd-depot-a']!.disrupted = true;
    run(w, 2 * TICKS_PER_DAY);
    expect(stats(w, 'div-1').stock).toBe(1728 - 2 * TICKS_PER_DAY * 6);
    expand(w, 'div-1');
    expect(stats(w, 'bde-1-1').stock).toBe(288);
    expect(stats(w, 'bde-1-2').stock).toBe(288);
  });

  it('nests: aggregating the corps hides an already-aggregated division, and expanding restores it', () => {
    const w = tinyWorld();
    const divBaseline = w.formations['div-1']!.baseline;
    aggregate(w, 'i-corps');
    expect(activeIds(w)).toEqual(['i-corps']);
    expect(stats(w, 'i-corps').strength).toBe(760 + 1200 + 1200);

    expand(w, 'i-corps');
    expect(activeIds(w)).toEqual(['div-1', 'div-2', 'div-3']);
    expect(w.formations['div-1']!.baseline).toEqual(divBaseline);
    expand(w, 'div-1');
    expect(activeIds(w)).toEqual(['bde-1-1', 'bde-1-2', 'div-2', 'div-3']);
  });

  it('frontier and rollup describe any subtree', () => {
    const w = tinyWorld();
    expect(frontier(w, 'i-corps').map((f) => f.id)).toEqual(['div-1', 'div-2', 'div-3']);
    expect(frontier(w, 'div-1').map((f) => f.id)).toEqual(['div-1']);
    expect(rollup(w, 'blueland').strength).toBe(3160);
  });

  it('rejects invalid LOD changes', () => {
    const w = tinyWorld();
    expect(() => aggregate(w, 'div-2')).toThrow(/no children/);
    expect(() => aggregate(w, 'div-1')).toThrow(/already aggregated/);
    expect(() => expand(w, 'i-corps')).toThrow(/not aggregated/);
    aggregate(w, 'i-corps');
    expect(() => expand(w, 'div-1')).toThrow(/hidden/);
    expect(() => expand(w, 'nope')).toThrow(/Unknown formation/);
  });

  it('hidden formations are frozen while their ancestor is aggregated', () => {
    const w = tinyWorld();
    const hidden = { ...stats(w, 'bde-1-1') };
    run(w, TICKS_PER_DAY);
    expect(stats(w, 'bde-1-1')).toEqual(hidden);
  });
});
