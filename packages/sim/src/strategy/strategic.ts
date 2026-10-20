// The strategic layer: governments and publics whose patience, support,
// cohesion and stability shape the war, the missile campaign against
// neutrals, the mandate's legal limits, and the cease-fire.
//
// A rules engine decides which strategic actions a side may take. In
// realistic mode, escalation locks and legal limits (such as contingents
// refusing to cross a border) are enforced; sandbox mode lifts them. The
// modelled consequences of an action apply in both modes.

import type { Effects, Position, StrategicActionSpec } from '@tow/content';
import { nextFloat } from '../core/rng.ts';
import { TICKS_PER_DAY, dayOf } from '../core/time.ts';
import { rngStream, sortedIds, type ActorState, type Formation, type StrategyState, type WorldState } from '../core/world.ts';
import { theaterUnits } from '../command/formations.ts';

const clamp = (v: number) => Math.max(0, Math.min(1000, v));

export function log(world: WorldState, kind: 'info' | 'warning' | 'crisis', text: string, routine = false): void {
  world.strategy?.log.push({ tick: world.tick, kind, text, ...(routine ? { routine: true } : {}) });
}

/** Region (country) at a position, or null off the map or without region data. */
export function regionAt(world: WorldState, p: Position): string | null {
  const t = world.terrain;
  if (!t?.regions) return null;
  const c = Math.floor(p.x / t.cellKm);
  const r = Math.floor(p.y / t.cellKm);
  if (c < 0 || r < 0 || c >= t.cols || r >= t.rows) return null;
  return t.regions.names[t.regions.cells[r * t.cols + c]!] ?? null;
}

/** The government a formation answers to. */
export function actorOf(world: WorldState, f: Formation): ActorState | undefined {
  const s = world.strategy;
  if (!s) return undefined;
  for (const id of sortedIds(s.actors)) if (s.actors[id]!.nations.includes(f.nation)) return s.actors[id];
  return undefined;
}

/** Whether a position lies outside what the side's mandate allows. */
export function beyondMandate(world: WorldState, side: string, p: Position): boolean {
  const m = world.strategy?.mandate;
  if (!m || m.side !== side) return false;
  const region = regionAt(world, p);
  if (region === null || !m.forbiddenRegions.includes(region)) return false;
  return m.allowedSouthOfY === undefined || p.y < m.allowedSouthOfY;
}

/**
 * The legal limit on sending a formation somewhere, in realistic mode: its
 * government's refusal to enter a region. Returns the reason, or null if allowed.
 */
export function movementRefusal(world: WorldState, f: Formation, to: Position): string | null {
  const s = world.strategy;
  if (!s || s.mode !== 'realistic') return null;
  const actor = actorOf(world, f);
  const region = regionAt(world, to);
  if (actor && region && actor.refusesRegions.includes(region)) {
    return `the ${actor.name} will not send its forces into ${region.replace(/-/g, ' ')}`;
  }
  return null;
}

export function applyEffects(world: WorldState, effects: Effects | null | undefined, side: string | null): void {
  const s = world.strategy;
  if (!s || !effects) return;
  for (const gauge of ['support', 'cohesion', 'patience', 'stability'] as const) {
    for (const [id, delta] of Object.entries(effects[gauge] ?? {})) {
      const a = s.actors[id];
      if (a && a[gauge] !== null) a[gauge] = clamp(a[gauge]! + delta);
    }
  }
  if (side !== null && effects.capital) s.capital[side] = Math.max(0, (s.capital[side] ?? 0) + effects.capital);
}

// ---------------------------------------------------------------- actions

export interface ActionStatus {
  available: boolean;
  /** Why it can't be taken right now, if it can't. */
  reason: string | null;
  locked: boolean;
}

