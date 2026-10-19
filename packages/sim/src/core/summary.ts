import { hashState } from './hash.ts';
import { dayOf } from './time.ts';
import { sortedIds, type FormationStats, type WorldState } from './world.ts';
import { activeFormations, rollup } from '../command/formations.ts';
import { combatPower, mobility, supplyLevel } from '../command/derived.ts';

export interface FormationSummary {
  id: string;
  name: string;
  echelon: string;
  aggregated: boolean;
  strength: number;
  readiness: number;
  morale: number;
  supplyLevel: number;
  mobility: number;
  combatPower: number;
}

export interface WorldSummary {
  tick: number;
  day: number;
  hash: string;
  active: FormationSummary[];
  /** Rolled-up stats for each root formation. */
  totals: Record<string, FormationStats>;
  nodes: { id: string; name: string; stock: number; capacity: number; disrupted: boolean }[];
  links: { id: string; flow: number; capacity: number; efficiency: number; disrupted: boolean }[];
}

export function summarize(world: WorldState): WorldSummary {
  const totals: Record<string, FormationStats> = {};
  for (const id of sortedIds(world.formations)) {
    if (world.formations[id]!.parentId === null) totals[id] = rollup(world, id);
  }
  return {
    tick: world.tick,
    day: dayOf(world.tick),
    hash: hashState(world),
    active: activeFormations(world).map((f) => ({
      id: f.id,
      name: f.name,
      echelon: f.echelon,
      aggregated: f.aggregated,
      strength: f.stats.strength,
      readiness: f.stats.readiness,
      morale: f.stats.morale,
      supplyLevel: supplyLevel(f.stats),
      mobility: mobility(f.stats, world.rules),
      combatPower: combatPower(f.stats),
    })),
    totals,
    nodes: sortedIds(world.supply.nodes).map((id) => {
      const n = world.supply.nodes[id]!;
      return { id, name: n.name, stock: n.stock, capacity: n.capacity, disrupted: n.disrupted };
    }),
    links: sortedIds(world.supply.links).map((id) => {
      const l = world.supply.links[id]!;
      return { id, flow: l.lastFlow, capacity: l.capacityPerTick, efficiency: l.efficiency, disrupted: l.disrupted };
    }),
  };
}
