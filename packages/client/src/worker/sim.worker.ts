// Runs the simulation off the main thread, paced by real time: normal play,
// auto-resolve to the next decision, and replays of saved games.
import { loadScenario } from '@tow/content';
import { lastDecisionId, nextDecision, type DecisionFilter } from '@tow/sim';
import { ticksDue } from './clock.ts';
import { ReplayHost, SimHost } from './host.ts';
import { SPEEDS, type FromWorker, type ScenarioChoice, type SpeedSetting, type ToWorker } from './protocol.ts';
import { scenarioIds } from './scenarios.ts';

// The client compiles against the DOM lib, so describe just the worker scope we use.
const scope = self as unknown as {
  postMessage(msg: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

const FRAME_MS = 50;
/** Real time a frame may spend simulating when running flat out. */
const BUDGET_MS = 35;
/** Autosave at most this often, in real time. */
const AUTOSAVE_MS = 10_000;

let game: SimHost | null = null;
let replayer: ReplayHost | null = null;
let speed: SpeedSetting = 0;
let carry = 0;
let last = performance.now();
let dirty = false;
let lastCeasefire: number | null = null;
/** The battle whose battalions go into snapshots. */
let watching: string | null = null;
/** Who the player is and which decisions stop their clock. */
let stops: { side: string | null; filter: DecisionFilter } = { side: null, filter: { minLevel: 'critical' } };
/** Decisions up to this id have been looked at. */
let seen = 0;
let resolving: { aiWhileResolving: boolean } | null = null;
let autosave: { meta: Record<string, unknown>; day: number; at: number } | null = null;

const post = (msg: FromWorker) => scope.postMessage(msg);
const host = () => game ?? replayer;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^\w+: /, '');

function publish() {
  const h = host();
  if (h) post({ type: 'snapshot', summary: h.snapshot(watching), speed, resolving: resolving !== null });
  dirty = false;
}

function reset() {
  speed = 0;
  carry = 0;
  watching = null;
  resolving = null;
  lastCeasefire = null;
}

function startGame(h: SimHost, notice: string | null = null) {
  reset();
  game = h;
  replayer = null;
  seen = lastDecisionId(h.world);
  lastCeasefire = h.world.strategy?.ceasefire.tick ?? null;
  post({ type: 'ready', scenario: h.info, mode: 'game', replay: null, notice });
  publish();
}

/** Hand the player's side to the AI, or take it back (logged like any command). */
function setPlayerAi(on: boolean) {
  const side = stops.side;
  if (game && side && game.world.sides[side]?.ai) game.command({ type: 'setAiControl', side, controlled: on });
}

function stopResolving(decision: string | null) {
  if (!resolving) return;
  if (resolving.aiWhileResolving) setPlayerAi(false);
  resolving = null;
  if (decision) post({ type: 'notice', text: decision });
}

/** After time has passed: pause on a decision that should stop the player's clock. */
function checkStops(): boolean {
  if (!game) return false;
  const d = lastDecisionId(game.world) > seen ? nextDecision(game.world, seen, stops.side, stops.filter) : null;
  seen = d ? d.id : lastDecisionId(game.world);
  if (!d) return false;
  speed = 0;
  post({ type: 'stopped', decision: d });
  return true;
}

function listScenarios(): ScenarioChoice[] {
  return scenarioIds.map((id) => {
    const r = loadScenario(id);
    const s = r.scenario;
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      days: s.days,
      mapId: s.map ?? null,
      seed: s.seed,
      sides: s.sides.map((x) => ({ id: x.id, name: x.name, color: x.color ?? '#3f7fc4', ai: x.ai ? { competence: x.ai.competence } : null })),
    };
  });
}

