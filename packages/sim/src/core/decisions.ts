// Decision points: moments that may need a player's attention, so the clock
// can stop there and "auto-resolve until the next decision" knows where to
// stop. The decisions phase runs last in each tick and compares what it sees
// with what it saw the tick before: units making contact, objectives changing
// hands, an offensive starting, a strategic choice opening up, and so on.
// Each decision has a level; how much a player wants to be interrupted (the
// depth dial) is a filter on levels and kinds, applied outside the sim.

import type { Position } from '@tow/content';
import { sortedIds, type FormationStatus, type WorldState } from './world.ts';
import { theaterUnits } from '../command/formations.ts';
import { distanceKm } from '../command/movement.ts';
import { inSupplyRange, supplyDistance } from '../supply/flow.ts';
import { actionStatus } from '../strategy/strategic.ts';

export type DecisionLevel = 'minor' | 'major' | 'critical';

export type DecisionKind =
  | 'contact'
  | 'battle-ended'
  | 'objective-taken'
  | 'objective-lost'
  | 'fell-back'
  | 'surrendered'
  | 'out-of-supply'
  | 'arrived'
  | 'offensive'
  | 'withdrawal'
  | 'action-available'
  | 'strategic';

export const DECISION_LEVELS: readonly DecisionLevel[] = ['minor', 'major', 'critical'];

export interface Decision {
  id: number;
  tick: number;
  /** The side it concerns, or null for everyone. */
  side: string | null;
  kind: DecisionKind;
  level: DecisionLevel;
  text: string;
  /** Where to look, if anywhere. */
  at: Position | null;
  /** The formation, objective, battle or action it is about. */
  subject: string | null;
}

export interface DecisionWatch {
  contact: string[];
  /** Last tick each unit was in contact: contact only counts as new after a quiet spell. */
  contactSeen: Record<string, number>;
  status: Record<string, FormationStatus>;
  outOfSupply: string[];
  moving: string[];
  holders: Record<string, string | null>;
  aiPhase: Record<string, string>;
  /** Strategic actions available, as "side:action". */
  available: string[];
  battles: Record<string, { name: string; center: Position }>;
  logSeen: number;
}

/** Which decisions stop the clock for a player: by minimum level, with per-kind overrides. */
export interface DecisionFilter {
  minLevel: DecisionLevel;
  /** Kinds that always (true) or never (false) stop, whatever their level. */
  kinds?: Partial<Record<DecisionKind, boolean>>;
}

export function decisionMatches(d: Decision, side: string | null, filter: DecisionFilter): boolean {
  if (side !== null && d.side !== null && d.side !== side) return false;
  const forced = filter.kinds?.[d.kind];
  if (forced !== undefined) return forced;
  return DECISION_LEVELS.indexOf(d.level) >= DECISION_LEVELS.indexOf(filter.minLevel);
}

/** The first decision after `afterId` that stops `side`'s clock, if any. */
export function nextDecision(world: WorldState, afterId: number, side: string | null, filter: DecisionFilter): Decision | null {
  for (let i = world.decisions.length - 1; i >= 0; i--) {
    if (world.decisions[i]!.id <= afterId) {
      return world.decisions.slice(i + 1).find((d) => decisionMatches(d, side, filter)) ?? null;
    }
  }
  return world.decisions.find((d) => decisionMatches(d, side, filter)) ?? null;
}

export function lastDecisionId(world: WorldState): number {
  return world.decisions[world.decisions.length - 1]?.id ?? 0;
}

/** Kinds where one decision per side and tick stands for several units. */
const GROUPED: DecisionKind[] = ['contact', 'fell-back', 'surrendered', 'out-of-supply', 'arrived'];

/** Ticks out of contact before a unit's contact counts as new (6 hours). */
const QUIET_TICKS = 24;

/** Record the world as it is now, as the baseline for spotting changes (createWorld calls this). */
export function observe(world: WorldState): void {
  world.watch = look(world, world.watch);
}

function look(world: WorldState, before: DecisionWatch | null): DecisionWatch {
  const units = theaterUnits(world);
  const strategy = world.strategy;
  // Slower-changing things are checked hourly.
  const hourly = before === null || world.tick % 4 === 0;
  let available = before?.available ?? [];
  if (hourly) {
    available = [];
    for (const a of strategy?.actions ?? []) {
      if (actionStatus(world, a.side, a.id).available) available.push(`${a.side}:${a.id}`);
    }
  }
  const status: Record<string, FormationStatus> = {};
  for (const f of units) status[f.id] = f.status;
  const contact = units.filter((f) => f.inContact).map((f) => f.id);
  const contactSeen: Record<string, number> = {};
  for (const [id, t] of Object.entries(before?.contactSeen ?? {})) if (world.tick - t <= QUIET_TICKS) contactSeen[id] = t;
  for (const id of contact) contactSeen[id] = world.tick;
  return {
    contact,
    contactSeen,
    status,
    outOfSupply: hourly ? units.filter((f) => supplyDistance(world, f) !== null && !inSupplyRange(world, f)).map((f) => f.id) : before!.outOfSupply,
    moving: units.filter((f) => f.order !== null && f.order.kind !== 'retreat').map((f) => f.id),
    holders: Object.fromEntries(sortedIds(world.objectives).map((id) => [id, world.objectives[id]!.holder])),
    aiPhase: Object.fromEntries(sortedIds(world.sides).flatMap((id) => (world.sides[id]!.ai ? [[id, world.sides[id]!.ai!.phase]] : []))),
    available,
    battles: Object.fromEntries(sortedIds(world.battles).map((id) => [id, { name: world.battles[id]!.name, center: { ...world.battles[id]!.center } }])),
    logSeen: strategy?.log.length ?? 0,
  };
}

