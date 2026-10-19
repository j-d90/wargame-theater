// The theater map: shaded relief, borders and cities, the supply network, and
// unit counters, drawn with PixiJS. It only draws what the latest snapshot says
// and reports clicks; it never talks to the sim directly.
import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { FormationSummary, WorldSummary } from '@tow/sim';
import { boundsOf, fit, pan, toWorld, zoomAt, type Camera } from './camera.ts';
import { hitTest, type Selection } from './hit.ts';
import { COLORS, COUNTER_H, COUNTER_W, ECHELON_MARK, NODE_SIZE, statusColor } from './style.ts';

export interface GeoData {
  widthKm: number;
  heightKm: number;
  borders: number[][];
  coast: number[][];
  lakes: number[][];
  rivers: { name: string; line: number[] }[];
  cities: { name: string; x: number; y: number; pop: number; capital: boolean }[];
}

export interface MapAssets {
  geo: GeoData | null;
  reliefUrl: string | null;
  /** km covered by one relief pixel. */
  reliefKmPerPx: number;
}

export type Mode = 'select' | 'move';

export interface TheaterCallbacks {
  onClick(world: { x: number; y: number }, hit: Selection | null): void;
}

type Pt = { x: number; y: number };
type Rect = { x0: number; y0: number; x1: number; y1: number; owner: string };

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Greedy label placement: a label is shown only if it doesn't cover another
 * unit's counter, a depot, or a label already placed this frame.
 */
class Occupancy {
  private rects: Rect[] = [];
  reset() {
    this.rects = [];
  }
  add(r: Rect) {
    this.rects.push(r);
  }
  /** Reserve a rect if it is free (ignoring the owner's own shapes). */
  claim(r: Rect): boolean {
    if (this.rects.some((o) => o.owner !== r.owner && overlaps(o, r))) return false;
    this.rects.push(r);
    return true;
  }
}

/** Approximate screen size of a label, converted to world units. */
function labelRect(text: string, size: number, x: number, y: number, anchorY: number, s: number, owner: string): Rect {
  const w = text.length * size * 0.56 * s;
  const h = size * 1.25 * s;
  const top = y - h * anchorY;
  return { x0: x - w / 2, y0: top, x1: x + w / 2, y1: top + h, owner };
}

/** Draws a dashed line; dash and gap are in world units. */
function dashed(g: Graphics, a: Pt, b: Pt, dash: number, gap: number): Graphics {
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

function polyline(g: Graphics, flat: number[]): Graphics {
  g.moveTo(flat[0]!, flat[1]!);
  for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i]!, flat[i + 1]!);
  return g;
}

/** Reuses Text objects by key across redraws; hides the ones not used this frame. */
class LabelPool {
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

export class TheaterView {
  private app = new Application();
  private world = new Container();
  private geoLayer = new Graphics();
  private supplyLayer = new Graphics();
  private unitLayer = new Graphics();
  private overlay = new Graphics();
  private cityLabels: LabelPool;
  private supplyLabels: LabelPool;
  private unitLabels: LabelPool;
  private overlayLabels: LabelPool;

