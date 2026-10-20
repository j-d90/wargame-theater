// Metrics for judging whether an AI-vs-AI Desert Storm run is plausible, and
// for the M4 experiments comparing strategic choices. Shared by the tests
// and tools/calibrate.ts.
import { loadScenario, scenarioFiles, validateScenario, type ScenarioInput } from '@tow/content';
import { TICKS_PER_DAY, activeFormations, battleMembers, createWorld, fightingValue, frontier, step, type Command, type WorldState } from '../src/index.ts';

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
  /** Day the cease-fire was declared, or null. */
  ceasefireDay: number | null;
  israelIntervened: boolean;
  /** Coalition governments that pulled their forces out. */
  withdrawnActors: string[];
  /** Lowest home support among the coalition democracies at the end, permille. */
  minSupport: number;
  /** Iraqi fighting value when the ground war began, share of the start. */
  iraqPowerAtGroundWar: number | null;
  msPerTick: number;
  /** Detailed battles opened, and the most battalions fighting in detail at once. */
  battlesOpened: number;
  peakDetailedUnits: number;
}

/** The Desert Storm scenario with an edit applied, for experiments. */
export function variant(edit: (raw: ScenarioInput) => void): ScenarioInput {
  const raw = structuredClone(scenarioFiles['desert-storm']) as ScenarioInput;
  edit(raw);
  return raw;
}

const coalitionStrategy = (raw: ScenarioInput) => raw.sides!.find((s) => s.id === 'coalition')!.ai!.strategy!;

export const POLICIES = {
  historical: (_raw: ScenarioInput) => {},
  ignoreScuds: (raw: ScenarioInput) => {
    coalitionStrategy(raw).scudResponse = 'ignore';
  },
  heavyBombing: (raw: ScenarioInput) => {
    coalitionStrategy(raw).strategicBombing = 300;
  },
  noBombing: (raw: ScenarioInput) => {
    coalitionStrategy(raw).strategicBombing = 0;
  },
  pursue: (raw: ScenarioInput) => {
    coalitionStrategy(raw).pursueAfterLiberation = true;
  },
  eliteIraq: (raw: ScenarioInput) => {
    raw.sides!.find((s) => s.id === 'iraq')!.ai!.competence = 1000;
  },
  greenIraq: (raw: ScenarioInput) => {
    raw.sides!.find((s) => s.id === 'iraq')!.ai!.competence = 250;
  },
} satisfies Record<string, (raw: ScenarioInput) => void>;

/** Commands that open a detailed battle for every contact not yet fought in detail (the M5 campaign check). */
export function openAllBattles(world: WorldState): Command[] {
  const fighting = battleMembers(world);
  const open = new Set<string>();
  const out: Command[] = [];
  for (const [a, b] of world.contacts) {
    if (fighting.has(a) || fighting.has(b) || open.has(a) || open.has(b)) continue;
    open.add(a);
    open.add(b);
    out.push({ type: 'openBattle', formation: a });
  }
  return out;
}

export interface CampaignOptions {
  /** Fight every battle in detail, opening them as contacts appear (checked hourly). */
  detailedBattles?: boolean;
}

