import { z } from 'zod';

// All gameplay numbers are abstract game stats (see CLAUDE.md content guardrails).
// Quantities that the sim accumulates are integers so state hashes stay stable.

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase kebab-case');
const nonNegInt = z.number().int().nonnegative();
const permille = z.number().int().min(0).max(1000);

export const EchelonSchema = z.enum([
  'nation',
  'theater',
  'army',
  'corps',
  'division',
  'brigade',
  'battalion',
  'company',
]);
export type Echelon = z.infer<typeof EchelonSchema>;

/** Map kilometres (see projection.ts). */
export const XYSchema = z.object({ x: z.number(), y: z.number() });
export type Position = z.infer<typeof XYSchema>;
/** Scenarios may place things in km or, on scenarios with a map, by latitude/longitude. */
export const PositionSchema = z.union([XYSchema, z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })]);
export type PositionInput = z.infer<typeof PositionSchema>;

export const MapFrameSchema = z.object({
  west: z.number(),
  east: z.number(),
  south: z.number(),
  north: z.number(),
  kmPerDegLon: z.number().positive(),
  kmPerDegLat: z.number().positive(),
});

export const TerrainClassSchema = z.object({
  code: z.string().length(1),
  name: z.string().min(1),
  /** Movement speed factor, permille of full speed. 0 means impassable. */
  speed: permille,
  /** Defender's protection multiplier, permille (1000 = no bonus). */
  defense: z.number().int().min(500).max(3000).default(1000),
});
export type TerrainClass = z.infer<typeof TerrainClassSchema>;

export const GameMapSchema = z
  .object({
    id,
    name: z.string().min(1),
    sources: z.array(z.string()).min(1),
    frame: MapFrameSchema,
    widthKm: z.number().positive(),
    heightKm: z.number().positive(),
    terrain: z.object({
      cellKm: z.number().positive(),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
      classes: z.array(TerrainClassSchema).min(1),
      /** One class code per cell, row by row from the north-west corner. */
      cells: z.string(),
    }),
    /** Country of each terrain cell ('.' for none), on the same grid. */
    regions: z
      .object({
        names: z.record(z.string().length(1), id),
        cells: z.string(),
      })
      .optional(),
  })
  .superRefine((m, ctx) => {
    const t = m.terrain;
    if (t.cells.length !== t.cols * t.rows) {
      ctx.addIssue({ code: 'custom', path: ['terrain', 'cells'], message: `expected ${t.cols * t.rows} cells, got ${t.cells.length}` });
    }
    if (m.regions && m.regions.cells.length !== t.cols * t.rows) {
      ctx.addIssue({ code: 'custom', path: ['regions', 'cells'], message: `expected ${t.cols * t.rows} region cells` });
    }
    const codes = new Set(t.classes.map((c) => c.code));
    const unknown = [...new Set(t.cells)].filter((c) => !codes.has(c));
    if (unknown.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['terrain', 'cells'], message: `unknown terrain codes ${unknown.join(', ')}` });
    }
  });
export type GameMap = z.infer<typeof GameMapSchema>;

export const UnitTemplateSchema = z.object({
  id,
  name: z.string().min(1),
  echelon: EchelonSchema,
  /** Abstract strength points at full establishment. */
  strength: z.number().int().positive(),
  /** Supply units consumed per tick at full strength. */
  supplyPerTick: z.number().int().positive(),
  /** Days of supply the formation carries with it. */
  stockDays: z.number().int().positive(),
  /** Unit type, used for map symbols. */
  branch: z.enum(['armor', 'mechanized', 'infantry', 'artillery', 'support']).optional(),
  /** Road-march speed in open terrain at full readiness, km per day. */
  speedKmPerDay: z.number().int().positive().default(40),
  /** Abstract fighting quality (training, equipment, doctrine), permille of a baseline unit. */
  quality: z.number().int().positive().default(1000),
  source: z.string().optional(),
});
export type UnitTemplate = z.infer<typeof UnitTemplateSchema>;

export const NationSchema = z.object({
  id,
  name: z.string().min(1),
  source: z.string().optional(),
});
export type Nation = z.infer<typeof NationSchema>;

/** Placeholder for later milestones; nothing consumes weapons in M1. */
export const WeaponSchema = z.object({
  id,
  name: z.string().min(1),
  range: z.number().nonnegative(),
  effect: z.number().nonnegative(),
  cost: z.number().nonnegative(),
});
export type Weapon = z.infer<typeof WeaponSchema>;

