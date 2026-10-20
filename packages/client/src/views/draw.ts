// Drawing helpers shared by the theater and tactical views.
import { Container, Graphics, Text } from 'pixi.js';
import type { GeoData } from './theater/TheaterView.ts';
import { COLORS } from './theater/style.ts';

type Pt = { x: number; y: number };

/** Draws a dashed line; dash and gap are in world units. */
export function dashed(g: Graphics, a: Pt, b: Pt, dash: number, gap: number): Graphics {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return g;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * e, a.y + uy * e);
  }
  return g;
}

export function polyline(g: Graphics, flat: number[]): Graphics {
  g.moveTo(flat[0]!, flat[1]!);
  for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i]!, flat[i + 1]!);
  return g;
}

/** Reuses Text objects by key across redraws; hides the ones not used this frame. */
export class LabelPool {
  private texts = new Map<string, Text>();
  private used = new Set<string>();
  constructor(private layer: Container) {}

  begin() {
    this.used.clear();
  }

  place(
    key: string,
    text: string,
    x: number,
    y: number,
    scale: number,
    style: { size: number; color: number; halo?: number; bold?: boolean; anchorY?: number },
  ) {
    let t = this.texts.get(key);
    if (!t) {
      t = new Text({
        text,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: style.size,
          fill: style.color,
          fontWeight: style.bold ? '700' : '500',
          stroke: { color: style.halo ?? 0x101214, width: 3, join: 'round' },
        },
        resolution: Math.max(2, globalThis.devicePixelRatio ?? 1),
      });
      t.anchor.set(0.5, style.anchorY ?? 0);
      this.layer.addChild(t);
      this.texts.set(key, t);
    }
    if (t.text !== text) t.text = text;
    t.position.set(x, y);
    t.scale.set(1 / scale);
    t.visible = true;
    this.used.add(key);
  }

  end() {
    for (const [key, t] of this.texts) if (!this.used.has(key)) t.visible = false;
  }
}

/** Map edge, lakes, rivers, coast and borders; `s` converts screen pixels to world units. */
export function drawGeoLines(g: Graphics, geo: GeoData, s: number): void {
  // Outline the edge of the map data so the empty area beyond reads as "off the map".
  g.rect(0, 0, geo.widthKm, geo.heightKm).stroke({ width: 1.5 * s, color: 0x5a6470 });
  for (const line of geo.lakes) polyline(g, line).stroke({ width: 1 * s, color: COLORS.coast, alpha: 0.9 });
  for (const r of geo.rivers) polyline(g, r.line).stroke({ width: 1.4 * s, color: COLORS.river, alpha: 0.85 });
  for (const line of geo.coast) polyline(g, line).stroke({ width: 1.2 * s, color: COLORS.coast, alpha: 0.9 });
  for (const line of geo.borders) polyline(g, line).stroke({ width: 1.6 * s, color: COLORS.border, alpha: 0.85 });
}
