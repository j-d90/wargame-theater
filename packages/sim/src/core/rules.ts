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
  /** Pace of an attack relative to a road march, permille. */
  attackPace: number;

  // Combat. Calibrated against the Desert Storm scenario; see the calibration test.
  /** Opposing formations closer than this are in contact, km. */
  contactKm: number;
  /** Strength lost per tick per point of effective enemy fire, before protection. */
  lossRate: number;
  /** Morale lost per tick when outgunned more than 1.5 to 1. */
  outgunnedStress: number;
  /** Fortification gained per tick while stationary, and the most digging in can reach. */
  fortifyPerTick: number;
  fortifyCap: number;
  /** In contact below this morale, a formation falls back. */
  retreatMorale: number;
  /** A retreating formation rallies above this morale once out of contact. */
  rallyMorale: number;
  /** Below this morale, or this share of establishment (permille), a formation may surrender. */
  collapseMorale: number;
  collapseStrength: number;
  /** Below this share of establishment (permille) a formation is destroyed. */
  destroyedStrength: number;
  /** Chance per tick (permille) that a collapsing formation in contact surrenders. */
  surrenderPerTick: number;

  // Air. Effort is in abstract sorties.
  /** Enemy air pool destroyed per counter-air sortie (permille, scaled by air quality). */
  counterAirKill: number;
  /** Strength destroyed per effective attrition sortie (sorties x air quality x superiority). */
  airAttritionRate: number;
  /** Morale lost per effective attrition sortie per 1000 strength of the target. */
  airMoraleRate: number;
  /** Link damage (permille) per effective interdiction sortie, and repair per day. */
  interdictionRate: number;
  linkRepairPerDay: number;
  /** Ground fire bonus (permille) per close-support sortie, and its cap. */
  supportPerSortie: number;
  supportCap: number;

  // Detailed (tactical) battles.
  /** Fire multiplier for the detailed resolver, calibrated so it matches aggregate combat (npm run tactical-check). */
  tacticalFire: number;
  /** Reach of units that have no battalion type, km. */
  tacticalDefaultRangeKm: number;
  /** How far a broken battalion falls back, km. */
  tacticalFallBackKm: number;
  /** A battle closes after this many ticks without opposing units in contact range. */
  battleIdleTicks: number;
}

export const DEFAULT_RULES: Readonly<Rules> = {
  lowSupplyThreshold: 250,
  readinessDecayLow: 1,
  readinessDecayEmpty: 3,
  readinessRecovery: 1,
  moraleDecayEmpty: 1,
  moraleRecoveryThreshold: 500,
  moraleRecovery: 0.25,
  mobilityReadinessThreshold: 600,
  supplyRangeKm: 150,
  attackPace: 500,

  contactKm: 15,
  lossRate: 0.0006,
  outgunnedStress: 2,
  fortifyPerTick: 2,
  fortifyCap: 500,
  retreatMorale: 300,
  rallyMorale: 450,
  collapseMorale: 150,
  collapseStrength: 300,
  destroyedStrength: 80,
  surrenderPerTick: 40,

  counterAirKill: 0.06,
  airAttritionRate: 0.1,
  airMoraleRate: 0.3,
  interdictionRate: 1.0,
  linkRepairPerDay: 80,
  supportPerSortie: 0.4,
  supportCap: 1600,

  tacticalFire: 1,
  tacticalDefaultRangeKm: 5,
  tacticalFallBackKm: 40,
  battleIdleTicks: 8,
};