export const FormationSpecSchema = z.object({
  id,
  name: z.string().min(1),
  nation: id,
  echelon: EchelonSchema,
  parent: id.optional(),
  /** Required on leaf formations; their starting stats come from it. */
  template: id.optional(),
  position: PositionSchema,
  /** Supply node this formation draws from. Children inherit it when unset. */
  supplyNode: id.optional(),
  /** Start collapsed into a single aggregate block. Only meaningful with children. */
  aggregated: z.boolean().optional(),
  strengthPct: z.number().int().min(1).max(100).optional(),
  readiness: permille.optional(),
  morale: permille.optional(),
  stockPct: z.number().int().min(0).max(100).optional(),
  /** Prepared defences at the start, permille extra protection. */
  fortification: z.number().int().min(0).max(2000).optional(),
});
export type FormationSpec = z.infer<typeof FormationSpecSchema>;

export const SupplyNodeSpecSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(['source', 'depot']),
  position: PositionSchema,
  capacity: z.number().int().positive(),
  stock: nonNegInt.optional(),
  /** Supply units produced per tick; sources only. */
  productionPerTick: nonNegInt.optional(),
  /** Owning side; required when a scenario has more than one side. */
  side: id.optional(),
  /** Mobile depots can be moved forward behind advancing forces. */
  mobile: z.boolean().optional(),
  speedKmPerDay: z.number().int().positive().optional(),
});
export type SupplyNodeSpec = z.infer<typeof SupplyNodeSpecSchema>;

export const SupplyLinkSpecSchema = z.object({
  id,
  from: id,
  to: id,
  mode: z.enum(['road', 'rail', 'sea', 'pipeline', 'air']),
  capacityPerTick: z.number().int().positive(),
  /** Max daily throughput loss in permille, rolled with the seeded RNG. */
  variance: permille.optional(),
  /** Abstract 0..1 exposure to attack; stored for later milestones. */
  vulnerability: z.number().min(0).max(1).optional(),
});
export type SupplyLinkSpec = z.infer<typeof SupplyLinkSpecSchema>;

const At = { day: nonNegInt, hour: z.number().int().min(0).max(23).optional() };

export const ScenarioEventSchema = z.discriminatedUnion('type', [
  z.object({ ...At, type: z.literal('expand'), formation: id }),
  z.object({ ...At, type: z.literal('aggregate'), formation: id }),
  z.object({ ...At, type: z.literal('move'), formation: id, to: PositionSchema }),
  z.object({
    ...At,
    type: z.literal('setDisrupted'),
    target: z.object({ kind: z.enum(['node', 'link']), id }),
    disrupted: z.boolean(),
  }),
]);
export type ScenarioEvent = z.infer<typeof ScenarioEventSchema>;

export const ObjectiveSpecSchema = z.object({
  id,
  name: z.string().min(1),
  position: PositionSchema,
  /** Side holding it at the start. */
  holder: id.optional(),
  /** A side holds the objective when only its formations are within this radius. */
  radiusKm: z.number().positive().default(20),
  points: z.number().int().nonnegative().default(10),
});
export type ObjectiveSpec = z.infer<typeof ObjectiveSpecSchema>;

export const AirSpecSchema = z.object({
  /** Abstract daily air effort at full strength. */
  sortiesPerDay: z.number().int().nonnegative(),
  /** Abstract air quality, permille of baseline. */
  quality: z.number().int().positive().default(1000),
});
export type AirSpec = z.infer<typeof AirSpecSchema>;

export const OffensivePlanSchema = z.object({
  /** The command whose subordinates carry out this plan. */
  corps: id,
  /** Where its divisions gather before the offensive. */
  assembly: PositionSchema,
  /** Objectives to take, in order. */
  objectives: z.array(id).min(1),
  /** Mobile depot that follows this command forward. */
  depot: id.optional(),
});
export type OffensivePlan = z.infer<typeof OffensivePlanSchema>;

/** How a side's strategic AI behaves; the knobs the M4 experiments turn. */
export const StrategyAiSpecSchema = z.object({
  /** Answer enemy missile strikes on neutrals (hunt launchers, send Patriots, press for restraint), or ignore them. */
  scudResponse: z.enum(['historical', 'ignore']).default('historical'),
  /** Share of air effort for missile-launcher hunting while missiles are flying, permille. */
  scudHuntShare: permille.default(120),
  /** Share of air effort for strategic bombing, permille. */
  strategicBombing: permille.default(0),
  /** Keep going past the mandate after liberation instead of declaring a cease-fire. */
  pursueAfterLiberation: z.boolean().default(false),
  /** Extra objectives per command when pursuing. */
  pursuit: z.array(z.object({ corps: id, objectives: z.array(id).min(1) })).default([]),
  /** Hours after the cease-fire conditions are met before declaring it. */
  ceasefireAfterHours: nonNegInt.default(24),
  /** Weights for choosing missile targets, by target id. */
  scudTargets: z.record(id, nonNegInt).default({}),
  /** Strategic actions to take on their own, from a given day. */
  useActions: z.array(z.object({ action: id, fromDay: nonNegInt, whenWithdrawing: z.boolean().default(false) })).default([]),
  /** Withdraw once the regime's stability falls below this (permille). */
  withdrawWhenStabilityBelow: permille.optional(),
});
export type StrategyAiSpec = z.infer<typeof StrategyAiSpecSchema>;

