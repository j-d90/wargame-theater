// Detailed battles. Opening a battle takes a cluster of formations in contact
// and expands them down to battalions (breaking divisions down from their
// compositions the first time), deployed in two lines facing the enemy.
// While it lasts, any formation that comes within contact range of it joins,
// tactical AI turns each root's orders into battalion orders, and fire is
// resolved battalion by battalion with the same Lanchester formula as
// aggregate combat. Only geometry differs: a battalion can hit only what is
// within its range. A battle closes on command or after a spell without
// contact, collapsing every root back into one block with its state kept.

import type { Position } from '@tow/content';
import { nextInt } from '../core/rng.ts';
import { rngStream, sortedIds, type BattleState, type Formation, type WorldState } from '../core/world.ts';
import { activeFormations, aggregate, alive, battleRootOf, expand, frontier } from '../command/formations.ts';
import { breakDown, canBreakDown } from '../command/composition.ts';
import { distanceKm, issueMove, terrainSpeedAt } from '../command/movement.ts';
import { ceasefireInForce } from '../strategy/strategic.ts';
import { tacticalPhase } from '../ai/tactical.ts';
import { enemyOf, exchangeFire, fallBack, surrender } from './aggregate.ts';

/**
 * Buckets formations by position so neighbour queries don't scan everything:
 * a flat grid over their bounding box, items stored cell by cell.
 */
export class SpatialGrid {
  private xs: Float64Array;
  private ys: Float64Array;
  private x0 = 0;
  private y0 = 0;
  private cols = 1;
  private rows = 1;
  private start: Int32Array;
  private cellItems: Int32Array;
  constructor(
    private cellKm: number,
    readonly items: readonly Formation[],
  ) {
    const n = items.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    items.forEach((f, i) => {
      const { x, y } = f.position;
      this.xs[i] = x;
      this.ys[i] = y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    if (n > 0) {
      this.x0 = minX;
      this.y0 = minY;
      this.cols = Math.floor((maxX - minX) / cellKm) + 1;
      this.rows = Math.floor((maxY - minY) / cellKm) + 1;
    }
    const cellOf = new Int32Array(n);
    const count = new Int32Array(this.cols * this.rows + 1);
    for (let i = 0; i < n; i++) {
      const c = Math.floor((this.xs[i]! - this.x0) / cellKm);
      const r = Math.floor((this.ys[i]! - this.y0) / cellKm);
      cellOf[i] = r * this.cols + c;
      count[cellOf[i]! + 1]!++;
    }
    for (let k = 1; k < count.length; k++) count[k]! += count[k - 1]!;
    this.start = count;
    this.cellItems = new Int32Array(n);
    const fill = count.slice(0, count.length - 1);
    for (let i = 0; i < n; i++) this.cellItems[fill[cellOf[i]!]!++] = i;
  }
  /** Indices (into `items`) of formations within `r` km of `p`, appended to `out` in a deterministic order. */
  nearIdx(p: Position, r: number, out: number[]): void {
    if (this.items.length === 0) return;
    const r2 = r * r;
    const k = this.cellKm;
    const c0 = Math.max(0, Math.floor((p.x - r - this.x0) / k));
    const c1 = Math.min(this.cols - 1, Math.floor((p.x + r - this.x0) / k));
    const r0 = Math.max(0, Math.floor((p.y - r - this.y0) / k));
    const r1 = Math.min(this.rows - 1, Math.floor((p.y + r - this.y0) / k));
    const { xs, ys, start, cellItems } = this;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * this.cols + col;
        for (let q = start[cell]!, end = start[cell + 1]!; q < end; q++) {
          const i = cellItems[q]!;
          const dx = xs[i]! - p.x;
          const dy = ys[i]! - p.y;
          if (dx * dx + dy * dy <= r2) out.push(i);
        }
      }
    }
  }
  /** Formations within `r` km of `p`, in a deterministic order. */
  near(p: Position, r: number): Formation[] {
    const idx: number[] = [];
    this.nearIdx(p, r, idx);
    return idx.map((i) => this.items[i]!);
  }
}

