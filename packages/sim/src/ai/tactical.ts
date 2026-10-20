// Tactical AI. Inside a detailed battle, each root formation's order is an
// intent ("attack towards X", "move to Y", "retreat to Z", or none: hold),
// and this turns it into battalion orders with simple utility scoring:
//
// - Attack: direct-fire battalions close on the enemy that is nearest and
//   weakest relative to themselves, stopping once something is in range;
//   with no enemy near, they advance on the objective keeping their place in
//   the formation. Artillery moves up only far enough to reach the enemy.
// - Move: carry on to the destination, stopping to fight when engaged.
// - Retreat: everyone heads back, keeping formation.
// - Hold: stay put and fire at whatever comes within range.
//
// The player's battalions follow the same intent unless given a direct order
// (`manual`). Battalions of an AI-controlled side always follow it.

import type { Position } from '@tow/content';
import { sortedIds, type Formation, type OrderKind, type WorldState } from '../core/world.ts';
import { alive, formationIds, frontier } from '../command/formations.ts';
import { distanceKm, issueMove } from '../command/movement.ts';
import { SpatialGrid, isRear, rangeOf } from '../combat/battle.ts';

/** How far an attacking battalion looks for a target, km. */
const ENGAGE_KM = 15;
/** Each battalion reconsiders its orders every this many ticks, staggered, to spread the work. */
const DECIDE_EVERY = 4;

/** Order unless the battalion already has much the same order. */
function order(world: WorldState, f: Formation, to: Position, kind: OrderKind): void {
  const o = f.order;
  if (o && o.kind === kind && distanceKm(o.destination, to) < 1.5) return;
  try {
    issueMove(world, f.id, to, kind, false);
  } catch {
    // Unreachable (water, mandate): stay put.
  }
}

function hold(f: Formation): void {
  if (f.order && f.order.kind !== 'retreat') f.order = null;
}

export function tacticalPhase(world: WorldState, members: Map<string, string>): void {
  const units = formationIds(world)
    .filter((id) => members.has(id))
    .map((id) => world.formations[id]!);
  const index = new Map(units.map((u, i) => [u.id, i]));
  const battle = units.map((u) => members.get(u.id));
  const grid = new SpatialGrid(ENGAGE_KM, units);
  const near: number[] = [];

  for (const bid of sortedIds(world.battles)) {
    const b = world.battles[bid]!;
    for (const rid of b.roots) {
      const root = world.formations[rid];
      if (!root) continue;
      const parts = frontier(world, rid).filter(alive);
      // A root with no battalions fights as itself, under its own orders.
      if (parts.length === 0 || (parts.length === 1 && parts[0] === root)) continue;
      // A side without an AI is the player's.
      const aiSide = world.sides[root.side]?.ai?.controlled ?? false;
      const intent = root.order;
      const cx = parts.reduce((s, p) => s + p.position.x, 0) / parts.length;
      const cy = parts.reduce((s, p) => s + p.position.y, 0) / parts.length;
      const keepPlace = (p: Formation, dest: Position) => ({ x: dest.x + p.position.x - cx, y: dest.y + p.position.y - cy });

      for (const p of parts) {
        if (p.manual && !aiSide) continue;
        if (p.status === 'retreating') continue;
        const pi = index.get(p.id) ?? 0;
        // An order to retreat is acted on at once; otherwise battalions take turns.
        const fresh = intent?.kind === 'retreat' && p.order?.kind !== 'retreat';
        if (!fresh && (pi + world.tick) % DECIDE_EVERY !== 0) continue;
        if (!intent) {
          hold(p);
          continue;
        }
        if (intent.kind === 'retreat') {
          order(world, p, keepPlace(p, intent.destination), 'retreat');
          continue;
        }
        if (intent.kind === 'move') {
          // Pressing on to the destination; contact stops it where it stands.
          order(world, p, keepPlace(p, intent.destination), 'move');
          continue;
        }
        const range = rangeOf(world, p);
        let target: Formation | null = null;
        let nearest = Infinity;
        let nearestAny = Infinity;
        let bestScore = Infinity;
        near.length = 0;
        grid.nearIdx(p.position, ENGAGE_KM, near);
        for (const j of near) {
          const e = units[j]!;
          if (e.side === p.side || battle[j] !== battle[pi]) continue;
          const d = distanceKm(p.position, e.position);
          nearestAny = Math.min(nearestAny, d);
          // Units falling back are leaving the fight; they aren't worth chasing.
          if (e.status === 'retreating') continue;
          nearest = Math.min(nearest, d);
          // Nearer is better, and so is weaker relative to us.
          const score = d * (0.6 + (0.4 * Math.max(1, e.stats.strength)) / Math.max(1, p.stats.strength));
          if (score < bestScore || (score === bestScore && target !== null && e.id < target.id)) [target, bestScore] = [e, score];
        }
        if (!target) {
          // Only a beaten enemy left nearby: let it go rather than run into it, as contact would in aggregate.
          if (nearestAny <= range) hold(p);
          else order(world, p, keepPlace(p, intent.destination), 'attack');
        } else if (isRear(world, p)) {
          // Move up just far enough to reach the enemy.
          if (nearest > 0.8 * range) {
            const d = distanceKm(p.position, target.position);
            const k = (d - 0.6 * range) / d;
            order(world, p, { x: p.position.x + (target.position.x - p.position.x) * k, y: p.position.y + (target.position.y - p.position.y) * k }, 'attack');
          } else hold(p);
        } else if (distanceKm(p.position, target.position) > 0.7 * range) {
          order(world, p, target.position, 'attack');
        } else hold(p);
      }
    }
  }
}
