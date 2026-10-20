// Aggregate combat. Opposing formations within contact range fire on each
// other every tick, Lanchester style: each side's losses scale with the
// enemy's effective fire, spread over its targets by strength. Effective fire
// is combat power (strength x readiness x morale) x quality x close air
// support x a seeded random factor; protection comes from terrain and digging
// in. Losses cost morale, and formations whose morale breaks fall back,
// then collapse and surrender.

import { nextFloat, nextInt } from '../core/rng.ts';
import { rngStream, type Formation, type WorldState } from '../core/world.ts';
import { activeFormations } from '../command/formations.ts';
import { combatPower } from '../command/derived.ts';
import { distanceKm, issueMove, terrainCodeAt } from '../command/movement.ts';
import { ceasefireInForce, noteRetreatLoss } from '../strategy/strategic.ts';

/** Fighting value of a formation before modifiers: combat power x quality. */
export function fightingValue(f: Formation): number {
  return (combatPower(f.stats) * f.stats.quality) / 1000;
}

/** Sum of fighting value over a side's active formations. */
export function sideCombatPower(world: WorldState, side: string): number {
  let total = 0;
  for (const f of activeFormations(world)) if (f.side === side) total += fightingValue(f);
  return total;
}

export function effectiveFire(world: WorldState, f: Formation): number {
  const support = world.sides[f.side]?.air?.supportBonus ?? 1000;
  const retreating = f.status === 'retreating' ? 0.5 : 1;
  return (fightingValue(f) * support * retreating) / 1000;
}

export function terrainDefense(world: WorldState, f: Formation): number {
  const t = world.terrain;
  if (!t) return 1000;
  const code = terrainCodeAt(world, f.position);
  return (code !== undefined && t.defense[code]) || 1000;
}

/** Divisor on incoming ground fire. */
export function protection(world: WorldState, f: Formation): number {
  return (terrainDefense(world, f) / 1000) * (1 + f.fortification / 1000);
}

/** Lower-quality formations lose more morale for the same losses. */
export function moraleFactor(f: Formation): number {
  return 2000 / (f.stats.quality + 1000);
}

/**
 * Take `loss` strength off a formation, shrinking its consumption and carrying
 * capacity in proportion, and record it against its side.
 */
export function applyLosses(world: WorldState, f: Formation, loss: number): number {
  const s = f.stats;
  const taken = Math.min(loss, s.strength);
  if (taken <= 0) return 0;
  const before = s.strength;
  s.strength -= taken;
  const k = s.strength / before;
  s.supplyPerTick = Math.ceil(s.supplyPerTick * k);
  s.stockCap = Math.ceil(s.stockCap * k);
  s.stock = Math.min(s.stock, s.stockCap);
  const side = world.sides[f.side];
  if (side) side.losses += taken;
  if (f.status === 'retreating' || f.order?.kind === 'retreat') noteRetreatLoss(world, f.side, taken);
  return taken;
}

/** Add fractional damage; whole points come off strength. Returns strength lost. */
export function damage(world: WorldState, f: Formation, amount: number): number {
  f.lossCarry += amount;
  const whole = Math.floor(f.lossCarry);
  if (whole <= 0) return 0;
  f.lossCarry -= whole;
  return applyLosses(world, f, whole);
}

const clampPermille = (v: number) => Math.max(0, Math.min(1000, v));

function enemyOf(world: WorldState, side: string): string | null {
  return Object.keys(world.sides).sort().find((s) => s !== side) ?? null;
}

function surrender(world: WorldState, f: Formation, captor: string | null) {
  const own = world.sides[f.side];
  if (own) own.surrendered += f.stats.strength;
  const cap = captor ? world.sides[captor] : undefined;
  if (cap) cap.prisonersTaken += f.stats.strength;
  f.stats.strength = 0;
  f.stats.supplyPerTick = 0;
  f.status = 'surrendered';
  f.order = null;
  f.inContact = false;
}

/** Fall back `km` away from the centroid of the enemies in contact. */
function fallBack(world: WorldState, f: Formation, enemies: Formation[], km: number): boolean {
  let cx = 0;
  let cy = 0;
  for (const e of enemies) {
    cx += e.position.x / enemies.length;
    cy += e.position.y / enemies.length;
  }
  let dx = f.position.x - cx;
  let dy = f.position.y - cy;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= d;
  dy /= d;
  // Try straight back, then angled back to either side.
  for (const [ax, ay] of [
    [dx, dy],
    [dx - dy, dy + dx],
    [dx + dy, dy - dx],
  ] as const) {
    const n = Math.sqrt(ax * ax + ay * ay);
    const to = { x: f.position.x + (ax / n) * km, y: f.position.y + (ay / n) * km };
    try {
      issueMove(world, f.id, to, 'retreat');
      return true;
    } catch {
      // Blocked that way; try the next.
    }
  }
  return false;
}

