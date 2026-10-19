import { defaultCatalog, scenarioFiles, type Catalog } from './catalog.ts';
import { ScenarioSchema, type Nation, type Scenario, type UnitTemplate } from './schemas.ts';

export interface ResolvedScenario {
  scenario: Scenario;
  units: ReadonlyMap<string, UnitTemplate>;
  nations: ReadonlyMap<string, Nation>;
}

export type ValidationResult =
  | { ok: true; value: ResolvedScenario }
  | { ok: false; errors: string[] };

/** Schema validation plus the cross-references Zod can't express. */
export function validateScenario(raw: unknown, catalog: Catalog = defaultCatalog): ValidationResult {
  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const s = parsed.data;
  const errors: string[] = [];

  const dupes = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${kind} id "${id}"`);
      seen.add(id);
    }
    return seen;
  };
  const formationIds = dupes('formation', s.formations.map((f) => f.id));
  const nodeIds = dupes('supply node', s.supply.nodes.map((n) => n.id));
  const linkIds = dupes('supply link', s.supply.links.map((l) => l.id));

  for (const n of s.nations) {
    if (!catalog.nations.has(n)) errors.push(`scenario nation "${n}" is not in the catalog`);
  }

  const byId = new Map(s.formations.map((f) => [f.id, f]));
  const hasChildren = new Set(s.formations.flatMap((f) => (f.parent ? [f.parent] : [])));
  for (const f of s.formations) {
    const where = `formation "${f.id}"`;
    if (!s.nations.includes(f.nation)) errors.push(`${where}: nation "${f.nation}" is not listed in scenario nations`);
    if (f.parent !== undefined && !formationIds.has(f.parent)) errors.push(`${where}: parent "${f.parent}" does not exist`);
    if (f.supplyNode !== undefined && !nodeIds.has(f.supplyNode)) errors.push(`${where}: supplyNode "${f.supplyNode}" does not exist`);
    const leaf = !hasChildren.has(f.id);
    if (leaf) {
      if (f.template === undefined) errors.push(`${where}: leaf formations need a template`);
      else if (!catalog.units.has(f.template)) errors.push(`${where}: template "${f.template}" is not in the catalog`);
      if (f.aggregated) errors.push(`${where}: only formations with children can start aggregated`);
    } else if (f.template !== undefined) {
      errors.push(`${where}: formations with children take their stats from children, not a template`);
    }
    // Walk to the root: catches cycles and finds the inherited supply node.
    const seen = new Set<string>();
    let cur: typeof f | undefined = f;
    let supplied = false;
    while (cur) {
      if (seen.has(cur.id)) {
        errors.push(`${where}: parent chain has a cycle`);
        break;
      }
      seen.add(cur.id);
      if (cur.supplyNode !== undefined) supplied = true;
      cur = cur.parent === undefined ? undefined : byId.get(cur.parent);
    }
    if (leaf && !supplied) errors.push(`${where}: no supplyNode on it or any ancestor`);
  }

  for (const n of s.supply.nodes) {
    if (n.kind === 'depot' && n.productionPerTick !== undefined) errors.push(`supply node "${n.id}": only sources produce`);
    if ((n.stock ?? 0) > n.capacity) errors.push(`supply node "${n.id}": stock exceeds capacity`);
  }
  for (const l of s.supply.links) {
    if (!nodeIds.has(l.from)) errors.push(`supply link "${l.id}": from "${l.from}" does not exist`);
    if (!nodeIds.has(l.to)) errors.push(`supply link "${l.id}": to "${l.to}" does not exist`);
    if (l.from === l.to) errors.push(`supply link "${l.id}": links a node to itself`);
  }

  s.events.forEach((e, i) => {
    const where = `events.${i}`;
    if (e.day >= s.days) errors.push(`${where}: day ${e.day} is past the scenario end (${s.days} days)`);
    if (e.type === 'setDisrupted') {
      const ids = e.target.kind === 'node' ? nodeIds : linkIds;
      if (!ids.has(e.target.id)) errors.push(`${where}: ${e.target.kind} "${e.target.id}" does not exist`);
    } else if (!hasChildren.has(e.formation)) {
      errors.push(`${where}: "${e.formation}" is not a formation with children`);
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { scenario: s, units: catalog.units, nations: catalog.nations } };
}

export function loadScenario(idOrRaw: string | unknown, catalog: Catalog = defaultCatalog): ResolvedScenario {
  const raw = typeof idOrRaw === 'string' ? scenarioFiles[idOrRaw] : idOrRaw;
  if (raw === undefined) {
    throw new Error(`Unknown scenario "${String(idOrRaw)}". Known: ${Object.keys(scenarioFiles).join(', ')}`);
  }
  const result = validateScenario(raw, catalog);
  if (!result.ok) throw new Error(`Invalid scenario:\n  ${result.errors.join('\n  ')}`);
  return result.value;
}
