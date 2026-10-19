import { GameMapSchema, NationSchema, UnitTemplateSchema, type GameMap, type Nation, type UnitTemplate } from './schemas.ts';
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

export interface Catalog {
  units: ReadonlyMap<string, UnitTemplate>;
  nations: ReadonlyMap<string, Nation>;
  maps: ReadonlyMap<string, GameMap>;
}

function indexById<T extends { id: string }>(items: T[], kind: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`Duplicate ${kind} id "${item.id}"`);
    map.set(item.id, item);
  }
  return map;
}

export function buildCatalog(raw: { units: unknown[]; nations: unknown[]; maps?: unknown[] }): Catalog {
  return {
    units: indexById(raw.units.map((u) => UnitTemplateSchema.parse(u)), 'unit template'),
    nations: indexById(raw.nations.map((n) => NationSchema.parse(n)), 'nation'),
    maps: indexById((raw.maps ?? []).map((m) => GameMapSchema.parse(m)), 'map'),
  };
}

export const defaultCatalog: Catalog = buildCatalog({
  units: [...testUnits, ...genericUnits, ...desertStormUnits],
  nations: [blueland, redland, coalitionSandbox, us, uk, france, saudiArabia, egypt, otherCoalition, iraq],
  maps: [gulfMap],
});

/** Raw scenario JSON by id; validate with loadScenario before use. */
export const scenarioFiles: Readonly<Record<string, unknown>> = { tiny, 'gulf-sandbox': gulfSandbox, 'desert-storm': desertStorm };
