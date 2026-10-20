import { defaultCatalog, scenarioFiles, type Catalog, type TacticalCatalog } from './catalog.ts';
import { latLonToXY } from './projection.ts';
import {
  ScenarioSchema,
  type AiSpec,
  type FormationSpec,
  type ObjectiveSpec,
  type OffensivePlan,
  type SideSpec,
  type StrategySpec,
  type MissileTargetSpec,
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
export type ResolvedObjective = Omit<ObjectiveSpec, 'position'> & { position: Position };
export type ResolvedPlan = Omit<OffensivePlan, 'assembly'> & { assembly: Position };
export interface ResolvedAi extends Omit<AiSpec, 'offensive' | 'defensive'> {
  offensive?: Omit<NonNullable<AiSpec['offensive']>, 'plans'> & { plans: ResolvedPlan[] };
  defensive?: Omit<NonNullable<AiSpec['defensive']>, 'withdrawTo'> & { withdrawTo: Position };
}
export type ResolvedSide = Omit<SideSpec, 'ai'> & { ai?: ResolvedAi };
type MissilesSpec = NonNullable<StrategySpec['missiles']>;
export interface ResolvedStrategy extends Omit<StrategySpec, 'missiles' | 'mandate' | 'oilFields'> {
  missiles?: Omit<MissilesSpec, 'launchArea' | 'targets'> & {
    launchArea: Position;
    targets: (Omit<MissileTargetSpec, 'position'> & { position: Position })[];
  };
  mandate?: Omit<NonNullable<StrategySpec['mandate']>, 'allowedSouthOfLat'> & { allowedSouthOfY?: number };
  oilFields: { name: string; position: Position }[];
}
export interface ResolvedScenarioData extends Omit<Scenario, 'formations' | 'supply' | 'events' | 'sides' | 'objectives' | 'strategy'> {
  strategy?: ResolvedStrategy;
  formations: ResolvedFormationSpec[];
  supply: { nodes: ResolvedSupplyNodeSpec[]; links: SupplyLinkSpec[] };
  events: ResolvedEvent[];
  /** Always at least one; scenarios without sides get a single side holding every nation. */
  sides: ResolvedSide[];
  objectives: ResolvedObjective[];
}

export interface ResolvedScenario {
  scenario: ResolvedScenarioData;
  units: ReadonlyMap<string, UnitTemplate>;
  nations: ReadonlyMap<string, Nation>;
  map: GameMap | null;
  tactical: TacticalCatalog;
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
  const resolvePos = (p: PositionInput, where: string, mustBePassable: boolean, allowOffMap = false): Position => {
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
      if (code === undefined && !allowOffMap) errors.push(`${where}: position is off the map`);
      else if (code !== undefined && mustBePassable && impassable.has(code)) errors.push(`${where}: position is on impassable terrain`);
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
    if (n.speedKmPerDay !== undefined && !n.mobile) errors.push(`${where}: only mobile nodes have a speed`);
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

  // Sides: every scenario nation on exactly one side.
  const sideSpecs: SideSpec[] = s.sides ?? [{ id: 'default', name: 'Default', nations: [...s.nations] }];
  const sideIds = dupes('side', sideSpecs.map((x) => x.id));
  const nationSide = new Map<string, string>();
  for (const side of sideSpecs) {
    for (const n of side.nations) {
      if (!s.nations.includes(n)) errors.push(`side "${side.id}": nation "${n}" is not listed in scenario nations`);
      if (nationSide.has(n)) errors.push(`nation "${n}" is on more than one side`);
      nationSide.set(n, side.id);
    }
  }
  for (const n of s.nations) if (!nationSide.has(n)) errors.push(`nation "${n}" is not on any side`);

  for (const n of s.supply.nodes) {
    if (n.side !== undefined && !sideIds.has(n.side)) errors.push(`supply node "${n.id}": side "${n.side}" is not a side`);
    if (n.side === undefined && sideSpecs.length > 1) errors.push(`supply node "${n.id}": needs a side`);
  }

  const objectiveIds = dupes('objective', s.objectives.map((o) => o.id));
  const objectives: ResolvedObjective[] = s.objectives.map((o) => {
    if (o.holder !== undefined && !sideIds.has(o.holder)) errors.push(`objective "${o.id}": holder "${o.holder}" is not a side`);
    return { ...o, position: resolvePos(o.position, `objective "${o.id}"`, true) };
  });

  const sides: ResolvedSide[] = sideSpecs.map((side) => {
    const { ai, ...rest } = side;
    if (!ai) return rest;
    const where = `side "${side.id}" ai`;
    const resolved: ResolvedAi = { posture: ai.posture, competence: ai.competence, ...(ai.strategy ? { strategy: ai.strategy } : {}) };
    if (ai.posture === 'offensive' && !ai.offensive) errors.push(`${where}: offensive posture needs an offensive plan`);
    if (ai.posture === 'defensive' && !ai.defensive) errors.push(`${where}: defensive posture needs defensive settings`);
    if (ai.offensive) {
      const o = ai.offensive;
      if (o.latestDay < o.earliestDay) errors.push(`${where}: latestDay is before earliestDay`);
      resolved.offensive = {
        ...o,
        plans: o.plans.map((p, i) => {
          const pw = `${where}.plans.${i}`;
          if (!hasChildren.has(p.corps)) errors.push(`${pw}: "${p.corps}" is not a formation with children`);
          for (const obj of p.objectives) if (!objectiveIds.has(obj)) errors.push(`${pw}: objective "${obj}" does not exist`);
          if (p.depot !== undefined && !s.supply.nodes.some((n) => n.id === p.depot && n.mobile)) {
            errors.push(`${pw}: depot "${p.depot}" is not a mobile supply node`);
          }
          return { ...p, assembly: resolvePos(p.assembly, `${pw}.assembly`, true) };
        }),
      };
    }
    if (ai.defensive) {
      const d = ai.defensive;
      for (const r of d.reserves) if (!hasChildren.has(r)) errors.push(`${where}: reserve "${r}" is not a formation with children`);
      for (const obj of d.withdrawWhenLost) if (!objectiveIds.has(obj)) errors.push(`${where}: objective "${obj}" does not exist`);
      resolved.defensive = { ...d, withdrawTo: resolvePos(d.withdrawTo, `${where}.withdrawTo`, true) };
    }
    return { ...rest, ai: resolved };
  });

  const strategy = s.strategy ? resolveStrategy(s.strategy) : undefined;
  function resolveStrategy(st: StrategySpec): ResolvedStrategy {
    const where = 'strategy';
    const actorIds = dupes('actor', st.actors.map((a) => a.id));
    const checkEffects = (e: { support: object; cohesion: object; patience: object; stability: object } | undefined, at: string) => {
      if (!e) return;
      for (const gauge of ['support', 'cohesion', 'patience', 'stability'] as const) {
        for (const a of Object.keys(e[gauge])) if (!actorIds.has(a)) errors.push(`${at}: ${gauge} effect on unknown actor "${a}"`);
      }
    };
    for (const id of Object.keys(st.capital)) if (!sideIds.has(id)) errors.push(`${where}.capital: "${id}" is not a side`);
    for (const a of st.actors) {
      const at = `${where} actor "${a.id}"`;
      if (a.side !== undefined && !sideIds.has(a.side)) errors.push(`${at}: side "${a.side}" is not a side`);
      for (const n of a.nations) if (!s.nations.includes(n)) errors.push(`${at}: nation "${n}" is not in the scenario`);
      if (a.interveneAgainst !== undefined && !sideIds.has(a.interveneAgainst)) errors.push(`${at}: interveneAgainst "${a.interveneAgainst}" is not a side`);
      if (a.interveneAgainst !== undefined && a.patience === undefined) errors.push(`${at}: an actor that can intervene needs patience`);
      checkEffects(a.onIntervene, at);
      checkEffects(a.onWithdraw, at);
      if (a.hostsAirPermille > 0 && !a.side) errors.push(`${at}: only an actor on a side can host its air power`);
      for (const n of a.restrictsSources) {
        if (!s.supply.nodes.some((x) => x.id === n && x.kind === 'source')) errors.push(`${at}: "${n}" is not a supply source`);
      }
    }
    const missileTargets = new Set(st.missiles?.targets.map((t) => t.id));
    dupes('strategic action', st.actions.map((a) => a.id));
    for (const a of st.actions) {
      const at = `${where} action "${a.id}"`;
      if (!sideIds.has(a.side)) errors.push(`${at}: side "${a.side}" is not a side`);
      if (a.kind === 'pressure' && (a.target === undefined || !actorIds.has(a.target))) errors.push(`${at}: pressure needs an actor target`);
      if (a.kind === 'deploy-patriots' && (a.target === undefined || !missileTargets.has(a.target))) errors.push(`${at}: deploy-patriots needs a missile target`);
      if (a.lockedInRealistic && !a.lockReason) errors.push(`${at}: locked actions need a lockReason`);
      for (const o of a.requires.objectivesHeld) if (!objectiveIds.has(o)) errors.push(`${at}: objective "${o}" does not exist`);
      checkEffects(a.effects, at);
    }
    let missiles: ResolvedStrategy['missiles'];
    if (st.missiles) {
      const m = st.missiles;
      if (!sideIds.has(m.side)) errors.push(`${where}.missiles: side "${m.side}" is not a side`);
      if (!sideIds.has(m.patriots.side)) errors.push(`${where}.missiles.patriots: side "${m.patriots.side}" is not a side`);
      for (const t of Object.keys(m.patriots.at)) if (!missileTargets.has(t)) errors.push(`${where}.missiles.patriots: "${t}" is not a missile target`);
      if (Object.values(m.patriots.at).reduce((a, b) => a + b, 0) > m.patriots.batteries) errors.push(`${where}.missiles.patriots: more batteries deployed than exist`);
      for (const t of m.targets) checkEffects(t.onHit, `missile target "${t.id}"`);
      missiles = {
        ...m,
        launchArea: resolvePos(m.launchArea, `${where}.missiles.launchArea`, false),
        targets: m.targets.map((t) => ({ ...t, position: resolvePos(t.position, `missile target "${t.id}"`, false, true) })),
      };
    }
    let mandate: ResolvedStrategy['mandate'];
    if (st.mandate) {
      const { allowedSouthOfLat, ...rest } = st.mandate;
      if (!sideIds.has(rest.side)) errors.push(`${where}.mandate: side "${rest.side}" is not a side`);
      for (const a of Object.keys(rest.cohesionPerFormationDay)) if (!actorIds.has(a)) errors.push(`${where}.mandate: unknown actor "${a}"`);
      mandate = { ...rest };
      if (allowedSouthOfLat !== undefined) {
        if (!map) errors.push(`${where}.mandate: allowedSouthOfLat needs a map`);
        else mandate.allowedSouthOfY = latLonToXY(map.frame, allowedSouthOfLat, map.frame.west).y;
      }
    }
    if (st.ceasefire) {
      if (!sideIds.has(st.ceasefire.side)) errors.push(`${where}.ceasefire: side "${st.ceasefire.side}" is not a side`);
      for (const o of st.ceasefire.requires) if (!objectiveIds.has(o)) errors.push(`${where}.ceasefire: objective "${o}" does not exist`);
    }
    const regionNames = new Set(Object.values(map?.regions?.names ?? {}));
    const regionRefs = [...st.actors.flatMap((a) => a.refusesRegions), ...(st.mandate?.forbiddenRegions ?? [])];
    for (const r of regionRefs) if (!regionNames.has(r)) errors.push(`${where}: region "${r}" is not on the map`);
    for (const side of sideSpecs) {
      const sa = side.ai?.strategy;
      if (!sa) continue;
      for (const p of sa.pursuit) {
        if (!hasChildren.has(p.corps)) errors.push(`side "${side.id}" strategy.pursuit: "${p.corps}" is not a formation with children`);
        for (const o of p.objectives) if (!objectiveIds.has(o)) errors.push(`side "${side.id}" strategy.pursuit: objective "${o}" does not exist`);
      }
      for (const t of Object.keys(sa.scudTargets)) if (!missileTargets.has(t)) errors.push(`side "${side.id}" strategy.scudTargets: "${t}" is not a missile target`);
      for (const u of sa.useActions) if (!st.actions.some((a) => a.id === u.action)) errors.push(`side "${side.id}" strategy.useActions: action "${u.action}" does not exist`);
    }
    return {
      ...st,
      ...(missiles ? { missiles } : {}),
      ...(mandate ? { mandate } : {}),
      oilFields: st.oilFields.map((o) => ({ name: o.name, position: resolvePos(o.position, `oil field "${o.name}"`, false) })),
    } as ResolvedStrategy;
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      scenario: { ...withoutStrategy(s), formations, supply: { nodes, links: s.supply.links }, events, sides, objectives, ...(strategy ? { strategy } : {}) },
      units: catalog.units,
      nations: catalog.nations,
      map,
      tactical: catalog.tactical,
    },
  };
}

function withoutStrategy(s: Scenario): Omit<Scenario, 'strategy'> {
  const { strategy: _unresolved, ...rest } = s;
  return rest;
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
