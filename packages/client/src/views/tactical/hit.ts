// What is under the pointer in the tactical view, and box selection.
import type { TacticalSummary } from '@tow/sim';

type Pt = { x: number; y: number };

/** Battalion counter size, screen pixels. */
export const BN_W = 22;
export const BN_H = 15;

/** Battalion under a world point, nearest first; `scale` is pixels per km. */
export function unitAt(t: TacticalSummary, p: Pt, scale: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const u of t.units) {
    const dx = Math.abs(p.x - u.position.x) * scale;
    const dy = Math.abs(p.y - u.position.y) * scale;
    if (dx <= BN_W / 2 + 2 && dy <= BN_H / 2 + 2) {
      const d = Math.hypot(dx, dy);
      if (!best || d < best.d) best = { id: u.id, d };
    }
  }
  return best?.id ?? null;
}

/** Battalions of `side` (or any side when null) inside a world-space box. */
export function unitsInBox(t: TacticalSummary, a: Pt, b: Pt, side: string | null): string[] {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return t.units
    .filter((u) => (side === null || u.side === side) && u.position.x >= x0 && u.position.x <= x1 && u.position.y >= y0 && u.position.y <= y1)
    .map((u) => u.id);
}
