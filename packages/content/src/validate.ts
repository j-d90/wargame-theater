import { defaultCatalog, scenarioFiles, type Catalog } from './catalog.ts';
import { latLonToXY } from './projection.ts';
import {
  ScenarioSchema,
  type FormationSpec,
  type GameMap,
  type Nation,
  type Position,
  type PositionInput,
  type Scenario,
  type ScenarioEvent,
  type SupplyLinkSpec,
  type SupplyNodeSpec,
  type UnitTemplate,
} from './schemas.ts';

// A resolved scenario has every position converted to map km.
type MoveEvent = Extract<ScenarioEvent, { type: 'move' }>;
export type ResolvedFormationSpec = Omit<FormationSpec, 'position'> & { position: Position };
export type ResolvedSupplyNodeSpec = Omit<SupplyNodeSpec, 'position'> & { position: Position };
export type ResolvedEvent = Exclude<ScenarioEvent, MoveEvent> | (Omit<MoveEvent, 'to'> & { to: Position });
export interface ResolvedScenarioData extends Omit<Scenario, 'formations' | 'supply' | 'events'> {
  formations: ResolvedFormationSpec[];
  supply: { nodes: ResolvedSupplyNodeSpec[]; links: SupplyLinkSpec[] };
  events: ResolvedEvent[];
}

export interface ResolvedScenario {
  scenario: ResolvedScenarioData;
  units: ReadonlyMap<string, UnitTemplate>;
  nations: ReadonlyMap<string, Nation>;
  map: GameMap | null;
}

export type ValidationResult =
  | { ok: true; value: ResolvedScenario }
  | { ok: false; errors: string[] };

/** Terrain class code at a map position, or undefined off the map. */
export function terrainCodeAt(map: GameMap, p: Position): string | undefined {
  const t = map.terrain;
  const c = Math.floor(p.x / t.cellKm);
  const r = Math.floor(p.y / t.cellKm);
  if (c < 0 || r < 0 || c >= t.cols || r >= t.rows) return undefined;
  return t.cells[r * t.cols + c];
}

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

  let map: GameMap | null = null;
  if (s.map !== undefined) {
    map = catalog.maps.get(s.map) ?? null;
    if (!map) errors.push(`map "${s.map}" is not in the catalog`);
  }
  const impassable = new Set(map?.terrain.classes.filter((c) => c.speed === 0).map((c) => c.code));
  const resolvePos = (p: PositionInput, where: string, mustBePassable: boolean): Position => {
    let xy: Position;
    if ('lat' in p) {
      if (!map) {
        errors.push(`${where}: lat/lon positions need a scenario map`);
        return { x: 0, y: 0 };
      }
      xy = latLonToXY(map.frame, p.lat, p.lon);
    } else {
      xy = { x: p.x, y: p.y };
    }
    if (map) {
      const code = terrainCodeAt(map, xy);
      if (code === undefined) errors.push(`${where}: position is off the map`);
      else if (mustBePassable && impassable.has(code)) errors.push(`${where}: position is on impassable terrain`);
    }
    return xy;
  };

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
  const formations: ResolvedFormationSpec[] = [];
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
    formations.push({ ...f, position: resolvePos(f.position, where, leaf) });
  }

  const nodes: ResolvedSupplyNodeSpec[] = [];
  for (const n of s.supply.nodes) {
    const where = `supply node "${n.id}"`;
    if (n.kind === 'depot' && n.productionPerTick !== undefined) errors.push(`${where}: only sources produce`);
    if ((n.stock ?? 0) > n.capacity) errors.push(`${where}: stock exceeds capacity`);
    nodes.push({ ...n, position: resolvePos(n.position, where, false) });
  }
  for (const l of s.supply.links) {
    if (!nodeIds.has(l.from)) errors.push(`supply link "${l.id}": from "${l.from}" does not exist`);
    if (!nodeIds.has(l.to)) errors.push(`supply link "${l.id}": to "${l.to}" does not exist`);
    if (l.from === l.to) errors.push(`supply link "${l.id}": links a node to itself`);
  }

  const events: ResolvedEvent[] = s.events.map((e, i) => {
    const where = `events.${i}`;
    if (e.day >= s.days) errors.push(`${where}: day ${e.day} is past the scenario end (${s.days} days)`);
    switch (e.type) {
      case 'setDisrupted': {
        const ids = e.target.kind === 'node' ? nodeIds : linkIds;
        if (!ids.has(e.target.id)) errors.push(`${where}: ${e.target.kind} "${e.target.id}" does not exist`);
        return e;
      }
      case 'move':
        if (!formationIds.has(e.formation)) errors.push(`${where}: formation "${e.formation}" does not exist`);
        return { ...e, to: resolvePos(e.to, where, true) };
      default:
        if (!hasChildren.has(e.formation)) errors.push(`${where}: "${e.formation}" is not a formation with children`);
        return e;
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      scenario: { ...s, formations, supply: { nodes, links: s.supply.links }, events },
      units: catalog.units,
      nations: catalog.nations,
      map,
    },
  };
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
