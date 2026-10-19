import type { Position } from '@tow/content';
import type { WorldState } from './world.ts';
import { aggregate, expand, frontier } from '../command/formations.ts';
import { issueMove } from '../command/movement.ts';

/** Intents sent into the sim. */
export type Command =
  | { type: 'expand'; formation: string }
  | { type: 'aggregate'; formation: string }
  | { type: 'move'; formation: string; to: Position }
  | { type: 'halt'; formation: string }
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
            issueMove(world, part.id, to);
          } catch {
            try {
              issueMove(world, part.id, order.destination);
            } catch {
              // Can't get there either way: the part stays put.
            }
          }
        }
      }
      return;
    }
    case 'move':
      issueMove(world, cmd.formation, cmd.to);
      return;
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
