// The formation tree and level of detail. A formation is either aggregated
// (simulated as one block) or expanded (its children simulated). The "active"
// formations are the ones the sim actually updates each tick: aggregated nodes
// and leaves that have no aggregated ancestor. Hidden descendants keep their
// state, frozen, until their ancestor expands again.

import { distribute } from '../core/distribute.ts';
import {
  EXTENSIVE_STATS,
  INTENSIVE_STATS,
  sortedIds,
  type Formation,
  type FormationStats,
  type WorldState,
} from '../core/world.ts';

function get(world: WorldState, id: string): Formation {
  const f = world.formations[id];
  if (!f) throw new Error(`Unknown formation "${id}"`);
  return f;
}

export function depthOf(world: WorldState, id: string): number {
  let depth = 0;
  for (let f = get(world, id); f.parentId !== null; f = get(world, f.parentId)) depth++;
  return depth;
}

export function hasAggregatedAncestor(world: WorldState, id: string): boolean {
  for (let f = get(world, id); f.parentId !== null; ) {
    f = get(world, f.parentId);
    if (f.aggregated) return true;
  }
  return false;
}

/** Still in the fight: not surrendered, destroyed, or withdrawn by its government. */
export function alive(f: Formation): boolean {
  return f.status === 'active' || f.status === 'retreating';
}

export function isActive(world: WorldState, id: string): boolean {
  const f = get(world, id);
  return (f.aggregated || f.childIds.length === 0) && alive(f) && !hasAggregatedAncestor(world, id);
}

/** All active (simulated and alive) formations, sorted by id. */
export function activeFormations(world: WorldState): Formation[] {
  return sortedIds(world.formations)
    .filter((id) => isActive(world, id))
    .map((id) => world.formations[id]!);
}

/**
 * The formations that stand for `id`'s subtree: itself if aggregated or a leaf,
 * otherwise the frontier of its children. Sorted by id.
 */
export function frontier(world: WorldState, id: string): Formation[] {
  const f = get(world, id);
  if (f.aggregated || f.childIds.length === 0) return [f];
  return childFrontier(world, f);
}