export function combatPhase(world: WorldState): void {
  if (ceasefireInForce(world)) {
    world.contacts = [];
    for (const f of activeFormations(world)) f.inContact = false;
    return;
  }
  const r = world.rules;
  const units = activeFormations(world);
  const enemies = new Map<string, Formation[]>();
  const contacts: [string, string][] = [];
  for (const f of units) f.inContact = false;
  for (let i = 0; i < units.length; i++) {
    const a = units[i]!;
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j]!;
      if (a.side === b.side || distanceKm(a.position, b.position) > r.contactKm) continue;
      contacts.push([a.id, b.id]);
      enemies.set(a.id, [...(enemies.get(a.id) ?? []), b]);
      enemies.set(b.id, [...(enemies.get(b.id) ?? []), a]);
    }
  }
  world.contacts = contacts;
  if (contacts.length === 0) {
    surrenderChecks(world, units, enemies);
    return;
  }

  // Fire is simultaneous: work out all incoming damage before applying any.
  const rng = rngStream(world, 'combat');
  const incoming = new Map<string, number>();
  const firedOn = new Map<string, number>();
  const ownFire = new Map<string, number>();
  for (const f of units) {
    const targets = enemies.get(f.id);
    if (!targets) continue;
    const fire = effectiveFire(world, f) * (0.85 + 0.3 * nextFloat(rng));
    ownFire.set(f.id, fire);
    const weight = targets.reduce((sum, t) => sum + Math.max(1, t.stats.strength), 0);
    for (const t of targets) {
      const share = (fire * Math.max(1, t.stats.strength)) / weight;
      incoming.set(t.id, (incoming.get(t.id) ?? 0) + (share * r.lossRate) / protection(world, t));
      firedOn.set(t.id, (firedOn.get(t.id) ?? 0) + share);
    }
  }

  for (const f of units) {
    const hit = incoming.get(f.id);
    if (hit === undefined) continue;
    f.inContact = true;
    const before = Math.max(1, f.stats.strength);
    const lost = damage(world, f, hit);
    const frac = lost / before;
    const outgunned = (firedOn.get(f.id) ?? 0) > 1.5 * (ownFire.get(f.id) ?? 0);
    f.stats.morale = clampPermille(f.stats.morale - frac * 1000 * moraleFactor(f) - (outgunned ? r.outgunnedStress : 0));
    f.stats.readiness = clampPermille(f.stats.readiness - frac * 500);
  }

  surrenderChecks(world, units, enemies);
}

/** Status changes after fire: destruction, surrender, falling back, rallying. */
function surrenderChecks(world: WorldState, units: Formation[], enemies: Map<string, Formation[]>) {
  const r = world.rules;
  const rng = rngStream(world, 'morale');
  for (const f of units) {
    const s = f.stats;
    const est = Math.max(1, s.establishment);
    const foes = enemies.get(f.id) ?? [];
    const captor = foes[0]?.side ?? enemyOf(world, f.side);

    if (s.strength * 1000 <= est * r.destroyedStrength) {
      // Too few left to fight: the remnant gives up.
      surrender(world, f, captor);
      if (f.stats.strength === 0 && foes.length === 0) f.status = 'destroyed';
      continue;
    }
    const collapsing = s.morale < r.collapseMorale || s.strength * 1000 < est * r.collapseStrength;
    if (collapsing) {
      // In contact the chance is full; out of contact, units still melt away, far more slowly.
      const chance = (r.surrenderPerTick * moraleFactor(f)) / (foes.length > 0 ? 1 : 40);
      if (nextInt(rng, 0, 999) < chance) {
        surrender(world, f, captor);
        continue;
      }
    }
    if (foes.length > 0 && s.morale < r.retreatMorale && f.status === 'active') {
      if (fallBack(world, f, foes, 40)) f.status = 'retreating';
      else if (collapsing) surrender(world, f, captor); // nowhere to go
    } else if (f.status === 'retreating' && foes.length === 0 && s.morale >= r.rallyMorale) {
      f.status = 'active';
    }
  }
}

/** Dig in while stationary; lose it on the move. */
export function fortifyPhase(world: WorldState): void {
  const r = world.rules;
  for (const f of activeFormations(world)) {
    if (f.order) f.fortification = 0;
    else if (f.fortification < r.fortifyCap) f.fortification = Math.min(r.fortifyCap, f.fortification + r.fortifyPerTick);
  }
}
