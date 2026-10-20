// Standard engagements for checking the detailed resolver against aggregate
// combat (tools/tactical-check.ts and tactical.test.ts). Each engagement is
// run from the same start with both resolvers: aggregate, and detailed with
// the battle opened at once. Blue attacks; red holds.

import type { ScenarioInput } from '@tow/content';
import { activeFormations, applyCommand, createWorld, step, type WorldState } from '../src/index.ts';
import { resolve } from './helpers.ts';

export type Outcome = 'held' | 'fell back' | 'broke';

interface UnitSpec {
  id: string;
  template: string;
  at: { x: number; y: number } | { lat: number; lon: number };
  fortification?: number;
  strengthPct?: number;
  morale?: number;
  quality?: number;
}

export interface Engagement {
  id: string;
  name: string;
  hours: number;
  map?: string;
  blue: { nation: string; units: UnitSpec[]; depot: { x: number; y: number } | { lat: number; lon: number } };
  red: { nation: string; units: UnitSpec[]; depot: { x: number; y: number } | { lat: number; lon: number } };
  /** Where blue attacks. */
  objective: { x: number; y: number } | { lat: number; lon: number };
}

export const ENGAGEMENTS: Engagement[] = [
  {
    id: 'even',
    name: 'Even fight: division attacks division',
    hours: 48,
    blue: { nation: 'blueland', units: [{ id: 'b1', template: 'test-division', at: { x: 50, y: 0 } }], depot: { x: 30, y: 0 } },
    red: { nation: 'redland', units: [{ id: 'r1', template: 'test-division', at: { x: 62, y: 0 } }], depot: { x: 85, y: 0 } },
    objective: { x: 75, y: 0 },
  },
  {
    id: 'three-to-one',
    name: 'Three divisions attack one',
    hours: 48,
    blue: {
      nation: 'blueland',
      units: [
        { id: 'b1', template: 'test-division', at: { x: 50, y: -12 } },
        { id: 'b2', template: 'test-division', at: { x: 50, y: 0 } },
        { id: 'b3', template: 'test-division', at: { x: 50, y: 12 } },
      ],
      depot: { x: 30, y: 0 },
    },
    red: { nation: 'redland', units: [{ id: 'r1', template: 'test-division', at: { x: 62, y: 0 }, fortification: 300 }], depot: { x: 85, y: 0 } },
    objective: { x: 75, y: 0 },
  },
  {
    id: 'armor-vs-dug-in',
    name: 'Armored division against dug-in infantry, Kuwait border',
    hours: 48,
    map: 'gulf',
    blue: { nation: 'us', units: [{ id: 'b1', template: 'ds-us-armored-division', at: { lat: 28.8, lon: 46.9 } }], depot: { lat: 28.55, lon: 46.9 } },
    red: { nation: 'iraq', units: [{ id: 'r1', template: 'ds-iq-infantry-division', at: { lat: 28.92, lon: 46.9 }, fortification: 500 }], depot: { lat: 29.3, lon: 46.9 } },
    objective: { lat: 29.1, lon: 46.9 },
  },
  {
    id: 'medina-ridge',
    name: 'Two armored divisions against a dug-in Republican Guard division',
    hours: 48,
    map: 'gulf',
    blue: {
      nation: 'us',
      units: [
        { id: 'b1', template: 'ds-us-armored-division', at: { lat: 29.85, lon: 46.95 } },
        { id: 'b2', template: 'ds-us-armored-division', at: { lat: 29.95, lon: 46.9 } },
      ],
      depot: { lat: 29.75, lon: 46.7 },
    },
    red: { nation: 'iraq', units: [{ id: 'r1', template: 'ds-iq-rg-armored-division', at: { lat: 29.95, lon: 47.05 }, fortification: 300 }], depot: { lat: 30.3, lon: 47.3 } },
    objective: { lat: 30.0, lon: 47.2 },
  },
  {
    id: 'broken-defender',
    name: 'Fresh division against a worn-down, shaken one',
    hours: 48,
    blue: { nation: 'blueland', units: [{ id: 'b1', template: 'test-division', at: { x: 50, y: 0 } }], depot: { x: 30, y: 0 } },
    red: { nation: 'redland', units: [{ id: 'r1', template: 'test-division', at: { x: 62, y: 0 }, strengthPct: 55, morale: 330 }], depot: { x: 85, y: 0 } },
    objective: { x: 75, y: 0 },
  },
];

