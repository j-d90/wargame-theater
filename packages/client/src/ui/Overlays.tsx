import { useState } from 'react';
import { focusOn, store, useApp } from '../state/store.ts';
import { nextDecision, quitToMenu, sim } from '../state/sim.ts';
import { calendarDate, clock, pct } from './format.ts';

/** Replays: a timeline to scrub, with the game's decision points marked on it. */
export function Timeline() {
  const replay = useApp((s) => s.replay);
  const tick = useApp((s) => s.summary?.tick ?? 0);
  const side = useApp((s) => s.playerSide);
  const [dragging, setDragging] = useState<number | null>(null);
  if (!replay) return null;
  const end = Math.max(1, replay.endTick);
  const marks = replay.decisions.filter((d) => d.level !== 'minor' && (d.side === null || d.side === side));
  const at = dragging ?? tick;
  return (
    <div className="timeline">
      <span className="muted">Day {clock(at).day}</span>
      <div className="timeline-track">
        {marks.map((d) => (
          <button
            key={d.id}
            className={`mark ${d.level}`}
            style={{ left: `${(d.tick / end) * 100}%` }}
            title={`Day ${clock(d.tick).day}: ${d.text}`}
            onClick={() => sim.seek(d.tick)}
          />
        ))}
        <input
          type="range"
          min={0}
          max={end}
          value={at}
          aria-label="Replay position"
          onChange={(e) => setDragging(Number(e.target.value))}
          onPointerUp={() => {
            if (dragging !== null) sim.seek(dragging);
            setDragging(null);
          }}
          onKeyUp={() => {
            if (dragging !== null) sim.seek(dragging);
            setDragging(null);
          }}
        />
      </div>
      <span className="muted">day {clock(end).day}</span>
    </div>
  );
}

/** What the clock stopped for, with the way on. */
export function StopBanner() {
  const stop = useApp((s) => s.lastStop);
  const speed = useApp((s) => s.speed);
  const resolving = useApp((s) => s.resolving);
  const phase = useApp((s) => s.phase);
  if (!stop || speed !== 0 || resolving || phase !== 'playing') return null;
  return (
    <div className={`stop-banner ${stop.level}`} role="status">
      <span>
        <strong>Day {clock(stop.tick).day}:</strong> {stop.text}
      </span>
      {stop.at && (
        <button className="link" onClick={() => focusOn(stop.at!)}>
          Show
        </button>
      )}
      <button onClick={nextDecision} title="N">
        Next decision ⏭
      </button>
      <button onClick={() => store.set({ lastStop: null })} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Pause or resume'],
  ['1 – 5', 'Speed: 15 min, 1 hour, 6 hours, 1 day per second, as fast as possible'],
  ['.', 'Run one game hour'],
  ['N', 'Skip ahead to the next decision (again to stop)'],
  ['M / H', 'Move or halt the selected unit'],
  ['B', 'Zoom in on the selected unit’s battle'],
  ['M / A / H / U', 'Tactical: move, attack, hold, back to division orders'],
  ['Shift-drag', 'Tactical: select several battalions'],
  ['Esc', 'Cancel, deselect, then zoom out'],
  ['?', 'This help'],
];

export function HelpOverlay() {
  const show = useApp((s) => s.showHelp);
  if (!show) return null;
  return (
    <div className="overlay" onClick={() => store.set({ showHelp: false })}>
      <div className="dialog" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table className="keys">
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k + v}>
                <th>
                  <kbd>{k}</kbd>
                </th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button className="primary" onClick={() => store.set({ showHelp: false })}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** At the end of the campaign (or once a cease-fire holds): how it went. */
export function EndSummary() {
  const summary = useApp((s) => s.summary);
  const days = useApp((s) => s.scenario?.days ?? 0);
  const seen = useApp((s) => s.endSeen);
  const phase = useApp((s) => s.phase);
  const ceasefire = summary?.strategy?.ceasefire.tick ?? null;
  if (!summary || seen || phase !== 'playing') return null;
  const over = summary.tick >= days * 96 || ceasefire !== null;
  if (!over) return null;
  const date = calendarDate(summary.startDate, clock(summary.tick).day);
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-label="Campaign summary">
        <h2>{ceasefire !== null ? 'Cease-fire' : 'The campaign is over'}</h2>
        <p className="muted">
          {summary.strategy?.ceasefire.reason ?? 'The scenario has run its course.'} {date ? `${date}, ` : ''}day {clock(summary.tick).day}.
        </p>
        <table className="results">
          <thead>
            <tr>
              <th />
              {summary.sides.map((s) => (
                <th key={s.id} style={{ color: s.color }}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Fighting power left</th>
              {summary.sides.map((s) => (
                <td key={s.id}>{pct(s.combatPowerRatio)}</td>
              ))}
            </tr>
            <tr>
              <th>Losses</th>
              {summary.sides.map((s) => (
                <td key={s.id}>{pct(((s.losses + s.surrendered) * 1000) / Math.max(1, s.initialStrength))}</td>
              ))}
            </tr>
            <tr>
              <th>Prisoners taken</th>
              {summary.sides.map((s) => (
                <td key={s.id}>{s.prisonersTaken}</td>
              ))}
            </tr>
            <tr>
              <th>Objectives held</th>
              {summary.sides.map((s) => (
                <td key={s.id}>{summary.objectives.filter((o) => o.holder === s.id).length}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <div className="actions">
          <button className="primary" onClick={() => store.set({ endSeen: true })}>
            Keep watching
          </button>
          <button onClick={quitToMenu}>Start screen</button>
        </div>
      </div>
    </div>
  );
}
