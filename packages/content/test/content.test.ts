import { describe, expect, it } from 'vitest';
import {
  GameMapSchema,
  buildCatalog,
  defaultCatalog,
  latLonToXY,
  loadScenario,
  scenarioFiles,
  terrainCodeAt,
  validateScenario,
  xyToLatLon,
} from '../src/index.ts';

const tinyRaw = () => structuredClone(scenarioFiles['tiny']) as Record<string, any>;

function errorsFor(mutate: (s: Record<string, any>) => void): string[] {
  const raw = tinyRaw();
  mutate(raw);
  const r = validateScenario(raw);
  return r.ok ? [] : r.errors;
}

describe('content', () => {
  it('loads and validates the tiny scenario', () => {
    const r = loadScenario('tiny');
    expect(r.scenario.days).toBe(43);
    expect(r.scenario.formations).toHaveLength(8);
    expect(r.units.get('test-division')?.strength).toBe(1200);
  });

  it('reports an unknown scenario id with the known ones', () => {
    expect(() => loadScenario('nope')).toThrow(/Known: tiny/);
  });

  it('reports schema errors with their path', () => {
    const errs = errorsFor((s) => {
      s.formations[0].echelon = 'platoon-ish';
      s.seed = 'abc';
    });
    expect(errs.some((e) => e.startsWith('formations.0.echelon'))).toBe(true);
    expect(errs.some((e) => e.startsWith('seed'))).toBe(true);
  });

  it.each([
    ['missing parent', (s: any) => (s.formations[2].parent = 'ghost'), /parent "ghost" does not exist/],
    ['unknown template', (s: any) => (s.formations[6].template = 'ghost'), /template "ghost" is not in the catalog/],
    ['leaf without template', (s: any) => delete s.formations[6].template, /leaf formations need a template/],
    ['template on a parent', (s: any) => (s.formations[3].template = 'test-division'), /take their stats from children/],
    ['aggregated leaf', (s: any) => (s.formations[6].aggregated = true), /only formations with children/],
    ['unknown supply node', (s: any) => (s.formations[6].supplyNode = 'ghost'), /supplyNode "ghost" does not exist/],
    ['no supply anywhere', (s: any) => {
      for (const f of s.formations) delete f.supplyNode;
    }, /no supplyNode on it or any ancestor/],
    ['parent cycle', (s: any) => (s.formations[0].parent = 'div-2'), /cycle/],
    ['duplicate id', (s: any) => (s.formations[7].id = 'div-2'), /duplicate formation id "div-2"/],
    ['bad link endpoint', (s: any) => (s.supply.links[0].to = 'ghost'), /to "ghost" does not exist/],
    ['self link', (s: any) => (s.supply.links[0].to = s.supply.links[0].from), /links a node to itself/],
    ['depot production', (s: any) => (s.supply.nodes[1].productionPerTick = 5), /only sources produce/],
    ['overfull node', (s: any) => (s.supply.nodes[1].stock = 999999), /stock exceeds capacity/],
    ['event past the end', (s: any) => (s.events[0].day = 99), /past the scenario end/],
    ['event on unknown link', (s: any) => (s.events[1].target.id = 'ghost'), /link "ghost" does not exist/],
    ['expand a leaf', (s: any) => (s.events[0].formation = 'div-2'), /not a formation with children/],
    ['unlisted nation', (s: any) => (s.formations[1].nation = 'redland'), /not listed in scenario nations/],
  ])('rejects %s', (_name, mutate, pattern) => {
    const errs = errorsFor(mutate);
    expect(errs.join('\n')).toMatch(pattern);
  });

  it('rejects a scenario nation missing from the catalog', () => {
    const empty = buildCatalog({ units: [...defaultCatalog.units.values()], nations: [] });
    const r = validateScenario(tinyRaw(), empty);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/nation "blueland" is not in the catalog/);
  });

  it('rejects duplicate catalog entries', () => {
    const u = defaultCatalog.units.get('test-division');
    expect(() => buildCatalog({ units: [u, u], nations: [] })).toThrow(/Duplicate unit template/);
  });
});

