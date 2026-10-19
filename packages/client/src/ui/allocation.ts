import type { AirAllocation } from '@tow/sim';

export const AIR_KEYS = ['counterAir', 'interdiction', 'attrition', 'support'] as const;
export type AirKey = (typeof AIR_KEYS)[number];

/**
 * Set one share and rescale the others proportionally so the total stays 1000.
 * Rounding remainders go to the largest of the other shares.
 */
export function rebalance(a: AirAllocation, key: AirKey, value: number): AirAllocation {
  const v = Math.max(0, Math.min(1000, Math.round(value)));
  const others = AIR_KEYS.filter((k) => k !== key);
  const rest = others.reduce((s, k) => s + a[k], 0);
  const out = { ...a, [key]: v };
  const left = 1000 - v;
  for (const k of others) out[k] = rest > 0 ? Math.floor((a[k] * left) / rest) : Math.floor(left / others.length);
  const sum = AIR_KEYS.reduce((s, k) => s + out[k], 0);
  const biggest = [...others].sort((x, y) => out[y] - out[x])[0]!;
  out[biggest] += 1000 - sum;
  return out;
}