export const AiSpecSchema = z.object({
  posture: z.enum(['offensive', 'defensive']),
  /** 0..1000. Lower competence decides less often and reacts to less. */
  competence: permille.default(700),
  strategy: StrategyAiSpecSchema.optional(),
  offensive: z
    .object({
      /** The ground offensive starts no earlier than this day... */
      earliestDay: nonNegInt,
      /** ...and no later than this one... */
      latestDay: nonNegInt,
      /** ...or as soon as enemy combat power falls below this share of its start (permille). */
      launchWhenEnemyBelow: permille,
      plans: z.array(OffensivePlanSchema).min(1),
    })
    .optional(),
  defensive: z
    .object({
      /** Commands whose subordinates counterattack nearby threats. */
      reserves: z.array(id).default([]),
      reactionKm: z.number().positive().default(80),
      /** Withdraw everything toward `withdrawTo` once own combat power falls below this share (permille)... */
      withdrawBelow: permille,
      /** ...or once the enemy holds any of these objectives. */
      withdrawWhenLost: z.array(id).default([]),
      withdrawTo: PositionSchema,
    })
    .optional(),
});
export type AiSpec = z.infer<typeof AiSpecSchema>;

export const SideSpecSchema = z.object({
  id,
  name: z.string().min(1),
  /** Map colour as #rrggbb. */
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  nations: z.array(id).min(1),
  air: AirSpecSchema.optional(),
  ai: AiSpecSchema.optional(),
});
export type SideSpec = z.infer<typeof SideSpecSchema>;

// ---------------------------------------------------------------- strategic layer

/** Changes to actors' gauges, by actor id. Permille points. */
export const EffectsSchema = z.object({
  support: z.record(id, z.number()).default({}),
  cohesion: z.record(id, z.number()).default({}),
  patience: z.record(id, z.number()).default({}),
  stability: z.record(id, z.number()).default({}),
  /** Change to the acting side's political capital. */
  capital: z.number().default(0),
});
export type Effects = z.infer<typeof EffectsSchema>;

export const ActorSpecSchema = z.object({
  id,
  /** Shown by role ("US government"), never by a living person's name. */
  name: z.string().min(1),
  /** Side the actor belongs to; absent for neutrals. */
  side: id.optional(),
  /** Formations of these nations answer to this actor. */
  nations: z.array(id).default([]),
  /** Home public support (democracies), permille. */
  support: permille.optional(),
  /** Commitment to the coalition, permille. */
  cohesion: permille.optional(),
  /** A neutral's restraint, permille. At zero it intervenes. */
  patience: permille.optional(),
  /** Regime stability, permille. */
  stability: permille.optional(),
  /** Pulls its forces out when cohesion falls below this. */
  withdrawBelow: permille.optional(),
  /** Its forces will not be sent into these regions (a legal limit, enforced in realistic mode). */
  refusesRegions: z.array(id).default([]),
  /** For a neutral: the side it attacks when it intervenes, and what that does. */
  interveneAgainst: id.optional(),
  onIntervene: EffectsSchema.optional(),
  /** What its withdrawal does to the others. */
  onWithdraw: EffectsSchema.optional(),
  /** Share of its side's air effort flown from its bases, lost if it withdraws (permille). */
  hostsAirPermille: permille.default(0),
  /** Supply sources on its territory (ports) that lose capacity if it withdraws... */
  restrictsSources: z.array(id).default([]),
  /** ...down to this share of their production, permille. */
  restrictedTo: permille.default(1000),
});
export type ActorSpec = z.infer<typeof ActorSpecSchema>;

export const StrategicActionSpecSchema = z.object({
  id,
  name: z.string().min(1),
  side: id,
  description: z.string().min(1),
  /**
   * What the action does beyond its effects: 'generic' (effects only), 'pressure' (adds patience to `target`),
   * 'deploy-patriots' (Patriot batteries to missile target `target`), 'declare-ceasefire', 'pursue'
   * (press on past the mandate; enemy forces rally to defend their homeland),
   * 'oil-fires', 'countervalue'.
   */
  kind: z.enum(['generic', 'pressure', 'deploy-patriots', 'declare-ceasefire', 'pursue', 'oil-fires', 'countervalue']),
  target: id.optional(),
  /** 0 (routine) to 5 (extreme). Shown to the player; locks apply to the dangerous rungs. */
  escalation: z.number().int().min(0).max(5).default(0),
  lockedInRealistic: z.boolean().default(false),
  lockReason: z.string().optional(),
  cost: nonNegInt.default(0),
  cooldownDays: nonNegInt.default(0),
  oneShot: z.boolean().default(false),
  requires: z
    .object({
      objectivesHeld: z.array(id).default([]),
      minDay: nonNegInt.default(0),
    })
    .default({ objectivesHeld: [], minDay: 0 }),
  effects: EffectsSchema.default({ support: {}, cohesion: {}, patience: {}, stability: {}, capital: 0 }),
});
export type StrategicActionSpec = z.infer<typeof StrategicActionSpecSchema>;

