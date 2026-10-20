// Owns the world inside the worker: applies commands safely, advances time,
// and records every accepted command with its tick (the basis for replays).
import { loadScenario } from '@tow/content';
import { applyCommand, battleRootOf, createWorld, step, summarize, type Command, type TimedCommand, type WorldState, type WorldSummary } from '@tow/sim';
import type { ScenarioInfo } from './protocol.ts';

export class SimHost {
  readonly world: WorldState;
  readonly info: ScenarioInfo;
  readonly log: TimedCommand[] = [];

  constructor(scenarioId: string) {
    const resolved = loadScenario(scenarioId);
    const s = resolved.scenario;
    this.world = createWorld(resolved);
    this.info = { id: s.id, name: s.name, description: s.description ?? '', days: s.days, mapId: s.map ?? null };
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

  /** The summary the views draw, with battalion detail for `battle` if given. */
  snapshot(battle: string | null = null): WorldSummary {
    return summarize(this.world, { battle });
  }
}