function scenario(e: Engagement): ScenarioInput {
  const side = (id: 'blue' | 'red') => {
    const s = e[id];
    return [
      { id: `${id}-hq`, name: `${id} HQ`, nation: s.nation, echelon: 'corps' as const, position: s.depot, supplyNode: `${id}-depot` },
      ...s.units.map((u) => ({
        id: u.id,
        name: u.id.toUpperCase(),
        nation: s.nation,
        echelon: 'division' as const,
        parent: `${id}-hq`,
        template: u.template,
        position: u.at,
        ...(u.fortification !== undefined ? { fortification: u.fortification } : {}),
        ...(u.strengthPct !== undefined ? { strengthPct: u.strengthPct } : {}),
        ...(u.morale !== undefined ? { morale: u.morale } : {}),
      })),
    ];
  };
  const node = (id: 'blue' | 'red') => ({ id: `${id}-depot`, name: `${id} depot`, kind: 'source' as const, side: id, position: e[id].depot, capacity: 100000, stock: 50000, productionPerTick: 200 });
  return {
    id: e.id,
    name: e.name,
    seed: 1,
    days: 5,
    ...(e.map ? { map: e.map } : {}),
    nations: [e.blue.nation, e.red.nation],
    sides: [
      { id: 'blue', name: 'Blue', nations: [e.blue.nation] },
      { id: 'red', name: 'Red', nations: [e.red.nation] },
    ],
    formations: [...side('blue'), ...side('red')],
    supply: { nodes: [node('blue'), node('red')], links: [] },
    objectives: [{ id: 'objective', name: 'Objective', position: e.objective, holder: 'red', radiusKm: 5 }],
    events: [],
  };
}

export function engagementWorld(e: Engagement, seed: number): WorldState {
  const w = createWorld(resolve(scenario(e)), { seed });
  for (const u of [...e.blue.units, ...e.red.units]) {
    if (u.quality !== undefined) w.formations[u.id]!.stats.quality = u.quality;
  }
  return w;
}

export interface EngagementResult {
  /** Share of each side's starting strength lost to fire or surrender. */
  loss: Record<string, number>;
  outcome: Record<string, Outcome>;
  /** Tick the detailed battle closed, if it did. */
  closedTick: number | null;
}

export function runEngagement(e: Engagement, seed: number, detailed: boolean): EngagementResult {
  const w = engagementWorld(e, seed);
  const to = w.objectives['objective']!.position;
  const commands = e.blue.units.map((u) => ({ type: 'move' as const, formation: u.id, to, kind: 'attack' as const }));
  if (detailed) step(w, [{ type: 'openBattle', formation: e.red.units[0]!.id }, ...commands]);
  else step(w, commands);
  const maxRetreat: Record<string, number> = { blue: 0, red: 0 };
  let closedTick: number | null = null;
  for (let t = 1; t < e.hours * 4; t++) {
    step(w);
    if (detailed && closedTick === null && Object.keys(w.battles).length === 0) closedTick = w.tick;
    for (const side of ['blue', 'red']) {
      const own = activeFormations(w).filter((f) => f.side === side);
      const total = own.reduce((s, f) => s + f.stats.strength, 0);
      const back = own.filter((f) => f.status === 'retreating').reduce((s, f) => s + f.stats.strength, 0);
      if (total > 0) maxRetreat[side] = Math.max(maxRetreat[side]!, back / total);
    }
  }
  const loss: Record<string, number> = {};
  const outcome: Record<string, Outcome> = {};
  for (const side of ['blue', 'red']) {
    const s = w.sides[side]!;
    loss[side] = (s.losses + s.surrendered) / s.initialStrength;
    outcome[side] = s.surrendered / s.initialStrength >= 0.3 ? 'broke' : maxRetreat[side]! >= 0.5 ? 'fell back' : 'held';
  }
  return { loss, outcome, closedTick };
}

export interface EngagementCheck {
  id: string;
  passes: number;
  seeds: number;
  mean: { aggregate: Record<string, number>; detailed: Record<string, number> };
  outcomes: { aggregate: Record<string, Record<Outcome, number>>; detailed: Record<string, Record<Outcome, number>> };
  failures: string[];
}

/** Losses agree within 25% relative or 3 percentage points, whichever is looser. */
export function lossesAgree(a: number, d: number): boolean {
  return Math.abs(a - d) <= Math.max(0.25 * a, 0.03);
}

export function checkEngagement(e: Engagement, seeds: number): EngagementCheck {
  const mean = { aggregate: { blue: 0, red: 0 } as Record<string, number>, detailed: { blue: 0, red: 0 } as Record<string, number> };
  const blank = (): Record<Outcome, number> => ({ held: 0, 'fell back': 0, broke: 0 });
  const outcomes = { aggregate: { blue: blank(), red: blank() }, detailed: { blue: blank(), red: blank() } } as EngagementCheck['outcomes'];
  const failures: string[] = [];
  let passes = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const a = runEngagement(e, seed, false);
    const d = runEngagement(e, seed, true);
    let ok = true;
    for (const side of ['blue', 'red']) {
      mean.aggregate[side]! += a.loss[side]! / seeds;
      mean.detailed[side]! += d.loss[side]! / seeds;
      outcomes.aggregate[side]![a.outcome[side]!]++;
      outcomes.detailed[side]![d.outcome[side]!]++;
      if (!lossesAgree(a.loss[side]!, d.loss[side]!)) {
        ok = false;
        failures.push(`seed ${seed} ${side}: losses ${(a.loss[side]! * 100).toFixed(1)}% aggregate vs ${(d.loss[side]! * 100).toFixed(1)}% detailed`);
      }
      if (a.outcome[side] !== d.outcome[side]) {
        ok = false;
        failures.push(`seed ${seed} ${side}: ${a.outcome[side]} aggregate vs ${d.outcome[side]} detailed`);
      }
    }
    if (ok) passes++;
  }
  return { id: e.id, passes, seeds, mean, outcomes, failures };
}
