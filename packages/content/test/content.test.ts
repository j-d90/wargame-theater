import { describe, expect, it } from 'vitest';
import {
  buildCatalog,
  defaultCatalog,
  loadScenario,
  scenarioFiles,
  validateScenario,
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
