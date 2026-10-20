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

describe('tactical catalog', () => {
  const t = defaultCatalog.tactical;
  const raw = () => ({
    types: [...t.types.values()].map((x) => ({ ...x })),
    compositions: [...t.compositions.values()].map((c) => structuredClone(c)),
  });

  it('gives every Desert Storm template a composition, with sources', () => {
    for (const u of defaultCatalog.units.values()) {
      if (!u.id.startsWith('ds-')) continue;
      expect(u.composition, u.id).toBeDefined();
      const c = t.compositions.get(u.composition!)!;
      expect(c.source.length).toBeGreaterThan(10);
    }
  });

  it('keeps group labels unique within a composition', () => {
    for (const c of t.compositions.values()) {
      const shorts = c.groups.map((g) => g.short.toLowerCase());
      expect(new Set(shorts).size, c.id).toBe(shorts.length);
    }
  });

  it('rejects a composition naming an unknown battalion type', () => {
    const bad = raw();
    bad.compositions[0]!.groups[0]!.parts[0]!.type = 'ghost-battalion';
    expect(() => buildCatalog({ units: [], nations: [], tactical: bad })).toThrow(/unknown tactical type "ghost-battalion"/);
  });

  it('rejects a template naming an unknown composition', () => {
    const u = { ...defaultCatalog.units.get('test-division')!, composition: 'ghost' };
    expect(() => buildCatalog({ units: [u], nations: [] })).toThrow(/unknown composition "ghost"/);
  });

  it('rejects out-of-range battalion stats', () => {
    const bad = raw();
    bad.types[0]!.rangeKm = 0;
    expect(() => buildCatalog({ units: [], nations: [], tactical: bad })).toThrow();
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

describe('Desert Storm content', () => {
  const dsRaw = () => structuredClone(scenarioFiles['desert-storm']) as Record<string, any>;
  const dsErrors = (mutate: (s: Record<string, any>) => void) => {
    const raw = dsRaw();
    mutate(raw);
    const r = validateScenario(raw);
    return r.ok ? '' : r.errors.join('\n');
  };

  it('loads with two sides, 43 Iraqi divisions, and cited sources', () => {
    const r = loadScenario('desert-storm');
    expect(r.scenario.sides.map((s) => s.id)).toEqual(['coalition', 'iraq']);
    const iraqi = r.scenario.formations.filter((f) => f.nation === 'iraq' && f.template);
    expect(iraqi).toHaveLength(43);
    for (const f of r.scenario.formations.filter((x) => x.template)) {
      expect(r.units.get(f.template!)?.source).toMatch(/Abstract game values/);
    }
  });

  it('resolves the strategic layer, allowing missile targets beyond the map edge', () => {
    const st = loadScenario('desert-storm').scenario.strategy!;
    expect(st.actors.find((a) => a.id === 'israeli-government')?.side).toBeUndefined();
    const israel = st.missiles!.targets.find((t) => t.id === 'israel')!;
    expect(israel.position.x).toBeLessThan(0); // west of the map
    expect(st.mandate?.allowedSouthOfY).toBeGreaterThan(0);
    for (const a of st.actors) expect(a.name).toMatch(/government|leadership/); // roles, not people
  });

  it('puts every scenario without sides on a single default side', () => {
    expect(loadScenario('tiny').scenario.sides.map((s) => s.id)).toEqual(['default']);
  });

  it.each([
    ['a nation on two sides', (s: any) => s.sides[1].nations.push('us'), /nation "us" is on more than one side/],
    ['a nation on no side', (s: any) => (s.sides[1].nations = []), /Too small|nation "iraq" is not on any side/],
    ['a supply node without a side', (s: any) => delete s.supply.nodes[0].side, /needs a side/],
    ['a plan objective that does not exist', (s: any) => s.sides[0].ai.offensive.plans[0].objectives.push('moscow'), /objective "moscow" does not exist/],
    ['a plan depot that is not mobile', (s: any) => (s.sides[0].ai.offensive.plans[0].depot = 'kkmc-log-base'), /not a mobile supply node/],
    ['an objective held by a non-side', (s: any) => (s.objectives[0].holder = 'martians'), /holder "martians" is not a side/],
    ['an objective in the sea', (s: any) => (s.objectives[0].position = { lat: 27.3, lon: 50.6 }), /impassable terrain/],
    ['an offensive posture without a plan', (s: any) => delete s.sides[0].ai.offensive, /needs an offensive plan/],
    ['an actor on an unknown side', (s: any) => (s.strategy.actors[0].side = 'martians'), /side "martians" is not a side/],
    ['an effect on an unknown actor', (s: any) => (s.strategy.actions[2].effects.patience = { nobody: 5 }), /patience effect on unknown actor "nobody"/],
    ['a locked action without a reason', (s: any) => delete s.strategy.actions.find((a: any) => a.lockedInRealistic).lockReason, /locked actions need a lockReason/],
    ['pressure without an actor target', (s: any) => delete s.strategy.actions.find((a: any) => a.kind === 'pressure').target, /pressure needs an actor target/],
    ['more Patriots deployed than exist', (s: any) => (s.strategy.missiles.patriots.at = { riyadh: 9 }), /more batteries deployed than exist/],
    ['a region that is not on the map', (s: any) => s.strategy.actors[3].refusesRegions.push('narnia'), /region "narnia" is not on the map/],
    ['a missile weight for an unknown target', (s: any) => (s.sides[1].ai.strategy.scudTargets.paris = 5), /"paris" is not a missile target/],
    ['a pursuit by a non-command', (s: any) => s.sides[0].ai.strategy.pursuit.push({ corps: 'us-1ad', objectives: ['basra'] }), /strategy.pursuit: "us-1ad" is not a formation with children/],
    ['a port restriction on a depot', (s: any) => s.strategy.actors[3].restrictsSources.push('kkmc-log-base'), /"kkmc-log-base" is not a supply source/],
  ])('rejects %s', (_name, mutate, pattern) => {
    expect(dsErrors(mutate)).toMatch(pattern);
  });
});
