import { useEffect, useRef, useState } from 'react';
import { checkSave } from '@tow/sim';
import { loadGame, newGame, removeSave, watchReplay } from '../state/sim.ts';
import { downloadSave, readSaveFile } from '../state/saves.ts';
import { notify, useApp } from '../state/store.ts';
import { DEPTH, type DepthPreset } from '../worker/protocol.ts';

/** AI competence levels offered at the start. */
export const COMPETENCE: { label: string; value: number }[] = [
  { label: 'Green', value: 250 },
  { label: 'Regular', value: 550 },
  { label: 'Veteran', value: 800 },
  { label: 'Elite', value: 1000 },
];

function SavedGames() {
  const saves = useApp((s) => s.saves);
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'load' | 'replay'>('load');
  const open = async (f: File | undefined) => {
    if (!f) return;
    try {
      const save = checkSave(await readSaveFile(f));
      if (mode === 'load') loadGame(save);
      else watchReplay(save);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    }
  };
  const pick = (m: 'load' | 'replay') => {
    setMode(m);
    file.current?.click();
  };
  return (
    <section className="start-card">
      <h2>Saved games</h2>
      {saves.length === 0 && <p className="muted">No saved games yet. The game autosaves about once a game day.</p>}
      <ul className="save-list">
        {saves.map((r) => (
          <li key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <span className="muted">
                {r.scenarioName} · day {Math.floor(r.tick / 96)} · {new Date(r.savedAt).toLocaleString()}
              </span>
            </div>
            <div className="save-actions">
              <button className="primary" onClick={() => loadGame(r.save)}>
                {r.id === 'autosave' ? 'Continue' : 'Load'}
              </button>
              <button onClick={() => watchReplay(r.save)} title="Watch the game so far from the start">
                Replay
              </button>
              <button onClick={() => downloadSave(r.save, `${r.scenarioName} ${r.name}`)} title="Save as a file">
                Export
              </button>
              <button className="danger" onClick={() => void removeSave(r.id)} aria-label={`Delete ${r.name}`}>
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button onClick={() => pick('load')}>Load a save file…</button>
        <button onClick={() => pick('replay')}>Watch a save file as a replay…</button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </section>
  );
}

export function StartScreen() {
  const scenarios = useApp((s) => s.scenarios);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  const [side, setSide] = useState<string | null>(null);
  const [depth, setDepth] = useState<DepthPreset>('operational');
  const [competence, setCompetence] = useState<Record<string, number>>({});
  const [seed, setSeed] = useState<number | null>(null);

  // Reset the choices when the scenario changes.
  useEffect(() => {
    if (!scenario) return;
    setSide(scenario.sides.find((s) => s.id === 'coalition')?.id ?? scenario.sides[0]?.id ?? null);
    setCompetence({});
    setSeed(null);
  }, [scenario?.id]);

  if (!scenario) return <div className="start">Loading…</div>;
  const others = scenario.sides.filter((s) => s.id !== side && s.ai);
  const start = () => {
    const chosen = Object.fromEntries(Object.entries(competence).filter(([id]) => others.some((o) => o.id === id)));
    newGame(scenario.id, scenario.sides.length > 1 ? side : null, depth, { seed: seed ?? scenario.seed, competence: chosen });
  };

  return (
    <div className="start">
      <header className="start-head">
        <h1>Theater of War</h1>
        <p className="muted">Command a war at any level, from head of state to battle commander, and switch levels mid-game.</p>
      </header>
      <div className="start-grid">
        <section className="start-card">
          <h2>New game</h2>
          <label className="field">
            <span>Scenario</span>
            <select value={scenario.id} onChange={(e) => setScenarioId(e.target.value)}>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">{scenario.description}</p>

          {scenario.sides.length > 1 && (
            <fieldset className="field">
              <legend>You command</legend>
              <div className="choices">
                {scenario.sides.map((s) => (
                  <label key={s.id} className={`choice ${side === s.id ? 'active' : ''}`}>
                    <input type="radio" name="side" checked={side === s.id} onChange={() => setSide(s.id)} />
                    <span className="side-tag" style={{ background: s.color }}>
                      {s.name}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="field">
            <legend>Depth</legend>
            <div className="depth-choices">
              {(Object.keys(DEPTH) as DepthPreset[]).map((d) => (
                <label key={d} className={`depth ${depth === d ? 'active' : ''}`}>
                  <input type="radio" name="depth" checked={depth === d} onChange={() => setDepth(d)} />
                  <strong>{DEPTH[d].label}</strong>
                  <span>{DEPTH[d].blurb}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {others.map((o) => (
            <label key={o.id} className="field">
              <span>{o.name} command</span>
              <select
                value={competence[o.id] ?? 'default'}
                onChange={(e) => setCompetence({ ...competence, [o.id]: Number(e.target.value) })}
              >
                <option value="default">As in the scenario ({COMPETENCE.reduce((best, c) => (Math.abs(c.value - o.ai!.competence) < Math.abs(best.value - o.ai!.competence) ? c : best)).label.toLowerCase()})</option>
                {COMPETENCE.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <label className="field">
            <span>Seed</span>
            <div className="seed">
              <input type="number" value={seed ?? scenario.seed} onChange={(e) => setSeed(Number(e.target.value) | 0)} />
              <button onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))} title="Same seed and orders, same war">
                Random
              </button>
            </div>
          </label>
          <div className="actions">
            <button className="primary big" onClick={start}>
              Start
            </button>
          </div>
        </section>
        <SavedGames />
      </div>
    </div>
  );
}
