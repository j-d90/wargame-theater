import type { FormationSummary, TacticalSummary, WorldSummary } from '@tow/sim';
import { closeBattle, leaveBattle, sim } from '../state/sim.ts';
import { store, useApp } from '../state/store.ts';
import { Bar, STATUS, Stat } from './SidePanel.tsx';
import { capitalize, duration, pct } from './format.ts';

/** The battle root (division) a battalion belongs to. Generated battalion ids extend their division's. */
function rootOf(t: TacticalSummary, u: FormationSummary): string | undefined {
  return t.battle.roots.find((r) => u.id === r || u.id.startsWith(`${r}/`));
}

function OrderButtons({ ids, manual }: { ids: string[]; manual: boolean }) {
  const mode = useApp((s) => s.tacticalMode);
  const toggle = (m: 'move' | 'attack') => store.set({ tacticalMode: mode === m ? 'select' : m });
  return (
    <div className="actions">
      <button className={mode === 'move' ? 'primary active' : 'primary'} onClick={() => toggle('move')} title="Then click the map (M)">
        {mode === 'move' ? 'Click destination…' : 'Move'}
      </button>
      <button className={mode === 'attack' ? 'danger active' : 'danger'} onClick={() => toggle('attack')} title="Then click the map (A)">
        {mode === 'attack' ? 'Click target…' : 'Attack'}
      </button>
      <button onClick={() => ids.forEach((id) => sim.send({ type: 'tacticalOrder', formation: id, order: 'hold' }))} title="Stop and hold (H)">
        Hold
      </button>
      {manual && (
        <button onClick={() => ids.forEach((id) => sim.send({ type: 'tacticalOrder', formation: id, order: 'auto' }))} title="Follow the division's orders again (U)">
          Back to division orders
        </button>
      )}
    </div>
  );
}

function Battalion({ u, t, summary, mine }: { u: FormationSummary; t: TacticalSummary; summary: WorldSummary; mine: boolean }) {
  const root = summary.active.find((f) => f.id === rootOf(t, u));
  const side = summary.sides.find((s) => s.id === u.side);
  return (
    <>
      <div className="panel-title">
        <h2>{u.name}</h2>
        <span className="subtitle">
          {capitalize(u.branch ?? 'unit')} battalion · {u.parentName}
          {root && root.id !== u.parentId ? `, ${root.name}` : ''}
        </span>
        {side && (
          <span className="side-tag" style={{ background: side.color }}>
            {side.name}
          </span>
        )}
      </div>
      <p className={`status ${u.inContact ? 'warn' : ''}`}>
        {STATUS[u.status]}
        {u.inContact ? ' · engaged' : ''}
        {u.orderKind ? ` · ${u.orderKind === 'attack' ? 'attacking' : u.orderKind === 'retreat' ? 'falling back' : 'moving'}` : ''}
      </p>
      {mine && <p className="muted">{u.manual ? 'Under your direct command.' : `Following ${root?.name ?? 'its division'}'s orders.`}</p>}
      <Bar label="Strength" permille={u.establishment > 0 ? (u.strength * 1000) / u.establishment : 0} detail={`${u.strength} / ${u.establishment}`} />
      <Bar label="Morale" permille={u.morale} />
      <Bar label="Readiness" permille={u.readiness} />
      <div className="stats">
        <Stat label="Range" value={`${u.rangeKm} km`} />
        <Stat label="Combat power" value={u.combatPower} />
        <Stat label="Dug in" value={pct(u.fortification)} />
        <Stat label="Supply" value={pct(u.supplyLevel)} />
      </div>
      {mine && <OrderButtons ids={[u.id]} manual={u.manual} />}
    </>
  );
}

export function TacticalPanel() {
  const summary = useApp((s) => s.summary);
  const battle = useApp((s) => s.battle);
  const selection = useApp((s) => s.tacticalSelection);
  const playerSide = useApp((s) => s.playerSide);
  const switchMs = useApp((s) => s.switchMs);
  const t = summary?.tactical && summary.tactical.battle.id === battle ? summary.tactical : null;
  if (!summary || !t) return <aside className="side">Opening the battle…</aside>;
  const b = t.battle;
  const selected = t.units.filter((u) => selection.includes(u.id));
  const isMine = (u: FormationSummary) => playerSide === null || u.side === playerSide;
  const myRoots = summary.active.filter((f) => b.roots.includes(f.id) && (playerSide === null || f.side === playerSide));

  return (
    <aside className="side">
      <section className="panel-body">
        <div className="panel-title">
          <h2>{b.name}</h2>
          <span className="subtitle">
            Fought in detail for {duration(summary.tick - b.openedTick)} · {b.radiusKm * 2} km across
          </span>
        </div>
        <div className="actions">
          <button onClick={leaveBattle} title="Zoom out; the battle carries on in detail (Esc)">
            Back to theater
          </button>
          <button onClick={() => closeBattle(b.id)} title="Collapse the battalions back into their divisions and resolve the fight in aggregate">
            Resolve in aggregate
          </button>
        </div>
        {b.sides.map((s) => {
          const side = summary.sides.find((x) => x.id === s.side);
          return (
            <div key={s.side} className="side-row">
              <span className="side-tag" style={{ background: side?.color }}>
                {side?.name ?? s.side}
              </span>
              <Bar label="Strength in the battle" permille={s.start > 0 ? (s.strength * 1000) / s.start : 0} detail={`${s.strength} / ${s.start}`} />
              <div className="side-stats">{s.units} battalions</div>
            </div>
          );
        })}

        {selected.length === 1 && <Battalion u={selected[0]!} t={t} summary={summary} mine={isMine(selected[0]!)} />}
        {selected.length > 1 && (
          <>
            <div className="panel-title">
              <h2>{selected.length} battalions</h2>
              <span className="subtitle">Orders keep them in formation</span>
            </div>
            <Bar
              label="Strength"
              permille={(selected.reduce((a, u) => a + u.strength, 0) * 1000) / Math.max(1, selected.reduce((a, u) => a + u.establishment, 0))}
            />
            <Bar label="Morale" permille={selected.reduce((a, u) => a + u.morale * u.strength, 0) / Math.max(1, selected.reduce((a, u) => a + u.strength, 0))} />
            <OrderButtons ids={selected.filter(isMine).map((u) => u.id)} manual={selected.some((u) => u.manual)} />
          </>
        )}
        {selected.length === 0 && (
          <>
            <p className="help">
              Click a battalion, or <kbd>Shift</kbd>-drag to select several. Your battalions follow their division's orders until you give them one of your own. Thin lines show who is
              firing on whom.
            </p>
            {myRoots.length > 0 && <h3>Your divisions here</h3>}
            <ul className="list">
              {myRoots.map((f) => (
                <li key={f.id}>
                  <button className="link" onClick={() => store.set({ tacticalSelection: t.units.filter((u) => rootOf(t, u) === f.id).map((u) => u.id) })}>
                    {f.name}
                  </button>
                  <span>
                    {pct((f.strength * 1000) / Math.max(1, f.establishment))} · {f.orderKind ?? 'holding'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted switch-time">
          {switchMs.in !== null && `Zoomed in in ${Math.round(switchMs.in)} ms`}
          {switchMs.out !== null && ` · out in ${Math.round(switchMs.out)} ms`}
        </p>
      </section>
    </aside>
  );
}
