// Theater camera: screen = world_km * scale + offset.

export interface Camera {
  /** Screen pixels per km. */
  scale: number;
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 12;

export function toScreen(cam: Camera, p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x * cam.scale + cam.x, y: p.y * cam.scale + cam.y };
}

export function toWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed on screen. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number, maxScale = MAX_SCALE): Camera {
  const scale = Math.min(maxScale, Math.max(MIN_SCALE, cam.scale * factor));
  const w = toWorld(cam, sx, sy);
  return { scale, x: sx - w.x * scale, y: sy - w.y * scale };
}

export function pan(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, x: cam.x + dx, y: cam.y + dy };
}

/** Camera that shows `b` centred in a view of `w` x `h` pixels with `pad` pixels to spare. */
export function fit(b: Bounds, w: number, h: number, pad = 40, maxScale = MAX_SCALE): Camera {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const scale = Math.min(maxScale, Math.max(MIN_SCALE, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh)));
  return { scale, x: w / 2 - ((b.minX + b.maxX) / 2) * scale, y: h / 2 - ((b.minY + b.maxY) / 2) * scale };
}

/** Bounds of a set of points, grown to at least `minSize` km on each side. */
export function boundsOf(points: { x: number; y: number }[], minSize = 0): Bounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: minSize, maxY: minSize };
  let b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    b = { minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) };
  }
  const grow = (lo: number, hi: number) => {
    const extra = Math.max(0, minSize - (hi - lo)) / 2;
    return [lo - extra, hi + extra] as const;
  };
  const [minX, maxX] = grow(b.minX, b.maxX);
  const [minY, maxY] = grow(b.minY, b.maxY);
  return { minX, minY, maxX, maxY };
}
