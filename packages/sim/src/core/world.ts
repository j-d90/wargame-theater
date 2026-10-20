import type {
  Branch,
  Composition,
  Echelon,
  Effects,
  Position,
  ResolvedAi,
  ResolvedEvent,
  ResolvedScenario,
  ResolvedStrategy,
  StrategicActionSpec,
  StrategyRules,
} from '@tow/content';
import { createRng, type RngState } from './rng.ts';
import { DEFAULT_RULES, type Rules } from './rules.ts';
import { TICKS_PER_DAY, tickAt } from './time.ts';
import type { TimedCommand } from './commands.ts';
import { activeFormations, aggregate, depthOf } from '../command/formations.ts';
import { sideCombatPower } from '../combat/aggregate.ts';

/** Stats summed when formations aggregate. */
export const EXTENSIVE_STATS = ['strength', 'establishment', 'stock', 'stockCap', 'supplyPerTick'] as const;
/** Stats averaged (weighted by strength) when formations aggregate. Permille. */
export const INTENSIVE_STATS = ['readiness', 'morale'] as const;
// `speed` is neither: an aggregate moves at the pace of its slowest part.
// `quality` is strength-weighted but never shifted on expand: it doesn't change in play.

export interface FormationStats {
  strength: number;
  /** Strength at full establishment (the start of the scenario). */
  establishment: number;
  /** Abstract fighting quality, permille of baseline. */
  quality: number;
  readiness: number;
  morale: number;
  /** Supply carried by the formation. */
  stock: number;
  stockCap: number;
  /** Consumption per tick. */
  supplyPerTick: number;
  /** Open-terrain march speed at full readiness, km per day. */
  speed: number;
}

export type OrderKind = 'move' | 'attack' | 'retreat';

export interface MoveOrder {
  /** Move and attack stop when they meet the enemy; retreat keeps going. */
  kind: OrderKind;
  destination: Position;
  /** Remaining waypoints; the last one is the destination. */
  path: Position[];
}

/** Static terrain the sim moves on. Copied from the map so saves are self-contained. */
export interface TerrainGrid {
  cellKm: number;
  cols: number;
  rows: number;
  /** One class code per cell, row-major from the north-west corner. */
  cells: string;
  /** Movement factor per class code, permille. 0 = impassable. */
  speeds: Record<string, number>;
  /** Defender protection per class code, permille. */
  defense: Record<string, number>;
  /** Country of each cell ('.' for none), if the map has them. */
  regions: { names: Record<string, string>; cells: string } | null;
}

/** 'withdrawn': pulled out of the war by its government. */
export type FormationStatus = 'active' | 'retreating' | 'surrendered' | 'destroyed' | 'withdrawn';

export interface Formation {
  id: string;
  name: string;
  nation: string;
  echelon: Echelon;
  /** Unit type from the template; for an aggregate, its parts' shared type or null if mixed. */
  branch: string | null;
  side: string;
  status: FormationStatus;
  /** Dug-in protection, permille. Builds up while stationary, lost on the move. */
  fortification: number;
  /** In contact with the enemy as of the last combat phase. */
  inContact: boolean;
  /** Fractional losses not yet taken off strength. */
  lossCarry: number;
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
  /** Position at the moment of aggregation, so children move with the block on expand. */
  baselinePosition: Position | null;
  order: MoveOrder | null;
  /** Composition id the formation breaks down into for a detailed battle, if any. */
  composition: string | null;
  /** Battalion type, for units generated from a composition. */
  tacticalType: string | null;
  /** Set on a battle's root formations: the open battle they are fought in, in detail. */
  battle: string | null;
  /** Under the player's direct tactical command; otherwise tactical AI follows the parent's intent. */
  manual: boolean;
}

/** A battalion type, copied from the tactical catalog so saves are self-contained. */
export interface TacticalTypeState {
  id: string;
  name: string;
  abbr: string;
  branch: Branch;
  weight: number;
  rangeKm: number;
  rear: boolean;
}

/**
 * A battle fought in detail. Its roots are the formations that were in the
 * fight when it opened or joined later; they are expanded down to battalions
 * while it lasts and collapsed back when it closes.
 */
export interface BattleState {
  id: string;
  name: string;
  roots: string[];
  openedTick: number;
  /** Last tick opposing units were within contact range. */
  lastContactTick: number;
  center: Position;
  radiusKm: number;
  /** Strength each side brought into the battle. */
  startStrength: Record<string, number>;
  /** Who fired on whom on the last tick (each shooter's main target), for display. */
  fire: [string, string][];
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
  side: string;
  mobile: boolean;
  speedKmPerDay: number;
  /** Where a mobile depot is heading, if anywhere. */
  moveTo: Position | null;
  /** For sources: industrial capacity left after strategic bombing, permille of production. */
  industry: number;
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
  /** Air interdiction damage, permille of capacity lost. Repaired over time. */
  damage: number;
}

