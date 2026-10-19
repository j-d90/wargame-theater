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
  })
  .superRefine((m, ctx) => {
    const t = m.terrain;
    if (t.cells.length !== t.cols * t.rows) {
      ctx.addIssue({ code: 'custom', path: ['terrain', 'cells'], message: `expected ${t.cols * t.rows} cells, got ${t.cells.length}` });
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

export const ScenarioSchema = z.object({
  id,
  name: z.string().min(1),
  description: z.string().optional(),
  seed: z.number().int(),
  days: z.number().int().positive(),
  /** Map id from the catalog. Without one the world is open, flat ground. */
  map: id.optional(),
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