/** Battle id of every active formation fighting in one. */
export function battleMembers(world: WorldState): Map<string, string> {
  const out = new Map<string, string>();
  for (const bid of sortedIds(world.battles)) {
    for (const rid of world.battles[bid]!.roots) {
      if (!world.formations[rid]) continue;
      for (const f of frontier(world, rid)) if (alive(f)) out.set(f.id, bid);
    }
  }
  return out;
}

export function rangeOf(world: WorldState, f: Formation): number {
  const t = f.tacticalType === null ? undefined : world.tactical.types[f.tacticalType];
  return t ? t.rangeKm : world.rules.tacticalDefaultRangeKm;
}

export function isRear(world: WorldState, f: Formation): boolean {
  const t = f.tacticalType === null ? undefined : world.tactical.types[f.tacticalType];
  return t?.rear ?? false;
}

/** Expand a formation's subtree all the way down, breaking leaves down from their compositions. */
function deepen(world: WorldState, id: string): void {
  const f = world.formations[id]!;
  if (!alive(f)) return;
  if (f.aggregated) expand(world, id);
  else if (canBreakDown(world, f)) breakDown(world, id);
  for (const c of f.childIds) deepen(world, c);
}

/**
 * Lay a root's battalions out around its position, facing `enemies`: the
 * direct-fire battalions in a forward line, artillery in a second line behind.
 */
function deploy(world: WorldState, root: Formation, enemies: readonly Formation[]): void {
  const parts = frontier(world, root.id).filter(alive);
  if (parts.length === 1 && parts[0] === root) return;
  const c = root.position;
  let ex = 0;
  let ey = 0;
  let n = 0;
  for (const e of enemies) {
    if (e.side === root.side || distanceKm(e.position, c) > 40) continue;
    ex += e.position.x;
    ey += e.position.y;
    n++;
  }
  let dx = 0;
  let dy = -1;
  if (n > 0) {
    const vx = ex / n - c.x;
    const vy = ey / n - c.y;
    const d = Math.sqrt(vx * vx + vy * vy);
    if (d > 0.01) [dx, dy] = [vx / d, vy / d];
  }
  const place = (list: Formation[], forward: number, spacing: number, rowStep: number) => {
    const perRow = 6;
    list.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, list.length - row * perRow);
      const lateral = ((i % perRow) - (inRow - 1) / 2) * spacing;
      const along = forward + row * rowStep;
      const pos = { x: c.x + dx * along - dy * lateral, y: c.y + dy * along + dx * lateral };
      p.position = terrainSpeedAt(world, pos) > 0 ? pos : { ...c };
      p.order = null;
      p.manual = false;
    });
  };
  place(
    parts.filter((p) => !isRear(world, p)),
    2,
    2,
    -2.5,
  );
  place(
    parts.filter((p) => isRear(world, p)),
    -5,
    3,
    -2,
  );
}

function join(world: WorldState, b: BattleState, f: Formation, enemies: readonly Formation[]): void {
  b.startStrength[f.side] = (b.startStrength[f.side] ?? 0) + f.stats.strength;
  const intent = f.order;
  f.battle = b.id;
  b.roots = [...b.roots, f.id].sort();
  deepen(world, f.id);
  // The root no longer moves itself; its order stays as the intent its battalions follow.
  f.order = intent;
  deploy(world, f, enemies);
}

function battleName(world: WorldState, at: Position, n: number): string {
  let best: string | null = null;
  let bestD = 60;
  for (const id of sortedIds(world.objectives)) {
    const o = world.objectives[id]!;
    const d = distanceKm(o.position, at);
    if (d < bestD) [best, bestD] = [o.name, d];
  }
  return best ? `Battle of ${best}` : `Battle ${n}`;
}

/**
 * Open a detailed battle around `formationId` and everything in contact with
 * it, directly or through others. Returns the battle id; if the formation is
 * already fighting one, returns that.
 */
