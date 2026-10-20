// Saves and replays. A save holds both a snapshot of the world (so loading is
// instant) and the log of every command since the start (so the game can be
// replayed, and checked: replaying the log from the scenario and seed must
// reproduce the snapshot's hash). Because the sim is deterministic, the log
// alone is enough to rebuild a game from an older save format.

import { hashState } from './hash.ts';
import { applyCommand, type TimedCommand } from './commands.ts';
import { step } from './tick.ts';
import { cloneWorld, type WorldState } from './world.ts';

/** Bump when WorldState changes shape, so old snapshots are rebuilt from their logs instead. */
export const SAVE_VERSION = 1;
export const SAVE_FORMAT = 'theater-of-war-save';

export interface SaveGame {
  format: typeof SAVE_FORMAT;
  version: number;
  scenarioId: string;
  seed: number;
  tick: number;
  hash: string;
  /** Every accepted command, with the tick it was applied before. */
  commands: TimedCommand[];
  world: WorldState;
  /** Client details (save name, player side, depth setting); the sim ignores them. */
  meta: Record<string, unknown>;
}

export function makeSave(world: WorldState, commands: readonly TimedCommand[], meta: Record<string, unknown> = {}): SaveGame {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    scenarioId: world.scenarioId,
    seed: world.seed,
    tick: world.tick,
    hash: hashState(world),
    commands: commands.map((c) => ({ ...c })),
    world: cloneWorld(world),
    meta: { ...meta },
  };
}

/** Check that `raw` looks like a save, saying what is wrong if not. */
export function checkSave(raw: unknown): SaveGame {
  const s = raw as Partial<SaveGame> | null;
  if (!s || typeof s !== 'object' || s.format !== SAVE_FORMAT) throw new Error('not a Theater of War save file');
  if (typeof s.version !== 'number' || typeof s.scenarioId !== 'string' || typeof s.seed !== 'number' || typeof s.tick !== 'number' || typeof s.hash !== 'string') {
    throw new Error('the save file is damaged (missing fields)');
  }
  if (!Array.isArray(s.commands) || s.commands.some((c) => typeof c?.tick !== 'number' || typeof c?.type !== 'string')) {
    throw new Error('the save file is damaged (bad command log)');
  }
  if (s.version > SAVE_VERSION) throw new Error('the save comes from a newer version of the game');
  return s as SaveGame;
}

/**
 * Advance `world` to `untilTick`, applying each logged command before the tick
 * it was given at, exactly as the game did. Commands given at `untilTick`
 * itself (after the last tick) are applied too. Mutates and returns `world`.
 */
export function replay(world: WorldState, commands: readonly TimedCommand[], untilTick: number, onTick?: (w: WorldState) => void): WorldState {
  let next = commands.findIndex((c) => c.tick >= world.tick);
  if (next < 0) next = commands.length;
  const applyDue = () => {
    while (next < commands.length && commands[next]!.tick <= world.tick) {
      const { tick: _tick, ...cmd } = commands[next++]!;
      applyCommand(world, cmd);
    }
  };
  while (world.tick < untilTick) {
    applyDue();
    step(world);
    onTick?.(world);
  }
  applyDue();
  return world;
}
