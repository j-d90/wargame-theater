import { useState } from 'react';
import type { SpeedSetting } from '../worker/protocol.ts';
import { DEPTH, type DepthPreset } from '../worker/protocol.ts';
import { exportGame, leaveBattle, nextDecision, quitToMenu, saveGame, setDepth, sim, watchBattle } from '../state/sim.ts';
import { store, useApp } from '../state/store.ts';
import { calendarDate, clock } from './format.ts';

const SPEED_BUTTONS: { speed: SpeedSetting; label: string; title: string }[] = [
  { speed: 0, label: '❚❚', title: 'Pause (Space)' },
  { speed: 1, label: '▸', title: '15 game minutes per second (1)' },
  { speed: 2, label: '▶', title: '1 game hour per second (2)' },
  { speed: 3, label: '▶▶', title: '6 game hours per second (3)' },
  { speed: 4, label: '▶▶▶', title: '1 game day per second (4)' },
  { speed: 5, label: '⏩', title: 'As fast as possible (5)' },
];

function GameMenu() {
  const [open, setOpen] = useState(false);
  const replaying = useApp((s) => s.phase === 'replay');
  const day = useApp((s) => Math.floor((s.summary?.tick ?? 0) / 96));
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="menu">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        Menu
      </button>
      {open && (
        <div className="menu-items" role="menu">
          {!replaying && (
            <button role="menuitem" onClick={act(() => saveGame(window.prompt('Name this save', `Day ${day}`) ?? `Day ${day}`))}>
              Save game
            </button>
          )}
          <button role="menuitem" onClick={act(exportGame)}>
            {replaying ? 'Export this replay' : 'Export save file'}
          </button>
          <button role="menuitem" onClick={act(() => store.set({ showHelp: true }))}>
            Keyboard shortcuts (?)
          </button>
          <button role="menuitem" onClick={act(quitToMenu)}>
            {replaying ? 'Leave the replay' : 'Quit to the start screen'}
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const name = useApp((s) => s.scenario?.name ?? 'Loading…');
  const days = useApp((s) => s.scenario?.days ?? 0);
  const tick = useApp((s) => s.summary?.tick ?? 0);
  const speed = useApp((s) => s.speed);
  const startDate = useApp((s) => s.summary?.startDate ?? null);
  const { day, time } = clock(tick);
  const date = calendarDate(startDate, day);
  const hasStrategy = useApp((s) => s.summary?.strategy != null);
  const view = useApp((s) => s.view);
  const ceasefire = useApp((s) => s.summary?.strategy?.ceasefire.tick != null);
  const battle = useApp((s) => s.battle);
  const firstBattle = useApp((s) => s.summary?.battles[0]?.id ?? null);
  const phase = useApp((s) => s.phase);
  const depth = useApp((s) => s.depth);
  const resolving = useApp((s) => s.resolving);
  const levels = [...(hasStrategy ? (['strategic'] as const) : []), 'theater' as const, ...(battle || firstBattle ? (['tactical'] as const) : [])];
  const LABELS = { strategic: 'Strategic', theater: 'Theater', tactical: 'Tactical' };
  const go = (v: (typeof levels)[number]) => {
    if (v === view) return;
    if (v === 'tactical') watchBattle(battle ?? firstBattle!);
    else if (view === 'tactical') {
      leaveBattle();
      store.set({ view: v });
    } else store.set({ view: v });
  };

  return (
    <header className="topbar">
      <div className="title">
        <strong>Theater of War</strong>
        <span className="scenario">{name}</span>
        {phase === 'replay' && <span className="replay-badge">Replay</span>}
      </div>
      {levels.length > 1 && (
        <div className="levels" role="tablist" aria-label="Command level">
          {levels.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => go(v)}>
              {LABELS[v]}
            </button>
          ))}
        </div>
      )}
      {ceasefire && <span className="ceasefire">Cease-fire</span>}
      <div className="clock" aria-live="off">
        <span className="day">{date ?? `Day ${day}`}</span>
        {date && <span className="of">day {day}</span>}
        <span className="time">{time}</span>
        <span className="of">of {days}</span>
      </div>
      {phase === 'playing' && (
        <label className="depth-select" title="How much you play yourself, and how often the clock stops for you">
          <select value={depth} onChange={(e) => setDepth(e.target.value as DepthPreset)}>
            {(Object.keys(DEPTH) as DepthPreset[]).map((d) => (
              <option key={d} value={d}>
                {DEPTH[d].label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="speed" role="group" aria-label="Time controls">
        {SPEED_BUTTONS.map((b) => (
          <button key={b.speed} className={speed === b.speed && !resolving ? 'active' : ''} title={b.title} onClick={() => sim.setSpeed(b.speed)}>
            {b.label}
          </button>
        ))}
        <button title="Run one game hour (.)" onClick={sim.step}>
          +1h
        </button>
        {phase === 'playing' && (
          <button className={resolving ? 'resolving active' : 'next'} title="Skip ahead to the next moment that needs you (N)" onClick={nextDecision}>
            {resolving ? 'Skipping… ✕' : 'Next decision ⏭'}
          </button>
        )}
      </div>
      <GameMenu />
    </header>
  );
}
