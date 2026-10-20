import type { Position } from '@tow/content';
import type { WorldState } from './world.ts';
import { aggregate, expand, frontier } from '../command/formations.ts';
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
  | { type: 'setDisrupted'; target: { kind: 'node' | 'link'; id: string }; disrupted: boolean };

export type TimedCommand = Command & { tick: number };

/** Apply a command. Invalid commands throw before changing anything. */
export function applyCommand(world: WorldState, cmd: Command): void {
  switch (cmd.type) {
    case 'expand': {
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
      aggregate(world, cmd.formation);
      return;
    case 'setDisrupted': {
      const { kind, id } = cmd.target;
      const target = kind === 'node' ? world.supply.nodes[id] : world.supply.links[id];
      if (!target) throw new Error(`setDisrupted: unknown ${kind} "${id}"`);
      target.disrupted = cmd.disrupted;
      return;
    }
  }
}
