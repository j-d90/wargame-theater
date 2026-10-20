// The M5 acceptance tests: a detailed battle gives the same results as
// auto-resolve within tolerance (see tactical.ts for the engagements), and
// Desert Storm stays plausible with every battle fought in detail.
import { describe, expect, it } from 'vitest';
import { ENGAGEMENTS, checkEngagement, lossesAgree } from './tactical.ts';
import { missedBands, runCampaign } from './campaign.ts';

describe('detailed vs aggregate resolution', () => {
  it('judges losses within 25% relative or 3 points, whichever is looser', () => {
    expect(lossesAgree(0.4, 0.49)).toBe(true);
    expect(lossesAgree(0.4, 0.51)).toBe(false);
    expect(lossesAgree(0.01, 0.039)).toBe(true);
    expect(lossesAgree(0.01, 0.045)).toBe(false);
  });

  for (const e of ENGAGEMENTS) {
    it(`${e.name}: losses and outcome agree in at least 16 of 20 seeds`, { timeout: 60_000 }, () => {
      const c = checkEngagement(e, 20);
      expect(c.passes, c.failures.join('\n')).toBeGreaterThanOrEqual(16);
    });
  }
});

describe('Desert Storm with every battle fought in detail', () => {
  it('stays within the plausibility bands in at least 9 of 10 seeds', { timeout: 300_000 }, () => {
    const failures: { seed: number; missed: string[] }[] = [];
    let opened = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = runCampaign(seed, undefined, { detailedBattles: true });
      opened += m.battlesOpened;
      const missed = missedBands(m);
      if (missed.length > 0) failures.push({ seed, missed });
    }
    expect(opened).toBeGreaterThan(50);
    expect(failures.length, JSON.stringify(failures, null, 2)).toBeLessThanOrEqual(1);
  });
});