function childFrontier(world: WorldState, f: Formation): Formation[] {
  return f.childIds.flatMap((c) => frontier(world, c)).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Supply node a formation draws from: its own, else the nearest ancestor's. */
export function effectiveSupplyNode(world: WorldState, id: string): string | null {
  for (let f: Formation | undefined = get(world, id); f; f = f.parentId === null ? undefined : get(world, f.parentId)) {
    if (f.supplyNode !== null) return f.supplyNode;
  }
  return null;
}

/** Combine stats: sum extensive ones, strength-weighted average (rounded) for intensive ones. */
export function combineStats(parts: readonly FormationStats[]): FormationStats {
  const out: FormationStats = {
    strength: 0,
    establishment: 0,
    quality: 1000,
    readiness: 0,
    morale: 0,
    stock: 0,
    stockCap: 0,
    supplyPerTick: 0,
    speed: 0,
  };
  for (const key of EXTENSIVE_STATS) {
    for (const p of parts) out[key] += p[key];
  }
  const totalStrength = out.strength;
  for (const key of INTENSIVE_STATS) {
    if (parts.length === 0) continue;
    if (totalStrength > 0) {
      let sum = 0;
      for (const p of parts) sum += p[key] * p.strength;
      out[key] = Math.floor((sum + Math.floor(totalStrength / 2)) / totalStrength);
    } else {
      let sum = 0;
      for (const p of parts) sum += p[key];
      out[key] = Math.floor((sum + Math.floor(parts.length / 2)) / parts.length);
    }
  }
  if (parts.length > 0) {
    out.speed = Math.min(...parts.map((p) => p.speed));
    out.quality = weightedMean(parts.map((p) => [p.quality, p.strength]));
  }
  return out;
}

/** Strength-weighted mean of [value, weight] pairs, rounded; plain mean if all weights are 0. */
function weightedMean(pairs: [number, number][]): number {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  if (total === 0) return Math.round(pairs.reduce((a, [v]) => a + v, 0) / pairs.length);
  return Math.round(pairs.reduce((a, [v, w]) => a + v * w, 0) / total);
}

/** Current stats of any formation, computed from whatever represents its subtree. */
export function rollup(world: WorldState, id: string): FormationStats {
  return combineStats(frontier(world, id).map((f) => f.stats));
}

/**
 * Move a child's permille value the way the aggregate moved from `base` to `now`:
 * scaled toward 0 on a drop, toward 1000 (by remaining headroom) on a rise. This
 * never clamps, keeps children in the same order, and preserves the weighted average.
 */
function shiftPermille(value: number, base: number, now: number): number {
  if (now === base) return value;
  if (now < base) return Math.round((value * now) / base);
  return 1000 - Math.round(((1000 - value) * (1000 - now)) / (1000 - base));
}

/**
 * Collapse a formation's subtree into a single aggregate block, placed at the
 * strength-weighted centre of its parts. The parts' move orders are dropped:
 * the block now takes orders as one unit.
 */
export function aggregate(world: WorldState, id: string): void {
  const f = get(world, id);
  if (f.childIds.length === 0) throw new Error(`aggregate: "${id}" has no children`);
  if (f.aggregated) throw new Error(`aggregate: "${id}" is already aggregated`);
  if (hasAggregatedAncestor(world, id)) throw new Error(`aggregate: "${id}" is hidden inside an aggregated ancestor`);
  const parts = childFrontier(world, f);
  const stats = combineStats(parts.map((c) => c.stats));
  let wx = 0;
  let wy = 0;
  let w = 0;
  for (const p of parts) {
    const pw = Math.max(1, p.stats.strength);
    wx += p.position.x * pw;
    wy += p.position.y * pw;
    w += pw;
    p.order = null;
  }
  f.position = { x: wx / w, y: wy / w };
  f.branch = parts.every((p) => p.branch === parts[0]!.branch) ? parts[0]!.branch : null;
  f.fortification = weightedMean(parts.map((p) => [p.fortification, p.stats.strength]));
  f.inContact = parts.some((p) => p.inContact);
  f.status = parts.some((p) => p.status === 'active') ? 'active' : 'retreating';
  for (const p of parts) p.lossCarry = 0;
  f.baselinePosition = { ...f.position };
  f.stats = stats;
  f.baseline = { ...stats };
  f.aggregated = true;
  f.order = null;
}

/**
 * Expand an aggregated formation. Whatever happened to the aggregate since it was
 * collapsed is pushed down onto the formations that now become active:
 * extensive stats are rescaled proportionally (largest remainder), intensive
 * stats via shiftPermille, and positions shift by however far the block moved.
 * With no change in between, this restores the exact pre-aggregation state.
 * Handing the block's move order down to its parts is the caller's job.
 */
export function expand(world: WorldState, id: string): void {
  const f = get(world, id);
  if (!f.aggregated || f.baseline === null || f.baselinePosition === null) throw new Error(`expand: "${id}" is not aggregated`);
  if (!alive(f)) throw new Error(`expand: "${id}" is no longer in the fight`);
  if (hasAggregatedAncestor(world, id)) throw new Error(`expand: "${id}" is hidden inside an aggregated ancestor`);
  const parts = childFrontier(world, f);
  const now = f.stats;
  const base = f.baseline;

  const split = (key: (typeof EXTENSIVE_STATS)[number], caps?: number[]) =>
    distribute(now[key], parts.map((p) => p.stats[key]), caps);
  const strength = split('strength');
  const establishment = split('establishment');
  const stockCap = split('stockCap');
  const supplyPerTick = split('supplyPerTick');
  const stock = split('stock', stockCap);

  const dx = f.position.x - f.baselinePosition.x;
  const dy = f.position.y - f.baselinePosition.y;
  parts.forEach((p, i) => {
    p.position = { x: p.position.x + dx, y: p.position.y + dy };
    const s = p.stats;
    s.strength = strength[i]!;
    s.establishment = establishment[i]!;
    p.fortification = f.fortification;
    if (alive(p)) p.status = f.status;
    s.stockCap = stockCap[i]!;
    s.supplyPerTick = supplyPerTick[i]!;
    s.stock = stock[i]!;
    for (const key of INTENSIVE_STATS) s[key] = shiftPermille(s[key], base[key], now[key]);
  });

  f.aggregated = false;
  f.baseline = null;
  f.baselinePosition = null;
  f.order = null;
}
