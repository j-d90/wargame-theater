// Messages between the main thread and the sim worker. Views send intents
// (commands) down and receive state snapshots back; they never touch the world.
import type { Command, WorldSummary } from '@tow/sim';

/** Index into SPEEDS. 0 is paused. */
export type SpeedSetting = 0 | 1 | 2 | 3;

/** Game ticks per real second for each speed setting (a tick is 15 game minutes). */
export const SPEEDS: Record<SpeedSetting, number> = {
  0: 0,
  1: 4, // 1 game hour per second
  2: 24, // 6 game hours per second
  3: 96, // 1 game day per second
};

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  days: number;
  mapId: string | null;
}

export type ToWorker =
  | { type: 'init'; scenario: string }
  | { type: 'command'; command: Command }
  | { type: 'speed'; speed: SpeedSetting }
  /** Fight the battle this formation is in at battalion level, and watch it. */
  | { type: 'openBattle'; formation: string }
  /** Include this battle's battalions in snapshots (null: none). */
  | { type: 'watch'; battle: string | null };

export type FromWorker =
  | { type: 'ready'; scenario: ScenarioInfo }
  | { type: 'battleOpened'; battle: string }
  | { type: 'snapshot'; summary: WorldSummary; speed: SpeedSetting }
  | { type: 'rejected'; command: Command; reason: string }
  | { type: 'error'; message: string };