export function actionStatus(world: WorldState, side: string, id: string): ActionStatus {
  const s = world.strategy;
  const a = s?.actions.find((x) => x.id === id);
  if (!s || !a) return { available: false, reason: 'unknown action', locked: false };
  const no = (reason: string, locked = false): ActionStatus => ({ available: false, reason, locked });
  if (a.side !== side) return no('not this side’s action');
  if (a.lockedInRealistic && s.mode === 'realistic') return no(a.lockReason ?? 'locked under realistic rules', true);
  if (s.ceasefire.tick !== null && a.kind !== 'generic') return no('a cease-fire is in force');
  const last = s.lastUsed[id];
  if (a.oneShot && last !== undefined) return no('already done');
  if (last !== undefined && world.tick - last < a.cooldownDays * TICKS_PER_DAY) return no(`available again in ${Math.ceil((last + a.cooldownDays * TICKS_PER_DAY - world.tick) / TICKS_PER_DAY)} d`);
  if ((s.capital[side] ?? 0) < a.cost) return no(`needs ${a.cost} political capital`);
  if (dayOf(world.tick) < a.requires.minDay) return no(`not before day ${a.requires.minDay}`);
  const missing = a.requires.objectivesHeld.filter((o) => world.objectives[o]?.holder !== side);
  if (missing.length > 0) return no(`needs ${missing.map((o) => world.objectives[o]?.name ?? o).join(', ')}`);
  if (a.kind === 'declare-ceasefire' && s.liberatedTick === null) return no('the cease-fire conditions are not met');
  if (a.kind === 'deploy-patriots') {
    const m = s.missiles;
    const free = m ? m.patriotBatteries - Object.values(m.patriotsAt).reduce((x, y) => x + y, 0) : 0;
    if (free <= 0) return no('no Patriot batteries free');
  }
  if (a.kind === 'pursue' && s.pursuing[side]) return no('already pursuing');
  return { available: true, reason: null, locked: false };
}

/** Take a strategic action. Throws, changing nothing, if it isn't available. */
export function takeAction(world: WorldState, side: string, id: string): void {
  const status = actionStatus(world, side, id);
  if (!status.available) throw new Error(`strategic action: ${status.reason}`);
  const s = world.strategy!;
  const a = s.actions.find((x) => x.id === id)!;
  s.capital[side] = (s.capital[side] ?? 0) - a.cost;
  s.lastUsed[id] = world.tick;
  applyEffects(world, a.effects, side);
  runKind(world, side, a);
  log(world, a.escalation >= 3 ? 'warning' : 'info', `${world.sides[side]?.name ?? side}: ${a.name}.`);
}

function runKind(world: WorldState, side: string, a: StrategicActionSpec) {
  const s = world.strategy!;
  switch (a.kind) {
    case 'deploy-patriots':
      if (s.missiles && a.target) s.missiles.patriotsAt[a.target] = (s.missiles.patriotsAt[a.target] ?? 0) + 1;
      return;
    case 'declare-ceasefire':
      declareCeasefire(world, `${world.sides[side]?.name ?? side} declares a cease-fire`);
      return;
    case 'pursue':
      s.pursuing[side] = true;
      // Invading their homeland, rather than evicting them from Kuwait, stiffens the defenders.
      for (const f of Object.values(world.formations)) {
        if (f.side !== side && (f.status === 'active' || f.status === 'retreating')) f.stats.morale = Math.min(1000, f.stats.morale + 150);
      }
      log(world, 'warning', 'Iraqi forces rally to defend Iraq itself.');
      return;
    case 'oil-fires':
      s.oilFires = world.tick;
      // Smoke over the battlefield: the other sides' air power loses some of its edge.
      for (const id of sortedIds(world.sides)) {
        const air = world.sides[id]!.air;
        if (id !== side && air) air.quality = Math.round(air.quality * 0.85);
      }
      return;
    case 'pressure':
    case 'countervalue':
    case 'generic':
      return; // effects only
  }
}

export function declareCeasefire(world: WorldState, reason: string): void {
  const s = world.strategy;
  if (!s || s.ceasefire.tick !== null) return;
  s.ceasefire = { tick: world.tick, reason };
  for (const f of Object.values(world.formations)) f.order = null;
  log(world, 'crisis', `Cease-fire: ${reason}.`);
}

export function ceasefireInForce(world: WorldState): boolean {
  return world.strategy?.ceasefire.tick != null;
}

// ---------------------------------------------------------------- the phase

/** Effective sorties a side flies on one mission today. */
function missionSorties(world: WorldState, side: string, key: 'scudHunt' | 'strategic'): number {
  const air = world.sides[side]?.air;
  if (!air) return 0;
  return (air.sorties * air.allocation[key] * air.quality * air.superiority) / 1e9;
}

function sideLosses(world: WorldState, side: string): number {
  const s = world.sides[side];
  return s ? s.losses + s.surrendered : 0;
}

