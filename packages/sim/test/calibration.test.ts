// The M3 acceptance test: auto-resolve plays out the full campaign with
// plausible results. Both sides are AI-controlled; see campaign.ts for the bands.
import { describe, expect, it } from 'vitest';
import { loadScenario } from '@tow/content';
import { TICKS_PER_DAY, cloneWorld, createWorld, hashState, run } from '../src/index.ts';
import { missedBands, runCampaign, type CampaignMetrics } from './campaign.ts';

describe('Desert Storm auto-resolve', () => {
  it('is deterministic with both AIs running, including across a mid-campaign snapshot', () => {
    const a = createWorld(loadScenario('desert-storm'), { seed: 7 });
    const b = createWorld(loadScenario('desert-storm'), { seed: 7 });
    run(a, 36 * TICKS_PER_DAY);
    run(b, 36 * TICKS_PER_DAY);
    expect(hashState(a)).toBe(hashState(b));
    const restored = cloneWorld(a);
    run(a, 7 * TICKS_PER_DAY);
    run(restored, 7 * TICKS_PER_DAY);
    expect(hashState(restored)).toBe(hashState(a));
  });

  it('plays out within the plausibility bands in at least 18 of 20 seeds, under 60 s each', { timeout: 300_000 }, () => {
    const runs: CampaignMetrics[] = [];
    for (let seed = 1; seed <= 20; seed++) runs.push(runCampaign(seed));
    const failures = runs.map((m) => ({ seed: m.seed, missed: missedBands(m) })).filter((r) => r.missed.length > 0);
    expect(failures.length, JSON.stringify(failures, null, 2)).toBeLessThanOrEqual(2);
    for (const m of runs) expect(m.msPerTick * 43 * TICKS_PER_DAY).toBeLessThan(60_000);
  });
});