export function openBattle(world: WorldState, formationId: string): string {
  const f = world.formations[formationId];
  if (!f) throw new Error(`openBattle: unknown formation "${formationId}"`);
  const existing = battleRootOf(world, f.id);
  if (existing) return existing.battle!;
  if (ceasefireInForce(world)) throw new Error('openBattle: a cease-fire is in force');
  const all = activeFormations(world);
  if (!all.includes(f)) throw new Error(`openBattle: "${f.name}" is not an active formation`);
  const members = battleMembers(world);
  const free = all.filter((u) => !members.has(u.id));
  const range = world.rules.contactKm;
  const grid = new SpatialGrid(range, free);

  // Everything linked to f by a chain of opposing contacts.
  const cluster = new Set<string>([f.id]);
  const queue = [f];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of grid.near(u.position, range)) {
      if (v.side === u.side || cluster.has(v.id)) continue;
      cluster.add(v.id);
      queue.push(v);
    }
  }
  if (cluster.size < 2) throw new Error(`openBattle: "${f.name}" is not in contact with the enemy`);

  const n = world.nextBattle++;
  const ids = [...cluster].sort();
  const cx = ids.reduce((s, id) => s + world.formations[id]!.position.x, 0) / ids.length;
  const cy = ids.reduce((s, id) => s + world.formations[id]!.position.y, 0) / ids.length;
  const b: BattleState = {
    id: `battle-${n}`,
    name: battleName(world, { x: cx, y: cy }, n),
    roots: [],
    openedTick: world.tick,
    lastContactTick: world.tick,
    center: { x: cx, y: cy },
    radiusKm: 0,
    startStrength: {},
    fire: [],
  };
  world.battles[b.id] = b;
  const enemies = ids.map((id) => world.formations[id]!);
  for (const id of ids) join(world, b, world.formations[id]!, enemies);
  updateGeometry(world, b);
  return b.id;
}

/** Collapse every root back into one block and drop the battle. */
export function closeBattle(world: WorldState, battleId: string): void {
  const b = world.battles[battleId];
  if (!b) throw new Error(`closeBattle: unknown battle "${battleId}"`);
  for (const rid of b.roots) {
    const f = world.formations[rid];
    if (!f) continue;
    f.battle = null;
    if (f.aggregated || f.childIds.length === 0) continue;
    const prior = f.status;
    const parts = frontier(world, rid);
    // Battalions falling back carry on as one block towards where they were heading.
    let intent = f.order;
    const falling = parts.filter((p) => alive(p) && p.order?.kind === 'retreat');
    if (!intent && falling.length > 0) {
      const x = falling.reduce((sum, p) => sum + p.order!.destination.x, 0) / falling.length;
      const y = falling.reduce((sum, p) => sum + p.order!.destination.y, 0) / falling.length;
      intent = { kind: 'retreat', destination: { x, y }, path: [] };
    }
    const anyAlive = parts.some(alive);
    for (const p of parts) p.manual = false;
    aggregate(world, rid);
    if (!anyAlive) {
      if (prior === 'withdrawn') f.status = 'withdrawn';
      else f.status = parts.some((p) => p.status === 'surrendered') ? 'surrendered' : 'destroyed';
      continue;
    }
    if (intent) {
      try {
        issueMove(world, rid, intent.destination, intent.kind);
      } catch {
        // Can't carry on from where it ended up: wait for new orders.
      }
    }
  }
  delete world.battles[battleId];
}

function merge(world: WorldState, into: BattleState, from: BattleState): void {
  for (const rid of from.roots) {
    const f = world.formations[rid];
    if (f) f.battle = into.id;
  }
  into.roots = [...into.roots, ...from.roots].sort();
  for (const [side, s] of Object.entries(from.startStrength)) into.startStrength[side] = (into.startStrength[side] ?? 0) + s;
  into.openedTick = Math.min(into.openedTick, from.openedTick);
  delete world.battles[from.id];
}

/**
 * Before movement: pull formations that came within contact range into the
 * battle, merge battles that touch, and let tactical AI give its orders.
 */
