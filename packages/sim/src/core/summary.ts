import type { Position } from '@tow/content';
import { hashState } from './hash.ts';
import { dayOf } from './time.ts';
import { sortedIds, type FormationStats, type WorldState } from './world.ts';
import { activeFormations, effectiveSupplyNode, rollup } from '../command/formations.ts';
import { combatPower, mobility, supplyLevel } from '../command/derived.ts';
import { kmPerTick } from '../command/movement.ts';
import { inSupplyRange, supplyDistance } from '../supply/flow.ts';
import { fightingValue, sideCombatPower } from '../combat/aggregate.ts';
import type { AiPhase, AirAllocation, FormationStatus, OrderKind } from './world.ts';
import { TICKS_PER_DAY } from './time.ts';

export interface FormationSummary {
  id: string;
  name: string;
  nation: string;
  echelon: string;
  branch: string | null;
  side: string;
  status: FormationStatus;
  orderKind: OrderKind | null;
  inContact: boolean;
  fortification: number;
  quality: number;
  establishment: number;
  fightingValue: number;
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

export interface SideSummary {
  id: string;
  name: string;
  color: string;
  /** Current fighting value as a share of the start, permille. */
  combatPowerRatio: number;
  strength: number;
  initialStrength: number;
  losses: number;
  surrendered: number;
  prisonersTaken: number;
  formations: number;
  air: { pool: number; sorties: number; superiority: number; allocation: AirAllocation; supportBonus: number } | null;
  ai: { controlled: boolean; phase: AiPhase; offensiveTick: number | null } | null;
}

export interface ObjectiveSummary {
  id: string;
  name: string;
  position: Position;
  holder: string | null;
  radiusKm: number;
  points: number;
  capturedTick: number | null;
}

export interface WorldSummary {
  tick: number;
  day: number;
  hash: string;
  startDate: string | null;
  supplyRangeKm: number;
  sides: SideSummary[];
  objectives: ObjectiveSummary[];
  /** Midpoints of formations in contact, for drawing engagements. */
  engagements: { a: string; b: string; position: Position }[];
  active: FormationSummary[];
  /** Rolled-up stats for each root formation. */
  totals: Record<string, FormationStats>;
  nodes: {
    id: string;
    name: string;
    kind: 'source' | 'depot';
    side: string;
    position: Position;
    stock: number;
    capacity: number;
    disrupted: boolean;
    mobile: boolean;
    moveTo: Position | null;
  }[];
  links: {
    id: string;
    from: string;
    to: string;
    mode: string;
    flow: number;
    capacity: number;
    efficiency: number;
    damage: number;
    disrupted: boolean;
  }[];
}

export function summarize(world: WorldState): WorldSummary {
  const totals: Record<string, FormationStats> = {};
  for (const id of sortedIds(world.formations)) {
    if (world.formations[id]!.parentId === null) totals[id] = rollup(world, id);
  }
  const active = activeFormations(world);
  return {
    tick: world.tick,
    day: dayOf(world.tick),
    hash: hashState(world),
    startDate: world.startDate,
    supplyRangeKm: world.rules.supplyRangeKm,
    sides: sortedIds(world.sides).map((id) => {
      const s = world.sides[id]!;
      const mine = active.filter((f) => f.side === id);
      return {
        id,
        name: s.name,
        color: s.color,
        combatPowerRatio: s.initialCombatPower > 0 ? Math.round((sideCombatPower(world, id) * 1000) / s.initialCombatPower) : 0,
        strength: mine.reduce((sum, f) => sum + f.stats.strength, 0),
        initialStrength: s.initialStrength,
        losses: s.losses,
        surrendered: s.surrendered,
        prisonersTaken: s.prisonersTaken,
        formations: mine.length,
        air: s.air
          ? { pool: s.air.pool, sorties: s.air.sorties, superiority: s.air.superiority, allocation: { ...s.air.allocation }, supportBonus: s.air.supportBonus }
          : null,
        ai: s.ai ? { controlled: s.ai.controlled, phase: s.ai.phase, offensiveTick: s.ai.offensiveTick } : null,
      };
    }),
    objectives: sortedIds(world.objectives).map((id) => {
      const o = world.objectives[id]!;
      return { id, name: o.name, position: { ...o.position }, holder: o.holder, radiusKm: o.radiusKm, points: o.points, capturedTick: o.capturedTick };
    }),
    engagements: world.contacts.flatMap(([a, b]) => {
      const fa = world.formations[a];
      const fb = world.formations[b];
      if (!fa || !fb) return [];
      return [{ a, b, position: { x: (fa.position.x + fb.position.x) / 2, y: (fa.position.y + fb.position.y) / 2 } }];
    }),
    active: active.map((f) => {
      const dist = supplyDistance(world, f);
      return {
        id: f.id,
        name: f.name,
        nation: f.nation,
        echelon: f.echelon,
        branch: f.branch,
        side: f.side,
        status: f.status,
        orderKind: f.order?.kind ?? null,
        inContact: f.inContact,
        fortification: Math.round(f.fortification),
        quality: f.stats.quality,
        establishment: f.stats.establishment,
        fightingValue: Math.round(fightingValue(f)),
        parentId: f.parentId,
        parentName: f.parentId === null ? null : world.formations[f.parentId]!.name,
        parentEchelon: f.parentId === null ? null : world.formations[f.parentId]!.echelon,
        hasChildren: f.childIds.length > 0,
        aggregated: f.aggregated,
        position: { ...f.position },
        path: f.order ? f.order.path.map((p) => ({ ...p })) : [],
        strength: f.stats.strength,
        readiness: f.stats.readiness,
        morale: Math.round(f.stats.morale),
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
      return {
        id,
        name: n.name,
        kind: n.kind,
        side: n.side,
        position: { ...n.position },
        stock: n.stock,
        capacity: n.capacity,
        disrupted: n.disrupted,
        mobile: n.mobile,
        moveTo: n.moveTo ? { ...n.moveTo } : null,
      };
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
        damage: Math.round(l.damage),
        disrupted: l.disrupted,
      };
    }),
  };
}
