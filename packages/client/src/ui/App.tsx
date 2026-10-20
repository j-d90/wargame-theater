import { useEffect } from 'react';
import type { SpeedSetting } from '../worker/protocol.ts';
import { leaveBattle, nextDecision, openBattle, sim, watchBattle } from '../state/sim.ts';
import { select, store, useApp } from '../state/store.ts';
import { MapCanvas } from './MapCanvas.tsx';
import { SidePanel } from './SidePanel.tsx';
import { StrategicView } from './StrategicView.tsx';
import { TacticalCanvas } from './TacticalCanvas.tsx';
import { TacticalPanel } from './TacticalPanel.tsx';
import { TopBar } from './TopBar.tsx';
import { StartScreen } from './StartScreen.tsx';
import { EndSummary, HelpOverlay, StopBanner, Timeline } from './Overlays.tsx';

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
    let lastSpeed: SpeedSetting = 2;
    const onKey = (e: KeyboardEvent) => {
      // Shortcuts work everywhere except while typing in a text field.
      const typing = e.target instanceof HTMLInputElement && !['checkbox', 'range', 'radio', 'button'].includes(e.target.type);
      if (typing || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const { speed, selection, mode, summary, playerSide, view, tacticalMode, tacticalSelection, phase, showHelp } = store.get();
      if (phase === 'setup') return;
      if (showHelp) {
        if (e.key === 'Escape' || e.key === '?') store.set({ showHelp: false });
        return;
      }
      const selected = selection?.kind === 'formation' ? summary?.active.find((f) => f.id === selection.id) : undefined;
      // Order shortcuts only apply to your own formations.
      const formation = selected && (playerSide === null || selected.side === playerSide) ? selected.id : null;
      if (e.key === ' ') {
        e.preventDefault();
        if (speed === 0) sim.setSpeed(lastSpeed);
        else {
          lastSpeed = speed;
          sim.setSpeed(0);
        }
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        sim.setSpeed(Number(e.key) as SpeedSetting);
      } else if (e.key === '.') {
        sim.step();
      } else if (e.key === 'n' || e.key === 'N') {
        nextDecision();
      } else if (e.key === '?') {
        store.set({ showHelp: true });
      } else if (view === 'tactical') {
        const units = summary?.tactical?.units ?? [];
        const mine = tacticalSelection.filter((id) => units.some((u) => u.id === id && (playerSide === null || u.side === playerSide)));
        const key = e.key.toLowerCase();
        if (e.key === 'Escape') {
          // Step back: cancel the order being given, then the selection, then zoom out.
          if (tacticalMode !== 'select') store.set({ tacticalMode: 'select' });
          else if (tacticalSelection.length > 0) store.set({ tacticalSelection: [] });
          else leaveBattle();
        } else if ((key === 'm' || key === 'a') && mine.length > 0) {
          const m = key === 'm' ? 'move' : 'attack';
          store.set({ tacticalMode: tacticalMode === m ? 'select' : m });
        } else if (key === 'h' && mine.length > 0) {
          for (const id of mine) sim.send({ type: 'tacticalOrder', formation: id, order: 'hold' });
        } else if (key === 'u' && mine.length > 0) {
          for (const id of mine) sim.send({ type: 'tacticalOrder', formation: id, order: 'auto' });
        }
      } else if (e.key === 'Escape') {
        if (mode === 'move') store.set({ mode: 'select' });
        else select(null);
      } else if ((e.key === 'b' || e.key === 'B') && selected && view === 'theater') {
        // Zoom in on the selected unit's battle.
        if (selected.battle) watchBattle(selected.battle);
        else if (selected.inContact) openBattle(selected.id);
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

/** Time a switch to the theater or strategic view: from the request to the first frame after it. */
function useSwitchTiming() {
  const view = useApp((s) => s.view);
  useEffect(() => {
    const { switchStart } = store.get();
    if (switchStart === null || view === 'tactical') return;
    const raf = requestAnimationFrame(() => {
      const s = store.get();
      if (s.switchStart === switchStart) store.set({ switchStart: null, switchMs: { ...s.switchMs, out: performance.now() - switchStart } });
    });
    return () => cancelAnimationFrame(raf);
  }, [view]);
}

export function App() {
  useKeyboard();
  useSwitchTiming();
  const view = useApp((s) => s.view);
  const phase = useApp((s) => s.phase);
  if (phase === 'setup') {
    return (
      <div className="app">
        <StartScreen />
        <Toasts />
      </div>
    );
  }
  return (
    <div className="app">
      <TopBar />
      {phase === 'replay' && <Timeline />}
      <StopBanner />
      {/* Both maps stay mounted while another view is up, so switching levels is instant. */}
      <main className="main" hidden={view !== 'theater'}>
        <MapCanvas />
        <SidePanel />
      </main>
      <main className="main" hidden={view !== 'tactical'}>
        <TacticalCanvas />
        <TacticalPanel />
      </main>
      {view === 'strategic' && <StrategicView />}
      <HelpOverlay />
      <EndSummary />
      <Toasts />
    </div>
  );
}
