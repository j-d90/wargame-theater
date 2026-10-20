// Main-thread side of the sim worker: sends intents, folds replies into the store.
import type { Command } from '@tow/sim';
import type { FromWorker, SpeedSetting, ToWorker } from '../worker/protocol.ts';
import { notify, store } from './store.ts';

/** Side the player asked for with ?side=, else the coalition, else the first side. */
const requestedSide = new URLSearchParams(location.search).get('side');

/** Strategic events already seen, so only new crises pop up as toasts. */
let seenLog = 0;

const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: ToWorker) => worker.postMessage(msg);

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'ready':
      store.set({ scenario: msg.scenario });
      return;
    case 'battleOpened':
      store.set({ battle: msg.battle, view: 'tactical', tacticalSelection: [], tacticalMode: 'select' });
      return;
    case 'snapshot': {
      const { selection, playerSide } = store.get();
      if (playerSide === null && msg.summary.sides.length > 1) {
        const ids = msg.summary.sides.map((s) => s.id);
        const side = ids.find((id) => id === requestedSide) ?? ids.find((id) => id === 'coalition') ?? ids[0]!;
        store.set({ playerSide: side });
        // The player commands their side; the AI keeps running the others.
        if (msg.summary.sides.find((s) => s.id === side)?.ai) post({ type: 'command', command: { type: 'setAiControl', side, controlled: false } });
      }
      // Drop a selection whose formation was just expanded or collapsed away.
      const gone = selection?.kind === 'formation' && !msg.summary.active.some((f) => f.id === selection.id);
      store.set({ summary: msg.summary, speed: msg.speed, ...(gone ? { selection: null, mode: 'select' as const } : {}) });
      // The watched battle has ended: collapse back to the theater.
      const watched = store.get().battle;
      if (watched !== null && !msg.summary.battles.some((b) => b.id === watched)) {
        notify('The battle is over; its divisions are back under theater command.');
        store.set((s) => ({ battle: null, tacticalSelection: [], view: s.view === 'tactical' ? 'theater' : s.view }));
        post({ type: 'watch', battle: null });
      }
      const log = msg.summary.strategy?.log ?? [];
      const latest = log[0] ? log[0].tick * 1000 + log.length : 0;
      if (seenLog !== 0 && latest !== seenLog) {
        for (const e of log.filter((x) => x.kind === 'crisis' && x.tick >= msg.summary.tick - 96).slice(0, 2)) notify(e.text, 'error');
      }
      seenLog = latest || seenLog || 1;
      return;
    }
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

export const sim = {
  load: (scenario: string) => post({ type: 'init', scenario }),
  send: (command: Command) => post({ type: 'command', command }),
  setSpeed: (speed: SpeedSetting) => post({ type: 'speed', speed }),
};

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
