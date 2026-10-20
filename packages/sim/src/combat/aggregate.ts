// Aggregate combat. Opposing formations within contact range fire on each
// other every tick, Lanchester style: each side's losses scale with the
// enemy's effective fire, spread over its targets by strength. Effective fire
// is combat power (strength x readiness x morale) x quality x close air
// support x a seeded random factor; protection comes from terrain and digging
// in. Losses cost morale, and formations whose morale breaks fall back,
// then collapse and surrender.

import { nextFloat, nextInt, type RngState } from '../core/rng.ts';
import { rngStream, type Formation, type WorldState } from '../core/world.ts';
import { activeFormations } from '../command/formations.ts';
import { combatPower } from '../command/derived.ts';
import { distanceKm, issueMove, terrainCodeAt } from '../command/movement.ts';
import { ceasefireInForce, noteRetreatLoss } from '../strategy/strategic.ts';
import { battleMembers, detailedCombat } from './battle.ts';

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

export function enemyOf(world: WorldState, side: string): string | null {
  return Object.keys(world.sides).sort().find((s) => s !== side) ?? null;
}

export function surrender(world: WorldState, f: Formation, captor: string | null) {
  const own = world.sides[f.side];
  if (own) own.surrendered += f.stats.strength;
  const cap = captor ? world.sides[captor] : undefined;
  if (cap) cap.prisonersTaken += f.stats.strength;
  f.stats.strength = 0;
  f.stats.supplyPerTick = 0;
  // Its supplies are lost with it, so they can't flow back if it is later merged into its parent.
  f.stats.stock = 0;
  f.stats.stockCap = 0;
  f.status = 'surrendered';
  f.order = null;
  f.inContact = false;
}

/** Fall back `km` away from the centroid of the enemies in contact. */
export function fallBack(world: WorldState, f: Formation, enemies: Formation[], km: number): boolean {
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
  const all = activeFormations(world);
  const inBattle = battleMembers(world);
  // Formations fighting a detailed battle are resolved there instead.
  const units = inBattle.size === 0 ? all : all.filter((f) => !inBattle.has(f.id));
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
  if (contacts.length > 0) {
    const index = new Map(units.map((f, i) => [f.id, i]));
    const targets = units.map((f) => enemies.get(f.id)?.map((t) => index.get(t.id)!));
    const hit = exchangeFire(world, units, targets, rngStream(world, 'combat'), 1);
    units.forEach((f, i) => {
      if (hit[i]) f.inContact = true;
    });
  }
  surrenderChecks(world, units, enemies, 40);
  if (inBattle.size > 0) detailedCombat(world, all.filter((f) => inBattle.has(f.id)), inBattle);
}

/**
 * Simultaneous Lanchester fire. `targets[i]` lists the indices (into
 * `units`) that unit i fires on; it spreads its effective fire (x `scale`)
 * over them by strength, and all damage is worked out before any is applied.
 * Losses fall on the units hit, while the shock to morale and readiness, and
 * whether a unit is outgunned, are shared across its `group` (by default each
 * unit is its own group; in a detailed battle, its division). Returns which
 * units were fired on.
 */
export function exchangeFire(
  world: WorldState,
  units: readonly Formation[],
  targets: readonly (readonly number[] | null | undefined)[],
  rng: RngState,
  scale: number,
  group?: Int32Array,
): Uint8Array {
  const r = world.rules;
  const n = units.length;
  const g = (i: number) => (group ? group[i]! : i);
  let ng = n;
  if (group) {
    ng = 0;
    for (let i = 0; i < n; i++) ng = Math.max(ng, group[i]! + 1);
  }
  const incoming = new Float64Array(n);
  const hit = new Uint8Array(n);
  const prot = new Float64Array(n);
  const firedOn = new Float64Array(ng);
  const ownFire = new Float64Array(ng);
  for (let i = 0; i < n; i++) {
    const ts = targets[i];
    if (!ts || ts.length === 0) continue;
    const fire = effectiveFire(world, units[i]!) * scale * (0.85 + 0.3 * nextFloat(rng));
    ownFire[g(i)]! += fire;
    let weight = 0;
    for (const j of ts) weight += Math.max(1, units[j]!.stats.strength);
    for (const j of ts) {
      const share = (fire * Math.max(1, units[j]!.stats.strength)) / weight;
      if (prot[j] === 0) prot[j] = protection(world, units[j]!);
      incoming[j]! += (share * r.lossRate) / prot[j]!;
      hit[j] = 1;
      firedOn[g(j)]! += share;
    }
  }

  const before = new Float64Array(ng);
  const lost = new Float64Array(ng);
  const groupHit = new Uint8Array(ng);
  for (let i = 0; i < n; i++) before[g(i)]! += units[i]!.stats.strength;
  for (let i = 0; i < n; i++) {
    if (!hit[i]) continue;
    lost[g(i)]! += damage(world, units[i]!, incoming[i]!);
    groupHit[g(i)] = 1;
  }
  for (let i = 0; i < n; i++) {
    const k = g(i);
    if (!groupHit[k]) continue;
    const f = units[i]!;
    const frac = lost[k]! / Math.max(1, before[k]!);
    const outgunned = firedOn[k]! > 1.5 * ownFire[k]!;
    f.stats.morale = clampPermille(f.stats.morale - frac * 1000 * moraleFactor(f) - (outgunned ? r.outgunnedStress : 0));
    f.stats.readiness = clampPermille(f.stats.readiness - frac * 500);
  }
  return hit;
}

/** Status changes after fire: destruction, surrender, falling back `fallBackKm`, rallying. */
export function surrenderChecks(world: WorldState, units: Formation[], enemies: Map<string, Formation[]>, fallBackKm: number) {
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
      if (fallBack(world, f, foes, fallBackKm)) f.status = 'retreating';
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