export function strategyPhase(world: WorldState): void {
  const s = world.strategy;
  if (!s) return;
  checkLiberation(world, s);
  if (world.tick % TICKS_PER_DAY !== 0) return;
  if (world.tick > 0) dailyGauges(world, s);
  if (!ceasefireInForce(world)) missiles(world, s);
  interventionsAndWithdrawals(world, s);
  for (const side of sortedIds(world.sides)) {
    s.dayStartLosses[side] = sideLosses(world, side);
    s.objectivePoints[side] = 0;
    s.retreatLosses[side] = 0;
    s.capital[side] = (s.capital[side] ?? 0) + (s.capital[side] !== undefined ? s.rules.capitalPerDay : 0);
  }
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

function checkLiberation(world: WorldState, s: StrategyState) {
  const c = s.ceasefireSpec;
  if (!c || s.liberatedTick !== null) return;
  if (c.requires.every((o) => world.objectives[o]?.holder === c.side)) {
    s.liberatedTick = world.tick;
    log(world, 'info', `${world.sides[c.side]?.name ?? c.side} holds all its liberation objectives.`);
  }
}

/** Record objective points captured (called when an objective changes hands). */
export function noteCapture(world: WorldState, side: string, points: number): void {
  const s = world.strategy;
  if (s) s.objectivePoints[side] = (s.objectivePoints[side] ?? 0) + points;
}

/** Record losses a side suffers while retreating after liberation (the enemy is seen hitting a beaten army). */
export function noteRetreatLoss(world: WorldState, side: string, amount: number): void {
  const s = world.strategy;
  if (s && s.liberatedTick !== null && s.ceasefire.tick === null) s.retreatLosses[side] = (s.retreatLosses[side] ?? 0) + amount;
}

function dailyGauges(world: WorldState, s: StrategyState) {
  const r = s.rules;
  const sides = sortedIds(world.sides);
  for (const id of sortedIds(s.actors)) {
    const a = s.actors[id]!;
    if (a.status === 'withdrawn') continue;
    if (a.patience !== null && a.status === 'neutral') a.patience = clamp(a.patience + r.patienceRecoveryPerDay);
    if (!a.side) continue;
    const side = world.sides[a.side];
    if (!side) continue;
    const lostToday = sideLosses(world, a.side) - (s.dayStartLosses[a.side] ?? 0);
    const lossPermille = (lostToday * 1000) / Math.max(1, side.initialStrength);
    const enemies = sides.filter((x) => x !== a.side);
    if (a.support !== null) {
      let d = -r.supportFatiguePerDay - lossPermille * r.supportPerLossPermille + (s.objectivePoints[a.side] ?? 0) * r.supportPerObjectivePoint;
      d -= (missionSorties(world, a.side, 'strategic') / 100) * r.civilianHarmPer100Sorties;
      for (const e of enemies) {
        const killed = ((s.retreatLosses[e] ?? 0) * 1000) / Math.max(1, world.sides[e]!.initialStrength);
        d -= killed * r.supportPerRetreatKillPermille;
      }
      a.support = clamp(a.support + d);
    }
    if (a.cohesion !== null) {
      // Civilian harm from the side's own strategic bombing strains partners.
      a.cohesion = clamp(a.cohesion - (missionSorties(world, a.side, 'strategic') / 100) * r.civilianHarmPer100Sorties);
    }
    if (a.stability !== null) {
      let d = -lossPermille * r.stabilityPerLossPermille;
      for (const e of enemies) d -= (missionSorties(world, e, 'strategic') / 100) * r.stabilityPer100StrategicSorties;
      a.stability = clamp(a.stability + d);
    }
  }

  // Strategic bombing wears down enemy industry, which feeds their supply sources.
  for (const side of sides) {
    const sorties = missionSorties(world, side, 'strategic');
    for (const nid of sortedIds(world.supply.nodes)) {
      const n = world.supply.nodes[nid]!;
      if (n.kind !== 'source' || n.side === side) continue;
      const hit = (sorties / 100) * r.industryPer100Sorties;
      n.industry = Math.max(0, Math.min(1000, n.industry - (hit * n.industry) / 1000 + (sorties > 0 ? 0 : r.industryRepairPerDay)));
    }
  }

  // Forces beyond the mandate strain the partners who signed up only for it.
  const m = s.mandate;
  if (m && !ceasefireInForce(world)) {
    const beyond = theaterUnits(world).filter((f) => f.side === m.side && beyondMandate(world, m.side, f.position)).length;
    if (beyond > 0) {
      for (const [id, perDay] of Object.entries(m.cohesionPerFormationDay)) {
        const a = s.actors[id];
        if (a?.cohesion != null && a.status === 'active') a.cohesion = clamp(a.cohesion - perDay * beyond);
      }
      log(world, 'warning', `${beyond} ${world.sides[m.side]?.name ?? m.side} formations are operating beyond the mandate.`, true);
    }
  }

  // Public pressure can force a cease-fire once the war's aims are met.
  const c = s.ceasefireSpec;
  if (c && s.liberatedTick !== null && !ceasefireInForce(world)) {
    const weakest = Object.values(s.actors).filter((a) => a.side === c.side && a.support !== null && a.status !== 'withdrawn');
    if (weakest.some((a) => a.support! < c.forceWhenSupportBelow)) {
      declareCeasefire(world, 'public pressure at home forces an end to the fighting');
    }
  }
}

function missiles(world: WorldState, s: StrategyState) {
  const m = s.missiles;
  if (!m) return;
  m.recent = m.recent.filter((x) => world.tick - x.tick < 2 * TICKS_PER_DAY);
  const hunting = Object.keys(world.sides).filter((x) => x !== m.side).reduce((sum, x) => sum + missionSorties(world, x, 'scudHunt'), 0);
  const suppression = hunting / (hunting + s.rules.scudHalfSuppressionSorties);
  m.suppression = Math.round(suppression * 1000);
  m.launchers = Math.max(0, m.launchers - (m.launchers * suppression * s.rules.scudKillPerDay) / 1000);
  if (m.launchers < 0.5) return;

  const rng = rngStream(world, 'missiles');
  const expected = m.launchers * m.launchesPerLauncherPerDay * (1 - suppression);
  let launches = Math.floor(expected);
  if (nextFloat(rng) < expected - launches) launches++;
  if (launches === 0) return;

  const weights = missileWeights(world, m.side);
  const total = m.targets.reduce((sum, t) => sum + (weights[t.id] ?? 0), 0);
  const counts = new Map<string, { hits: number; intercepted: number }>();
  for (let i = 0; i < launches; i++) {
    let pick = nextFloat(rng) * total;
    const target = m.targets.find((t) => (pick -= weights[t.id] ?? 0) < 0) ?? m.targets[0]!;
    const chance = Math.min(m.maxIntercept, (m.patriotsAt[target.id] ?? 0) * m.interceptPerBattery) / 1000;
    const intercepted = nextFloat(rng) < chance;
    applyEffects(world, intercepted ? target.onIntercept : target.onHit, null);
    m.recent.push({ tick: world.tick, target: target.id, intercepted });
    m.fired++;
    if (!intercepted) m.hits++;
    const c = counts.get(target.id) ?? { hits: 0, intercepted: 0 };
    if (intercepted) c.intercepted++;
    else c.hits++;
    counts.set(target.id, c);
  }
  for (const t of m.targets) {
    const c = counts.get(t.id);
    if (!c) continue;
    const n = c.hits + c.intercepted;
    log(world, t.kind === 'city' ? 'warning' : 'info', `${n} missile${n > 1 ? 's' : ''} fired at ${t.name}${c.intercepted ? `, ${c.intercepted} intercepted` : ''}.`, true);
  }
}

/** Target weights: the firing side's AI preferences, else equal. */
function missileWeights(world: WorldState, side: string): Record<string, number> {
  const configured = world.sides[side]?.ai?.config.strategy?.scudTargets ?? {};
  const m = world.strategy!.missiles!;
  const out: Record<string, number> = {};
  for (const t of m.targets) out[t.id] = Object.keys(configured).length > 0 ? (configured[t.id] ?? 0) : 1;
  return out;
}

function interventionsAndWithdrawals(world: WorldState, s: StrategyState) {
  for (const id of sortedIds(s.actors)) {
    const a = s.actors[id]!;
    if (a.status === 'neutral' && a.patience !== null && a.patience <= 0 && a.interveneAgainst) {
      a.status = 'intervened';
      applyEffects(world, a.onIntervene, null);
      log(world, 'crisis', `The ${a.name} has run out of patience and is striking back at ${world.sides[a.interveneAgainst]?.name ?? a.interveneAgainst}.`);
    }
    if (a.status === 'active' && a.cohesion !== null && a.withdrawBelow !== null && a.cohesion < a.withdrawBelow && !ceasefireInForce(world)) {
      a.status = 'withdrawn';
      let n = 0;
      for (const f of Object.values(world.formations)) {
        if (a.nations.includes(f.nation) && (f.status === 'active' || f.status === 'retreating')) {
          f.status = 'withdrawn';
          f.order = null;
          f.inContact = false;
          n++;
        }
      }
      applyEffects(world, a.onWithdraw, null);
      const air = a.side ? world.sides[a.side]?.air : undefined;
      if (air && a.hostsAirPermille > 0) {
        // The aircraft based on its territory have to leave with it.
        air.sortiesPerDay = Math.round((air.sortiesPerDay * (1000 - a.hostsAirPermille)) / 1000);
      }
      // Ports on its soil can only be used at a fraction of their capacity; the rest has to be rerouted.
      for (const nid of a.restrictsSources) {
        const node = world.supply.nodes[nid];
        if (node) node.industry = Math.min(node.industry, a.restrictedTo);
      }
      log(world, 'crisis', `The ${a.name} pulls its ${n} formation${n === 1 ? '' : 's'} out of the coalition${a.hostsAirPermille > 0 ? ' and closes its air bases' : ''}.`);
    }
  }
}
