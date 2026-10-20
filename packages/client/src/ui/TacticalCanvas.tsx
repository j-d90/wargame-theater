import { useEffect, useRef } from 'react';
import { TacticalView } from '../views/tactical/TacticalView.ts';
import { mapAssets } from '../views/theater/maps.ts';
import { sim } from '../state/sim.ts';
import { store, useApp } from '../state/store.ts';

/** Send each selected battalion to `to`, keeping their places relative to one another. */
export function orderSelected(kind: 'move' | 'attack', to: { x: number; y: number }) {
  const { summary, tacticalSelection } = store.get();
  const units = summary?.tactical?.units.filter((u) => tacticalSelection.includes(u.id)) ?? [];
  if (units.length === 0) return;
  const cx = units.reduce((a, u) => a + u.position.x, 0) / units.length;
  const cy = units.reduce((a, u) => a + u.position.y, 0) / units.length;
  for (const u of units) {
    sim.send({ type: 'tacticalOrder', formation: u.id, order: kind, to: { x: to.x + u.position.x - cx, y: to.y + u.position.y - cy } });
  }
}

export function TacticalCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const mapId = useApp((s) => s.scenario?.mapId ?? null);
  const loaded = useApp((s) => s.scenario !== null);

  useEffect(() => {
    if (!host.current || !loaded) return;
    const view = new TacticalView(mapAssets(mapId), {
      onClick(point, unit, add) {
        const { tacticalMode, tacticalSelection, summary, playerSide } = store.get();
        if (tacticalMode !== 'select') {
          orderSelected(tacticalMode, point);
          store.set({ tacticalMode: 'select' });
          return;
        }
        if (!unit) {
          if (!add) store.set({ tacticalSelection: [] });
          return;
        }
        // Enemy battalions can be inspected one at a time but not added to an order group.
        const side = summary?.tactical?.units.find((u) => u.id === unit)?.side;
        const own = playerSide === null || side === playerSide;
        if (add && own) {
          store.set({ tacticalSelection: tacticalSelection.includes(unit) ? tacticalSelection.filter((id) => id !== unit) : [...tacticalSelection, unit] });
        } else store.set({ tacticalSelection: [unit] });
      },
      onBox(units, add) {
        const current = store.get().tacticalSelection;
        store.set({ tacticalSelection: add ? [...new Set([...current, ...units])] : units });
      },
      onShown() {
        const { switchStart, switchMs } = store.get();
        if (switchStart !== null) store.set({ switchStart: null, switchMs: { ...switchMs, in: performance.now() - switchStart } });
      },
    });
    const sync = () => {
      const s = store.get();
      view.setState(s.summary, s.battle, s.tacticalSelection, s.tacticalMode, s.playerSide, s.view === 'tactical' ? s.switchStart : null);
    };
    const unsubscribe = store.subscribe(sync);
    sync();
    void view.init(host.current);
    return () => {
      unsubscribe();
      view.destroy();
    };
  }, [mapId, loaded]);

  return <div className="map" ref={host} />;
}
