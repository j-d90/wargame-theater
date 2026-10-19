// Supply moves one hop per tick. Each node first issues to the formations that
// draw from it, then ships what is left along its outgoing links. Shipments
// arrive at the end of the tick, so nodes are processed against start-of-tick
// stock and the processing order only matters for who claims free space first
// (sorted ids, so it is deterministic). Disruption needs no special handling:
// a cut node or link simply stops moving supply and downstream stock runs dry.

import { distribute } from '../core/distribute.ts';
import { rngStream, sortedIds, type Formation, type SupplyLink, type WorldState } from '../core/world.ts';
import { nextInt } from '../core/rng.ts';
import { activeFormations, effectiveSupplyNode } from '../command/formations.ts';

/** Daily roll of each link's throughput: up to `variance` permille lost. */
export function rollLinkEfficiency(world: WorldState): void {
  const rng = rngStream(world, 'supply');
  for (const id of sortedIds(world.supply.links)) {
    const link = world.supply.links[id]!;
    link.efficiency = 1000 - (link.variance > 0 ? nextInt(rng, 0, link.variance) : 0);
  }
}

export function linkThroughput(link: SupplyLink): number {
  return Math.floor((link.capacityPerTick * link.efficiency) / 1000);
}

export function supplyPhase(world: WorldState): void {
  const { nodes, links } = world.supply;
  const nodeIds = sortedIds(nodes);
  const linkIds = sortedIds(links);

  for (const id of nodeIds) {
    const n = nodes[id]!;
    if (!n.disrupted && n.productionPerTick > 0) n.stock = Math.min(n.capacity, n.stock + n.productionPerTick);
  }

  // Issue to formations.
  const drawers = new Map<string, Formation[]>();
  for (const f of activeFormations(world)) {
    const nodeId = effectiveSupplyNode(world, f.id);
    if (nodeId === null) continue;
    const list = drawers.get(nodeId) ?? [];
    list.push(f);
    drawers.set(nodeId, list);
  }
  for (const id of nodeIds) {
    const n = nodes[id]!;
    const forms = drawers.get(id);
    if (n.disrupted || !forms) continue;
    const deficits = forms.map((f) => f.stats.stockCap - f.stats.stock);
    const total = deficits.reduce((a, b) => a + b, 0);
    const shares = distribute(Math.min(n.stock, total), deficits, deficits);
    forms.forEach((f, i) => {
      f.stats.stock += shares[i]!;
      n.stock -= shares[i]!;
    });
  }

  // Ship along links. `reserved` tracks free space already claimed at each target this tick.
  const outgoing = new Map<string, SupplyLink[]>();
  for (const lid of linkIds) {
    const l = links[lid]!;
    l.lastFlow = 0;
    const list = outgoing.get(l.from) ?? [];
    list.push(l);
    outgoing.set(l.from, list);
  }
  const reserved = new Map<string, number>();
  for (const id of nodeIds) {
    const n = nodes[id]!;
    if (n.disrupted || n.stock === 0) continue;
    const out = (outgoing.get(id) ?? []).filter((l) => !l.disrupted && !nodes[l.to]!.disrupted);
    if (out.length === 0) continue;
    const wants = out.map((l) => {
      const t = nodes[l.to]!;
      const room = t.capacity - t.stock - (reserved.get(t.id) ?? 0);
      return Math.max(0, Math.min(linkThroughput(l), room));
    });
    const total = wants.reduce((a, b) => a + b, 0);
    const sends = distribute(Math.min(n.stock, total), wants, wants);
    out.forEach((l, i) => {
      const amount = sends[i]!;
      l.lastFlow = amount;
      n.stock -= amount;
      reserved.set(l.to, (reserved.get(l.to) ?? 0) + amount);
    });
  }
  for (const [id, amount] of reserved) nodes[id]!.stock += amount;
}