/** Name of the nearest objective within 60 km, to say where something happened. */
function near(world: WorldState, p: Position): string {
  let best: string | null = null;
  let bestD = 60;
  for (const id of sortedIds(world.objectives)) {
    const o = world.objectives[id]!;
    const d = distanceKm(o.position, p);
    if (d < bestD) [best, bestD] = [o.name, d];
  }
  return best ? ` near ${best}` : '';
}

function names(list: string[]): string {
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]} and ${list.length - 1} others`;
}

export function decisionsPhase(world: WorldState): void {
  const before = world.watch;
  const now = look(world, before);
  world.watch = now;
  if (!before) return;


  const out: Omit<Decision, 'id' | 'tick'>[] = [];
  const sideName = (id: string) => world.sides[id]?.name ?? id;
  const unit = (id: string) => world.formations[id];

  // Per-unit changes, grouped per side and kind.
  const groups = new Map<string, string[]>();
  const add = (kind: DecisionKind, id: string) => {
    const f = unit(id);
    if (!f) return;
    const key = `${kind}|${f.side}`;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  };
  for (const id of now.contact) if (before.contactSeen[id] === undefined) add('contact', id);
  const wasOut = new Set(before.outOfSupply);
  for (const id of now.outOfSupply) if (!wasOut.has(id)) add('out-of-supply', id);
  const nowMoving = new Set(now.moving);
  for (const id of before.moving) {
    const f = unit(id);
    if (!nowMoving.has(id) && f && f.status === 'active' && f.order === null && now.status[id] !== undefined) add('arrived', id);
  }
  for (const [id, st] of Object.entries(before.status)) {
    const f = unit(id);
    if (!f) continue;
    if (st === 'active' && now.status[id] === 'retreating') add('fell-back', id);
    if ((st === 'active' || st === 'retreating') && (f.status === 'surrendered' || f.status === 'destroyed')) add('surrendered', id);
  }
  for (const kind of GROUPED) {
    for (const side of sortedIds(world.sides)) {
      const ids = groups.get(`${kind}|${side}`);
      if (!ids) continue;
      const first = unit(ids[0]!)!;
      const who = names(ids.map((id) => unit(id)!.name));
      const where = near(world, first.position);
      const many = ids.length > 1;
      const text = {
        contact: `${who} ${many ? 'are' : 'is'} in contact with the enemy${where}.`,
        'fell-back': `${who} ${many ? 'are' : 'is'} falling back${where}.`,
        surrendered: `${who} ${many ? 'have' : 'has'} surrendered${where}.`,
        'out-of-supply': `${who} ${many ? 'are' : 'is'} out of supply range.`,
        arrived: `${who} ${many ? 'have' : 'has'} reached ${many ? 'their' : 'its'} destination.`,
      }[kind as 'contact'];
      const level: DecisionLevel = kind === 'contact' || kind === 'surrendered' ? 'major' : 'minor';
      out.push({ side, kind, level, text, at: { ...first.position }, subject: first.id });
    }
  }

  for (const [id, holder] of Object.entries(now.holders)) {
    const prev = before.holders[id];
    if (prev === holder || holder === null) continue;
    const o = world.objectives[id]!;
    out.push({ side: holder, kind: 'objective-taken', level: 'major', text: `${sideName(holder)} takes ${o.name}.`, at: { ...o.position }, subject: id });
    if (prev) out.push({ side: prev, kind: 'objective-lost', level: 'major', text: `${o.name} has fallen to ${sideName(holder)}.`, at: { ...o.position }, subject: id });
  }

  for (const [side, phase] of Object.entries(now.aiPhase)) {
    if (before.aiPhase[side] === phase) continue;
    if (phase === 'offensive') {
      out.push({ side, kind: 'offensive', level: 'critical', text: `${sideName(side)}'s ground offensive has begun.`, at: null, subject: side });
      for (const other of sortedIds(world.sides)) {
        if (other !== side) out.push({ side: other, kind: 'offensive', level: 'critical', text: `The enemy has launched its ground offensive.`, at: null, subject: side });
      }
    } else if (phase === 'withdraw') {
      out.push({ side: null, kind: 'withdrawal', level: 'major', text: `${sideName(side)} is pulling its forces back.`, at: null, subject: side });
    }
  }

  const wasAvailable = new Set(before.available);
  for (const key of now.available) {
    if (wasAvailable.has(key)) continue;
    const [side, actionId] = key.split(':') as [string, string];
    const a = world.strategy!.actions.find((x) => x.id === actionId)!;
    // Decisive choices are critical; recurring options (Patriots, pressure) only minor.
    const decisive = a.oneShot || a.kind === 'declare-ceasefire' || a.kind === 'pursue';
    out.push({ side, kind: 'action-available', level: decisive ? 'critical' : 'minor', text: `Strategic option available: ${a.name}.`, at: null, subject: actionId });
  }

  for (const [id, b] of Object.entries(before.battles)) {
    if (!now.battles[id]) out.push({ side: null, kind: 'battle-ended', level: 'major', text: `The ${b.name.startsWith('Battle of') ? b.name : `battle (${b.name})`} is over.`, at: b.center, subject: id });
  }

  for (const e of world.strategy?.log.slice(before.logSeen) ?? []) {
    if (e.kind === 'info') continue;
    out.push({ side: null, kind: 'strategic', level: e.kind === 'crisis' ? 'critical' : e.routine ? 'minor' : 'major', text: e.text, at: null, subject: null });
  }

  let id = lastDecisionId(world);
  for (const d of out) world.decisions.push({ id: ++id, tick: world.tick, ...d });
}