export interface AirAllocation {
  /** Permille shares of the day's air effort; they sum to 1000. */
  counterAir: number;
  interdiction: number;
  attrition: number;
  support: number;
  /** Hunting enemy missile launchers. */
  scudHunt: number;
  /** Strategic bombing of the enemy's industry and leadership. */
  strategic: number;
}

export interface AirState {
  sortiesPerDay: number;
  quality: number;
  /** Remaining air force, permille of the start. */
  pool: number;
  allocation: AirAllocation;
  /** Today's effective sorties. */
  sorties: number;
  /** Share of the air effort over the theater, permille. */
  superiority: number;
  /** Multiplier on ground fire from close air support, permille (1000 = none). */
  supportBonus: number;
}

export type AiPhase = 'prepare' | 'offensive' | 'defend' | 'withdraw';

export interface AiState {
  /** False while a player commands this side. */
  controlled: boolean;
  config: ResolvedAi;
  phase: AiPhase;
  /** Tick the ground offensive started, if it has. */
  offensiveTick: number | null;
  /** Index into each plan's objectives, by corps id. */
  planStep: Record<string, number>;
  /** Last order key given to each formation, so orders aren't re-issued every decision. */
  issued: Record<string, string>;
  nextDecisionTick: number;
}

export interface SideState {
  id: string;
  name: string;
  color: string;
  nations: string[];
  air: AirState | null;
  ai: AiState | null;
  initialStrength: number;
  initialCombatPower: number;
  /** Strength lost to fire. */
  losses: number;
  /** Strength lost to surrender. */
  surrendered: number;
  /** Enemy strength taken prisoner. */
  prisonersTaken: number;
}

export type ActorStatus = 'active' | 'neutral' | 'intervened' | 'withdrawn';

export interface ActorState {
  id: string;
  name: string;
  side: string | null;
  nations: string[];
  /** Gauges in permille; null when the actor doesn't have that gauge. */
  support: number | null;
  cohesion: number | null;
  patience: number | null;
  stability: number | null;
  withdrawBelow: number | null;
  refusesRegions: string[];
  interveneAgainst: string | null;
  onIntervene: Effects | null;
  onWithdraw: Effects | null;
  hostsAirPermille: number;
  restrictsSources: string[];
  restrictedTo: number;
  status: ActorStatus;
}

export interface StrategicEvent {
  tick: number;
  kind: 'info' | 'warning' | 'crisis';
  text: string;
}

export interface MissileStrike {
  tick: number;
  target: string;
  intercepted: boolean;
}

export interface MissileState {
  side: string;
  launchers: number;
  launchesPerLauncherPerDay: number;
  launchArea: Position;
  targets: NonNullable<ResolvedStrategy['missiles']>['targets'];
  patriotSide: string;
  patriotBatteries: number;
  interceptPerBattery: number;
  maxIntercept: number;
  patriotsAt: Record<string, number>;
  /** Strikes in the last two days, for display. */
  recent: MissileStrike[];
  fired: number;
  hits: number;
  /** Fraction of launches suppressed by launcher hunting today, permille. */
  suppression: number;
}

export interface StrategyState {
  mode: 'realistic' | 'sandbox';
  actors: Record<string, ActorState>;
  capital: Record<string, number>;
  actions: StrategicActionSpec[];
  /** Tick each action was last taken. */
  lastUsed: Record<string, number>;
  missiles: MissileState | null;
  mandate: NonNullable<ResolvedStrategy['mandate']> | null;
  ceasefireSpec: NonNullable<ResolvedStrategy['ceasefire']> | null;
  ceasefire: { tick: number | null; reason: string | null };
  /** Tick the cease-fire's liberation objectives were all first held. */
  liberatedTick: number | null;
  /** Sides pressing on past the mandate. */
  pursuing: Record<string, boolean>;
  oilFires: number | null;
  oilFields: { name: string; position: Position }[];
  rules: StrategyRules;
  log: StrategicEvent[];
  /** Per side, for daily changes: losses and surrenders at the start of the day, objective points taken, retreat losses after liberation. */
  dayStartLosses: Record<string, number>;
  objectivePoints: Record<string, number>;
  retreatLosses: Record<string, number>;
}

export interface ObjectiveState {
  id: string;
  name: string;
  position: Position;
  holder: string | null;
  radiusKm: number;
  points: number;
  /** Tick the current holder took it, or null if held from the start. */
  capturedTick: number | null;
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
  /** Null when the scenario has no map: open, flat ground everywhere. */
  terrain: TerrainGrid | null;
  /** Calendar date of day 0, for display. */
  startDate: string | null;
  sides: Record<string, SideState>;
  objectives: Record<string, ObjectiveState>;
  /** Pairs of formation ids in contact as of the last combat phase. */
  contacts: [string, string][];
  /** Null for scenarios without a strategic layer. */
  strategy: StrategyState | null;
  /** Battalion types and compositions used by this scenario's templates. */
  tactical: { types: Record<string, TacticalTypeState>; compositions: Record<string, Composition> };
  battles: Record<string, BattleState>;
  /** Counter for battle ids. */
  nextBattle: number;
}

