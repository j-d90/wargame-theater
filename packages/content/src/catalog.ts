import {
  GameMapSchema,
  NationSchema,
  TacticalCatalogSchema,
  UnitTemplateSchema,
  type Composition,
  type GameMap,
  type Nation,
  type TacticalType,
  type UnitTemplate,
} from './schemas.ts';
import blueland from '../nations/blueland.json';
import redland from '../nations/redland.json';
import coalitionSandbox from '../nations/coalition-sandbox.json';
import us from '../nations/us.json';
import uk from '../nations/uk.json';
import france from '../nations/france.json';
import saudiArabia from '../nations/saudi-arabia.json';
import egypt from '../nations/egypt.json';
import otherCoalition from '../nations/other-coalition.json';
import iraq from '../nations/iraq.json';
import testUnits from '../units/test.json';
import genericUnits from '../units/generic.json';
import desertStormUnits from '../units/desert-storm.json';
import tiny from '../scenarios/test/tiny.json';
import gulfSandbox from '../scenarios/gulf-sandbox/scenario.json';
import desertStorm from '../scenarios/desert-storm/scenario.json';
import gulfMap from '../maps/gulf/terrain.json';
import tactical from '../tactical/tactical.json';

export interface Catalog {
  units: ReadonlyMap<string, UnitTemplate>;
  nations: ReadonlyMap<string, Nation>;
  maps: ReadonlyMap<string, GameMap>;
  /** Battalion types and the compositions templates break down into. */
  tactical: TacticalCatalog;
}

export interface TacticalCatalog {
  types: ReadonlyMap<string, TacticalType>;
  compositions: ReadonlyMap<string, Composition>;
}

function indexById<T extends { id: string }>(items: T[], kind: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`Duplicate ${kind} id "${item.id}"`);
    map.set(item.id, item);
  }
  return map;
}

export function buildCatalog(raw: { units: unknown[]; nations: unknown[]; maps?: unknown[]; tactical?: unknown }): Catalog {
  const t = TacticalCatalogSchema.parse(raw.tactical ?? tactical);
  const types = indexById(t.types, 'tactical type');
  const compositions = indexById(t.compositions, 'composition');
  for (const c of compositions.values()) {
    const shorts = new Set<string>();
    for (const g of c.groups) {
      // Group labels become id segments, so they must be unique.
      if (shorts.has(g.short.toLowerCase())) throw new Error(`Composition "${c.id}": group label "${g.short}" is used twice`);
      shorts.add(g.short.toLowerCase());
      for (const p of g.parts) {
        if (!types.has(p.type)) throw new Error(`Composition "${c.id}": unknown tactical type "${p.type}"`);
      }
    }
  }
  const units = indexById(raw.units.map((u) => UnitTemplateSchema.parse(u)), 'unit template');
  for (const u of units.values()) {
    if (u.composition !== undefined && !compositions.has(u.composition)) {
      throw new Error(`Unit template "${u.id}": unknown composition "${u.composition}"`);
    }
  }
  return {
    units,
    nations: indexById(raw.nations.map((n) => NationSchema.parse(n)), 'nation'),
    maps: indexById((raw.maps ?? []).map((m) => GameMapSchema.parse(m)), 'map'),
    tactical: { types, compositions },
  };
}

export const defaultCatalog: Catalog = buildCatalog({
  units: [...testUnits, ...genericUnits, ...desertStormUnits],
  nations: [blueland, redland, coalitionSandbox, us, uk, france, saudiArabia, egypt, otherCoalition, iraq],
  maps: [gulfMap],
  tactical,
});

/** Raw scenario JSON by id; validate with loadScenario before use. */
export const scenarioFiles: Readonly<Record<string, unknown>> = { tiny, 'gulf-sandbox': gulfSandbox, 'desert-storm': desertStorm };
