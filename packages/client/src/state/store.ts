// A tiny external store: React panels read it through useApp, the Pixi view
// subscribes to it directly so map redraws never go through React.
import { useSyncExternalStore } from 'react';
import type { WorldSummary } from '@tow/sim';
import type { Selection } from '../views/theater/hit.ts';
import type { Mode } from '../views/theater/TheaterView.ts';
import type { ScenarioInfo, SpeedSetting } from '../worker/protocol.ts';

export interface Message {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

export interface AppState {
  scenario: ScenarioInfo | null;
  summary: WorldSummary | null;
  /** The side the player commands; null when there is only one side or none chosen. */
  playerSide: string | null;
  speed: SpeedSetting;
  selection: Selection | null;
  mode: Mode;
  messages: Message[];
  /** Which command level is on screen. */
  view: 'theater' | 'strategic' | 'tactical';
  /** The detailed battle being watched, if any. */
  battle: string | null;
  /** Battalions selected in the tactical view. */
  tacticalSelection: string[];
  tacticalMode: TacticalMode;
  /** When the player asked to switch level (performance.now()), until the new view has drawn. */
  switchStart: number | null;
  /** How long the last switch in each direction took, ms. */
  switchMs: { in: number | null; out: number | null };
  /** Ask the map to centre on a point; `seq` changes on every request. */
  focus: { x: number; y: number; seq: number } | null;
}

export type TacticalMode = 'select' | 'move' | 'attack';

type Listener = () => void;

export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      for (const l of listeners) l();
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export const store = createStore<AppState>({
  scenario: null,
  summary: null,
  playerSide: null,
  speed: 0,
  selection: null,
  mode: 'select',
  view: 'theater',
  battle: null,
  tacticalSelection: [],
  tacticalMode: 'select',
  switchStart: null,
  switchMs: { in: null, out: null },
  messages: [],
  focus: null,
});

/** Subscribe a component to one slice of state. Selectors must return stable values. */
export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

let nextMessageId = 1;
export function notify(text: string, kind: Message['kind'] = 'info') {
  const id = nextMessageId++;
  store.set((s) => ({ messages: [...s.messages.slice(-3), { id, text, kind }] }));
  setTimeout(() => store.set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })), 5000);
}

export function select(selection: Selection | null) {
  store.set({ selection, mode: 'select' });
}

export function focusOn(p: { x: number; y: number }) {
  store.set((s) => ({ focus: { ...p, seq: (s.focus?.seq ?? 0) + 1 } }));
}
