import { NationSchema, UnitTemplateSchema, type Nation, type UnitTemplate } from './schemas.ts';
import blueland from '../nations/blueland.json';
import testUnits from '../units/test.json';
import tiny from '../scenarios/test/tiny.json';

export interface Catalog {
  units: ReadonlyMap<string, UnitTemplate>;
  nations: ReadonlyMap<string, Nation>;
}

function indexById<T extends { id: string }>(items: T[], kind: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`Duplicate ${kind} id "${item.id}"`);
    map.set(item.id, item);
  }
  return map;
}

export function buildCatalog(raw: { units: unknown[]; nations: unknown[] }): Catalog {
  return {
    units: indexById(raw.units.map((u) => UnitTemplateSchema.parse(u)), 'unit template'),
    nations: indexById(raw.nations.map((n) => NationSchema.parse(n)), 'nation'),
  };
}

export const defaultCatalog: Catalog = buildCatalog({
  units: [...testUnits],
  nations: [blueland],
});

/** Raw scenario JSON by id; validate with loadScenario before use. */
export const scenarioFiles: Readonly<Record<string, unknown>> = { tiny };
