// Turns real elapsed time into a whole number of sim ticks, carrying the
// fraction forward. Lives outside the sim: wall-clock time is only allowed here.

/** Never run more than this many ticks in one frame, so a stalled tab can't spiral. */
export const MAX_TICKS_PER_FRAME = 96;

export function ticksDue(carry: number, elapsedMs: number, ticksPerSecond: number): { ticks: number; carry: number } {
  if (ticksPerSecond <= 0 || elapsedMs <= 0) return { ticks: 0, carry: ticksPerSecond <= 0 ? 0 : carry };
  const exact = carry + (elapsedMs / 1000) * ticksPerSecond;
  const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(exact));
  return { ticks, carry: ticks === MAX_TICKS_PER_FRAME ? 0 : exact - ticks };
}