scope.onmessage = (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'listScenarios':
        post({ type: 'scenarios', list: listScenarios() });
        return;
      case 'init':
        startGame(new SimHost(msg.scenario, msg.options));
        return;
      case 'load': {
        const { host: h, rebuilt } = SimHost.fromSave(msg.save);
        startGame(h, rebuilt ? 'This save came from an older version of the game; it was rebuilt by replaying its orders.' : null);
        return;
      }
      case 'replay': {
        reset();
        replayer = new ReplayHost(msg.save);
        game = null;
        post({
          type: 'ready',
          scenario: replayer.info,
          mode: 'replay',
          replay: { endTick: replayer.endTick, decisions: replayer.decisions, meta: replayer.save.meta },
          notice: null,
        });
        publish();
        return;
      }
      case 'command': {
        if (!game) {
          if (replayer) post({ type: 'rejected', command: msg.command, reason: 'This is a replay: watch it, but it cannot be changed.' });
          return;
        }
        const reason = game.command(msg.command);
        if (reason) post({ type: 'rejected', command: msg.command, reason: reason.replace(/^\w+: /, '') });
        dirty = true;
        return;
      }
      case 'speed':
        speed = msg.speed;
        carry = 0;
        if (resolving && speed === 0) stopResolving(null);
        dirty = true;
        return;
      case 'step': {
        const h = host();
        if (!h) return;
        stopResolving(null);
        speed = 0;
        h.advance(4);
        checkStops();
        publish();
        return;
      }
      case 'stops': {
        stops = { side: msg.side, filter: msg.filter };
        const ai = game && msg.side ? game.world.sides[msg.side]?.ai : undefined;
        if (ai && ai.controlled !== msg.playerAi && !resolving) setPlayerAi(msg.playerAi);
        dirty = true;
        return;
      }
      case 'resolve':
        if (!game || game.finished) return;
        resolving = { aiWhileResolving: msg.aiWhileResolving };
        if (msg.aiWhileResolving) setPlayerAi(true);
        seen = lastDecisionId(game.world);
        speed = 0;
        dirty = true;
        return;
      case 'cancelResolve':
        stopResolving(null);
        dirty = true;
        return;
      case 'save':
        if (game) post({ type: 'saved', purpose: msg.purpose, save: game.save(msg.meta) });
        else if (replayer && msg.purpose === 'export') post({ type: 'saved', purpose: 'export', save: replayer.save });
        return;
      case 'autosave':
        autosave = msg.enabled && game ? { meta: msg.meta, day: Math.floor(game.world.tick / 96), at: performance.now() } : null;
        return;
      case 'seek':
        if (replayer) {
          replayer.seek(msg.tick);
          publish();
        }
        return;
      case 'openBattle': {
        if (!game) {
          post({ type: 'rejected', command: { type: 'openBattle', formation: msg.formation }, reason: 'This is a replay: only battles fought in detail in the game can be watched.' });
          return;
        }
        try {
          watching = game.openBattle(msg.formation);
          post({ type: 'battleOpened', battle: watching });
        } catch (err) {
          post({ type: 'rejected', command: { type: 'openBattle', formation: msg.formation }, reason: errorText(err) });
        }
        // Answer at once rather than on the next frame: this is a level switch.
        publish();
        return;
      }
      case 'watch':
        watching = msg.battle;
        publish();
        return;
    }
  } catch (err) {
    post({ type: 'error', message: errorText(err) });
  }
};

setInterval(() => {
  const now = performance.now();
  const elapsed = now - last;
  last = now;
  const h = host();
  if (!h) return;

  if (game && resolving) {
    // Auto-resolve: as fast as possible, a slice per frame so the page stays responsive.
    const r = game.resolve(seen, stops.side, stops.filter, BUDGET_MS);
    if (r.ran > 0) dirty = true;
    if (r.decision) {
      seen = r.decision.id;
      stopResolving(null);
      post({ type: 'stopped', decision: r.decision });
    } else if (r.finished) {
      seen = lastDecisionId(game.world);
      stopResolving('The campaign has reached its end.');
    }
  } else if (speed === 5) {
    const started = performance.now();
    let ran = 0;
    while (!h.finished && performance.now() - started < BUDGET_MS) {
      ran += h.advance(4);
      if (checkStops()) break;
    }
    if (ran > 0) dirty = true;
  } else {
    const due = ticksDue(carry, elapsed, SPEEDS[speed]);
    carry = due.carry;
    if (due.ticks > 0 && h.advance(due.ticks) > 0) {
      dirty = true;
      checkStops();
    }
  }

  if (game) {
    // Stop the clock at the end, and when a cease-fire is declared so the player sees it.
    const ceasefire = game.world.strategy?.ceasefire.tick ?? null;
    if ((game.finished || (ceasefire !== null && ceasefire !== lastCeasefire)) && (speed !== 0 || resolving)) {
      speed = 0;
      stopResolving(null);
      dirty = true;
    }
    lastCeasefire = ceasefire;
    const day = Math.floor(game.world.tick / 96);
    if (autosave && day !== autosave.day && now - autosave.at >= AUTOSAVE_MS) {
      autosave = { ...autosave, day, at: now };
      post({ type: 'saved', purpose: 'autosave', save: game.save(autosave.meta) });
    }
  } else if (replayer && replayer.finished && speed !== 0) {
    speed = 0;
    dirty = true;
    post({ type: 'notice', text: replayer.matchesSave() ? 'End of the replay: it matches the saved game exactly.' : 'End of the replay, but it does not match the saved game.' });
  }
  if (dirty) publish();
}, FRAME_MS);
