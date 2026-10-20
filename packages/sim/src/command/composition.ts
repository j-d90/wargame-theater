// Detailed units on demand. A formation whose template has a composition is
// broken down into its groups (brigades, regiments) and battalions the first
// time a detailed battle needs them. The battalions split the formation's
// current stats exactly, by battalion weight with largest remainder, so
// collapsing them again gives back the formation they came from. After that
// the generated subtree stays in the world and is reused through the usual
// aggregate and expand.

import { distribute } from '../core/distribute.ts';
import { type Formation, type FormationStats, type TacticalTypeState, type WorldState } from '../core/world.ts';
import { combineStats, forgetFormationIds } from './formations.ts';

export function canBreakDown(world: WorldState, f: Formation): boolean {
  return f.childIds.length === 0 && f.composition !== null && world.tactical.compositions[f.composition] !== undefined;
}

/** Generate `id`'s groups and battalions from its composition. The formation is left expanded. */
export function breakDown(world: WorldState, id: string): void {
  const f = world.formations[id];
  if (!f || !canBreakDown(world, f)) throw new Error(`breakDown: "${id}" has no composition to break down into`);
  const comp = world.tactical.compositions[f.composition!]!;

  // One entry per battalion, in composition order.
  const battalions: { group: number; type: TacticalTypeState; label: string; id: string }[] = [];
  comp.groups.forEach((g, gi) => {
    const groupId = g.name === undefined ? id : `${id}/${g.short.toLowerCase()}`;
    const counts = new Map<string, number>();
    for (const part of g.parts) {
      const type = world.tactical.types[part.type]!;
      for (let k = 0; k < part.count; k++) {
        const n = (counts.get(type.id) ?? 0) + 1;
        counts.set(type.id, n);
        battalions.push({
          group: gi,
          type,
          label: g.name === undefined ? `${type.abbr} ${n}` : `${g.short}-${n} ${type.abbr}`,
          id: `${groupId}/${type.abbr.toLowerCase()}-${n}`,
        });
      }
    }
  });

  const s = f.stats;
  const weights = battalions.map((b) => b.type.weight);
  const split = (total: number, caps?: number[]) => distribute(total, weights, caps);
  const strength = split(s.strength);
  const establishment = split(s.establishment);
  const stockCap = split(s.stockCap);
  const supplyPerTick = split(s.supplyPerTick);
  const stock = split(s.stock, stockCap);

  const make = (fid: string, name: string, echelon: Formation['echelon'], parentId: string, stats: FormationStats, type: TacticalTypeState | null): Formation => {
    if (world.formations[fid]) throw new Error(`breakDown: id "${fid}" is already taken`);
    const child: Formation = {
      id: fid,
      name,
      nation: f.nation,
      echelon,
      branch: type ? type.branch : null,
      side: f.side,
      status: f.status,
      fortification: f.fortification,
      inContact: false,
      lossCarry: 0,
      parentId,
      childIds: [],
      position: { ...f.position },
      supplyNode: null,
      aggregated: false,
      stats,
      baseline: null,
      baselinePosition: null,
      order: null,
      composition: null,
      tacticalType: type ? type.id : null,
      battle: null,
      manual: false,
    };
    world.formations[fid] = child;
    return child;
  };

  const groupChildren = new Map<number, Formation[]>();
  battalions.forEach((b, i) => {
    const g = comp.groups[b.group]!;
    const parentId = g.name === undefined ? id : `${id}/${g.short.toLowerCase()}`;
    const stats: FormationStats = {
      strength: strength[i]!,
      establishment: establishment[i]!,
      quality: s.quality,
      readiness: s.readiness,
      morale: s.morale,
      stock: stock[i]!,
      stockCap: stockCap[i]!,
      supplyPerTick: supplyPerTick[i]!,
      speed: s.speed,
    };
    const bn = make(b.id, b.label, 'battalion', parentId, stats, b.type);
    groupChildren.set(b.group, [...(groupChildren.get(b.group) ?? []), bn]);
  });

  comp.groups.forEach((g, gi) => {
    const parts = groupChildren.get(gi) ?? [];
    if (g.name === undefined) return;
    const echelon = f.echelon === 'division' || f.echelon === 'corps' ? 'brigade' : 'battalion';
    const group = make(`${id}/${g.short.toLowerCase()}`, g.name, echelon, id, combineStats(parts.map((p) => p.stats)), null);
    group.childIds = parts.map((p) => p.id).sort();
  });

  forgetFormationIds(world);
  const direct = new Set<string>();
  battalions.forEach((b) => direct.add(comp.groups[b.group]!.name === undefined ? b.id : `${id}/${comp.groups[b.group]!.short.toLowerCase()}`));
  f.childIds = [...direct].sort();
  f.aggregated = false;
  f.lossCarry = 0;
}
