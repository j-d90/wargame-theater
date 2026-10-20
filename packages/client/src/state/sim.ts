// Main-thread side of the sim worker: sends intents, folds replies into the store.
import type { Command, SaveGame } from '@tow/sim';
import type { GameOptions } from '../worker/host.ts';
import { DEPTH, type DepthPreset, type FromWorker, type SpeedSetting, type ToWorker } from '../worker/protocol.ts';
import { deleteSave, downloadSave, listSaves, putSave } from './saves.ts';
import { focusOn, notify, store } from './store.ts';

/** Strategic events already seen, so only new crises pop up as toasts. */
let seenLog = 0;
/** Decisions already shown as toasts. */
let seenDecision = -1;
/** Name for the next slot save, set by saveGame. */
let pendingSaveName = 'Saved game';

const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: ToWorker) => worker.postMessage(msg);

function saveMeta(): Record<string, unknown> {
  const { playerSide, depth, scenario } = store.get();
  return { playerSide, depth, scenarioName: scenario?.name ?? '' };
}

async function refreshSaves() {
  try {
    store.set({ saves: await listSaves() });
  } catch (err) {
    notify(`Saved games are unavailable: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

async function storeSave(id: string, name: string, save: SaveGame) {
  await putSave({ id, name, savedAt: Date.now(), scenarioName: store.get().scenario?.name ?? save.scenarioId, tick: save.tick, save });
  await refreshSaves();
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'scenarios':
      store.set({ scenarios: msg.list });
      return;
    case 'ready': {
      seenLog = 0;
      seenDecision = -1;
      store.set({
        scenario: msg.scenario,
        phase: msg.mode === 'replay' ? 'replay' : 'playing',
        replay: msg.replay,
        summary: null,
        selection: null,
        battle: null,
        view: 'theater',
        lastStop: null,
        endSeen: false,
        resolving: false,
        ...(msg.replay ? { playerSide: (msg.replay.meta['playerSide'] as string | null) ?? null } : {}),
      });
      if (msg.mode === 'game') applyDepth();
      if (msg.notice) notify(msg.notice);
      return;
    }
    case 'battleOpened':
      store.set({ battle: msg.battle, view: 'tactical', tacticalSelection: [], tacticalMode: 'select' });
      return;
    case 'snapshot': {
      const { selection, playerSide } = store.get();
      if (playerSide === null && msg.summary.sides.length > 1 && store.get().phase === 'playing') {
        // Started from a URL without choosing a side: the coalition, else the first side.
        const ids = msg.summary.sides.map((s) => s.id);
        store.set({ playerSide: ids.find((id) => id === 'coalition') ?? ids[0]! });
        applyDepth();
      }
      // Drop a selection whose formation was just expanded or collapsed away.
      const gone = selection?.kind === 'formation' && !msg.summary.active.some((f) => f.id === selection.id);
      store.set({ summary: msg.summary, speed: msg.speed, resolving: msg.resolving, ...(gone ? { selection: null, mode: 'select' as const } : {}) });
      // The watched battle has ended: collapse back to the theater.
      const watched = store.get().battle;
      if (watched !== null && !msg.summary.battles.some((b) => b.id === watched)) {
        notify('The battle is over; its divisions are back under theater command.');
        store.set((s) => ({ battle: null, tacticalSelection: [], view: s.view === 'tactical' ? 'theater' : s.view }));
        post({ type: 'watch', battle: null });
      }
      // News for the player that didn't stop the clock (the first snapshot only sets the baseline).
      const { playerSide: side, lastStop, phase } = store.get();
      const lastId = msg.summary.decisions[msg.summary.decisions.length - 1]?.id ?? 0;
      if (seenDecision >= 0 && !msg.resolving && phase === 'playing') {
        const fresh = msg.summary.decisions.filter((d) => d.id > seenDecision && d.id !== lastStop?.id && d.level !== 'minor' && (d.side === null || d.side === side));
        for (const d of fresh.slice(-2)) notify(d.text);
      }
      seenDecision = Math.max(seenDecision, lastId);
      const log = msg.summary.strategy?.log ?? [];
      const latest = log[0] ? log[0].tick * 1000 + log.length : 0;
      if (seenLog !== 0 && latest !== seenLog && store.get().phase === 'replay') {
        for (const x of log.filter((x) => x.kind === 'crisis' && x.tick >= msg.summary.tick - 96).slice(0, 2)) notify(x.text, 'error');
      }
      seenLog = latest || seenLog || 1;
      return;
    }
    case 'stopped': {
      const d = msg.decision;
      store.set({ lastStop: d });
      notify(d.text, d.level === 'critical' ? 'error' : 'info');
      if (d.at) focusOn(d.at);
      return;
    }
    case 'saved':
      if (msg.purpose === 'export') downloadSave(msg.save, `${store.get().scenario?.name ?? 'game'} day ${Math.floor(msg.save.tick / 96)}`);
      else if (msg.purpose === 'autosave') void storeSave('autosave', 'Autosave', msg.save);
      else
        void storeSave(`save-${Date.now()}`, pendingSaveName, msg.save).then(() => notify(`Saved “${pendingSaveName}”.`), (err: unknown) => notify(String(err), 'error'));
      return;
    case 'notice':
      notify(msg.text);
      return;
    case 'rejected':
      if (msg.command.type === 'openBattle') store.set({ switchStart: null });
      notify(msg.reason, 'error');
      return;
    case 'error':
      notify(msg.message, 'error');
      return;
  }
};
worker.onerror = (e) => notify(`Simulation worker failed: ${e.message}`, 'error');

/** Tell the worker which decisions stop the player's clock, and who commands the player's forces. */
function applyDepth() {
  const { depth, playerSide, phase } = store.get();
  if (phase !== 'playing') return;
  const d = DEPTH[depth];
  post({ type: 'stops', side: playerSide, filter: d.filter, playerAi: d.ai === 'always' });
  post({ type: 'autosave', enabled: true, meta: saveMeta() });
}

export const sim = {
  send: (command: Command) => post({ type: 'command', command }),
  setSpeed: (speed: SpeedSetting) => post({ type: 'speed', speed }),
  step: () => post({ type: 'step' }),
  seek: (tick: number) => post({ type: 'seek', tick }),
};

/** Ask for the scenario list and the saved games, for the start screen. */
export function loadMenu() {
  post({ type: 'listScenarios' });
  void refreshSaves();
}

export function newGame(scenario: string, playerSide: string | null, depth: DepthPreset, options: GameOptions) {
  store.set({ playerSide, depth });
  post({ type: 'init', scenario, options });
}

export function setDepth(depth: DepthPreset) {
  store.set({ depth });
  applyDepth();
}

/** Auto-resolve to the next decision that needs you; again to cancel. */
export function nextDecision() {
  const { resolving, depth, phase } = store.get();
  if (phase !== 'playing') return;
  if (resolving) post({ type: 'cancelResolve' });
  else {
    // Show it at once rather than on the next snapshot.
    store.set({ resolving: true, lastStop: null });
    post({ type: 'resolve', aiWhileResolving: DEPTH[depth].ai === 'while-skipping' });
  }
}

export function saveGame(name: string) {
  pendingSaveName = name;
  post({ type: 'save', purpose: 'slot', meta: saveMeta() });
}

export function exportGame() {
  post({ type: 'save', purpose: 'export', meta: saveMeta() });
}

export function loadGame(save: SaveGame) {
  const meta = save.meta;
  store.set({
    playerSide: (meta['playerSide'] as string | null | undefined) ?? null,
    depth: (meta['depth'] as DepthPreset | undefined) ?? 'operational',
  });
  post({ type: 'load', save });
}

export function watchReplay(save: SaveGame) {
  post({ type: 'replay', save });
}

export async function removeSave(id: string) {
  await deleteSave(id);
  await refreshSaves();
}

/** Back to the start screen. */
export function quitToMenu() {
  post({ type: 'speed', speed: 0 });
  // Keep where the player left off.
  if (store.get().phase === 'playing') post({ type: 'save', purpose: 'autosave', meta: saveMeta() });
  post({ type: 'autosave', enabled: false, meta: {} });
  store.set({ phase: 'setup', summary: null, scenario: null, replay: null, battle: null, view: 'theater' });
  loadMenu();
}

/** Zoom in: fight the battle `formation` is in at battalion level and switch to it. */
export function openBattle(formation: string) {
  store.set({ switchStart: performance.now() });
  post({ type: 'openBattle', formation });
}

/** Zoom in on a battle that is already being fought in detail. */
export function watchBattle(battle: string) {
  store.set({ switchStart: performance.now(), battle, view: 'tactical', tacticalSelection: [], tacticalMode: 'select' });
  post({ type: 'watch', battle });
}

/** Zoom out to the theater. The battle carries on in detail until it ends or is closed. */
export function leaveBattle() {
  store.set({ switchStart: performance.now(), view: 'theater', tacticalMode: 'select' });
}

/** End detailed fighting: the battle's battalions collapse back into their divisions. */
export function closeBattle(battle: string) {
  store.set({ switchStart: performance.now(), view: 'theater', battle: null, tacticalSelection: [] });
  post({ type: 'command', command: { type: 'closeBattle', battle } });
  post({ type: 'watch', battle: null });
}
