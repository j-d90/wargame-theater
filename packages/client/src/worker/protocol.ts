// Messages between the main thread and the sim worker. Views send intents
// (commands) down and receive state snapshots back; they never touch the world.
import type { Command, Decision, DecisionFilter, SaveGame, WorldSummary } from '@tow/sim';
import type { GameOptions } from './host.ts';

/** Index into SPEEDS. 0 is paused; 5 runs as fast as the machine allows. */
export type SpeedSetting = 0 | 1 | 2 | 3 | 4 | 5;

/** Game ticks per real second for each speed setting (a tick is 15 game minutes). */
export const SPEEDS: Record<SpeedSetting, number> = {
  0: 0,
  1: 1, // 15 game minutes per second
  2: 4, // 1 game hour per second
  3: 24, // 6 game hours per second
  4: 96, // 1 game day per second
  5: Infinity, // as fast as possible
};

export type DepthPreset = 'commander' | 'operational' | 'quick';

export interface DepthSetting {
  label: string;
  blurb: string;
  /** Which decisions stop the clock. */
  filter: DecisionFilter;
  /** When the AI gives your forces their orders. */
  ai: 'never' | 'while-skipping' | 'always';
}

/** The depth dial: how much of the war you play yourself, and how often it stops for you. */
export const DEPTH: Record<DepthPreset, DepthSetting> = {
  commander: {
    label: 'Commander',
    blurb: 'You give every order, and the clock stops for anything that needs you. Many hours.',
    filter: { minLevel: 'minor' },
    ai: 'never',
  },
  operational: {
    label: 'Operational',
    blurb: 'You command, but your staff carries on while you skip ahead. Stops for contact, objectives and strategy. A few hours.',
    filter: { minLevel: 'major' },
    ai: 'while-skipping',
  },
  quick: {
    label: 'Quick',
    blurb: 'Your generals fight the war; you make the big calls. Stops only for critical choices. About 10 minutes.',
    filter: { minLevel: 'critical' },
    ai: 'always',
  },
};

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  days: number;
  mapId: string | null;
}

/** What the start screen needs to set up a game. */
export interface ScenarioChoice extends ScenarioInfo {
  seed: number;
  sides: { id: string; name: string; color: string; ai: { competence: number } | null }[];
}

export interface ReplayInfo {
  endTick: number;
  decisions: Decision[];
  meta: Record<string, unknown>;
}

export type ToWorker =
  | { type: 'listScenarios' }
  | { type: 'init'; scenario: string; options?: GameOptions }
  | { type: 'load'; save: SaveGame }
  | { type: 'replay'; save: SaveGame }
  | { type: 'command'; command: Command }
  | { type: 'speed'; speed: SpeedSetting }
  /** Run one game hour, then pause. */
  | { type: 'step' }
  /** Which decisions pause the clock for the player's side, and whether the AI commands that side. */
  | { type: 'stops'; side: string | null; filter: DecisionFilter; playerAi: boolean }
  /** Auto-resolve until the next decision that stops the clock. */
  | { type: 'resolve'; aiWhileResolving: boolean }
  | { type: 'cancelResolve' }
  | { type: 'save'; purpose: 'slot' | 'export' | 'autosave'; meta: Record<string, unknown> }
  /** Post an autosave about once a game day (no more than every few seconds). */
  | { type: 'autosave'; enabled: boolean; meta: Record<string, unknown> }
  | { type: 'seek'; tick: number }
  /** Fight the battle this formation is in at battalion level, and watch it. */
  | { type: 'openBattle'; formation: string }
  /** Include this battle's battalions in snapshots (null: none). */
  | { type: 'watch'; battle: string | null };

export type FromWorker =
  | { type: 'scenarios'; list: ScenarioChoice[] }
  | { type: 'ready'; scenario: ScenarioInfo; mode: 'game' | 'replay'; replay: ReplayInfo | null; notice: string | null }
  | { type: 'battleOpened'; battle: string }
  | { type: 'snapshot'; summary: WorldSummary; speed: SpeedSetting; resolving: boolean }
  /** The clock stopped for a decision. */
  | { type: 'stopped'; decision: Decision }
  | { type: 'saved'; purpose: 'slot' | 'export' | 'autosave'; save: SaveGame }
  | { type: 'notice'; text: string }
  | { type: 'rejected'; command: Command; reason: string }
  | { type: 'error'; message: string };
