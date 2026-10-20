import type { Position } from '@tow/content';
import type { WorldState } from './world.ts';
import { aggregate, battleRootOf, expand, frontier } from '../command/formations.ts';
import { closeBattle, openBattle } from '../combat/battle.ts';
import { issueMove } from '../command/movement.ts';
import { moveDepot } from '../supply/depots.ts';
import { log, takeAction } from '../strategy/strategic.ts';
import type { AirAllocation, OrderKind } from './world.ts';

/** Intents sent into the sim. */
export type Command =
  | { type: 'expand'; formation: string }
  | { type: 'aggregate'; formation: string }
  | { type: 'move'; formation: string; to: Position; kind?: OrderKind }
  | { type: 'halt'; formation: string }
  | { type: 'moveDepot'; node: string; to: Position }
  | { type: 'setAirAllocation'; side: string; allocation: AirAllocation }
  | { type: 'setAiControl'; side: string; controlled: boolean }
  | { type: 'strategicAction'; side: string; action: string }
  | { type: 'setRulesMode'; mode: 'realistic' | 'sandbox' }
  | { type: 'setDisrupted'; target: { kind: 'node' | 'link'; id: string }; disrupted: boolean }
  /** Fight the battle `formation` is in at battalion level. */
  | { type: 'openBattle'; formation: string }
  | { type: 'closeBattle'; battle: string }
  /** A direct order to a unit inside a detailed battle; 'auto' hands it back to tactical AI. */
  | { type: 'tacticalOrder'; formation: string; order: 'move' | 'attack' | 'hold' | 'auto'; to?: Position }
  /** How well a side's AI commands, 0..1000. */
  | { type: 'setAiCompetence'; side: string; competence: number }
  /** Take a formation (and everything under it) from the AI, or hand it back. */
  | { type: 'setFormationControl'; formation: string; player: boolean };

export type TimedCommand = Command & { tick: number };

/** Expanding or collapsing part of a detailed battle would pull units out from under it. */
function refuseInBattle(world: WorldState, id: string, verb: string) {
  const f = world.formations[id];
  if (f && battleRootOf(world, id)) throw new Error(`${verb}: "${f.name}" is fighting a detailed battle; close the battle first`);
}

/** Apply a command. Invalid commands throw before changing anything. */
export function applyCommand(world: WorldState, cmd: Command): void {
  switch (cmd.type) {
    case 'expand': {
      refuseInBattle(world, cmd.formation, 'expand');
      const f = world.formations[cmd.formation];
      const order = f?.order ?? null;
      expand(world, cmd.formation);
      // Until there is AI to translate intents (M3), parts keep the block's
      // destination, offset by where they stand relative to the block.
      if (f && order) {
        for (const part of frontier(world, f.id)) {
          const to = {
            x: order.destination.x + part.position.x - f.position.x,
            y: order.destination.y + part.position.y - f.position.y,
          };
          try {
            issueMove(world, part.id, to, order.kind);
          } catch {
            try {
              issueMove(world, part.id, order.destination, order.kind);
            } catch {
              // Can't get there either way: the part stays put.
            }
          }
        }
      }
      return;
    }
    case 'move':
      issueMove(world, cmd.formation, cmd.to, cmd.kind ?? 'move');
      return;
    case 'moveDepot':
      moveDepot(world, cmd.node, cmd.to);
      return;
    case 'setAirAllocation': {
      const air = world.sides[cmd.side]?.air;
      if (!air) throw new Error(`setAirAllocation: side "${cmd.side}" has no air power`);
      const a = cmd.allocation;
      const parts = [a.counterAir, a.interdiction, a.attrition, a.support, a.scudHunt, a.strategic];
      if (parts.some((p) => !Number.isInteger(p) || p < 0) || parts.reduce((x, y) => x + y, 0) !== 1000) {
        throw new Error('setAirAllocation: shares must be whole permille summing to 1000');
      }
      air.allocation = { ...a };
      return;
    }
    case 'strategicAction':
      takeAction(world, cmd.side, cmd.action);
      return;
    case 'setRulesMode': {
      const s = world.strategy;
      if (!s) throw new Error('setRulesMode: this scenario has no strategic layer');
      if (s.mode !== cmd.mode) {
        s.mode = cmd.mode;
        log(world, 'warning', cmd.mode === 'sandbox' ? 'Sandbox rules: escalation locks and legal limits lifted.' : 'Realistic rules restored.');
      }
      return;
    }
    case 'setAiControl': {
      const ai = world.sides[cmd.side]?.ai;
      if (!ai) throw new Error(`setAiControl: side "${cmd.side}" has no AI`);
      ai.controlled = cmd.controlled;
      ai.nextDecisionTick = world.tick;
      return;
    }
    case 'halt': {
      const f = world.formations[cmd.formation];
      if (!f) throw new Error(`halt: unknown formation "${cmd.formation}"`);
      f.order = null;
      return;
    }
    case 'aggregate':
      refuseInBattle(world, cmd.formation, 'aggregate');
      aggregate(world, cmd.formation);
      return;
    case 'setAiCompetence': {
      const ai = world.sides[cmd.side]?.ai;
      if (!ai) throw new Error(`setAiCompetence: side "${cmd.side}" has no AI`);
      if (!Number.isInteger(cmd.competence) || cmd.competence < 0 || cmd.competence > 1000) throw new Error('setAiCompetence: competence must be a whole number from 0 to 1000');
      ai.config = { ...ai.config, competence: cmd.competence };
      return;
    }
    case 'setFormationControl': {
      const f = world.formations[cmd.formation];
      if (!f) throw new Error(`setFormationControl: unknown formation "${cmd.formation}"`);
      const ai = world.sides[f.side]?.ai;
      if (!ai) throw new Error(`setFormationControl: ${world.sides[f.side]?.name ?? f.side} has no AI to hand it to`);
      ai.manual = cmd.player ? [...new Set([...ai.manual, f.id])].sort() : ai.manual.filter((id) => id !== f.id);
      if (cmd.player) delete ai.issued[f.id];
      return;
    }
    case 'openBattle':
      openBattle(world, cmd.formation);
      return;
    case 'closeBattle':
      closeBattle(world, cmd.battle);
      return;
    case 'tacticalOrder': {
      const f = world.formations[cmd.formation];
      if (!f) throw new Error(`tacticalOrder: unknown formation "${cmd.formation}"`);
      const root = battleRootOf(world, f.id);
      if (!root || root === f) throw new Error(`tacticalOrder: "${f.name}" is not a unit in a detailed battle`);
      if (cmd.order === 'auto') {
        f.manual = false;
      } else if (cmd.order === 'hold') {
        f.order = null;
        f.manual = true;
      } else {
        if (!cmd.to) throw new Error('tacticalOrder: move and attack need a destination');
        issueMove(world, f.id, cmd.to, cmd.order, false);
        f.manual = true;
      }
      return;
    }
    case 'setDisrupted': {
      const { kind, id } = cmd.target;
      const target = kind === 'node' ? world.supply.nodes[id] : world.supply.links[id];
      if (!target) throw new Error(`setDisrupted: unknown ${kind} "${id}"`);
      target.disrupted = cmd.disrupted;
      return;
    }
  }
}
