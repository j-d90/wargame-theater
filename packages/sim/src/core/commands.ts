import type { WorldState } from './world.ts';
import { aggregate, expand } from '../command/formations.ts';

/** Intents sent into the sim. M1 has only the minimum needed to exercise LOD and supply. */
export type Command =
  | { type: 'expand'; formation: string }
  | { type: 'aggregate'; formation: string }
  | { type: 'setDisrupted'; target: { kind: 'node' | 'link'; id: string }; disrupted: boolean };

export type TimedCommand = Command & { tick: number };

export function applyCommand(world: WorldState, cmd: Command): void {
  switch (cmd.type) {
    case 'expand':
      expand(world, cmd.formation);
      return;
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
