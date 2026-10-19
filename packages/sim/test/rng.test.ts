import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextInt, nextU32 } from '../src/index.ts';

const draw = (s: ReturnType<typeof createRng>, n: number) => Array.from({ length: n }, () => nextU32(s));

describe('seeded RNG', () => {
  it('produces the same sequence for the same seed and label', () => {
    expect(draw(createRng(42, 'x'), 100)).toEqual(draw(createRng(42, 'x'), 100));
  });

  it('differs across seeds and across labels', () => {
    const base = draw(createRng(42, 'x'), 10);
    expect(draw(createRng(43, 'x'), 10)).not.toEqual(base);
    expect(draw(createRng(42, 'y'), 10)).not.toEqual(base);
  });

  it('continues identically from a copied state (save/restore)', () => {
    const s = createRng(1);
    draw(s, 37);
    const saved = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(draw(saved, 50)).toEqual(draw(s, 50));
  });

  it('keeps labelled streams independent', () => {
    const a1 = createRng(5, 'a');
    const a2 = createRng(5, 'a');
    const b = createRng(5, 'b');
    draw(b, 1000); // heavy use of another stream must not affect stream "a"
    expect(draw(a1, 20)).toEqual(draw(a2, 20));
  });

  it('nextInt stays in range and hits both ends', () => {
    const s = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = nextInt(s, -2, 2);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
    expect(() => nextInt(s, 3, 1)).toThrow();
  });

  it('nextFloat is in [0, 1)', () => {
    const s = createRng(11);
    for (let i = 0; i < 1000; i++) {
      const v = nextFloat(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
