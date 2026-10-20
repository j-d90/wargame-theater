import type { FormationSummary, WorldSummary } from '@tow/sim';
import { openBattle, sim, watchBattle } from '../state/sim.ts';
import { focusOn, select, store, useApp } from '../state/store.ts';
import { statusColor } from '../views/theater/style.ts';
import { calendarDate, capitalize, daysOfSupply, pct } from './format.ts';
import { AIR_KEYS, rebalance, type AirKey } from './allocation.ts';

const AIR_LABELS: Record<AirKey, string> = {
  counterAir: 'Counter-air',
  interdiction: 'Interdiction',
  attrition: 'Strikes on units',
  support: 'Close support',
  scudHunt: 'Missile hunt',
  strategic: 'Strategic',
};

export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

export function Bar({ label, permille, detail }: { label: string; permille: number; detail?: string }) {
  return (
    <div className="bar">
      <div className="bar-label">
        <span>{label}</span>
        <span>{detail ?? pct(permille)}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.min(100, permille / 10)}%`, background: css(statusColor(permille)) }} />
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const COLLAPSIBLE = new Set(['corps', 'division', 'brigade', 'battalion']);

export const STATUS: Record<FormationSummary['status'], string> = {
  active: 'Active',
  retreating: 'Falling back',
  surrendered: 'Surrendered',
  destroyed: 'Destroyed',
  withdrawn: 'Withdrawn by its government',
};

function FormationPanel({ f, summary }: { f: FormationSummary; summary: WorldSummary }) {
  const mode = useApp((s) => s.mode);
  const playerSide = useApp((s) => s.playerSide);
  const side = summary.sides.find((x) => x.id === f.side);
  // With opposing sides you only command your own; enemy units can be inspected.
  const commandable = playerSide === null || f.side === playerSide;
  const node = summary.nodes.find((n) => n.id === f.supplyNode);
  const remaining = f.path.reduce(
    (acc, wp) => ({ km: acc.km + Math.hypot(wp.x - acc.at.x, wp.y - acc.at.y), at: wp }),
    { km: 0, at: f.position },
  ).km;
  const status =
    f.path.length === 0
      ? 'Holding position'
      : f.kmPerDay === 0
        ? `Stalled, ${Math.round(remaining)} km to go`
        : `Moving, ${Math.round(remaining)} km to go (~${Math.max(1, Math.round(remaining / f.kmPerDay))} d)`;

  return (
    <section className="panel-body">
      <div className="panel-title">
        <h2>{f.name}</h2>
        <span className="subtitle">
          {capitalize(f.echelon)}
          {f.branch ? ` · ${f.branch}` : ''}
          {f.aggregated ? ' · aggregated' : ''}
        </span>
        {summary.sides.length > 1 && side && (
          <span className="side-tag" style={{ background: side.color }}>
            {side.name}
          </span>
        )}
      </div>
      {summary.sides.length > 1 && (
        <p className={`status ${f.inContact ? 'warn' : ''}`}>
          {STATUS[f.status]}
          {f.inContact ? ' · in contact with the enemy' : ''}
          {f.fortification > 0 ? ` · dug in ${pct(f.fortification)}` : ''}
        </p>
      )}
      <p className={`status ${f.path.length > 0 && f.kmPerDay === 0 ? 'warn' : ''}`}>{f.battle ? (f.orderKind ? `Ordered to ${f.orderKind}` : 'Holding its ground') : status}</p>
      {f.battle && (
        <p className="status warn">
          In a battle fought battalion by battalion ({summary.battles.find((b) => b.id === f.battle)?.name ?? 'battle'}) ·{' '}
          <button className="link" onClick={() => watchBattle(f.battle!)} title="Zoom in (B)">
            View battle
          </button>
        </p>
      )}
      {!f.battle && f.inContact && (
        <div className="actions">
          <button className="primary" onClick={() => openBattle(f.id)} title="Zoom in: fight this battle battalion by battalion (B)">
            Fight battle in detail
          </button>
        </div>
      )}
      {!f.inSupplyRange && (
        <p className="alert">
          Out of supply range: {f.supplyDistanceKm ?? '?'} km from {node?.name ?? 'its depot'} (max {summary.supplyRangeKm} km)
        </p>
      )}

      <Bar label="Readiness" permille={f.readiness} />
      <Bar label="Morale" permille={f.morale} />
      <Bar label="Supply carried" permille={f.supplyLevel} detail={`${pct(f.supplyLevel)} · ${daysOfSupply(f.stock, f.supplyPerTick)}`} />
      <div className="stats">
        <Stat label="Strength" value={f.strength} />
        <Stat label="Combat power" value={f.combatPower} />
        <Stat label="Mobility" value={pct(f.mobility)} />
        <Stat label="Pace now" value={`${f.kmPerDay} km/d`} />
        {summary.sides.length > 1 && <Stat label="Quality" value={pct(f.quality)} />}
        {summary.sides.length > 1 && <Stat label="Losses" value={`${pct(((f.establishment - f.strength) * 1000) / Math.max(1, f.establishment))}`} />}
      </div>
      <div className="supply-source">
        Draws from <button className="link" onClick={() => node && (select({ kind: 'node', id: node.id }), focusOn(node.position))}>{node?.name ?? '—'}</button>
        {f.supplyDistanceKm !== null && ` · ${f.supplyDistanceKm} km`}
      </div>

      {commandable && (
        <div className="actions">
          <button className={mode === 'move' ? 'primary active' : 'primary'} onClick={() => store.set({ mode: mode === 'move' ? 'select' : 'move' })} title="Then click the map (M)">
            {mode === 'move' ? 'Click destination…' : 'Move'}
          </button>
          <button disabled={f.path.length === 0} onClick={() => sim.send({ type: 'halt', formation: f.id })} title="Stop where it is (H)">
            Halt
          </button>
          {f.hasChildren && f.aggregated && <button onClick={() => sim.send({ type: 'expand', formation: f.id })}>Expand</button>}
          {!f.battle && f.parentId && f.parentEchelon && COLLAPSIBLE.has(f.parentEchelon) && (
            <button onClick={() => sim.send({ type: 'aggregate', formation: f.parentId! })}>Collapse into {f.parentName}</button>
          )}
        </div>
      )}
    </section>
  );
}

function NodePanel({ id, summary }: { id: string; summary: WorldSummary }) {
  const n = summary.nodes.find((x) => x.id === id);
  if (!n) return null;
  const links = summary.links.filter((l) => l.from === id || l.to === id);
  const users = summary.active.filter((f) => f.supplyNode === id);
  const nodeName = (nid: string) => summary.nodes.find((x) => x.id === nid)?.name ?? nid;
  return (
    <section className="panel-body">
      <div className="panel-title">
        <h2>{n.name}</h2>
        <span className="subtitle">{n.kind === 'source' ? 'Supply source' : 'Depot'}</span>
      </div>
      {n.disrupted && <p className="alert">Disrupted: not receiving, issuing, or shipping supply.</p>}
      <Bar label="Stock" permille={n.capacity > 0 ? (n.stock * 1000) / n.capacity : 0} detail={`${n.stock} / ${n.capacity}`} />
      <h3>Links</h3>
      <ul className="list">
        {links.map((l) => (
          <li key={l.id}>
            <button className="link" onClick={() => select({ kind: 'link', id: l.id })}>
              {l.from === id ? `→ ${nodeName(l.to)}` : `← ${nodeName(l.from)}`}
            </button>
            <span className={l.disrupted ? 'bad' : ''}>{l.disrupted ? 'cut' : `${l.flow}/${l.capacity}`}</span>
          </li>
        ))}
      </ul>
      <h3>Supplies</h3>
      <ul className="list">
        {users.length === 0 && <li className="muted">No active formations</li>}
        {users.map((f) => (
          <li key={f.id}>
            <button className="link" onClick={() => (select({ kind: 'formation', id: f.id }), focusOn(f.position))}>
              {f.name}
            </button>
            <span className={f.inSupplyRange ? '' : 'bad'}>{f.inSupplyRange ? pct(f.supplyLevel) : 'out of range'}</span>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className={n.disrupted ? 'primary' : 'danger'} onClick={() => sim.send({ type: 'setDisrupted', target: { kind: 'node', id }, disrupted: !n.disrupted })}>
          {n.disrupted ? 'Restore' : 'Disrupt'}
        </button>
      </div>
    </section>
  );
}

function LinkPanel({ id, summary }: { id: string; summary: WorldSummary }) {
  const l = summary.links.find((x) => x.id === id);
  if (!l) return null;
  const from = summary.nodes.find((n) => n.id === l.from);
  const to = summary.nodes.find((n) => n.id === l.to);
  return (
    <section className="panel-body">
      <div className="panel-title">
        <h2>
          {from?.name} → {to?.name}
        </h2>
        <span className="subtitle">Supply link · {l.mode}</span>
      </div>
      {l.disrupted && <p className="alert">Cut: nothing moves along this link.</p>}
      <Bar label="Flow" permille={l.capacity > 0 ? (l.flow * 1000) / l.capacity : 0} detail={`${l.flow} / ${l.capacity} per tick`} />
      <div className="stats">
        <Stat label="Efficiency today" value={pct(l.efficiency)} />
      </div>
      <div className="actions">
        <button className={l.disrupted ? 'primary' : 'danger'} onClick={() => sim.send({ type: 'setDisrupted', target: { kind: 'link', id }, disrupted: !l.disrupted })}>
          {l.disrupted ? 'Restore link' : 'Cut link'}
        </button>
      </div>
    </section>
  );
}

function Campaign({ summary }: { summary: WorldSummary }) {
  const playerSide = useApp((s) => s.playerSide);
  const mine = summary.sides.find((s) => s.id === playerSide);
  const names = new Map(summary.sides.map((s) => [s.id, s]));
  const air = mine?.air;
  const aiRuns = mine?.ai?.controlled ?? false;
  return (
    <>
      <h3>Forces</h3>
      {summary.sides.map((s) => (
        <div key={s.id} className="side-row">
          <span className="side-tag" style={{ background: s.color }}>
            {s.name}
          </span>
          <Bar label="Combat power" permille={s.combatPowerRatio} />
          <div className="side-stats">
            {s.formations} formations · lost {s.losses} · surrendered {s.surrendered}
            {s.air ? ` · air force ${pct(s.air.pool)}, superiority ${pct(s.air.superiority)}` : ''}
            {s.ai?.controlled ? ` · AI: ${s.ai.phase}` : ''}
          </div>
        </div>
      ))}
      {summary.battles.length > 0 && (
        <>
          <h3>Battles fought in detail</h3>
          <ul className="list">
            {summary.battles.map((b) => (
              <li key={b.id}>
                <button className="link" onClick={() => watchBattle(b.id)}>
                  {b.name}
                </button>
                <span>{b.sides.reduce((n, x) => n + x.units, 0)} battalions</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Objectives</h3>
      <ul className="list">
        {summary.objectives.map((o) => {
          const holder = o.holder ? names.get(o.holder) : undefined;
          return (
            <li key={o.id}>
              <button className="link" onClick={() => focusOn(o.position)}>
                {o.name}
              </button>
              <span style={{ color: holder?.color }}>
                {holder?.name ?? '—'}
                {o.capturedTick !== null ? ` (${calendarDate(summary.startDate, Math.floor(o.capturedTick / 96)) ?? `day ${Math.floor(o.capturedTick / 96)}`})` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {mine?.ai && (
        <label className="toggle">
          <input type="checkbox" checked={aiRuns} onChange={(e) => sim.send({ type: 'setAiControl', side: mine.id, controlled: e.target.checked })} />
          AI commands the {mine.name} (watch it auto-resolve)
        </label>
      )}
      {air && (
        <>
          <h3>{mine.name} air effort · {air.sorties} sorties today</h3>
          {AIR_KEYS.map((k) => (
            <div key={k} className="slider">
              <span>{AIR_LABELS[k]}</span>
              <input
                type="range"
                min={0}
                max={1000}
                step={50}
                value={air.allocation[k]}
                disabled={aiRuns}
                onChange={(e) => sim.send({ type: 'setAirAllocation', side: mine.id, allocation: rebalance(air.allocation, k, Number(e.target.value)) })}
              />
              <span className="value">{pct(air.allocation[k])}</span>
            </div>
          ))}
          {aiRuns && <p className="muted">The AI is setting the air effort.</p>}
        </>
      )}
    </>
  );
}

function Overview({ summary }: { summary: WorldSummary }) {
  const description = useApp((s) => s.scenario?.description ?? '');
  const playerSide = useApp((s) => s.playerSide);
  const units = summary.active.filter((f) => playerSide === null || f.side === playerSide).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="panel-body">
      <p className="muted">{description}</p>
      <p className="help">
        Click a unit, depot, or supply line to inspect it. Drag to pan, scroll or pinch to zoom. <kbd>Space</kbd> pauses, <kbd>1</kbd>–<kbd>3</kbd> set speed.
      </p>
      {summary.sides.length > 1 && <Campaign summary={summary} />}
      <h3>{summary.sides.length > 1 ? 'Your formations' : 'Formations'}</h3>
      <ul className="list">
        {units.map((f) => (
          <li key={f.id}>
            <button className="link" onClick={() => (select({ kind: 'formation', id: f.id }), focusOn(f.position))}>
              {f.name}
            </button>
            <span className="dots">
              <i style={{ background: css(statusColor(f.readiness)) }} title={`Readiness ${pct(f.readiness)}`} />
              <i style={{ background: css(statusColor(f.inSupplyRange ? f.supplyLevel : 0)) }} title={`Supply ${pct(f.supplyLevel)}`} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SidePanel() {
  const summary = useApp((s) => s.summary);
  const selection = useApp((s) => s.selection);
  if (!summary) return <aside className="side">Loading…</aside>;
  const formation = selection?.kind === 'formation' ? summary.active.find((f) => f.id === selection.id) : undefined;
  return (
    <aside className="side">
      {selection && (
        <button className="close" onClick={() => select(null)} aria-label="Close">
          ×
        </button>
      )}
      {formation && <FormationPanel f={formation} summary={summary} />}
      {selection?.kind === 'node' && <NodePanel id={selection.id} summary={summary} />}
      {selection?.kind === 'link' && <LinkPanel id={selection.id} summary={summary} />}
      {!selection && <Overview summary={summary} />}
    </aside>
  );
}