/** Ids of a record in sorted order. All sim iteration goes through this. */
export function sortedIds(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

export function rngStream(world: WorldState, label: string): RngState {
  return (world.rng[label] ??= createRng(world.seed, label));
}

function eventToCommand(e: ResolvedEvent): TimedCommand {
  const tick = tickAt(e.day, e.hour ?? 0);
  switch (e.type) {
    case 'expand':
    case 'aggregate':
      return { tick, type: e.type, formation: e.formation };
    case 'move':
      return { tick, type: 'move', formation: e.formation, to: { ...e.to } };
    case 'setDisrupted':
      return { tick, type: 'setDisrupted', target: e.target, disrupted: e.disrupted };
  }
}

export interface CreateWorldOptions {
  seed?: number;
  rules?: Partial<Rules>;
}

export function createWorld(resolved: ResolvedScenario, options: CreateWorldOptions = {}): WorldState {
  const { scenario, units, map } = resolved;
  const formations: Record<string, Formation> = {};
  const sideOf = new Map(scenario.sides.flatMap((s) => s.nations.map((n) => [n, s.id] as const)));

  for (const spec of scenario.formations) {
    let branch: string | null = null;
    let composition: string | null = null;
    let stats: FormationStats = {
      strength: 0,
      establishment: 0,
      quality: 1000,
      readiness: 0,
      morale: 0,
      stock: 0,
      stockCap: 0,
      supplyPerTick: 0,
      speed: 0,
    };
    if (spec.template !== undefined) {
      const t = units.get(spec.template);
      if (!t) throw new Error(`createWorld: unknown template "${spec.template}"`);
      branch = t.branch ?? null;
      composition = t.composition ?? null;
      const pct = spec.strengthPct ?? 100;
      const supplyPerTick = Math.ceil((t.supplyPerTick * pct) / 100);
      const stockCap = supplyPerTick * TICKS_PER_DAY * t.stockDays;
      const strength = Math.floor((t.strength * pct) / 100);
      stats = {
        strength,
        establishment: strength,
        quality: t.quality,
        readiness: spec.readiness ?? 1000,
        morale: spec.morale ?? 1000,
        stock: Math.floor((stockCap * (spec.stockPct ?? 100)) / 100),
        stockCap,
        supplyPerTick,
        speed: t.speedKmPerDay,
      };
    }
    formations[spec.id] = {
      id: spec.id,
      name: spec.name,
      nation: spec.nation,
      echelon: spec.echelon,
      branch,
      side: sideOf.get(spec.nation) ?? scenario.sides[0]!.id,
      status: 'active',
      fortification: spec.fortification ?? 0,
      inContact: false,
      lossCarry: 0,
      parentId: spec.parent ?? null,
      childIds: [],
      position: { ...spec.position },
      supplyNode: spec.supplyNode ?? null,
      aggregated: false,
      stats,
      baseline: null,
      baselinePosition: null,
      order: null,
      composition,
      tacticalType: null,
      battle: null,
      manual: false,
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
      side: n.side ?? scenario.sides[0]!.id,
      mobile: n.mobile ?? false,
      speedKmPerDay: n.speedKmPerDay ?? 0,
      moveTo: null,
      industry: 1000,
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
      damage: 0,
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
    terrain: map
      ? {
          cellKm: map.terrain.cellKm,
          cols: map.terrain.cols,
          rows: map.terrain.rows,
          cells: map.terrain.cells,
          speeds: Object.fromEntries(map.terrain.classes.map((c) => [c.code, c.speed])),
          defense: Object.fromEntries(map.terrain.classes.map((c) => [c.code, c.defense])),
          regions: map.regions ? { names: { ...map.regions.names }, cells: map.regions.cells } : null,
        }
      : null,
    startDate: scenario.startDate ?? null,
    sides: {},
    objectives: {},
    contacts: [],
    strategy: scenario.strategy ? createStrategy(scenario.strategy) : null,
    tactical: tacticalFor(resolved, formations),
    battles: {},
    nextBattle: 1,
  };

  for (const s of scenario.sides) {
    world.sides[s.id] = {
      id: s.id,
      name: s.name,
      color: s.color ?? '#3f7fc4',
      nations: [...s.nations],
      air: s.air
        ? {
            sortiesPerDay: s.air.sortiesPerDay,
            quality: s.air.quality,
            pool: 1000,
            allocation: { counterAir: 500, interdiction: 0, attrition: 300, support: 200, scudHunt: 0, strategic: 0 },
            sorties: 0,
            superiority: 0,
            supportBonus: 1000,
          }
        : null,
      ai: s.ai
        ? {
            controlled: true,
            config: s.ai,
            phase: s.ai.posture === 'offensive' ? 'prepare' : 'defend',
            offensiveTick: null,
            planStep: {},
            issued: {},
            nextDecisionTick: 0,
          }
        : null,
      initialStrength: 0,
      initialCombatPower: 0,
      losses: 0,
      surrendered: 0,
      prisonersTaken: 0,
    };
  }
  for (const o of scenario.objectives) {
    world.objectives[o.id] = {
      id: o.id,
      name: o.name,
      position: { ...o.position },
      holder: o.holder ?? null,
      radiusKm: o.radiusKm,
      points: o.points,
      capturedTick: null,
    };
  }

  // Collapse deepest first so no node is aggregated beneath an already-aggregated ancestor.
  const startAggregated = scenario.formations
    .filter((f) => f.aggregated)
    .map((f) => f.id)
    .sort((a, b) => depthOf(world, b) - depthOf(world, a) || (a < b ? -1 : 1));
  for (const id of startAggregated) aggregate(world, id);

  for (const side of Object.values(world.sides)) {
    side.initialStrength = activeFormations(world)
      .filter((f) => f.side === side.id)
      .reduce((sum, f) => sum + f.stats.strength, 0);
    side.initialCombatPower = sideCombatPower(world, side.id);
  }
  return world;
}

/** The compositions this scenario's formations can break down into, and their battalion types. */
function tacticalFor(resolved: ResolvedScenario, formations: Record<string, Formation>): WorldState['tactical'] {
  const out: WorldState['tactical'] = { types: {}, compositions: {} };
  for (const id of sortedIds(formations)) {
    const cid = formations[id]!.composition;
    if (cid === null || out.compositions[cid]) continue;
    const c = resolved.tactical.compositions.get(cid);
    if (!c) throw new Error(`createWorld: unknown composition "${cid}"`);
    out.compositions[cid] = structuredCloneJson(c);
    for (const g of c.groups) {
      for (const p of g.parts) {
        const t = resolved.tactical.types.get(p.type);
        if (!t) throw new Error(`createWorld: unknown tactical type "${p.type}"`);
        out.types[t.id] = { ...t };
      }
    }
  }
  return out;
}

function createStrategy(st: ResolvedStrategy): StrategyState {
  const actors: Record<string, ActorState> = {};
  for (const a of st.actors) {
    actors[a.id] = {
      id: a.id,
      name: a.name,
      side: a.side ?? null,
      nations: [...a.nations],
      support: a.support ?? null,
      cohesion: a.cohesion ?? null,
      patience: a.patience ?? null,
      stability: a.stability ?? null,
      withdrawBelow: a.withdrawBelow ?? null,
      refusesRegions: [...a.refusesRegions],
      interveneAgainst: a.interveneAgainst ?? null,
      onIntervene: a.onIntervene ?? null,
      onWithdraw: a.onWithdraw ?? null,
      hostsAirPermille: a.hostsAirPermille,
      restrictsSources: [...a.restrictsSources],
      restrictedTo: a.restrictedTo,
      status: a.side ? 'active' : 'neutral',
    };
  }
  const m = st.missiles;
  return {
    mode: st.mode,
    actors,
    capital: { ...st.capital },
    actions: structuredCloneJson(st.actions),
    lastUsed: {},
    missiles: m
      ? {
          side: m.side,
          launchers: m.launchers,
          launchesPerLauncherPerDay: m.launchesPerLauncherPerDay,
          launchArea: { ...m.launchArea },
          targets: structuredCloneJson(m.targets),
          patriotSide: m.patriots.side,
          patriotBatteries: m.patriots.batteries,
          interceptPerBattery: m.patriots.interceptPerBattery,
          maxIntercept: m.patriots.maxIntercept,
          patriotsAt: { ...m.patriots.at },
          recent: [],
          fired: 0,
          hits: 0,
          suppression: 0,
        }
      : null,
    mandate: st.mandate ? structuredCloneJson(st.mandate) : null,
    ceasefireSpec: st.ceasefire ? structuredCloneJson(st.ceasefire) : null,
    ceasefire: { tick: null, reason: null },
    liberatedTick: null,
    pursuing: {},
    oilFires: null,
    oilFields: structuredCloneJson(st.oilFields),
    rules: { ...st.rules },
    log: [],
    dayStartLosses: {},
    objectivePoints: {},
    retreatLosses: {},
  };
}

function structuredCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Deep copy for snapshots. The state is plain JSON by contract, so a JSON round trip is exact. */
export function cloneWorld(world: WorldState): WorldState {
  return JSON.parse(JSON.stringify(world)) as WorldState;
}