export function battlePhase(world: WorldState): void {
  const ids = sortedIds(world.battles);
  if (ids.length === 0) return;
  if (ceasefireInForce(world)) {
    for (const id of ids) closeBattle(world, id);
    return;
  }
  const range = world.rules.contactKm;
  let members = battleMembers(world);
  const all = activeFormations(world);
  const fighting = all.filter((f) => members.has(f.id));
  const grid = new SpatialGrid(range, fighting);
  let changed = false;
  for (const o of all) {
    if (members.has(o.id) || !alive(o)) continue;
    let target: string | null = null;
    for (const u of grid.near(o.position, range)) {
      if (u.side === o.side) continue;
      const bid = members.get(u.id)!;
      if (target === null || bid < target) target = bid;
    }
    const b = target === null ? undefined : world.battles[target];
    if (b) {
      join(world, b, o, fighting);
      changed = true;
    }
  }

  if (sortedIds(world.battles).length > 1) {
    if (changed) members = battleMembers(world);
    const now = activeFormations(world).filter((f) => members.has(f.id));
    const g2 = new SpatialGrid(range, now);
    for (const u of now) {
      const bu = members.get(u.id)!;
      for (const v of g2.near(u.position, range)) {
        const bv = members.get(v.id)!;
        if (v.side === u.side || bv === bu) continue;
        const [keep, drop] = bu < bv ? [bu, bv] : [bv, bu];
        const a = world.battles[keep];
        const d = world.battles[drop];
        if (a && d) {
          merge(world, a, d);
          changed = true;
        }
      }
    }
  }
  if (changed) members = battleMembers(world);
  tacticalPhase(world, members);
}

/** A battalion engages at most this many enemies at once: the nearest in range. */
const MAX_TARGETS = 4;

/**
 * Battalion-level fire. Each battalion fires on the nearest enemies of its
 * battle within its range; the fire and its effects follow the aggregate
 * formula, scaled by the calibrated `tacticalFire`, with morale shared across
 * each division.
 */
