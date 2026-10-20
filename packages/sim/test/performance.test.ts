// Tick cost of a large detailed battle. The design's v0 target is 8 ms a tick
// with about 2,000 battalions expanded; this guards against regressions with
// headroom for slow or busy test machines, and reports what it measured.
import { describe, expect, it } from 'vitest';
import { battleMembers, step } from '../src/index.ts';
import { bigBattleWorld } from './bigbattle.ts';

function medianTickMs(perSide: number): { median: number; units: number } {
  const w = bigBattleWorld(perSide);
  const times: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    step(w);
    times.push(performance.now() - t);
  }
  const warm = times.slice(10).sort((a, b) => a - b);
  return { median: warm[Math.floor(warm.length / 2)]!, units: battleMembers(w).size };
}

describe('detailed battle performance', () => {
  it('runs a 2,000-battalion battle at a playable tick cost', { timeout: 60_000 }, () => {
    const big = medianTickMs(125);
    console.log(`2,000-battalion battle: ${big.median.toFixed(1)} ms per tick (median)`);
    expect(big.units).toBe(2000);
    expect(big.median).toBeLessThan(40);
  });
});
