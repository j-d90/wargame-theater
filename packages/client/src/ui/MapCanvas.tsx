import { useEffect, useRef } from 'react';
import { TheaterView } from '../views/theater/TheaterView.ts';
import { mapAssets } from '../views/theater/maps.ts';
import { openBattle, sim, watchBattle } from '../state/sim.ts';
import { select, store, useApp } from '../state/store.ts';

export function MapCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const mapId = useApp((s) => s.scenario?.mapId ?? null);
  const loaded = useApp((s) => s.scenario !== null);

  useEffect(() => {
    if (!host.current || !loaded) return;
    const view = new TheaterView(mapAssets(mapId), {
      onClick(point, hit) {
        const { mode, selection } = store.get();
        if (mode === 'move' && selection?.kind === 'formation') {
          sim.send({ type: 'move', formation: selection.id, to: point });
          store.set({ mode: 'select' });
          return;
        }
        select(hit);
      },
      onDoubleClick(point, hit, scale) {
        // Zoom in: on a unit in a fight, an engagement, or a battle already fought in detail.
        const sum = store.get().summary;
        if (!sum) return;
        const f = hit?.kind === 'formation' ? sum.active.find((a) => a.id === hit.id) : undefined;
        if (f?.battle) return watchBattle(f.battle);
        if (f?.inContact) return openBattle(f.id);
        const near = (p: { x: number; y: number }) => Math.hypot(p.x - point.x, p.y - point.y) * scale;
        const e = sum.engagements.find((x) => near(x.position) <= 14);
        if (e) return openBattle(e.a);
        const b = sum.battles.find((x) => near(x.center) <= Math.max(x.radiusKm * scale, 14));
        if (b) watchBattle(b.id);
      },
    });
    const sync = () => {
      const s = store.get();
      view.setState(s.summary, s.selection, s.mode, s.playerSide);
    };
    let lastFocus = store.get().focus?.seq ?? 0;
    const unsubscribe = store.subscribe(() => {
      sync();
      const f = store.get().focus;
      if (f && f.seq !== lastFocus) {
        lastFocus = f.seq;
        view.centerOn(f);
      }
    });
    sync();
    void view.init(host.current);
    return () => {
      unsubscribe();
      view.destroy();
    };
  }, [mapId, loaded]);

  return <div className="map" ref={host} />;
}
