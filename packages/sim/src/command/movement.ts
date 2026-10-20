// Movement on the terrain grid. Move orders are planned once with A* over the
// map's terrain cells (8-way, no corner cutting past impassable cells) and then
// followed a little each tick. Speed = march speed x mobility x terrain factor,
// so a formation that is short of supply slows down and eventually stops.

import type { Position } from '@tow/content';
import { TICKS_PER_DAY } from '../core/time.ts';
import type { Formation, OrderKind, TerrainGrid, WorldState } from '../core/world.ts';
import { activeFormations, battleRootOf, isActive } from './formations.ts';
import { mobility } from './derived.ts';
import { movementRefusal } from '../strategy/strategic.ts';

const ORTHO = 10;
const DIAG = 14;

export function distanceKm(a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function cellOf(t: TerrainGrid, p: Position): { c: number; r: number } {
  return { c: Math.floor(p.x / t.cellKm), r: Math.floor(p.y / t.cellKm) };
}

/** Terrain class code at a position, or undefined off the map or without one. */
export function terrainCodeAt(world: WorldState, p: Position): string | undefined {
  const t = world.terrain;
  if (!t) return undefined;
  const { c, r } = cellOf(t, p);
  if (c < 0 || r < 0 || c >= t.cols || r >= t.rows) return undefined;
  return t.cells[r * t.cols + c];
}

/** Terrain speed factor at a position, permille. Off-map counts as impassable. */
export function terrainSpeedAt(world: WorldState, p: Position): number {
  const t = world.terrain;
  if (!t) return 1000;
  const code = terrainCodeAt(world, p);
  return code === undefined ? 0 : (t.speeds[code] ?? 0);
}

/** Binary min-heap keyed by (f, cell index), so ties always break the same way. */
class Heap {
  private f: number[] = [];
  private v: number[] = [];
  get size() {
    return this.v.length;
  }
  private less(i: number, j: number) {
    return this.f[i]! < this.f[j]! || (this.f[i] === this.f[j] && this.v[i]! < this.v[j]!);
  }
  private swap(i: number, j: number) {
    [this.f[i], this.f[j]] = [this.f[j]!, this.f[i]!];
    [this.v[i], this.v[j]] = [this.v[j]!, this.v[i]!];
  }
  push(f: number, v: number) {
    this.f.push(f);
    this.v.push(v);
    for (let i = this.v.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.v[0]!;
    const lastF = this.f.pop()!;
    const lastV = this.v.pop()!;
    if (this.v.length > 0) {
      this.f[0] = lastF;
      this.v[0] = lastV;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.v.length && this.less(l, m)) m = l;
        if (r < this.v.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** Cells near these points cost `factor` times more to cross. */
export interface Avoid {
  points: Position[];
  radiusKm: number;
  factor: number;
}

/**
 * Waypoints from `from` to `to`, ending exactly at `to`, or null when `to` is
 * off the map, impassable, or unreachable. Without terrain the path is a straight line.
 */
export function planPath(world: WorldState, from: Position, to: Position, avoid?: Avoid): Position[] | null {
  const t = world.terrain;
  if (!t) return [{ ...to }];
  if (terrainSpeedAt(world, to) === 0) return null;
  const { cols, rows } = t;
  const clampCell = ({ c, r }: { c: number; r: number }) => Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c));
  const start = clampCell(cellOf(t, from));
  const goal = clampCell(cellOf(t, to));
  if (start === goal) return [{ ...to }];

  const speed = (i: number) => t.speeds[t.cells[i]!] ?? 0;
  const penalty = new Float64Array(cols * rows).fill(1);
  if (avoid) {
    const reach = Math.ceil(avoid.radiusKm / t.cellKm);
    for (const p of avoid.points) {
      const pc = Math.floor(p.x / t.cellKm);
      const pr = Math.floor(p.y / t.cellKm);
      for (let r = Math.max(0, pr - reach); r <= Math.min(rows - 1, pr + reach); r++) {
        for (let c = Math.max(0, pc - reach); c <= Math.min(cols - 1, pc + reach); c++) {
          const dx = (c + 0.5) * t.cellKm - p.x;
          const dy = (r + 0.5) * t.cellKm - p.y;
          if (dx * dx + dy * dy <= avoid.radiusKm * avoid.radiusKm) penalty[r * cols + c] = avoid.factor;
        }
      }
    }
  }
  const gc = goal % cols;
  const gr = Math.floor(goal / cols);
  const h = (i: number) => {
    const dx = Math.abs((i % cols) - gc);
    const dy = Math.abs(Math.floor(i / cols) - gr);
    return ORTHO * (dx + dy) + (DIAG - 2 * ORTHO) * Math.min(dx, dy);
  };
  const g = new Int32Array(cols * rows).fill(0x7fffffff);
  const came = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const open = new Heap();
  g[start] = 0;
  open.push(h(start), start);

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    const cc = cur % cols;
    const cr = Math.floor(cur / cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        const sp = speed(n);
        if (sp === 0 || closed[n]) continue;
        const diagonal = dr !== 0 && dc !== 0;
        if (diagonal && (speed(cr * cols + nc) === 0 || speed(nr * cols + cc) === 0)) continue;
        const cost = g[cur]! + Math.round(((diagonal ? DIAG : ORTHO) * 1000 * penalty[n]!) / sp);
        if (cost < g[n]!) {
          g[n] = cost;
          came[n] = cur;
          open.push(cost + h(n), n);
        }
      }
    }
  }
  if (came[goal] === -1) return null;

  const cells: number[] = [];
  for (let i = goal; i !== start; i = came[i]!) cells.push(i);
  cells.reverse();
  // Keep only the cells where the direction changes, then finish at the exact destination.
  const path: Position[] = [];
  let prev = start;
  for (let k = 0; k < cells.length - 1; k++) {
    const a = cells[k]!;
    const b = cells[k + 1]!;
    if (a - prev !== b - a) path.push({ x: ((a % cols) + 0.5) * t.cellKm, y: (Math.floor(a / cols) + 0.5) * t.cellKm });
    prev = a;
  }
  path.push({ ...to });
  return path;
}

/**
 * Give an active formation a move order. Throws if it can't go there. A
 * formation fighting a detailed battle takes it as intent for its battalions.
 */
export function issueMove(world: WorldState, id: string, to: Position, kind: OrderKind = 'move', avoidEnemies = true): void {
  const f = world.formations[id];
  if (!f) throw new Error(`move: unknown formation "${id}"`);
  if (!isActive(world, id) && f.battle === null) throw new Error(`move: "${f.name}" is not an active formation (it is expanded or hidden)`);
  const refusal = movementRefusal(world, f, to);
  if (refusal) throw new Error(`move: ${refusal}`);
  // Except when attacking, steer clear of known enemy formations.
  const enemies = kind === 'attack' || !avoidEnemies ? [] : activeFormations(world).filter((e) => e.side !== f.side);
  const avoid = enemies.length > 0 ? { points: enemies.map((e) => e.position), radiusKm: 30, factor: 8 } : undefined;
  const path = planPath(world, f.position, to, avoid);
  if (!path) throw new Error(`move: "${f.name}" can't reach that point (water, off the map, or cut off)`);
  f.order = { kind, destination: { ...to }, path };
}

/** km a formation covers this tick at its current position, readiness, and terrain. */
export function kmPerTick(world: WorldState, f: Formation): number {
  // A formation left on impassable ground (e.g. after an expand) can still walk off it.
  const terrain = terrainSpeedAt(world, f.position) || 500;
  const pace = f.order?.kind === 'attack' ? world.rules.attackPace : 1000;
  return (f.stats.speed * mobility(f.stats, world.rules) * terrain * pace) / (1_000_000_000 * TICKS_PER_DAY);
}

export function movementPhase(world: WorldState): void {
  for (const f of activeFormations(world)) {
    const order = f.order;
    if (!order) continue;
    // Contact pins a formation in place until one side gives way; only a retreat breaks off.
    // In a detailed battle, tactical AI decides how close its battalions go.
    if (f.inContact && order.kind !== 'retreat' && (f.manual || battleRootOf(world, f.id) === null)) continue;
    let budget = kmPerTick(world, f);
    while (budget > 0 && order.path.length > 0) {
      const wp = order.path[0]!;
      const d = distanceKm(f.position, wp);
      if (d <= budget) {
        f.position = { x: wp.x, y: wp.y };
        budget -= d;
        order.path.shift();
      } else {
        const k = budget / d;
        // Plain IEEE arithmetic is deterministic; rounding here would only add drift.
        f.position = { x: f.position.x + (wp.x - f.position.x) * k, y: f.position.y + (wp.y - f.position.y) * k };
        budget = 0;
      }
    }
    if (order.path.length === 0) f.order = null;
  }
}
