// Metrics for judging whether an AI-vs-AI Desert Storm run is plausible.
// Shared by the calibration test and tools/calibrate.ts.
import { loadScenario } from '@tow/content';
import { TICKS_PER_DAY, activeFormations, createWorld, fightingValue, frontier, run, type WorldState } from '../src/index.ts';

const RG = 'iq-rgfc';

function groupValue(world: WorldState, root: string, inside: boolean): number {
  const ids = new Set(frontier(world, root).map((f) => f.id));
  let total = 0;
  for (const f of activeFormations(world)) {
    if (f.side === 'iraq' && ids.has(f.id) === inside) total += fightingValue(f);
  }
  return total;
}

export interface CampaignMetrics {
  seed: number;
  /** Day the coalition ground offensive began, or null. */
  groundWarDay: number | null;
  kuwaitCityHolder: string | null;
  /** Days from the ground offensive to taking Kuwait City, or null. */
  groundWarDays: number | null;
  /** Iraqi fighting value left at the end, share of the start. */
  iraqPowerLeft: number;
  /** Share of Iraqi strength lost to surrender rather than fire. */
  iraqSurrenderShare: number;
  /** Coalition strength lost, share of the start. */
  coalitionLossShare: number;
  /** Fighting value left as a share of the start, for the Republican Guard and the rest. */
  rgLeft: number;
  regularLeft: number;
  msPerTick: number;
}

export function runCampaign(seed: number): CampaignMetrics {
  const world = createWorld(loadScenario('desert-storm'), { seed });
  const rg0 = groupValue(world, RG, true);
  const regular0 = groupValue(world, RG, false);
  const started = performance.now();
  run(world, 43 * TICKS_PER_DAY);
  const ms = performance.now() - started;

  const coalition = world.sides['coalition']!;
  const iraq = world.sides['iraq']!;
  const kc = world.objectives['kuwait-city']!;
  const offensive = coalition.ai?.offensiveTick ?? null;
  const groundWarDay = offensive === null ? null : offensive / TICKS_PER_DAY;
  const taken = kc.holder === 'coalition' && kc.capturedTick !== null ? kc.capturedTick / TICKS_PER_DAY : null;
  let iraqValue = 0;
  for (const f of activeFormations(world)) if (f.side === 'iraq') iraqValue += fightingValue(f);
  return {
    seed,
    groundWarDay,
    kuwaitCityHolder: kc.holder,
    groundWarDays: taken !== null && groundWarDay !== null ? taken - groundWarDay : null,
    iraqPowerLeft: iraqValue / iraq.initialCombatPower,
    iraqSurrenderShare: iraq.surrendered / Math.max(1, iraq.surrendered + iraq.losses),
    coalitionLossShare: (coalition.losses + coalition.surrendered) / coalition.initialStrength,
    rgLeft: groupValue(world, RG, true) / rg0,
    regularLeft: groupValue(world, RG, false) / regular0,
    msPerTick: ms / (43 * TICKS_PER_DAY),
  };
}

/** The plausibility bands agreed in the M3 plan. Returns the bands a run misses. */
export function missedBands(m: CampaignMetrics): string[] {
  const missed: string[] = [];
  if (m.kuwaitCityHolder !== 'coalition') missed.push('coalition does not hold Kuwait City');
  if (m.groundWarDay === null || m.groundWarDay < 30 || m.groundWarDay > 42) missed.push(`ground war starts day ${m.groundWarDay}`);
  if (m.groundWarDays === null || m.groundWarDays < 3 || m.groundWarDays > 10) missed.push(`ground war lasts ${m.groundWarDays?.toFixed(1)} days`);
  if (m.iraqPowerLeft >= 0.3) missed.push(`Iraq keeps ${(m.iraqPowerLeft * 100).toFixed(0)}% of its power`);
  if (m.iraqSurrenderShare <= 0.5) missed.push(`only ${(m.iraqSurrenderShare * 100).toFixed(0)}% of Iraqi losses are surrenders`);
  if (m.coalitionLossShare >= 0.03) missed.push(`coalition loses ${(m.coalitionLossShare * 100).toFixed(1)}%`);
  if (m.rgLeft < m.regularLeft) missed.push('Republican Guard is not the most intact Iraqi force');
  return missed;
}
