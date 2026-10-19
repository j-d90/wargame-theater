// Main-thread side of the sim worker: sends intents, folds replies into the store.
import type { Command } from '@tow/sim';
import type { FromWorker, SpeedSetting, ToWorker } from '../worker/protocol.ts';
import { notify, store } from './store.ts';

/** Side the player asked for with ?side=, else the coalition, else the first side. */
const requestedSide = new URLSearchParams(location.search).get('side');

const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: ToWorker) => worker.postMessage(msg);

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'ready':
      store.set({ scenario: msg.scenario });
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
      return;
    }
    case 'rejected':
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
