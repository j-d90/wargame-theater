// Owns the world inside the worker: applies commands safely, advances time,
// and records every accepted command with its tick, which is what saves and
// replays are made of.
import { loadScenario } from '@tow/content';
import {
  SAVE_VERSION,
  applyCommand,
  battleRootOf,
  checkSave,
  cloneWorld,
  createWorld,
  hashState,
  lastDecisionId,
  makeSave,
  nextDecision,
  replay,
  step,
  summarize,
  type Command,
  type Decision,
  type DecisionFilter,
  type SaveGame,
  type TimedCommand,
  type WorldState,
  type WorldSummary,
} from '@tow/sim';
import type { ScenarioInfo } from './protocol.ts';

export interface GameOptions {
  seed?: number;
  /** AI competence by side, applied (and logged) at the start. */
  competence?: Record<string, number>;
}

function infoFor(scenarioId: string): { info: ScenarioInfo; world: (seed: number) => WorldState } {
  const resolved = loadScenario(scenarioId);
  const s = resolved.scenario;
  return {
    info: { id: s.id, name: s.name, description: s.description ?? '', days: s.days, mapId: s.map ?? null },
    world: (seed) => createWorld(resolved, { seed }),
  };
}

export interface ResolveResult {
  ran: number;
  /** The decision that stopped it, if one did. */
  decision: Decision | null;
  finished: boolean;
}

export class SimHost {
  world: WorldState;
  readonly info: ScenarioInfo;
  readonly log: TimedCommand[] = [];

  constructor(scenarioId: string, options: GameOptions = {}) {
    const resolved = loadScenario(scenarioId);
    const s = resolved.scenario;
    this.world = createWorld(resolved, options.seed === undefined ? {} : { seed: options.seed });
    this.info = { id: s.id, name: s.name, description: s.description ?? '', days: s.days, mapId: s.map ?? null };
    for (const [side, competence] of Object.entries(options.competence ?? {})) {
      const reason = this.command({ type: 'setAiCompetence', side, competence });
      if (reason) throw new Error(reason);
    }
  }

  /**
   * Restore a saved game. A save from this version loads its snapshot (checked
   * against its hash); an older one is rebuilt by replaying its command log.
   */
  static fromSave(raw: unknown): { host: SimHost; rebuilt: boolean } {
    const save = checkSave(raw);
    const host = new SimHost(save.scenarioId, { seed: save.seed });
    host.log.push(...save.commands.map((c) => ({ ...c })));
    if (save.version === SAVE_VERSION && hashState(save.world) === save.hash) {
      host.world = save.world;
      return { host, rebuilt: false };
    }
    host.world = replay(infoFor(save.scenarioId).world(save.seed), save.commands, save.tick);
    if (hashState(host.world) !== save.hash) throw new Error('the save could not be rebuilt: the game has changed too much since it was made');
    return { host, rebuilt: true };
  }

  /** Apply a command between ticks. Returns an error message instead of throwing. */
  command(cmd: Command): string | null {
    try {
      applyCommand(this.world, cmd);
      this.log.push({ ...cmd, tick: this.world.tick });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  /** Advance up to `ticks` ticks, stopping at the scenario's end. Returns ticks run. */
  advance(ticks: number): number {
    const end = this.info.days * 96;
    let ran = 0;
    while (ran < ticks && this.world.tick < end) {
      step(this.world);
      ran++;
    }
    return ran;
  }

  /**
   * Run ticks as fast as possible until a decision after `afterId` stops
   * `side`'s clock, the scenario ends, or `budgetMs` of real time is used up
   * (call again to carry on).
   */
  resolve(afterId: number, side: string | null, filter: DecisionFilter, budgetMs: number): ResolveResult {
    const end = this.info.days * 96;
    const started = performance.now();
    let ran = 0;
    while (this.world.tick < end && performance.now() - started < budgetMs) {
      step(this.world);
      ran++;
      const d = lastDecisionId(this.world) > afterId ? nextDecision(this.world, afterId, side, filter) : null;
      if (d) return { ran, decision: d, finished: false };
    }
    return { ran, decision: null, finished: this.world.tick >= end };
  }

  get finished(): boolean {
    return this.world.tick >= this.info.days * 96;
  }

  /** Open (or find) the detailed battle a formation is fighting. Returns its id, or throws why not. */
  openBattle(formation: string): string {
    const reason = this.command({ type: 'openBattle', formation });
    if (reason) throw new Error(reason);
    const root = battleRootOf(this.world, formation);
    if (!root?.battle) throw new Error('openBattle: the battle closed at once');
    return root.battle;
  }

  save(meta: Record<string, unknown> = {}): SaveGame {
    return makeSave(this.world, this.log, meta);
  }

  /** Replay the log from the scenario and seed; true if it reproduces the current world. */
  verify(): boolean {
    const fresh = createWorld(loadScenario(this.info.id), { seed: this.world.seed });
    return hashState(replay(fresh, this.log, this.world.tick)) === hashState(this.world);
  }

  /** The summary the views draw, with battalion detail for `battle` if given. */
  snapshot(battle: string | null = null): WorldSummary {
    return summarize(this.world, { battle });
  }
}

/** Snapshots kept while a replay plays, so seeking backwards is quick: one every two game days. */
const KEYFRAME_TICKS = 2 * 96;

/**
 * Plays a saved game back from the start: read-only, with seeking. Seeking
 * restarts from the nearest snapshot before the target and re-simulates the
 * rest, so any point can be reached exactly.
 */
export class ReplayHost {
  world: WorldState;
  readonly info: ScenarioInfo;
  readonly save: SaveGame;
  private keyframes = new Map<number, WorldState>();

  constructor(raw: unknown) {
    this.save = checkSave(raw);
    const { info, world } = infoFor(this.save.scenarioId);
    this.info = info;
    this.world = world(this.save.seed);
    this.keyframes.set(0, cloneWorld(this.world));
    // One pass through the whole game up front (about a second for a full campaign)
    // leaves a snapshot every two days, so any later seek only re-simulates a little.
    this.advance(this.endTick);
    this.world = cloneWorld(this.keyframes.get(0)!);
  }

  get endTick(): number {
    return this.save.tick;
  }

  get finished(): boolean {
    return this.world.tick >= this.endTick;
  }

  /** The decisions of the whole game, for markers on the timeline. */
  get decisions(): Decision[] {
    return this.save.world.decisions;
  }

  advance(ticks: number): number {
    const target = Math.min(this.endTick, this.world.tick + ticks);
    const from = this.world.tick;
    replay(this.world, this.save.commands, target, (w) => {
      if (w.tick % KEYFRAME_TICKS === 0 && !this.keyframes.has(w.tick)) this.keyframes.set(w.tick, cloneWorld(w));
    });
    return this.world.tick - from;
  }

  seek(tick: number): void {
    const target = Math.max(0, Math.min(this.endTick, Math.round(tick)));
    let best = 0;
    for (const k of this.keyframes.keys()) if (k <= target && k > best) best = k;
    // Going forward from where we are is cheaper than any snapshot behind it.
    if (!(this.world.tick <= target && this.world.tick >= best)) this.world = cloneWorld(this.keyframes.get(best)!);
    this.advance(target - this.world.tick);
  }

  /** True once the replay has reached the end of the save and matches it exactly. */
  matchesSave(): boolean {
    return this.world.tick === this.endTick && hashState(this.world) === this.save.hash;
  }

  snapshot(battle: string | null = null): WorldSummary {
    return summarize(this.world, { battle });
  }
}
