// Active formations consume from the stock they carry. Running low costs
// readiness; running out costs readiness faster and erodes morale. Mobility and
// combat power are derived from readiness and morale (command/derived.ts), so
// they fall in turn.

import type { WorldState } from '../core/world.ts';
import { activeFormations } from '../command/formations.ts';
import { supplyLevel } from '../command/derived.ts';

const clamp = (v: number) => Math.max(0, Math.min(1000, v));

/** How high morale can recover by rest alone; better units rally further. */
export function moraleCeiling(quality: number): number {
  return Math.min(1000, 450 + quality / 4);
}

export function consumptionPhase(world: WorldState): void {
  const r = world.rules;
  for (const f of activeFormations(world)) {
    const s = f.stats;
    const empty = s.stock < s.supplyPerTick;
    s.stock = empty ? 0 : s.stock - s.supplyPerTick;
    const level = supplyLevel(s);

    if (empty) {
      s.readiness = clamp(s.readiness - r.readinessDecayEmpty);
      s.morale = clamp(s.morale - r.moraleDecayEmpty);
    } else if (level < r.lowSupplyThreshold) {
      s.readiness = clamp(s.readiness - r.readinessDecayLow);
    } else {
      s.readiness = clamp(s.readiness + r.readinessRecovery);
    }
    if (!empty && !f.inContact && level >= r.moraleRecoveryThreshold && s.morale < moraleCeiling(s.quality)) {
      s.morale = Math.min(moraleCeiling(s.quality), s.morale + r.moraleRecovery);
    }
  }
}
