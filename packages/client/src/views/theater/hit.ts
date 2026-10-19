// What is under the pointer. Units win over depots, depots over supply lines.
import type { WorldSummary } from '@tow/sim';
import { COUNTER_H, COUNTER_W, NODE_SIZE } from './style.ts';

export type Selection = { kind: 'formation' | 'node' | 'link'; id: string };

export function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** `p` is in world km, `scale` is pixels per km. */
export function hitTest(summary: WorldSummary, p: { x: number; y: number }, scale: number): Selection | null {
  const px = (km: number) => km * scale;

  let best: { sel: Selection; d: number } | null = null;
  for (const f of summary.active) {
    const dx = px(Math.abs(p.x - f.position.x));
    const dy = px(Math.abs(p.y - f.position.y));
    if (dx <= COUNTER_W / 2 + 2 && dy <= COUNTER_H / 2 + 2) {
      const d = Math.hypot(dx, dy);
      if (!best || d < best.d) best = { sel: { kind: 'formation', id: f.id }, d };
    }
  }
  if (best) return best.sel;

  for (const n of summary.nodes) {
    const d = px(Math.hypot(p.x - n.position.x, p.y - n.position.y));
    if (d <= NODE_SIZE / 2 + 4 && (!best || d < best.d)) best = { sel: { kind: 'node', id: n.id }, d };
  }
  if (best) return best.sel;

  const nodes = new Map(summary.nodes.map((n) => [n.id, n.position]));
  for (const l of summary.links) {
    const a = nodes.get(l.from);
    const b = nodes.get(l.to);
    if (!a || !b) continue;
    const d = px(distanceToSegment(p, a, b));
    if (d <= 6 && (!best || d < best.d)) best = { sel: { kind: 'link', id: l.id }, d };
  }
  return best?.sel ?? null;
}
