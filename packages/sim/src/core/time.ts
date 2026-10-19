export const TICK_MINUTES = 15;
export const TICKS_PER_HOUR = 60 / TICK_MINUTES;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;

export function tickAt(day: number, hour = 0): number {
  return day * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
}

export function dayOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY);
}

/** "D12 06:45" */
export function formatTick(tick: number): string {
  const day = dayOf(tick);
  const minutes = (tick % TICKS_PER_DAY) * TICK_MINUTES;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `D${day} ${hh}:${mm}`;
}
