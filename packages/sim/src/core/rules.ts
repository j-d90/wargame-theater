// Tuning constants for M1 supply effects. Readiness and morale are permille (0..1000);
// rates are per tick. Kept in one place so later milestones can load them from content.

export interface Rules {
  /** Supply level (stock / stockCap, permille) below which readiness starts to fall. */
  lowSupplyThreshold: number;
  /** Readiness lost per tick while supply is below the threshold. */
  readinessDecayLow: number;
  /** Readiness lost per tick when the formation could not cover its consumption. */
  readinessDecayEmpty: number;
  /** Readiness regained per tick while supply is at or above the threshold. */
  readinessRecovery: number;
  /** Morale lost per tick when the formation could not cover its consumption. */
  moraleDecayEmpty: number;
  /** Supply level at or above which morale recovers. */
  moraleRecoveryThreshold: number;
  moraleRecovery: number;
  /** Below this readiness, mobility starts dropping (derived stat). */
  mobilityReadinessThreshold: number;
  /** Formations farther than this from their supply node receive nothing, km. */
  supplyRangeKm: number;
}

export const DEFAULT_RULES: Readonly<Rules> = {
  lowSupplyThreshold: 250,
  readinessDecayLow: 1,
  readinessDecayEmpty: 3,
  readinessRecovery: 1,
  moraleDecayEmpty: 1,
  moraleRecoveryThreshold: 500,
  moraleRecovery: 1,
  mobilityReadinessThreshold: 600,
  supplyRangeKm: 150,
};
