import type { Echelon, Position, ResolvedScenario, ScenarioEvent } from '@tow/content';
import { createRng, type RngState } from './rng.ts';
import { DEFAULT_RULES, type Rules } from './rules.ts';
import { TICKS_PER_DAY, tickAt } from './time.ts';
import type { TimedCommand } from './commands.ts';
import { aggregate, depthOf } from '../command/formations.ts';

/** Stats summed when formations aggregate. */
export const EXTENSIVE_STATS = ['strength', 'stock', 'stockCap', 'supplyPerTick'] as const;
/** Stats averaged (weighted by strength) when formations aggregate. Permille. */
export const INTENSIVE_STATS = ['readiness', 'morale'] as const;

export interface FormationStats {
  strength: number;
  readiness: number;
  morale: number;
  /** Supply carried by the formation. */
  stock: number;
  stockCap: number;
  /** Consumption per tick. */
  supplyPerTick: number;
}

export interface Formation {
  id: string;
  name: string;
  nation: string;
  echelon: Echelon;
  parentId: string | null;
  /** Sorted by id. */
  childIds: string[];
  position: Position;
  /** Own supply node; the effective node is inherited from the nearest ancestor when null. */
  supplyNode: string | null;
  /** True when this node is simulated as one block standing in for its subtree. */
  aggregated: boolean;
  /**
   * Authoritative only while the formation is active (an aggregated node or a leaf
   * with no aggregated ancestor). Use rollup() for expanded nodes.
   */
  stats: FormationStats;
  /** Stats at the moment of aggregation, used to push changes back down on expand. */
  baseline: FormationStats | null;
}

export interface SupplyNode {
  id: string;
  name: string;
  kind: 'source' | 'depot';
  position: Position;
  capacity: number;
  stock: number;
  productionPerTick: number;
  disrupted: boolean;
}

export interface SupplyLink {
  id: string;
  from: string;
  to: string;
  mode: 'road' | 'rail' | 'sea' | 'pipeline' | 'air';
  capacityPerTick: number;
  variance: number;
  vulnerability: number;
  disrupted: boolean;
  /** Today's throughput factor in permille, rolled daily. */
  efficiency: number;
  /** Supply moved on the last tick. */
  lastFlow: number;
}

/** The whole simulation state: plain JSON-serializable data, nothing else. */
export interface WorldState {
  scenarioId: string;
  seed: number;
  tick: number;
  rng: Record<string, RngState>;
  formations: Record<string, Formation>;
  supply: {
    nodes: Record<string, SupplyNode>;
    links: Record<string, SupplyLink>;
  };
  /** Pending scripted commands, sorted by tick. */
  schedule: TimedCommand[];
  rules: Rules;
}

/** Ids of a record in sorted order. All sim iteration goes through this. */
export function sortedIds(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

export function rngStream(world: WorldState, label: string): RngState {
  return (world.rng[label] ??= createRng(world.seed, label));
}

function eventToCommand(e: ScenarioEvent): TimedCommand {
  const tick = tickAt(e.day, e.hour ?? 0);
  switch (e.type) {
    case 'expand':
    case 'aggregate':
      return { tick, type: e.type, formation: e.formation };
    case 'setDisrupted':
      return { tick, type: 'setDisrupted', target: e.target, disrupted: e.disrupted };
  }
}

export interface CreateWorldOptions {
  seed?: number;
  rules?: Partial<Rules>;
}

export function createWorld(resolved: ResolvedScenario, options: CreateWorldOptions = {}): WorldState {
  const { scenario, units } = resolved;
  const formations: Record<string, Formation> = {};

  for (const spec of scenario.formations) {
    let stats: FormationStats = { strength: 0, readiness: 0, morale: 0, stock: 0, stockCap: 0, supplyPerTick: 0 };
    if (spec.template !== undefined) {
      const t = units.get(spec.template);
      if (!t) throw new Error(`createWorld: unknown template "${spec.template}"`);
      const pct = spec.strengthPct ?? 100;
      const supplyPerTick = Math.ceil((t.supplyPerTick * pct) / 100);
      const stockCap = supplyPerTick * TICKS_PER_DAY * t.stockDays;
      stats = {
        strength: Math.floor((t.strength * pct) / 100),
        readiness: spec.readiness ?? 1000,
        morale: spec.morale ?? 1000,
        stock: Math.floor((stockCap * (spec.stockPct ?? 100)) / 100),
        stockCap,
        supplyPerTick,
      };
    }
    formations[spec.id] = {
      id: spec.id,
      name: spec.name,
      nation: spec.nation,
      echelon: spec.echelon,
      parentId: spec.parent ?? null,
      childIds: [],
      position: { ...spec.position },
      supplyNode: spec.supplyNode ?? null,
      aggregated: false,
      stats,
      baseline: null,
    };
  }
  for (const id of sortedIds(formations)) {
    const f = formations[id]!;
    if (f.parentId !== null) formations[f.parentId]!.childIds.push(id);
  }

  const nodes: Record<string, SupplyNode> = {};
  for (const n of scenario.supply.nodes) {
    nodes[n.id] = {
      id: n.id,
      name: n.name,
      kind: n.kind,
      position: { ...n.position },
      capacity: n.capacity,
      stock: n.stock ?? 0,
      productionPerTick: n.productionPerTick ?? 0,
      disrupted: false,
    };
  }
  const links: Record<string, SupplyLink> = {};
  for (const l of scenario.supply.links) {
    links[l.id] = {
      id: l.id,
      from: l.from,
      to: l.to,
      mode: l.mode,
      capacityPerTick: l.capacityPerTick,
      variance: l.variance ?? 0,
      vulnerability: l.vulnerability ?? 0,
      disrupted: false,
      efficiency: 1000,
      lastFlow: 0,
    };
  }

  const world: WorldState = {
    scenarioId: scenario.id,
    seed: options.seed ?? scenario.seed,
    tick: 0,
    rng: {},
    formations,
    supply: { nodes, links },
    // Array.prototype.sort is stable, so same-tick events keep file order.
    schedule: scenario.events.map(eventToCommand).sort((a, b) => a.tick - b.tick),
    rules: { ...DEFAULT_RULES, ...options.rules },
  };

  // Collapse deepest first so no node is aggregated beneath an already-aggregated ancestor.
  const startAggregated = scenario.formations
    .filter((f) => f.aggregated)
    .map((f) => f.id)
    .sort((a, b) => depthOf(world, b) - depthOf(world, a) || (a < b ? -1 : 1));
  for (const id of startAggregated) aggregate(world, id);

  return world;
}

/** Deep copy for snapshots. The state is plain JSON by contract, so a JSON round trip is exact. */
export function cloneWorld(world: WorldState): WorldState {
  return JSON.parse(JSON.stringify(world)) as WorldState;
}
