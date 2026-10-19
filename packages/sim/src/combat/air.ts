// Abstract air power: no aircraft on the map, just a daily effort per side
// split between counter-air (wearing down the enemy air force and winning
// superiority), interdiction (damaging enemy supply links), attrition
// (striking enemy formations), and close support (a bonus to ground fire).

import { TICKS_PER_DAY } from '../core/time.ts';
import { sortedIds, type Formation, type WorldState } from '../core/world.ts';
import { activeFormations } from '../command/formations.ts';
import { damage, moraleFactor } from './aggregate.ts';

const sidesWithAir = (world: WorldState) => sortedIds(world.sides).filter((id) => world.sides[id]!.air);

/** Start of day: effective sorties, superiority, counter-air losses, support bonus. */
export function dailyAirPhase(world: WorldState): void {
  const r = world.rules;
  const ids = sidesWithAir(world);
  if (ids.length === 0) return;
  for (const id of ids) {
    const air = world.sides[id]!.air!;
    air.sorties = Math.floor((air.sortiesPerDay * air.pool) / 1000);
  }
  const weight = (id: string) => {
    const air = world.sides[id]!.air!;
    return air.sorties * air.quality;
  };
  const total = ids.reduce((sum, id) => sum + weight(id), 0);
  // Counter-air losses are worked out from start-of-day sorties, then applied together.
  const poolLoss = new Map<string, number>();
  for (const id of ids) {
    const air = world.sides[id]!.air!;
    air.superiority = total > 0 ? Math.round((weight(id) * 1000) / total) : 0;
    const ca = (air.sorties * air.allocation.counterAir) / 1000;
    for (const other of ids) {
      if (other === id) continue;
      poolLoss.set(other, (poolLoss.get(other) ?? 0) + (ca * air.quality * r.counterAirKill) / 1000);
    }
    const support = (air.sorties * air.allocation.support * air.superiority) / 1_000_000;
    air.supportBonus = Math.min(r.supportCap, 1000 + Math.round(support * r.supportPerSortie));
  }
  for (const [id, loss] of poolLoss) {
    const air = world.sides[id]!.air!;
    air.pool = Math.max(0, Math.round(air.pool - loss));
  }
}

/** Air strikes are spread evenly over the day's ticks. */
export function airPhase(world: WorldState): void {
  const r = world.rules;
  const units = activeFormations(world);
  for (const id of sidesWithAir(world)) {
    const air = world.sides[id]!.air!;
    const effect = (air.sorties * air.quality * air.superiority) / (1000 * 1000 * TICKS_PER_DAY);

    // Attrition: spread over enemy formations in proportion to their strength.
    const targets = units.filter((f) => f.side !== id);
    const strikes = (effect * air.allocation.attrition) / 1000;
    const totalStrength = targets.reduce((sum, t) => sum + t.stats.strength, 0);
    if (strikes > 0 && totalStrength > 0) {
      for (const t of targets) strike(world, t, (strikes * t.stats.strength) / totalStrength);
    }

    // Interdiction: aimed at enemy supply links in proportion to their capacity.
    const links = sortedIds(world.supply.links)
      .map((lid) => world.supply.links[lid]!)
      .filter((l) => world.supply.nodes[l.from]?.side !== id);
    const sorties = (effect * air.allocation.interdiction) / 1000;
    const capacity = links.reduce((sum, l) => sum + l.capacityPerTick, 0);
    for (const l of links) {
      if (sorties > 0 && capacity > 0) {
        // Diminishing returns: the more of a link is already wrecked, the less each strike adds.
        const hit = (sorties * r.interdictionRate * l.capacityPerTick) / capacity;
        l.damage = Math.min(1000, l.damage + (hit * (1000 - l.damage)) / 1000);
      }
    }
  }
  // Engineers repair what they can.
  for (const lid of sortedIds(world.supply.links)) {
    const l = world.supply.links[lid]!;
    if (l.damage > 0) l.damage = Math.max(0, l.damage - r.linkRepairPerDay / TICKS_PER_DAY);
  }
}

function strike(world: WorldState, f: Formation, sorties: number) {
  const r = world.rules;
  const strength = Math.max(1, f.stats.strength);
  // Digging in helps against air attack, but only half as much as against ground fire.
  const protection = 1 + f.fortification / 2000;
  // Morale suffers with the weight of attack per soldier, not in total.
  const intensity = (sorties * 1000) / strength;
  damage(world, f, (sorties * r.airAttritionRate) / protection);
  f.stats.morale = Math.max(0, f.stats.morale - (intensity * r.airMoraleRate * moraleFactor(f)) / protection);
}
