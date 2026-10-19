// An objective belongs to whichever side last had formations within its
// radius with no enemy formations there.

import { sortedIds, type WorldState } from '../core/world.ts';
import { activeFormations } from '../command/formations.ts';
import { distanceKm } from '../command/movement.ts';

export function objectivesPhase(world: WorldState): void {
  const ids = sortedIds(world.objectives);
  if (ids.length === 0) return;
  const units = activeFormations(world);
  for (const id of ids) {
    const o = world.objectives[id]!;
    const present = new Set<string>();
    for (const f of units) if (distanceKm(f.position, o.position) <= o.radiusKm) present.add(f.side);
    if (present.size !== 1) continue;
    const [side] = present;
    if (side !== o.holder) {
      o.holder = side!;
      o.capturedTick = world.tick;
    }
  }
}
