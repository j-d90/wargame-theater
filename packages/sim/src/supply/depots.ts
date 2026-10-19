// Mobile depots drive forward behind advancing forces, in a straight line
// across country. Links follow them, since links join nodes, not places.

import type { Position } from '@tow/content';
import { TICKS_PER_DAY } from '../core/time.ts';
import { sortedIds, type WorldState } from '../core/world.ts';
import { distanceKm } from '../command/movement.ts';

export function moveDepot(world: WorldState, id: string, to: Position): void {
  const n = world.supply.nodes[id];
  if (!n) throw new Error(`moveDepot: unknown node "${id}"`);
  if (!n.mobile) throw new Error(`moveDepot: "${n.name}" is not mobile`);
  n.moveTo = { ...to };
}

export function depotPhase(world: WorldState): void {
  for (const id of sortedIds(world.supply.nodes)) {
    const n = world.supply.nodes[id]!;
    if (!n.moveTo || n.disrupted) continue;
    const step = n.speedKmPerDay / TICKS_PER_DAY;
    const d = distanceKm(n.position, n.moveTo);
    if (d <= step) {
      n.position = n.moveTo;
      n.moveTo = null;
    } else {
      const k = step / d;
      n.position = { x: n.position.x + (n.moveTo.x - n.position.x) * k, y: n.position.y + (n.moveTo.y - n.position.y) * k };
    }
  }
}
