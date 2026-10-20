// Theater AI. Each AI-controlled side decides on a cadence set by its
// competence. Following the design's intent model, the AI works at corps
// level ("take this objective", "gather here") and turns that into orders
// for the corps' divisions, spread across a frontage.
//
// Offensive posture: run the air campaign, move corps to their assembly
// areas, launch the ground offensive when the enemy is worn down enough (or
// the latest date arrives), then take each corps' objectives in order,
// pulling mobile depots forward behind the advance.
//
// Defensive posture: hold and dig in, counterattack with reserves when the
// enemy comes near, and withdraw everything once losses mount or key
// objectives fall.

import type { Position } from '@tow/content';
import { dayOf } from '../core/time.ts';
import { sortedIds, type AiState, type AirAllocation, type Formation, type OrderKind, type SideState, type WorldState } from '../core/world.ts';
import { activeFormations, frontier, isActive } from '../command/formations.ts';
import { distanceKm, issueMove } from '../command/movement.ts';
import { sideCombatPower } from '../combat/aggregate.ts';
import { moveDepot } from '../supply/depots.ts';
import { ceasefireInForce } from '../strategy/strategic.ts';

/** Ticks between decisions: every hour at full competence, every 6 hours at none. */
export function decisionInterval(competence: number): number {
  return Math.round(4 + ((1000 - competence) * 20) / 1000);
}

export function aiPhase(world: WorldState): void {
  for (const id of sortedIds(world.sides)) {
    const side = world.sides[id]!;
    const ai = side.ai;
    if (!ai || !ai.controlled || world.tick < ai.nextDecisionTick || ceasefireInForce(world)) continue;
    ai.nextDecisionTick = world.tick + decisionInterval(ai.config.competence);
    if (ai.config.posture === 'offensive') offensive(world, side, ai);
    else defensive(world, side, ai);
    allocateAir(world, side, ai);
  }
}

function enemies(world: WorldState, side: string): string[] {
  return sortedIds(world.sides).filter((s) => s !== side);
}

function powerRatio(world: WorldState, side: string): number {
  const s = world.sides[side]!;
  return s.initialCombatPower > 0 ? sideCombatPower(world, side) / s.initialCombatPower : 0;
}

/** Active formations standing for a command's subtree that can take orders. */
function commandUnits(world: WorldState, id: string): Formation[] {
  if (!world.formations[id]) return [];
  return frontier(world, id).filter((f) => isActive(world, f.id) && f.status === 'active');
}

/** Order a formation somewhere unless it already has that order. Returns false if it can't go. */
function order(world: WorldState, ai: AiState, f: Formation, to: Position, kind: OrderKind, gridKm = 5): boolean {
  const key = `${kind}:${Math.round(to.x / gridKm)}:${Math.round(to.y / gridKm)}`;
  if (ai.issued[f.id] === key && (f.order !== null || distanceKm(f.position, to) < gridKm)) return true;
  try {
    issueMove(world, f.id, to, kind);
    ai.issued[f.id] = key;
    return true;
  } catch {
    return false;
  }
}

/** Send units at a target on a broad front, keeping their left-to-right order. */
function spreadOrders(world: WorldState, ai: AiState, units: Formation[], target: Position, kind: OrderKind, spacingKm = 20) {
  if (units.length === 0) return;
  const cx = units.reduce((s, f) => s + f.position.x, 0) / units.length;
  const cy = units.reduce((s, f) => s + f.position.y, 0) / units.length;
  let dx = target.x - cx;
  let dy = target.y - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) [dx, dy] = [0, -1];
  else [dx, dy] = [dx / d, dy / d];
  const px = -dy;
  const py = dx;
  const sorted = [...units].sort((a, b) => a.position.x * px + a.position.y * py - (b.position.x * px + b.position.y * py) || (a.id < b.id ? -1 : 1));
  sorted.forEach((f, i) => {
    const off = (i - (sorted.length - 1) / 2) * spacingKm;
    const dest = { x: target.x + px * off, y: target.y + py * off };
    if (!order(world, ai, f, dest, kind)) order(world, ai, f, target, kind);
  });
}

/** Keep a mobile depot about 40 km behind a group of units. */
function followWithDepot(world: WorldState, nodeId: string | undefined, units: Formation[]) {
  const node = nodeId ? world.supply.nodes[nodeId] : undefined;
  if (!node || units.length === 0) return;
  const cx = units.reduce((s, f) => s + f.position.x, 0) / units.length;
  const cy = units.reduce((s, f) => s + f.position.y, 0) / units.length;
  const back = { x: node.position.x - cx, y: node.position.y - cy };
  const d = Math.sqrt(back.x * back.x + back.y * back.y) || 1;
  const desired = { x: cx + (back.x / d) * 40, y: cy + (back.y / d) * 40 };
  const current = node.moveTo ?? node.position;
  if (distanceKm(current, desired) > 30) moveDepot(world, node.id, desired);
}