  private occupancy = new Occupancy();
  private cam: Camera = { scale: 1, x: 0, y: 0 };
  private camReady = false;
  private drawnGeoScale = -1;
  private dirty = true;
  private summary: WorldSummary | null = null;
  private selection: Selection | null = null;
  private mode: Mode = 'select';
  private playerSide: string | null = null;
  private sideColors = new Map<string, number>();
  private cursor: Pt | null = null;
  private pointers = new Map<number, Pt>();
  private dragged = false;
  private destroyed = false;
  private canvas: HTMLCanvasElement | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private assets: MapAssets,
    private callbacks: TheaterCallbacks,
  ) {
    const cityLayer = new Container();
    const supplyLabelLayer = new Container();
    const unitLabelLayer = new Container();
    const overlayLabelLayer = new Container();
    this.overlayLabels = new LabelPool(overlayLabelLayer);
    this.cityLabels = new LabelPool(cityLayer);
    this.supplyLabels = new LabelPool(supplyLabelLayer);
    this.unitLabels = new LabelPool(unitLabelLayer);
    this.world.addChild(this.geoLayer, cityLayer, this.supplyLayer, supplyLabelLayer, this.unitLayer, this.overlay, unitLabelLayer, overlayLabelLayer);
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: COLORS.background,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio ?? 1),
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    if (this.assets.reliefUrl) {
      const tex = await Assets.load<Texture>(this.assets.reliefUrl);
      if (this.destroyed) return;
      const relief = new Sprite(tex);
      relief.width = tex.width * this.assets.reliefKmPerPx;
      relief.height = tex.height * this.assets.reliefKmPerPx;
      relief.tint = 0xcfcfcf;
      this.world.addChildAt(relief, 0);
    }
    this.app.stage.addChild(this.world);
    host.appendChild(this.app.canvas);
    this.canvas = this.app.canvas;
    // resizeTo only follows the window; also follow layout changes beside the map.
    const observer = new ResizeObserver(() => {
      this.app.resize();
      this.dirty = true;
    });
    observer.observe(host);
    this.cleanup.push(() => observer.disconnect());
    this.bindInput(this.app.canvas);
    this.app.ticker.add(() => this.render());
  }

  destroy() {
    this.destroyed = true;
    for (const off of this.cleanup) off();
    if (this.canvas) this.app.destroy(true, { children: true });
  }

  setState(summary: WorldSummary | null, selection: Selection | null, mode: Mode, playerSide: string | null = null) {
    this.summary = summary;
    this.playerSide = playerSide;
    if (summary) for (const s of summary.sides) this.sideColors.set(s.id, parseInt(s.color.slice(1), 16));
    this.selection = selection;
    this.mode = mode;
    if (this.canvas) this.canvas.style.cursor = mode === 'move' ? 'crosshair' : 'default';
    this.dirty = true;
  }

  centerOn(p: Pt) {
    const { width, height } = this.app.screen;
    this.cam = { ...this.cam, x: width / 2 - p.x * this.cam.scale, y: height / 2 - p.y * this.cam.scale };
    this.dirty = true;
  }

  // ---------------------------------------------------------------- input

  private bindInput(canvas: HTMLCanvasElement) {
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => canvas.removeEventListener(type, fn as EventListener));
    };
    canvas.style.touchAction = 'none';

    on('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 1) this.dragged = false;
    });
    on('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      const now = { x: e.offsetX, y: e.offsetY };
      this.cursor = toWorld(this.cam, now.x, now.y);
      if (this.mode === 'move') this.dirty = true;
      if (!prev) {
        if (this.summary && this.mode === 'select') {
          canvas.style.cursor = hitTest(this.summary, this.cursor, this.cam.scale) ? 'pointer' : 'default';
        }
        return;
      }
      if (this.pointers.size === 1) {
        if (!this.dragged && Math.hypot(now.x - prev.x, now.y - prev.y) < 4) return;
        this.dragged = true;
        this.cam = pan(this.cam, now.x - prev.x, now.y - prev.y);
      } else if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(now.x - other.x, now.y - other.y);
        const mid0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
        const mid1 = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
        this.cam = pan(zoomAt(this.cam, mid0.x, mid0.y, d0 > 0 ? d1 / d0 : 1), mid1.x - mid0.x, mid1.y - mid0.y);
        this.dragged = true;
      }
      this.pointers.set(e.pointerId, now);
      this.dirty = true;
    });
    const release = (e: PointerEvent) => {
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (e.type === 'pointerup' && wasSingle && !this.dragged) {
        const w = toWorld(this.cam, e.offsetX, e.offsetY);
        this.callbacks.onClick(w, this.summary ? hitTest(this.summary, w, this.cam.scale) : null);
      }
    };
    on('pointerup', release);
    on('pointercancel', release);
    on('pointerleave', () => {
      this.cursor = null;
      if (this.mode === 'move') this.dirty = true;
    });
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        this.cam = zoomAt(this.cam, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
        this.dirty = true;
      },
      { passive: false },
    );
    on('contextmenu', (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- drawing

  private render() {
    if (!this.camReady) {
      const { width, height } = this.app.screen;
      if (width === 0 || height === 0) return;
      const points = this.summary
        ? [...this.summary.active.map((f) => f.position), ...this.summary.nodes.map((n) => n.position)]
        : [{ x: 0, y: 0 }];
      // On a real map, open on a theater-sized area around the forces; without one, fit them tightly.
      this.cam = fit(boundsOf(points, this.assets.geo ? 500 : 60), width, height);
      this.camReady = this.summary !== null;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.world.position.set(this.cam.x, this.cam.y);
    this.world.scale.set(this.cam.scale);
    if (this.drawnGeoScale !== this.cam.scale) this.drawGeo();
    this.reserveShapes();
    this.drawSupply();
    this.drawUnits();
    this.drawOverlay();
  }

  private drawGeo() {
    this.drawnGeoScale = this.cam.scale;
    const s = 1 / this.cam.scale;
    const g = this.geoLayer.clear();
    const geo = this.assets.geo;
    this.cityLabels.begin();
    if (geo) {
      // Outline the edge of the map data so the empty area beyond reads as "off the map".
      g.rect(0, 0, geo.widthKm, geo.heightKm).stroke({ width: 1.5 * s, color: 0x5a6470 });
      for (const line of geo.lakes) polyline(g, line).stroke({ width: 1 * s, color: COLORS.coast, alpha: 0.9 });
      for (const r of geo.rivers) polyline(g, r.line).stroke({ width: 1.4 * s, color: COLORS.river, alpha: 0.85 });
      for (const line of geo.coast) polyline(g, line).stroke({ width: 1.2 * s, color: COLORS.coast, alpha: 0.9 });
      for (const line of geo.borders) polyline(g, line).stroke({ width: 1.6 * s, color: COLORS.border, alpha: 0.85 });
      const minPop = this.cam.scale >= 1.6 ? 0 : this.cam.scale >= 0.9 ? 400_000 : 1_000_000;
      const nodes = this.summary?.nodes ?? [];
      for (const c of geo.cities) {
        if (c.pop < minPop && !c.capital) continue;
        // A depot or port at the same place already carries the name.
        if (nodes.some((n) => Math.hypot(n.position.x - c.x, n.position.y - c.y) < 20)) continue;
        g.circle(c.x, c.y, (c.capital ? 3.5 : 2.5) * s).fill({ color: COLORS.city }).stroke({ width: 1 * s, color: 0xeeeeee, alpha: 0.7 });
        this.cityLabels.place(`city:${c.name}`, c.name, c.x, c.y + 4 * s, this.cam.scale, { size: c.capital ? 12 : 11, color: 0x2b2118, halo: 0xe6d8b8, bold: c.capital });
      }
    }
    this.cityLabels.end();
  }

  /** Counters and depots are obstacles for labels. */
  private reserveShapes() {
    const s = 1 / this.cam.scale;
    this.occupancy.reset();
    if (!this.summary) return;
    for (const f of this.summary.active) {
      const hw = (COUNTER_W / 2 + 2) * s;
      this.occupancy.add({ x0: f.position.x - hw, y0: f.position.y - (COUNTER_H / 2 + 14) * s, x1: f.position.x + hw, y1: f.position.y + (COUNTER_H / 2 + 9) * s, owner: f.id });
    }
    for (const n of this.summary.nodes) {
      const h = (NODE_SIZE / 2 + 4) * s;
      this.occupancy.add({ x0: n.position.x - h, y0: n.position.y - h, x1: n.position.x + h, y1: n.position.y + h + 6 * s, owner: n.id });
    }
    // The selected unit's name goes first so it is never the one dropped.
    const sel = this.selection;
    const f = sel?.kind === 'formation' ? this.summary.active.find((a) => a.id === sel.id) : undefined;
    if (f) this.occupancy.claim(labelRect(f.name, 11, f.position.x, f.position.y + (COUNTER_H / 2 + 11) * s, 0, s, f.id));
  }

  private drawSupply() {
    const s = 1 / this.cam.scale;
    const g = this.supplyLayer.clear();
    this.supplyLabels.begin();
    const sum = this.summary;
    if (!sum) return this.supplyLabels.end();
    const nodes = new Map(sum.nodes.map((n) => [n.id, n]));
    const sel = this.selection;

    for (const l of sum.links) {
      const a = nodes.get(l.from)?.position;
      const b = nodes.get(l.to)?.position;
      if (!a || !b) continue;
      const width = (2 + Math.min(4, l.capacity / 30)) * s;
      if (sel?.kind === 'link' && sel.id === l.id) g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width + 4 * s, color: COLORS.selected, alpha: 0.9 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: width + 2.5 * s, color: COLORS.linkCasing, alpha: 0.75 });
      if (l.disrupted) {
        dashed(g, a, b, 10 * s, 7 * s).stroke({ width, color: COLORS.linkCut });
      } else if (l.damage >= 300) {
        // Badly damaged by air interdiction: amber, dashed when mostly wrecked.
        if (l.damage >= 700) dashed(g, a, b, 6 * s, 4 * s).stroke({ width, color: COLORS.damaged });
        else g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color: COLORS.damaged, alpha: 0.9 });
      } else {
        const util = l.capacity > 0 ? l.flow / l.capacity : 0;
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width, color: util > 0 ? COLORS.link : COLORS.linkIdle, alpha: 0.7 + 0.3 * Math.min(1, util * 1.5) });
      }
    }

    // Objectives: a diamond in the holder's colour.
    for (const o of sum.objectives) {
      const r = 8 * s;
      const holder = (o.holder && this.sideColors.get(o.holder)) || 0x999999;
      const { x, y } = o.position;
      g.poly([x, y - r, x + r, y, x, y + r, x - r, y], true).fill({ color: holder }).stroke({ width: 2 * s, color: 0xffffff });
      g.circle(x, y, o.radiusKm).stroke({ width: 1 * s, color: holder, alpha: 0.35 });
      const ly = y - r - 2 * s;
      if (this.cam.scale >= 0.7 && this.occupancy.claim(labelRect(o.name, 11, x, ly, 1, s, o.id))) {
        this.supplyLabels.place(`obj:${o.id}`, o.name, x, ly, this.cam.scale, { size: 11, color: 0xffffff, bold: true, anchorY: 1 });
      }
    }

    const half = (NODE_SIZE / 2) * s;
    for (const n of sum.nodes) {
      const { x, y } = n.position;
      const selected = sel?.kind === 'node' && sel.id === n.id;
      if (selected) g.circle(x, y, half + 5 * s).stroke({ width: 2 * s, color: COLORS.selected });
      if (n.moveTo) dashed(g, n.position, n.moveTo, 5 * s, 4 * s).stroke({ width: 1.5 * s, color: COLORS.node, alpha: 0.8 });
      if (n.kind === 'source') g.circle(x, y, half);
      else g.rect(x - half, y - half, 2 * half, 2 * half);
      g.fill({ color: COLORS.node }).stroke({ width: 2 * s, color: this.sideColors.get(n.side) ?? COLORS.nodeEdge });
      // Stock gauge under the node.
      const frac = n.capacity > 0 ? n.stock / n.capacity : 0;
      g.rect(x - 9 * s, y + half + 3 * s, 18 * s, 4 * s).fill({ color: 0x101214 });
      g.rect(x - 9 * s, y + half + 3 * s, 18 * s * frac, 4 * s).fill({ color: statusColor(frac * 1000) });
      if (n.disrupted) {
        g.moveTo(x - half - 3 * s, y - half - 3 * s).lineTo(x + half + 3 * s, y + half + 3 * s);
        g.moveTo(x + half + 3 * s, y - half - 3 * s).lineTo(x - half - 3 * s, y + half + 3 * s);
        g.stroke({ width: 3 * s, color: COLORS.linkCut });
      }
      const ly = y - half - 3 * s;
      if ((selected || this.cam.scale >= 1.2) && this.occupancy.claim(labelRect(n.name, 11, x, ly, 1, s, n.id))) {
        this.supplyLabels.place(`node:${n.id}`, n.name, x, ly, this.cam.scale, { size: 11, color: 0xf3ead2, anchorY: 1 });
      }
    }
    this.supplyLabels.end();
  }

  private drawUnits() {
    const s = 1 / this.cam.scale;
    const g = this.unitLayer.clear();
    this.unitLabels.begin();
    const sum = this.summary;
    if (!sum) return this.unitLabels.end();
    const nodes = new Map(sum.nodes.map((n) => [n.id, n.position]));
    const selectedId = this.selection?.kind === 'formation' ? this.selection.id : null;

    // Paths and supply tethers first, so counters sit on top.
    for (const f of sum.active) {
      const selected = f.id === selectedId;
      if (f.path.length > 0) {
        let prev = f.position;
        for (const wp of f.path) {
          dashed(g, prev, wp, 6 * s, 4 * s);
          prev = wp;
        }
        g.stroke({ width: (selected ? 2 : 1.5) * s, color: COLORS.path, alpha: selected ? 0.95 : 0.55 });
        const end = f.path[f.path.length - 1]!;
        g.circle(end.x, end.y, 4 * s).stroke({ width: 1.5 * s, color: COLORS.path, alpha: selected ? 0.95 : 0.55 });
      }
      const node = f.supplyNode ? nodes.get(f.supplyNode) : undefined;
      if (node && (selected || !f.inSupplyRange)) {
        if (f.inSupplyRange) g.moveTo(f.position.x, f.position.y).lineTo(node.x, node.y).stroke({ width: 1.5 * s, color: COLORS.tether, alpha: 0.8 });
        else dashed(g, f.position, node, 5 * s, 5 * s).stroke({ width: 1.5 * s, color: COLORS.tetherBroken, alpha: 0.85 });
      }
    }

    // Engagements: an orange burst between formations in contact.
    for (const e of sum.engagements) {
      const { x, y } = e.position;
      g.circle(x, y, 7 * s).fill({ color: COLORS.contact, alpha: 0.35 });
      g.moveTo(x - 5 * s, y - 5 * s).lineTo(x + 5 * s, y + 5 * s).moveTo(x + 5 * s, y - 5 * s).lineTo(x - 5 * s, y + 5 * s);
      g.stroke({ width: 2 * s, color: COLORS.contact });
    }

    for (const f of sum.active) this.drawCounter(g, f, f.id === selectedId, s);
    this.unitLabels.end();
  }

  private drawCounter(g: Graphics, f: FormationSummary, selected: boolean, s: number) {
    const w = COUNTER_W * s;
    const h = COUNTER_H * s;
    const x = f.position.x - w / 2;
    const y = f.position.y - h / 2;
    if (selected) g.rect(x - 3 * s, y - 3 * s, w + 6 * s, h + 6 * s).stroke({ width: 2.5 * s, color: COLORS.selected });
    else if (f.inContact) g.rect(x - 2 * s, y - 2 * s, w + 4 * s, h + 4 * s).stroke({ width: 2 * s, color: COLORS.contact });
    const fill = this.sideColors.get(f.side) ?? COLORS.friendly;
    g.rect(x, y, w, h).fill({ color: fill, alpha: f.status === 'retreating' ? 0.55 : 1 }).stroke({ width: 1.2 * s, color: COLORS.friendlyLine });

    // Branch symbol: armor = oval, infantry = cross, mechanized = both.
    const branch = f.branch;
    if (branch === 'armor' || branch === 'mechanized') {
      g.roundRect(x + 6 * s, y + 5 * s, w - 12 * s, h - 10 * s, (h - 10 * s) / 2).stroke({ width: 1.3 * s, color: COLORS.friendlyLine });
    }
    if (branch === 'infantry' || branch === 'mechanized') {
      g.moveTo(x, y).lineTo(x + w, y + h).moveTo(x + w, y).lineTo(x, y + h).stroke({ width: 1.2 * s, color: COLORS.friendlyLine });
    }

    // Readiness and supply gauges.
    const gy = y + h + 2 * s;
    g.rect(x, gy, w, 7 * s).fill({ color: 0x101214 });
    g.rect(x, gy, (w * f.readiness) / 1000, 3 * s).fill({ color: statusColor(f.readiness) });
    g.rect(x, gy + 4 * s, (w * f.supplyLevel) / 1000, 3 * s).fill({ color: statusColor(f.supplyLevel) });

    if (!f.inSupplyRange) {
      g.circle(x + w, y, 5 * s).fill({ color: COLORS.bad }).stroke({ width: 1 * s, color: 0xffffff });
    }

    const mark = ECHELON_MARK[f.echelon] ?? '';
    if (mark) this.unitLabels.place(`mark:${f.id}`, mark, f.position.x, y - 1 * s, this.cam.scale, { size: 10, color: 0xffffff, bold: true, anchorY: 1 });
    // The selected unit's label was reserved up front in reserveShapes.
    const ly = gy + 9 * s;
    if (selected || (this.cam.scale >= 0.9 && this.occupancy.claim(labelRect(f.name, 11, f.position.x, ly, 0, s, f.id)))) {
      this.unitLabels.place(`name:${f.id}`, f.name, f.position.x, ly, this.cam.scale, { size: 11, color: 0xffffff, bold: selected });
    }
  }

  private drawOverlay() {
    const g = this.overlay.clear();
    this.overlayLabels.begin();
    this.drawMovePreview(g);
    this.overlayLabels.end();
  }

  private drawMovePreview(g: Graphics) {
    const s = 1 / this.cam.scale;
    if (this.mode !== 'move' || !this.cursor || this.selection?.kind !== 'formation' || !this.summary) return;
    const id = this.selection.id;
    const f = this.summary.active.find((a) => a.id === id);
    if (!f) return;
    dashed(g, f.position, this.cursor, 8 * s, 5 * s).stroke({ width: 2 * s, color: COLORS.path, alpha: 0.9 });
    g.circle(this.cursor.x, this.cursor.y, 7 * s).stroke({ width: 2 * s, color: COLORS.path });
    const km = Math.round(Math.hypot(this.cursor.x - f.position.x, this.cursor.y - f.position.y));
    this.overlayLabels.place('distance', `${km} km`, this.cursor.x, this.cursor.y + 10 * s, this.cam.scale, { size: 12, color: 0xffffff, bold: true });
  }
}
