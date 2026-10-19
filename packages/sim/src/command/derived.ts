import type { Rules } from '../core/rules.ts';
import type { FormationStats } from '../core/world.ts';

/** Stock as a fraction of what the formation can carry, permille. */
export function supplyLevel(s: FormationStats): number {
  return s.stockCap > 0 ? Math.floor((s.stock * 1000) / s.stockCap) : 0;
}

/** Permille of full movement. Falls off linearly once readiness drops below the threshold. */
export function mobility(s: FormationStats, rules: Rules): number {
  const t = rules.mobilityReadinessThreshold;
  return s.readiness >= t ? 1000 : Math.floor((s.readiness * 1000) / t);
}

/** Abstract fighting value: strength scaled by readiness and (half-weighted) morale. */
export function combatPower(s: FormationStats): number {
  return Math.floor((s.strength * s.readiness * (500 + Math.floor(s.morale / 2))) / 1_000_000);
}
