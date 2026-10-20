import { TICKS_PER_DAY, TICK_MINUTES } from '@tow/sim';

export const pct = (permille: number) => `${Math.round(permille / 10)}%`;

export function clock(tick: number): { day: number; time: string } {
  const minutes = (tick % TICKS_PER_DAY) * TICK_MINUTES;
  return {
    day: Math.floor(tick / TICKS_PER_DAY),
    time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
  };
}

/** A span of ticks as "2 d 6 h", "6 h 45 min" or "30 min". */
export function duration(ticks: number): string {
  const minutes = ticks * TICK_MINUTES;
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** Days the carried stock lasts at the current rate of use. */
export function daysOfSupply(stock: number, supplyPerTick: number): string {
  if (supplyPerTick <= 0) return '–';
  const days = stock / (supplyPerTick * TICKS_PER_DAY);
  return days >= 10 ? `${Math.round(days)} d` : `${days.toFixed(1)} d`;
}

/** Calendar date of a game day, e.g. "24 Feb 1991", or null without a start date. */
export function calendarDate(startDate: string | null, day: number): string | null {
  if (!startDate) return null;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
