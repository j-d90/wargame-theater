// The strategic level: governments and publics, the missile crisis, the rules
// in force, the actions available to your side, and what has happened.
import type { StrategySummary, WorldSummary } from '@tow/sim';
import { sim } from '../state/sim.ts';
import { useApp } from '../state/store.ts';
import { statusColor } from '../views/theater/style.ts';
import { calendarDate, pct } from './format.ts';

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
type Actor = StrategySummary['actors'][number];

const GAUGES: { key: 'support' | 'cohesion' | 'patience' | 'stability'; label: string; help: string }[] = [
  { key: 'support', label: 'Public support', help: 'Falls with casualties, a long war, and harm to civilians.' },
  { key: 'cohesion', label: 'Commitment', help: 'Below its limit, this government pulls its forces out.' },
  { key: 'patience', label: 'Patience', help: 'At zero, this government enters the war.' },
  { key: 'stability', label: 'Regime stability', help: 'Low stability pushes the regime to pull back and save what it can.' },
];

const STATUS: Record<Actor['status'], string> = {
  active: 'At war',
  neutral: 'Neutral',
  intervened: 'Entered the war',
  withdrawn: 'Withdrawn',
};

function Gauge({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <div className="bar" title={help}>
      <div className="bar-label">
        <span>{label}</span>
        <span>{pct(value)}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${value / 10}%`, background: css(statusColor(value)) }} />
      </div>
    </div>
  );
}

function ActorCard({ a, summary }: { a: Actor; summary: WorldSummary }) {
  const side = summary.sides.find((s) => s.id === a.side);
  // Members of a multi-government side are "in the coalition"; a side of one is simply at war.
  const partners = summary.strategy!.actors.filter((x) => x.side !== null && x.side === a.side).length;
  const status = a.status === 'active' && partners > 1 ? `In the ${side?.name.toLowerCase() ?? 'coalition'}` : STATUS[a.status];
  return (
    <div className={`card actor ${a.status}`}>
      <div className="card-head">
        <strong>{a.name}</strong>
        <span className={`badge ${a.status}`}>{status}</span>
      </div>
      {side && (
        <span className="side-tag" style={{ background: side.color }}>
          {side.name}
        </span>
      )}
      {GAUGES.map((g) => (a[g.key] === null ? null : <Gauge key={g.key} label={g.label} value={a[g.key]!} help={g.help} />))}
      {a.withdrawBelow !== null && a.status === 'active' && <div className="muted small">Withdraws below {pct(a.withdrawBelow)}</div>}
    </div>
  );
}

function Missiles({ st, summary }: { st: StrategySummary; summary: WorldSummary }) {
  const m = st.missiles;
  if (!m) return null;
  const names = new Map(m.targets.map((t) => [t.id, t.name]));
  const firing = summary.sides.find((s) => s.id === m.side)?.name ?? m.side;
  return (
    <div className="card">
      <div className="card-head">
        <strong>{firing} missile campaign</strong>
      </div>
      <div className="stats">
        <div className="stat">
          <span>Launchers left</span>
          <strong>{m.launchers}</strong>
        </div>
        <div className="stat">
          <span>Fired / hit</span>
          <strong>
            {m.fired} / {m.hits}
          </strong>
        </div>
        <div className="stat">
          <span>Suppressed today</span>
          <strong>{pct(m.suppression)}</strong>
        </div>
        <div className="stat">
          <span>Patriot batteries</span>
          <strong>
            {Object.values(m.patriotsAt).reduce((a, b) => a + b, 0)} / {m.patriotBatteries}
          </strong>
        </div>
      </div>
      <ul className="list">
        {m.targets.map((t) => (
          <li key={t.id}>
            <span>{t.name}</span>
            <span className="muted">{m.patriotsAt[t.id] ?? 0} Patriot</span>
          </li>
        ))}
      </ul>
      {m.recent.length > 0 && (
        <p className="muted small">
          Last two days:{' '}
          {m.recent
            .slice(-6)
            .map((r) => `${names.get(r.target)}${r.intercepted ? ' (intercepted)' : ''}`)
            .join(', ')}
        </p>
      )}
    </div>
  );
}

function Actions({ st, side }: { st: StrategySummary; side: string }) {
  const actions = st.actions.filter((a) => a.side === side);
  if (actions.length === 0) return null;
  return (
    <div className="actions-grid">
      {actions.map((a) => (
        <div key={a.id} className={`card action ${a.locked ? 'locked' : ''}`}>
          <div className="card-head">
            <strong>{a.name}</strong>
            <span className="escalation" title={`Escalation ${a.escalation} of 5`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <i key={i} className={i <= a.escalation ? 'on' : ''} />
              ))}
            </span>
          </div>
          <p className="small">{a.description}</p>
          <div className="action-foot">
            {a.cost > 0 && <span className="muted small">{a.cost} capital</span>}
            <button
              className={a.locked ? '' : 'primary'}
              disabled={!a.available}
              title={a.reason ?? ''}
              onClick={() => sim.send({ type: 'strategicAction', side, action: a.id })}
            >
              {a.locked ? '🔒 Locked' : 'Do it'}
            </button>
          </div>
          {!a.available && a.reason && <p className={`small ${a.locked ? 'alert' : 'muted'}`}>{a.reason}</p>}
        </div>
      ))}
    </div>
  );
}

export function StrategicView() {
  const summary = useApp((s) => s.summary);
  const playerSide = useApp((s) => s.playerSide);
  const st = summary?.strategy;
  if (!summary || !st) return <div className="strategic">This scenario has no strategic layer.</div>;
  const mySide = summary.sides.find((s) => s.id === playerSide);
  const aiRuns = mySide?.ai?.controlled ?? false;
  return (
    <div className="strategic">
      {st.ceasefire.tick !== null && (
        <div className="banner">
          Cease-fire since {calendarDate(summary.startDate, Math.floor(st.ceasefire.tick / 96))}: {st.ceasefire.reason}.
        </div>
      )}
      <section className="strategic-top">
        <div>
          <h2>Strategic situation</h2>
          {mySide && (
            <p className="muted">
              You command the {mySide.name}. Political capital: <strong>{st.capital[mySide.id] ?? 0}</strong>
              {aiRuns ? ' · the AI is making your decisions' : ''}
            </p>
          )}
        </div>
        <div className="rules">
          <span className="muted small">Rules</span>
          <div className="levels">
            {(['realistic', 'sandbox'] as const).map((m) => (
              <button key={m} className={st.mode === m ? 'active' : ''} onClick={() => sim.send({ type: 'setRulesMode', mode: m })}>
                {m === 'realistic' ? 'Realistic' : 'Sandbox'}
              </button>
            ))}
          </div>
          <span className="muted small">{st.mode === 'realistic' ? 'Escalation locks and legal limits enforced' : 'Locks and legal limits lifted; consequences still apply'}</span>
        </div>
      </section>

      <h3>Governments</h3>
      <div className="actor-grid">
        {st.actors.map((a) => (
          <ActorCard key={a.id} a={a} summary={summary} />
        ))}
      </div>

      <div className="strategic-columns">
        <div>
          {mySide && (
            <>
              <h3>Your options</h3>
              <Actions st={st} side={mySide.id} />
            </>
          )}
          <h3>Missiles</h3>
          <Missiles st={st} summary={summary} />
        </div>
        <div>
          <h3>Events</h3>
          <ul className="log">
            {st.log.map((e, i) => (
              <li key={`${e.tick}-${i}`} className={e.kind}>
                <span className="when">{calendarDate(summary.startDate, Math.floor(e.tick / 96)) ?? `day ${Math.floor(e.tick / 96)}`}</span>
                {e.text}
              </li>
            ))}
            {st.log.length === 0 && <li className="muted">Nothing yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