export function runCampaign(seed: number, edit: (raw: ScenarioInput) => void = POLICIES.historical, options: CampaignOptions = {}): CampaignMetrics {
  const result = validateScenario(variant(edit));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  const world = createWorld(result.value, { seed });
  const rg0 = groupValue(world, RG, true);
  const regular0 = groupValue(world, RG, false);
  const started = performance.now();
  let iraqPowerAtGroundWar: number | null = null;
  const days = result.value.scenario.days;
  // Fighting stops at a cease-fire, but units recover afterwards: judge the war where it ended.
  let atEnd: { iraq: number; rg: number; regular: number } | null = null;
  const measure = (w: WorldState) => {
    let iraq = 0;
    for (const f of activeFormations(w)) if (f.side === 'iraq') iraq += fightingValue(f);
    return { iraq, rg: groupValue(w, RG, true), regular: groupValue(w, RG, false) };
  };
  let peakDetailedUnits = 0;
  for (let t = 0; t < days * TICKS_PER_DAY; t++) {
    const w = world;
    step(w, options.detailedBattles && w.tick % 4 === 0 ? openAllBattles(w) : []);
    if (options.detailedBattles && Object.keys(w.battles).length > 0) peakDetailedUnits = Math.max(peakDetailedUnits, battleMembers(w).size);
    if (iraqPowerAtGroundWar === null && w.sides['coalition']!.ai?.offensiveTick !== null) {
      iraqPowerAtGroundWar = measure(w).iraq / w.sides['iraq']!.initialCombatPower;
    }
    if (atEnd === null && w.strategy?.ceasefire.tick != null) atEnd = measure(w);
  }
  const ms = performance.now() - started;
  const st = world.strategy!;
  const end = atEnd ?? measure(world);

  const coalition = world.sides['coalition']!;
  const iraq = world.sides['iraq']!;
  const kc = world.objectives['kuwait-city']!;
  const offensive = coalition.ai?.offensiveTick ?? null;
  const groundWarDay = offensive === null ? null : offensive / TICKS_PER_DAY;
  const taken = kc.holder === 'coalition' && kc.capturedTick !== null ? kc.capturedTick / TICKS_PER_DAY : null;
  return {
    seed,
    groundWarDay,
    kuwaitCityHolder: kc.holder,
    groundWarDays: taken !== null && groundWarDay !== null ? taken - groundWarDay : null,
    iraqPowerLeft: end.iraq / iraq.initialCombatPower,
    iraqSurrenderShare: iraq.surrendered / Math.max(1, iraq.surrendered + iraq.losses),
    coalitionLossShare: (coalition.losses + coalition.surrendered) / coalition.initialStrength,
    rgLeft: end.rg / rg0,
    regularLeft: end.regular / regular0,
    ceasefireDay: st.ceasefire.tick === null ? null : st.ceasefire.tick / TICKS_PER_DAY,
    israelIntervened: st.actors['israeli-government']!.status === 'intervened',
    withdrawnActors: Object.values(st.actors).filter((a) => a.status === 'withdrawn').map((a) => a.id),
    minSupport: Math.min(...Object.values(st.actors).filter((a) => a.side === 'coalition' && a.support !== null).map((a) => a.support!)),
    iraqPowerAtGroundWar,
    msPerTick: ms / (days * TICKS_PER_DAY),
    battlesOpened: world.nextBattle - 1,
    peakDetailedUnits,
  };
}

/** The plausibility bands agreed in the M3 plan. Returns the bands a run misses. */
export function missedBands(m: CampaignMetrics): string[] {
  const missed: string[] = [];
  if (m.kuwaitCityHolder !== 'coalition') missed.push('coalition does not hold Kuwait City');
  if (m.groundWarDay === null || m.groundWarDay < 30 || m.groundWarDay > 42) missed.push(`ground war starts day ${m.groundWarDay}`);
  if (m.groundWarDays === null || m.groundWarDays < 3 || m.groundWarDays > 10) missed.push(`ground war lasts ${m.groundWarDays?.toFixed(1)} days`);
  // Measured at the cease-fire, which lets part of the Iraqi army escape (agreed in the M4 plan).
  if (m.iraqPowerLeft >= 0.4) missed.push(`Iraq keeps ${(m.iraqPowerLeft * 100).toFixed(0)}% of its power`);
  if (m.iraqSurrenderShare <= 0.5) missed.push(`only ${(m.iraqSurrenderShare * 100).toFixed(0)}% of Iraqi losses are surrenders`);
  if (m.coalitionLossShare >= 0.03) missed.push(`coalition loses ${(m.coalitionLossShare * 100).toFixed(1)}%`);
  if (m.rgLeft <= m.regularLeft) missed.push('Republican Guard is not the most intact Iraqi force');
  if (m.ceasefireDay === null) missed.push('no cease-fire');
  if (m.israelIntervened) missed.push('Israel enters the war');
  if (m.withdrawnActors.length > 0) missed.push(`${m.withdrawnActors.join(', ')} withdraw`);
  return missed;
}

// ---------------------------------------------------------------- M4 experiments

const kcDay = (m: CampaignMetrics) => (m.groundWarDay !== null && m.groundWarDays !== null ? m.groundWarDay + m.groundWarDays : Infinity);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const avg = (ms: CampaignMetrics[], f: (m: CampaignMetrics) => number) => mean(ms.map(f).filter(Number.isFinite));
const p = (v: number) => `${(v * 100).toFixed(1)}%`;
const d = (v: number) => v.toFixed(1);

export interface Experiment {
  name: string;
  a: (raw: ScenarioInput) => void;
  b: (raw: ScenarioInput) => void;
  /** Whether one seed pair shows the expected effect of choosing A over B. */
  shows: (a: CampaignMetrics, b: CampaignMetrics) => boolean;
  describe: (a: CampaignMetrics[], b: CampaignMetrics[]) => string;
}