export function detailedCombat(world: WorldState, units: Formation[], members: Map<string, string>): void {
  // Work in indices into `units`, which is sorted by id, so index order is id order.
  const n = units.length;
  const battleNo = new Map<string, number>();
  const battle = new Int32Array(n);
  const sideNo = new Map<string, number>();
  const side = new Int32Array(n);
  const range = new Float64Array(n);
  const rear = new Uint8Array(n);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = units[i]!;
    const bid = members.get(u.id)!;
    if (!battleNo.has(bid)) battleNo.set(bid, battleNo.size);
    battle[i] = battleNo.get(bid)!;
    if (!sideNo.has(u.side)) sideNo.set(u.side, sideNo.size);
    side[i] = sideNo.get(u.side)!;
    range[i] = rangeOf(world, u);
    rear[i] = isRear(world, u) ? 1 : 0;
    xs[i] = u.position.x;
    ys[i] = u.position.y;
  }
  const maxRange = range.reduce((m, v) => Math.max(m, v), 0);
  // One grid per side, so a search only looks at enemies.
  const bySide = [...sideNo.values()].map((s) => {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (side[i] === s) idx.push(i);
    return { idx, grid: new SpatialGrid(Math.max(2, maxRange / 4), idx.map((i) => units[i]!)) };
  });

  const targets: (number[] | null)[] = new Array<number[] | null>(n).fill(null);
  const foeIdx: number[][] = Array.from({ length: n }, () => []);
  const engaged = new Uint8Array(n);
  const buf: number[] = [];
  const pickJ = new Int32Array(MAX_TARGETS);
  const pickD = new Float64Array(MAX_TARGETS);
  for (let i = 0; i < n; i++) {
    let picked = 0;
    const xi = xs[i]!;
    const yi = ys[i]!;
    const bi = battle[i]!;
    for (let s = 0; s < bySide.length; s++) {
      if (s === side[i]) continue;
      const { idx, grid } = bySide[s]!;
      buf.length = 0;
      grid.nearIdx(units[i]!.position, range[i]!, buf);
      for (let q = 0; q < buf.length; q++) {
        const j = idx[buf[q]!]!;
        if (battle[j] !== bi) continue;
        const dx = xs[j]! - xi;
        const dy = ys[j]! - yi;
        const d = dx * dx + dy * dy;
        if (picked < MAX_TARGETS) {
          pickJ[picked] = j;
          pickD[picked] = d;
          picked++;
          continue;
        }
        let worst = 0;
        for (let k = 1; k < MAX_TARGETS; k++) {
          if (pickD[k]! > pickD[worst]! || (pickD[k] === pickD[worst] && pickJ[k]! > pickJ[worst]!)) worst = k;
        }
        if (d < pickD[worst]! || (d === pickD[worst] && j < pickJ[worst]!)) {
          pickJ[worst] = j;
          pickD[worst] = d;
        }
      }
    }
    if (picked === 0) continue;
    // Ascending index order (insertion sort; at most MAX_TARGETS entries).
    const ts: number[] = [];
    for (let k = 0; k < picked; k++) {
      const j = pickJ[k]!;
      let at = ts.length;
      while (at > 0 && ts[at - 1]! > j) at--;
      ts.splice(at, 0, j);
    }
    targets[i] = ts;
    for (const j of ts) {
      foeIdx[i]!.push(j);
      foeIdx[j]!.push(i);
      if (!rear[i]) engaged[j] = 1;
    }
  }
  for (const fs of foeIdx) {
    if (fs.length < 2) continue;
    fs.sort((a, b) => a - b);
    let w = 1;
    for (let k = 1; k < fs.length; k++) if (fs[k] !== fs[w - 1]) fs[w++] = fs[k]!;
    fs.length = w;
  }

  const battleIds = [...battleNo.keys()];
  for (const bid of sortedIds(world.battles)) world.battles[bid]!.fire = [];
  for (let i = 0; i < n; i++) {
    const ts = targets[i];
    if (!ts) continue;
    let main = ts[0]!;
    for (const j of ts) if (units[j]!.stats.strength > units[main]!.stats.strength) main = j;
    world.battles[battleIds[battle[i]!]!]?.fire.push([units[i]!.id, units[main]!.id]);
  }

  // Divisions share morale; a root that fights as itself is its own group.
  const rootNo = new Map<string, number>();
  const group = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const rid = battleRootOf(world, units[i]!.id)?.id ?? units[i]!.id;
    if (!rootNo.has(rid)) rootNo.set(rid, rootNo.size);
    group[i] = rootNo.get(rid)!;
  }
  exchangeFire(world, units, targets, rngStream(world, 'tactical'), world.rules.tacticalFire, group);
  for (let i = 0; i < n; i++) units[i]!.inContact = targets[i] !== null || engaged[i] === 1;
  battalionChecks(world, units, foeIdx);
  divisionCohesion(world, units, foeIdx, group, rootNo);
}

/**
 * A battalion on its own only gives up when there is almost nothing left of
 * it, and rallies once clear of the enemy; falling back and collapsing are
 * decided for its division.
 */
function battalionChecks(world: WorldState, units: Formation[], foeIdx: number[][]): void {
  const r = world.rules;
  for (let i = 0; i < units.length; i++) {
    const f = units[i]!;
    const s = f.stats;
    const foes = foeIdx[i]!;
    if (s.strength * 1000 <= Math.max(1, s.establishment) * r.destroyedStrength) {
      surrender(world, f, foes.length > 0 ? units[foes[0]!]!.side : enemyOf(world, f.side));
      if (f.stats.strength === 0 && foes.length === 0) f.status = 'destroyed';
    } else if (f.status === 'retreating' && foes.length === 0 && s.morale >= r.rallyMorale) {
      f.status = 'active';
    }
  }
}

/**
 * Whether a division gives way or gives up is decided for the division as a
 * whole, as in aggregate combat: on its rolled-up morale and strength.
 */
