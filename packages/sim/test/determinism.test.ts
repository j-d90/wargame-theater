import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_DAY,
  canonicalJson,
  cloneWorld,
  hashState,
  run,
  step,
  type Command,
  type WorldState,
} from '../src/index.ts';
import { tinyWorld } from './helpers.ts';

const DAYS = 43;

function dailyHashes(world: WorldState, days: number): string[] {
  const hashes: string[] = [];
  run(world, days * TICKS_PER_DAY, (w) => {
    if (w.tick % TICKS_PER_DAY === 0) hashes.push(hashState(w));
  });
  return hashes;
}

describe('determinism', () => {
  it('same seed => same state hash on every day of a 43-day run', () => {
    const a = dailyHashes(tinyWorld(), DAYS);
    const b = dailyHashes(tinyWorld(), DAYS);
    expect(a).toHaveLength(DAYS);
    expect(a).toEqual(b);
    // The state actually changes over the run; we are not comparing constants.
    expect(new Set(a).size).toBeGreaterThan(DAYS / 2);
  });

  it('a different seed gives a different hash', () => {
    const a = tinyWorld({ seed: 1 });
    const b = tinyWorld({ seed: 2 });
    run(a, DAYS * TICKS_PER_DAY);
    run(b, DAYS * TICKS_PER_DAY);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('a snapshot taken mid-run continues to the same final state', () => {
    const straight = tinyWorld();
    run(straight, DAYS * TICKS_PER_DAY);

    const first = tinyWorld();
    run(first, 20 * TICKS_PER_DAY + 37);
    const restored = cloneWorld(first);
    run(restored, DAYS * TICKS_PER_DAY - restored.tick);

    expect(hashState(restored)).toBe(hashState(straight));
    expect(restored).toEqual(straight);
  });

  it('same orders at the same ticks => same result', () => {
    const orders = new Map<number, Command[]>([
      [100, [{ type: 'setDisrupted', target: { kind: 'node', id: 'fwd-depot-a' }, disrupted: true }]],
      [500, [{ type: 'setDisrupted', target: { kind: 'link', id: 'msr-1' }, disrupted: true }]],
      [900, [{ type: 'setDisrupted', target: { kind: 'node', id: 'fwd-depot-a' }, disrupted: false }]],
    ]);
    const play = () => {
      const w = tinyWorld();
      for (let t = 0; t < 12 * TICKS_PER_DAY; t++) step(w, orders.get(t) ?? []);
      return hashState(w);
    };
    const withoutOrders = tinyWorld();
    run(withoutOrders, 12 * TICKS_PER_DAY);

    expect(play()).toBe(play());
    expect(play()).not.toBe(hashState(withoutOrders));
  });

  it('hash ignores object key order but not values', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(hashState({ a: 1, b: 2 })).toBe(hashState({ b: 2, a: 1 }));
    expect(hashState({ a: 1, b: 2 })).not.toBe(hashState({ a: 1, b: 3 }));
    expect(() => canonicalJson({ x: NaN })).toThrow();
  });

  it('state survives a JSON round trip unchanged (saves need nothing special)', () => {
    const w = tinyWorld();
    run(w, 5 * TICKS_PER_DAY);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });
});
