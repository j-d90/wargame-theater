import { describe, expect, it } from 'vitest';
import { distribute } from '../src/index.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('distribute', () => {
  it('splits proportionally into integers that sum to the total', () => {
    expect(distribute(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(distribute(100, [1, 3])).toEqual([25, 75]);
    const r = distribute(997, [13, 7, 29, 51]);
    expect(sum(r)).toBe(997);
  });

  it('breaks ties toward the lower index', () => {
    expect(distribute(1, [5, 5])).toEqual([1, 0]);
    expect(distribute(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it('splits evenly when all weights are zero', () => {
    expect(distribute(4, [0, 0])).toEqual([2, 2]);
  });

  it('respects caps and re-splits overflow', () => {
    expect(distribute(10, [9, 1], [5, 100])).toEqual([5, 5]);
    expect(distribute(10, [1, 1], [3, 3])).toEqual([3, 3]); // short when everything is full
  });

  it('never exceeds weights when weights are also the caps', () => {
    const w = [7, 0, 3, 12];
    for (let t = 0; t <= sum(w); t++) {
      const r = distribute(t, w, w);
      expect(sum(r)).toBe(t);
      r.forEach((v, i) => expect(v).toBeLessThanOrEqual(w[i]!));
    }
  });
});