describe('maps', () => {
  const gulf = defaultCatalog.maps.get('gulf')!;
  const sandboxRaw = () => structuredClone(scenarioFiles['gulf-sandbox']) as Record<string, any>;
  const sandboxErrors = (mutate: (s: Record<string, any>) => void) => {
    const raw = sandboxRaw();
    mutate(raw);
    const r = validateScenario(raw);
    return r.ok ? '' : r.errors.join('\n');
  };

  it('loads the Gulf map with a consistent terrain grid and cited sources', () => {
    expect(gulf.terrain.cells).toHaveLength(gulf.terrain.cols * gulf.terrain.rows);
    expect(gulf.terrain.cols * gulf.terrain.cellKm).toBeGreaterThanOrEqual(gulf.widthKm);
    expect(gulf.sources.join()).toMatch(/Natural Earth/);
  });

  it('projects lat/lon to km and back', () => {
    const p = latLonToXY(gulf.frame, 29.37, 47.98);
    const back = xyToLatLon(gulf.frame, p.x, p.y);
    expect(back.lat).toBeCloseTo(29.37, 4);
    expect(back.lon).toBeCloseTo(47.98, 4);
    expect(latLonToXY(gulf.frame, gulf.frame.north, gulf.frame.west)).toEqual({ x: 0, y: 0 });
  });

  it('knows land from water at a few well-known places', () => {
    const at = (lat: number, lon: number) => terrainCodeAt(gulf, latLonToXY(gulf.frame, lat, lon));
    expect(at(27.3, 50.6)).toBe('~'); // Persian Gulf
    expect(at(28.43, 45.96)).not.toBe('~'); // Hafar al-Batin
    expect(at(33.341, 44.392)).toBe('u'); // Baghdad
    expect(at(36.5, 45.5)).toMatch(/[\^M]/); // Zagros
    expect(at(10, 10)).toBeUndefined();
  });

  it('loads the sandbox scenario with positions converted to km', () => {
    const r = loadScenario('gulf-sandbox');
    expect(r.map?.id).toBe('gulf');
    const port = r.scenario.supply.nodes.find((n) => n.id === 'dammam-port')!;
    expect(port.position).toEqual(latLonToXY(gulf.frame, 26.43, 50.05));
  });

  it.each([
    ['unknown map', (s: any) => (s.map = 'atlantis'), /map "atlantis" is not in the catalog/],
    ['lat/lon without a map', (s: any) => delete s.map, /lat\/lon positions need a scenario map/],
    ['position off the map', (s: any) => (s.formations[3].position = { lat: 10, lon: 10 }), /off the map/],
    ['unit in the sea', (s: any) => (s.formations[3].position = { lat: 27.3, lon: 50.6 }), /impassable terrain/],
    ['move into the sea', (s: any) => s.events.push({ day: 1, type: 'move', formation: 'div-w1', to: { lat: 27.3, lon: 50.6 } }), /events.0: position is on impassable/],
    ['move an unknown formation', (s: any) => s.events.push({ day: 1, type: 'move', formation: 'ghost', to: { x: 500, y: 900 } }), /formation "ghost" does not exist/],
  ])('rejects %s', (_name, mutate, pattern) => {
    expect(sandboxErrors(mutate)).toMatch(pattern);
  });

  it('rejects a terrain grid whose size or codes do not match', () => {
    const bad = structuredClone(gulf);
    bad.terrain.cells = bad.terrain.cells.slice(1) + 'Z';
    const r = GameMapSchema.safeParse(bad);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/unknown terrain codes Z/);
    bad.terrain.cells = 'Z';
    expect(JSON.stringify(GameMapSchema.safeParse(bad).error?.issues)).toMatch(/expected \d+ cells/);
  });
});
