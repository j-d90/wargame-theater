import type { Position } from '@tow/content';
import { hashState } from './hash.ts';
import { dayOf } from './time.ts';
import { sortedIds, type FormationStats, type WorldState } from './world.ts';
import { activeFormations, effectiveSupplyNode, rollup } from '../command/formations.ts';
import { combatPower, mobility, supplyLevel } from '../command/derived.ts';
import { kmPerTick } from '../command/movement.ts';
import { inSupplyRange, supplyDistance } from '../supply/flow.ts';
import { TICKS_PER_DAY } from './time.ts';

export interface FormationSummary {
  id: string;
  name: string;
  nation: string;
  echelon: string;
  branch: string | null;
  parentId: string | null;
  parentName: string | null;
  parentEchelon: string | null;
  hasChildren: boolean;
  aggregated: boolean;
  position: Position;
  /** Remaining waypoints of the current move order, empty when stationary. */
  path: Position[];
  strength: number;
  readiness: number;
  morale: number;
  stock: number;
  stockCap: number;
  supplyPerTick: number;
  supplyLevel: number;
  mobility: number;
  combatPower: number;
  /** Current pace given readiness and terrain, km per day. */
  kmPerDay: number;
  supplyNode: string | null;
  supplyDistanceKm: number | null;
  inSupplyRange: boolean;
}

export interface WorldSummary {
  tick: number;
  day: number;
  hash: string;
  supplyRangeKm: number;
  active: FormationSummary[];
  /** Rolled-up stats for each root formation. */
  totals: Record<string, FormationStats>;
  nodes: { id: string; name: string; kind: 'source' | 'depot'; position: Position; stock: number; capacity: number; disrupted: boolean }[];
  links: { id: string; from: string; to: string; mode: string; flow: number; capacity: number; efficiency: number; disrupted: boolean }[];
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
    supplyRangeKm: world.rules.supplyRangeKm,
    active: activeFormations(world).map((f) => {
      const dist = supplyDistance(world, f);
      return {
        id: f.id,
        name: f.name,
        nation: f.nation,
        echelon: f.echelon,
        branch: f.branch,
        parentId: f.parentId,
        parentName: f.parentId === null ? null : world.formations[f.parentId]!.name,
        parentEchelon: f.parentId === null ? null : world.formations[f.parentId]!.echelon,
        hasChildren: f.childIds.length > 0,
        aggregated: f.aggregated,
        position: { ...f.position },
        path: f.order ? f.order.path.map((p) => ({ ...p })) : [],
        strength: f.stats.strength,
        readiness: f.stats.readiness,
        morale: f.stats.morale,
        stock: f.stats.stock,
        stockCap: f.stats.stockCap,
        supplyPerTick: f.stats.supplyPerTick,
        supplyLevel: supplyLevel(f.stats),
        mobility: mobility(f.stats, world.rules),
        combatPower: combatPower(f.stats),
        kmPerDay: Math.round(kmPerTick(world, f) * TICKS_PER_DAY),
        supplyNode: effectiveSupplyNode(world, f.id),
        supplyDistanceKm: dist === null ? null : Math.round(dist),
        inSupplyRange: inSupplyRange(world, f),
      };
    }),
    totals,
    nodes: sortedIds(world.supply.nodes).map((id) => {
      const n = world.supply.nodes[id]!;
      return { id, name: n.name, kind: n.kind, position: { ...n.position }, stock: n.stock, capacity: n.capacity, disrupted: n.disrupted };
    }),
    links: sortedIds(world.supply.links).map((id) => {
      const l = world.supply.links[id]!;
      return {
        id,
        from: l.from,
        to: l.to,
        mode: l.mode,
        flow: l.lastFlow,
        capacity: l.capacityPerTick,
        efficiency: l.efficiency,
        disrupted: l.disrupted,
      };
    }),
  };
}
