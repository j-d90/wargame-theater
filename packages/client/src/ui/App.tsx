import { useEffect } from 'react';
import type { SpeedSetting } from '../worker/protocol.ts';
import { sim } from '../state/sim.ts';
import { select, store, useApp } from '../state/store.ts';
import { MapCanvas } from './MapCanvas.tsx';
import { SidePanel } from './SidePanel.tsx';
import { TopBar } from './TopBar.tsx';

function Toasts() {
  const messages = useApp((s) => s.messages);
  return (
    <div className="toasts" role="status">
      {messages.map((m) => (
        <div key={m.id} className={`toast ${m.kind}`}>
          {m.text}
        </div>
      ))}
    </div>
  );
}

function useKeyboard() {
  useEffect(() => {
    let lastSpeed: SpeedSetting = 1;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const { speed, selection, mode, summary } = store.get();
      const formation = selection?.kind === 'formation' ? selection.id : null;
      if (e.key === ' ') {
        e.preventDefault();
        if (speed === 0) sim.setSpeed(lastSpeed);
        else {
          lastSpeed = speed;
          sim.setSpeed(0);
        }
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        sim.setSpeed(Number(e.key) as SpeedSetting);
      } else if (e.key === 'Escape') {
        if (mode === 'move') store.set({ mode: 'select' });
        else select(null);
      } else if ((e.key === 'm' || e.key === 'M') && formation) {
        store.set({ mode: mode === 'move' ? 'select' : 'move' });
      } else if ((e.key === 'h' || e.key === 'H') && formation && summary) {
        sim.send({ type: 'halt', formation });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useKeyboard();
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <MapCanvas />
        <SidePanel />
      </main>
      <Toasts />
    </div>
  );
}
