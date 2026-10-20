import type { SpeedSetting } from '../worker/protocol.ts';
import { leaveBattle, sim, watchBattle } from '../state/sim.ts';
import { store, useApp } from '../state/store.ts';
import { calendarDate, clock } from './format.ts';

const SPEED_BUTTONS: { speed: SpeedSetting; label: string; title: string }[] = [
  { speed: 0, label: '❚❚', title: 'Pause (Space)' },
  { speed: 1, label: '▶', title: '1 game hour per second (1)' },
  { speed: 2, label: '▶▶', title: '6 game hours per second (2)' },
  { speed: 3, label: '▶▶▶', title: '1 game day per second (3)' },
];

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
      <div className="speed" role="group" aria-label="Time controls">
        {SPEED_BUTTONS.map((b) => (
          <button key={b.speed} className={speed === b.speed ? 'active' : ''} title={b.title} onClick={() => sim.setSpeed(b.speed)}>
            {b.label}
          </button>
        ))}
      </div>
    </header>
  );
}