export const MissileTargetSpecSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(['city', 'military']),
  /** May lie beyond the map edge. */
  position: PositionSchema,
  onHit: EffectsSchema,
  onIntercept: EffectsSchema,
});
export type MissileTargetSpec = z.infer<typeof MissileTargetSpecSchema>;

export const StrategyRulesSchema = z.object({
  patienceRecoveryPerDay: z.number().default(10),
  /** Support lost per permille of a side's strength lost in a day. */
  supportPerLossPermille: z.number().default(3),
  supportFatiguePerDay: z.number().default(2),
  /** Support gained per objective point captured. */
  supportPerObjectivePoint: z.number().default(0.5),
  /** Support and Arab cohesion lost per 100 effective strategic-bombing sorties (civilian harm). */
  civilianHarmPer100Sorties: z.number().default(1),
  stabilityPerLossPermille: z.number().default(1),
  stabilityPer100StrategicSorties: z.number().default(2),
  /** Industry destroyed per 100 effective strategic sorties (permille, diminishing) and repaired per day. */
  industryPer100Sorties: z.number().default(20),
  industryRepairPerDay: z.number().default(5),
  /** Support lost per permille of the enemy's strength destroyed while retreating, after liberation. */
  supportPerRetreatKillPermille: z.number().default(2),
  /** Effective hunting sorties for half suppression of missile launches. */
  scudHalfSuppressionSorties: z.number().default(150),
  /** Share of suppressed launchers destroyed per day, permille. */
  scudKillPerDay: z.number().default(40),
  capitalPerDay: z.number().default(5),
});
export type StrategyRules = z.infer<typeof StrategyRulesSchema>;

export const StrategySpecSchema = z.object({
  mode: z.enum(['realistic', 'sandbox']).default('realistic'),
  capital: z.record(id, nonNegInt).default({}),
  actors: z.array(ActorSpecSchema).min(1),
  actions: z.array(StrategicActionSpecSchema).default([]),
  missiles: z
    .object({
      side: id,
      launchers: nonNegInt,
      launchesPerLauncherPerDay: z.number().nonnegative(),
      launchArea: PositionSchema,
      targets: z.array(MissileTargetSpecSchema).min(1),
      patriots: z.object({
        side: id,
        batteries: nonNegInt,
        interceptPerBattery: permille,
        maxIntercept: permille,
        /** Starting deployment, by target id. */
        at: z.record(id, nonNegInt).default({}),
      }),
    })
    .optional(),
  mandate: z
    .object({
      side: id,
      /** Regions the side's forces may not enter under the mandate... */
      forbiddenRegions: z.array(id),
      /** ...except south of this latitude. */
      allowedSouthOfLat: z.number().optional(),
      /** Cohesion each of these actors loses per day for each formation beyond the mandate. */
      cohesionPerFormationDay: z.record(id, z.number()).default({}),
    })
    .optional(),
  ceasefire: z
    .object({
      side: id,
      /** Objectives whose holding counts as liberation. */
      requires: z.array(id).min(1),
      /** Public pressure forces a cease-fire after liberation once any of the side's support falls below this. */
      forceWhenSupportBelow: permille.default(500),
    })
    .optional(),
  /** Oil fields that burn if set alight. */
  oilFields: z.array(z.object({ name: z.string(), position: PositionSchema })).default([]),
  rules: StrategyRulesSchema.default(StrategyRulesSchema.parse({})),
});
export type StrategySpec = z.infer<typeof StrategySpecSchema>;

export const ScenarioSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().optional(),
  seed: z.number().int(),
  days: z.number().int().positive(),
  /** Map id from the catalog. Without one the world is open, flat ground. */
  map: id.optional(),
  /** Calendar date of day 0, YYYY-MM-DD, for display. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Opposing sides. Without them every nation is on one side and nothing fights. */
  sides: z.array(SideSpecSchema).optional(),
  objectives: z.array(ObjectiveSpecSchema).default([]),
  strategy: StrategySpecSchema.optional(),
  nations: z.array(id).min(1),
  formations: z.array(FormationSpecSchema).min(1),
  supply: z.object({
    nodes: z.array(SupplyNodeSpecSchema),
    links: z.array(SupplyLinkSpecSchema),
  }),
  events: z.array(ScenarioEventSchema).default([]),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
/** Scenario as written in JSON, before defaults are applied. */
export type ScenarioInput = z.input<typeof ScenarioSchema>;
