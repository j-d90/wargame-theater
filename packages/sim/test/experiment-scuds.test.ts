// M4 acceptance: strategic choices measurably change how the theater war unfolds.
// One experiment per file so they run in parallel.
import { describe, expect, it } from 'vitest';
import { EXPERIMENTS, runExperiment } from './campaign.ts';

const experiment = EXPERIMENTS[0]!;

describe(`experiment: ${experiment.name}`, () => {
  it('shows the expected effect in at least 16 of 20 seed pairs', { timeout: 600_000 }, () => {
    const r = runExperiment(experiment, 20);
    expect(r.passed, experiment.describe(r.a, r.b)).toBeGreaterThanOrEqual(16);
  });
});