export const EXPERIMENTS: Experiment[] = [
  {
    name: 'Ignore the Scuds vs the historical response',
    a: POLICIES.ignoreScuds,
    b: POLICIES.historical,
    // Israel enters, Arab divisions withdraw, and Kuwait City falls later or at higher cost.
    shows: (a, b) => a.israelIntervened && !b.israelIntervened && a.withdrawnActors.length > 0 && (kcDay(a) > kcDay(b) || a.coalitionLossShare > b.coalitionLossShare),
    describe: (a, b) =>
      `Israel intervenes ${a.filter((m) => m.israelIntervened).length} vs ${b.filter((m) => m.israelIntervened).length}; ` +
      `governments withdrawn ${d(avg(a, (m) => m.withdrawnActors.length))} vs ${d(avg(b, (m) => m.withdrawnActors.length))}; ` +
      `Kuwait City day ${d(avg(a, kcDay))} vs ${d(avg(b, kcDay))}; coalition losses ${p(avg(a, (m) => m.coalitionLossShare))} vs ${p(avg(b, (m) => m.coalitionLossShare))}`,
  },
  {
    name: 'Heavy strategic bombing vs none',
    a: POLICIES.heavyBombing,
    b: POLICIES.noBombing,
    // Iraqi supply falls faster so the front weakens sooner (the ground war starts earlier, or meets a
    // clearly weaker enemy), but support at home ends lower.
    shows: (a, b) =>
      a.groundWarDay !== null &&
      b.groundWarDay !== null &&
      (a.groundWarDay < b.groundWarDay || (a.iraqPowerAtGroundWar ?? 1) < (b.iraqPowerAtGroundWar ?? 1) - 0.05) &&
      a.minSupport < b.minSupport,
    describe: (a, b) =>
      `ground war day ${d(avg(a, (m) => m.groundWarDay ?? NaN))} vs ${d(avg(b, (m) => m.groundWarDay ?? NaN))}; ` +
      `Iraqi power then ${p(avg(a, (m) => m.iraqPowerAtGroundWar ?? NaN))} vs ${p(avg(b, (m) => m.iraqPowerAtGroundWar ?? NaN))}; ` +
      `lowest home support ${p(avg(a, (m) => m.minSupport / 1000))} vs ${p(avg(b, (m) => m.minSupport / 1000))}`,
  },
  {
    name: 'Pursue into Iraq vs cease-fire',
    a: POLICIES.pursue,
    b: POLICIES.historical,
    // Arab cohesion breaks and coalition losses rise, but more of the Republican Guard is destroyed.
    shows: (a, b) => a.withdrawnActors.length > b.withdrawnActors.length && a.coalitionLossShare > b.coalitionLossShare && a.rgLeft < b.rgLeft,
    describe: (a, b) =>
      `governments withdrawn ${d(avg(a, (m) => m.withdrawnActors.length))} vs ${d(avg(b, (m) => m.withdrawnActors.length))}; ` +
      `coalition losses ${p(avg(a, (m) => m.coalitionLossShare))} vs ${p(avg(b, (m) => m.coalitionLossShare))}; ` +
      `Republican Guard left ${p(avg(a, (m) => m.rgLeft))} vs ${p(avg(b, (m) => m.rgLeft))}`,
  },
  {
    name: 'Elite vs green Iraqi command',
    a: POLICIES.eliteIraq,
    b: POLICIES.greenIraq,
    // An able command sees the blow coming and pulls back in time: more of the army survives
    // and fewer surrender, at the price of giving up ground sooner.
    shows: (a, b) => a.iraqPowerLeft > b.iraqPowerLeft && a.iraqSurrenderShare < b.iraqSurrenderShare,
    describe: (a, b) =>
      `Iraqi power left ${p(avg(a, (m) => m.iraqPowerLeft))} vs ${p(avg(b, (m) => m.iraqPowerLeft))}; ` +
      `surrender share ${p(avg(a, (m) => m.iraqSurrenderShare))} vs ${p(avg(b, (m) => m.iraqSurrenderShare))}; ` +
      `Kuwait City day ${d(avg(a, kcDay))} vs ${d(avg(b, kcDay))}`,
  },
];

export function runExperiment(e: Experiment, seeds: number) {
  const a: CampaignMetrics[] = [];
  const b: CampaignMetrics[] = [];
  let passed = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const ma = runCampaign(seed, e.a);
    const mb = runCampaign(seed, e.b);
    a.push(ma);
    b.push(mb);
    if (e.shows(ma, mb)) passed++;
  }
  return { a, b, passed };
}
