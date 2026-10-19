import { describe, expect, it } from 'vitest';
import type { AirAllocation } from '@tow/sim';
import { AIR_KEYS, rebalance } from '../src/ui/allocation.ts';

const total = (a: AirAllocation) => AIR_KEYS.reduce((s, k) => s + a[k], 0);

describe('air allocation rebalance', () => {
  it('keeps the total at 1000 and the other shares in proportion', () => {
    const a = rebalance({ counterAir: 500, interdiction: 250, attrition: 250, support: 0 }, 'support', 500);
    expect(a).toEqual({ counterAir: 250, interdiction: 125, attrition: 125, support: 500 });
  });

  it('spreads evenly when the others are all zero', () => {
    const a = rebalance({ counterAir: 1000, interdiction: 0, attrition: 0, support: 0 }, 'counterAir', 400);
    expect(total(a)).toBe(1000);
    expect(a.interdiction).toBe(200);
  });

  it('clamps and always sums to 1000', () => {
    for (const v of [-50, 0, 333, 999, 1000, 1500]) {
      expect(total(rebalance({ counterAir: 100, interdiction: 200, attrition: 300, support: 400 }, 'attrition', v))).toBe(1000);
    }
  });
});