function divisionCohesion(world: WorldState, units: Formation[], foeIdx: number[][], group: Int32Array, rootNo: Map<string, number>): void {
  const r = world.rules;
  const rng = rngStream(world, 'morale');
  const members: number[][] = Array.from({ length: rootNo.size }, () => []);
  for (let i = 0; i < units.length; i++) members[group[i]!]!.push(i);
  for (const [rid, k] of [...rootNo].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const root = world.formations[rid]!;
    // A root without battalions fights as itself and is judged the same way.
    const idx = members[k]!.filter((i) => alive(units[i]!));
    if (idx.length === 0) continue;
    const parts = idx.map((i) => units[i]!);
    // Establishment counts the battalions already lost; the root still holds the total.
    let strength = 0;
    let morale = 0;
    let quality = 0;
    for (const p of parts) {
      strength += p.stats.strength;
      morale += p.stats.morale * p.stats.strength;
      quality += p.stats.quality * p.stats.strength;
    }
    morale = strength > 0 ? morale / strength : 0;
    quality = strength > 0 ? quality / strength : root.stats.quality;
    const est = Math.max(1, root.stats.establishment);
    const engaged = idx.some((i) => foeIdx[i]!.length > 0);
    const foesOf = (list: number[]) => [...new Set(list.flatMap((i) => foeIdx[i]!))].sort((a, b) => a - b).map((j) => units[j]!);
    const giveUp = () => {
      const captor = foesOf(idx)[0]?.side ?? enemyOf(world, root.side);
      for (const p of parts) surrender(world, p, captor);
    };
    if (strength * 1000 <= est * r.destroyedStrength) {
      giveUp();
      continue;
    }
    if (morale < r.collapseMorale || strength * 1000 < est * r.collapseStrength) {
      const chance = (r.surrenderPerTick * 2000) / (quality + 1000) / (engaged ? 1 : 40);
      if (nextInt(rng, 0, 999) < chance) {
        giveUp();
        continue;
      }
    }
    if (engaged && morale < r.retreatMorale) {
      const everyone = foesOf(idx);
      for (const i of idx) {
        const p = units[i]!;
        if (p.status !== 'active') continue;
        const own = foeIdx[i]!;
        if (fallBack(world, p, own.length > 0 ? own.map((j) => units[j]!) : everyone, r.tacticalFallBackKm)) p.status = 'retreating';
      }
    }
  }
}

function updateGeometry(world: WorldState, b: BattleState): void {
  const units = b.roots.flatMap((rid) => (world.formations[rid] ? frontier(world, rid).filter(alive) : []));
  if (units.length === 0) return;
  const cx = units.reduce((s, f) => s + f.position.x, 0) / units.length;
  const cy = units.reduce((s, f) => s + f.position.y, 0) / units.length;
  b.center = { x: cx, y: cy };
  b.radiusKm = Math.max(10, ...units.map((f) => distanceKm(f.position, b.center) + 5));
}

/**
 * End of tick: keep each root's position and status in step with its
 * battalions, and close battles that have gone quiet or been decided.
 */
export function battleUpkeep(world: WorldState): void {
  const ids = sortedIds(world.battles);
  if (ids.length === 0) return;
  const range = world.rules.contactKm;
  for (const id of ids) {
    const b = world.battles[id]!;
    const units: Formation[] = [];
    for (const rid of b.roots) {
      const root = world.formations[rid];
      if (!root) continue;
      const parts = frontier(world, rid).filter(alive);
      units.push(...parts);
      if (parts.length === 0 || (parts.length === 1 && parts[0] === root)) continue;
      let wx = 0;
      let wy = 0;
      let w = 0;
      for (const p of parts) {
        const pw = Math.max(1, p.stats.strength);
        wx += p.position.x * pw;
        wy += p.position.y * pw;
        w += pw;
      }
      root.position = { x: wx / w, y: wy / w };
      root.inContact = parts.some((p) => p.inContact);
      root.status = parts.some((p) => p.status === 'active') ? 'active' : 'retreating';
    }
    updateGeometry(world, b);
    const sides = new Set(units.map((u) => u.side));
    const grid = new SpatialGrid(range, units);
    const contact = units.some((u) => grid.near(u.position, range).some((v) => v.side !== u.side));
    if (contact) b.lastContactTick = world.tick;
    if (sides.size < 2 || world.tick - b.lastContactTick >= world.rules.battleIdleTicks) closeBattle(world, id);
  }
}