function offensive(world: WorldState, side: SideState, ai: AiState) {
  const o = ai.config.offensive;
  if (!o) return;
  if (ai.phase === 'prepare') {
    const day = dayOf(world.tick);
    const enemyRatio = Math.min(...enemies(world, side.id).map((e) => powerRatio(world, e)));
    if (day >= o.earliestDay && (enemyRatio * 1000 <= o.launchWhenEnemyBelow || day >= o.latestDay)) {
      ai.phase = 'offensive';
      ai.offensiveTick = world.tick;
    }
  }
  for (const plan of o.plans) {
    const units = commandUnits(world, plan.corps);
    if (ai.phase === 'prepare') {
      spreadOrders(world, ai, units, plan.assembly, 'move');
    } else {
      // Pressing on past the mandate adds the pursuit objectives after the plan's own.
      const pursuit = world.strategy?.pursuing[side.id]
        ? (ai.config.strategy?.pursuit.find((p) => p.corps === plan.corps)?.objectives ?? [])
        : [];
      const objectives = [...plan.objectives, ...pursuit];
      let step = ai.planStep[plan.corps] ?? 0;
      while (step < objectives.length - 1 && world.objectives[objectives[step]!]?.holder === side.id) step++;
      ai.planStep[plan.corps] = step;
      const objective = world.objectives[objectives[step]!];
      if (objective) spreadOrders(world, ai, units, objective.position, 'attack');
    }
    followWithDepot(world, plan.depot, units);
  }
}

function defensive(world: WorldState, side: SideState, ai: AiState) {
  const d = ai.config.defensive;
  if (!d) return;
  if (ai.phase === 'defend') {
    const lost = d.withdrawWhenLost.some((id) => {
      const h = world.objectives[id]?.holder;
      return h !== undefined && h !== null && h !== side.id;
    });
    // A regime that fears for its survival pulls back to save what it can.
    const limit = ai.config.strategy?.withdrawWhenStabilityBelow;
    const shaky = limit !== undefined && Object.values(world.strategy?.actors ?? {}).some((a) => a.side === side.id && a.stability !== null && a.stability < limit);
    if (lost || shaky || powerRatio(world, side.id) * 1000 < d.withdrawBelow) ai.phase = 'withdraw';
  }

  if (ai.phase === 'withdraw') {
    const own = activeFormations(world).filter((f) => f.side === side.id);
    own.forEach((f, i) => {
      // Spread arrivals over a 40 km box so they don't all aim at one point.
      const to = { x: d.withdrawTo.x + ((i % 5) - 2) * 10, y: d.withdrawTo.y + ((Math.floor(i / 5) % 5) - 2) * 10 };
      if (!order(world, ai, f, to, 'retreat', 10)) order(world, ai, f, d.withdrawTo, 'retreat', 10);
    });
    return;
  }

  // Reserves strike at enemies that come within reach. Less competent commands see less far.
  const reach = (d.reactionKm * (500 + ai.config.competence / 2)) / 1000;
  const foes = activeFormations(world).filter((f) => f.side !== side.id);
  for (const r of d.reserves) {
    for (const f of commandUnits(world, r)) {
      if (f.inContact) continue;
      let best: Formation | null = null;
      let bestD = reach;
      for (const e of foes) {
        const dist = distanceKm(f.position, e.position);
        if (dist < bestD) [best, bestD] = [e, dist];
      }
      if (best) order(world, ai, f, best.position, 'attack', 10);
    }
  }
}

type TheaterAir = Pick<AirAllocation, 'counterAir' | 'interdiction' | 'attrition' | 'support'>;

function allocateAir(world: WorldState, side: SideState, ai: AiState) {
  const air = side.air;
  if (!air) return;
  let base: TheaterAir;
  if (ai.config.posture === 'defensive') {
    base = { counterAir: 700, interdiction: 0, attrition: 100, support: 200 };
  } else {
    const enemyPool = Math.max(0, ...enemies(world, side.id).map((e) => world.sides[e]!.air?.pool ?? 0));
    if (enemyPool > 350) base = { counterAir: 650, interdiction: 150, attrition: 200, support: 0 };
    else if (ai.phase === 'prepare') base = { counterAir: 100, interdiction: 350, attrition: 550, support: 0 };
    else base = { counterAir: 50, interdiction: 50, attrition: 600, support: 300 };
  }
  // Strategic missions come off the top; the theater missions share what's left.
  const st = ai.config.strategy;
  const m = world.strategy?.missiles;
  const missilesFlying = m !== undefined && m !== null && m.side !== side.id && m.launchers >= 0.5;
  const scudHunt = st && st.scudResponse === 'historical' && missilesFlying ? st.scudHuntShare : 0;
  // Strategic bombing belongs to the air campaign; once the ground war starts, the air effort goes to the front.
  const strategic = ai.phase === 'prepare' ? (st?.strategicBombing ?? 0) : 0;
  const left = 1000 - scudHunt - strategic;
  const scaled = {
    counterAir: Math.floor((base.counterAir * left) / 1000),
    interdiction: Math.floor((base.interdiction * left) / 1000),
    attrition: Math.floor((base.attrition * left) / 1000),
    support: Math.floor((base.support * left) / 1000),
  };
  scaled.counterAir += left - (scaled.counterAir + scaled.interdiction + scaled.attrition + scaled.support);
  air.allocation = { ...scaled, scudHunt, strategic };
}
