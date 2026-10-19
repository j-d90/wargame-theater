import { applyCommand, type Command } from './commands.ts';
import { TICKS_PER_DAY } from './time.ts';
import type { WorldState } from './world.ts';
import { rollLinkEfficiency, supplyPhase } from '../supply/flow.ts';
import { consumptionPhase } from '../supply/consumption.ts';

/**
 * Advance the world by one fixed tick (15 minutes of game time). Mutates `world`.
 * Phase order is part of the determinism contract; change it deliberately.
 */
export function step(world: WorldState, commands: readonly Command[] = []): void {
  while (world.schedule.length > 0 && world.schedule[0]!.tick <= world.tick) {
    applyCommand(world, world.schedule.shift()!);
  }
  for (const cmd of commands) applyCommand(world, cmd);

  if (world.tick % TICKS_PER_DAY === 0) rollLinkEfficiency(world);
  supplyPhase(world);
  consumptionPhase(world);

  world.tick++;
}

/** Run `ticks` ticks. `onTick` fires after each one, e.g. to print daily summaries. */
export function run(world: WorldState, ticks: number, onTick?: (world: WorldState) => void): void {
  for (let i = 0; i < ticks; i++) {
    step(world);
    onTick?.(world);
  }
}
