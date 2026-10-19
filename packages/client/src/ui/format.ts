import { TICKS_PER_DAY, TICK_MINUTES } from '@tow/sim';

export const pct = (permille: number) => `${Math.round(permille / 10)}%`;

export function clock(tick: number): { day: number; time: string } {
  const minutes = (tick % TICKS_PER_DAY) * TICK_MINUTES;
  return {
    day: Math.floor(tick / TICKS_PER_DAY),
    time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
  };
}

/** Days the carried stock lasts at the current rate of use. */
export function daysOfSupply(stock: number, supplyPerTick: number): string {
  if (supplyPerTick <= 0) return '–';
  const days = stock / (supplyPerTick * TICKS_PER_DAY);
  return days >= 10 ? `${Math.round(days)} d` : `${days.toFixed(1)} d`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
