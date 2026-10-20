// The tactical map: one detailed battle, battalion by battalion, over the
// same relief as the theater map. It draws the battle area, who is firing on
// whom, ranges and orders, and reports clicks and box selections; like the
// theater view, it never talks to the sim directly.
import { Application, Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { FormationSummary, TacticalSummary, WorldSummary } from '@tow/sim';
import { boundsOf, fit, pan, toWorld, zoomAt, type Camera } from '../theater/camera.ts';
import type { MapAssets } from '../theater/TheaterView.ts';
import { COLORS, statusColor } from '../theater/style.ts';
import { LabelPool, dashed, drawGeoLines } from '../draw.ts';
import type { TacticalMode } from '../../state/store.ts';
import { BN_H, BN_W, unitAt, unitsInBox } from './hit.ts';

type Pt = { x: number; y: number };

/** The tactical view zooms in much further than the theater. */
const MAX_SCALE = 80;

export interface TacticalCallbacks {
  /** A click: the battalion under the pointer, if any. `add` when shift was held. */
  onClick(world: Pt, unit: string | null, add: boolean): void;
  /** A shift-drag box selection. */
  onBox(units: string[], add: boolean): void;
  /** The first frame drawn with the battle after a switch to this view. */
  onShown(battle: string): void;
}

export class TacticalView {
  private app = new Application();
  private world = new Container();
  private geoLayer = new Graphics();
  private areaLayer = new Graphics();
  private fireLayer = new Graphics();
  private unitLayer = new Graphics();
  private overlay = new Graphics();
  private labels: LabelPool;
  private overlayLabels: LabelPool;
  private cam: Camera = { scale: 10, x: 0, y: 0 };
  private fittedBattle: string | null = null;
  /** A level switch waiting for this view to draw (its start time), and the last one reported. */
  private switchStart: number | null = null;
  private reported: number | null = null;
  private drawnGeoScale = -1;
  private dirty = true;
  private summary: WorldSummary | null = null;
  private battle: string | null = null;
  private selection = new Set<string>();
  private mode: TacticalMode = 'select';
  private playerSide: string | null = null;
  private sideColors = new Map<string, number>();
  private cursor: Pt | null = null;
  private pointers = new Map<number, Pt>();
  private dragged = false;
  private box: { from: Pt; to: Pt; add: boolean } | null = null;
  private destroyed = false;
  private canvas: HTMLCanvasElement | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private assets: MapAssets,
    private callbacks: TacticalCallbacks,
  ) {
    const labelLayer = new Container();
    const overlayLabelLayer = new Container();
    this.labels = new LabelPool(labelLayer);
    this.overlayLabels = new LabelPool(overlayLabelLayer);
    this.world.addChild(this.geoLayer, this.areaLayer, this.fireLayer, this.unitLayer, labelLayer, this.overlay, overlayLabelLayer);
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
      relief.tint = 0xb8b8b8;
      this.world.addChildAt(relief, 0);
    }
    this.app.stage.addChild(this.world);
    host.appendChild(this.app.canvas);
    this.canvas = this.app.canvas;
    const observer = new ResizeObserver(() => {
      this.app.resize();
      this.fittedBattle = null;
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

  setState(summary: WorldSummary | null, battle: string | null, selection: string[], mode: TacticalMode, playerSide: string | null, switchStart: number | null = null) {
    this.summary = summary;
    if (summary) for (const s of summary.sides) this.sideColors.set(s.id, parseInt(s.color.slice(1), 16));
    this.switchStart = switchStart;
    this.battle = battle;
    this.selection = new Set(selection);
    this.mode = mode;
    this.playerSide = playerSide;
    if (this.canvas) this.canvas.style.cursor = mode === 'select' ? 'default' : 'crosshair';
    this.dirty = true;
  }

  private get tactical(): TacticalSummary | null {
    const t = this.summary?.tactical ?? null;
    return t && t.battle.id === this.battle ? t : null;
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
      if (this.pointers.size === 1) {
        this.dragged = false;
        // Shift-drag draws a selection box instead of panning.
        if (e.shiftKey && this.mode === 'select') {
          const w = toWorld(this.cam, e.offsetX, e.offsetY);
          this.box = { from: w, to: w, add: true };
        }
      }
    });
    on('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      const now = { x: e.offsetX, y: e.offsetY };
      this.cursor = toWorld(this.cam, now.x, now.y);
      if (this.mode !== 'select') this.dirty = true;
      if (!prev) {
        const t = this.tactical;
        if (t && this.mode === 'select') canvas.style.cursor = unitAt(t, this.cursor, this.cam.scale) ? 'pointer' : 'default';
        return;
      }
      if (this.box) {
        this.box.to = this.cursor;
        this.dragged = true;
        this.dirty = true;
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
        this.cam = pan(zoomAt(this.cam, mid0.x, mid0.y, d0 > 0 ? d1 / d0 : 1, MAX_SCALE), mid1.x - mid0.x, mid1.y - mid0.y);
        this.dragged = true;
      }
      this.pointers.set(e.pointerId, now);
      this.dirty = true;
    });
    const release = (e: PointerEvent) => {
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      const t = this.tactical;
      if (this.box) {
        const box = this.box;
        this.box = null;
        this.dirty = true;
        if (t && this.dragged) {
          this.callbacks.onBox(unitsInBox(t, box.from, box.to, this.playerSide), box.add);
          return;
        }
      }
      if (e.type === 'pointerup' && wasSingle && !this.dragged) {
        const w = toWorld(this.cam, e.offsetX, e.offsetY);
        this.callbacks.onClick(w, t ? unitAt(t, w, this.cam.scale) : null, e.shiftKey);
      }
    };
    on('pointerup', release);
    on('pointercancel', release);
    on('pointerleave', () => {
      this.cursor = null;
      if (this.mode !== 'select') this.dirty = true;
    });
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        this.cam = zoomAt(this.cam, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015), MAX_SCALE);
        this.dirty = true;
      },
      { passive: false },
    );
    on('contextmenu', (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- drawing

  private render() {
    const t = this.tactical;
    const { width, height } = this.app.screen;
    if (t && this.fittedBattle !== t.battle.id && width > 0 && height > 0) {
      const c = t.battle.center;
      const r = t.battle.radiusKm;
      this.cam = fit(boundsOf([{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r }]), width, height, 30, MAX_SCALE);
      this.fittedBattle = t.battle.id;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.world.position.set(this.cam.x, this.cam.y);
    this.world.scale.set(this.cam.scale);
    if (this.drawnGeoScale !== this.cam.scale) {
      this.drawnGeoScale = this.cam.scale;
      const g = this.geoLayer.clear();
      if (this.assets.geo) drawGeoLines(g, this.assets.geo, 1 / this.cam.scale);
    }
    this.drawBattle(t);
    this.drawOverlay(t);
    if (t && this.switchStart !== null && this.reported !== this.switchStart) {
      this.reported = this.switchStart;
      this.callbacks.onShown(t.battle.id);
    }
  }

  private drawBattle(t: TacticalSummary | null) {
    const s = 1 / this.cam.scale;
    const area = this.areaLayer.clear();
    const fire = this.fireLayer.clear();
    const g = this.unitLayer.clear();
    this.labels.begin();
    if (!t || !this.summary) return this.labels.end();

    // The battle area, and objectives inside it.
    const { center, radiusKm } = t.battle;
    area.circle(center.x, center.y, radiusKm).fill({ color: COLORS.contact, alpha: 0.04 });
    // Dashed rim.
    for (let a = 0; a < 64; a += 2) {
      const a0 = (a / 64) * Math.PI * 2;
      const a1 = ((a + 1) / 64) * Math.PI * 2;
      area.moveTo(center.x + Math.cos(a0) * radiusKm, center.y + Math.sin(a0) * radiusKm).lineTo(center.x + Math.cos(a1) * radiusKm, center.y + Math.sin(a1) * radiusKm);
    }
    area.stroke({ width: 1.5 * s, color: COLORS.contact, alpha: 0.6 });
    for (const o of this.summary.objectives) {
      if (Math.hypot(o.position.x - center.x, o.position.y - center.y) > radiusKm + o.radiusKm) continue;
      const r = 8 * s;
      const holder = (o.holder && this.sideColors.get(o.holder)) || 0x999999;
      const { x, y } = o.position;
      area.poly([x, y - r, x + r, y, x, y + r, x - r, y], true).fill({ color: holder }).stroke({ width: 2 * s, color: 0xffffff });
      this.labels.place(`obj:${o.id}`, o.name, x, y - r - 2 * s, this.cam.scale, { size: 12, color: 0xffffff, bold: true, anchorY: 1 });
    }

    const byId = new Map(t.units.map((u) => [u.id, u]));
    // Who fired on whom on the last tick.
    for (const [a, b] of t.fire) {
      const ua = byId.get(a);
      const ub = byId.get(b);
      if (!ua || !ub) continue;
      fire.moveTo(ua.position.x, ua.position.y).lineTo(ub.position.x, ub.position.y).stroke({ width: 1 * s, color: this.sideColors.get(ua.side) ?? 0xffffff, alpha: 0.35 });
    }

    // Ranges and paths of the selected battalions.
    for (const id of this.selection) {
      const u = byId.get(id);
      if (!u) continue;
      area.circle(u.position.x, u.position.y, u.rangeKm).stroke({ width: 1 * s, color: COLORS.selected, alpha: 0.5 });
      if (u.path.length > 0) {
        let prev = u.position;
        for (const wp of u.path) {
          dashed(g, prev, wp, 5 * s, 3 * s);
          prev = wp;
        }
        g.stroke({ width: 1.5 * s, color: COLORS.path, alpha: 0.85 });
      }
    }

    for (const u of t.units) this.drawBattalion(g, u, this.selection.has(u.id), s);
    this.labels.end();
  }

  private drawBattalion(g: Graphics, u: FormationSummary, selected: boolean, s: number) {
    const w = BN_W * s;
    const h = BN_H * s;
    const x = u.position.x - w / 2;
    const y = u.position.y - h / 2;
    const line = COLORS.friendlyLine;
    if (selected) g.rect(x - 3 * s, y - 3 * s, w + 6 * s, h + 6 * s).stroke({ width: 2 * s, color: COLORS.selected });
    else if (u.inContact) g.rect(x - 2 * s, y - 2 * s, w + 4 * s, h + 4 * s).stroke({ width: 1.5 * s, color: COLORS.contact });
    const fill = this.sideColors.get(u.side) ?? COLORS.friendly;
    g.rect(x, y, w, h).fill({ color: fill, alpha: u.status === 'retreating' ? 0.5 : 1 }).stroke({ width: 1 * s, color: line });

    // Role symbol: armor oval, infantry cross, both for mechanized, a dot for artillery, a slash for reconnaissance.
    const b = u.branch;
    if (b === 'armor' || b === 'mechanized') g.roundRect(x + 4 * s, y + 3.5 * s, w - 8 * s, h - 7 * s, (h - 7 * s) / 2).stroke({ width: 1.1 * s, color: line });
    if (b === 'infantry' || b === 'mechanized') g.moveTo(x, y).lineTo(x + w, y + h).moveTo(x + w, y).lineTo(x, y + h).stroke({ width: 1 * s, color: line });
    if (b === 'artillery') g.circle(u.position.x, u.position.y, 2.5 * s).fill({ color: line });
    if (b === 'recon') g.moveTo(x, y + h).lineTo(x + w, y).stroke({ width: 1 * s, color: line });
    // Under the player's direct command: a corner tab.
    if (u.manual) g.poly([x + w, y, x + w - 6 * s, y, x + w, y + 6 * s], true).fill({ color: COLORS.selected });

    // Strength and morale gauges.
    const gy = y + h + 1.5 * s;
    const strength = u.establishment > 0 ? (u.strength * 1000) / u.establishment : 0;
    g.rect(x, gy, w, 5 * s).fill({ color: 0x101214 });
    g.rect(x, gy, (w * strength) / 1000, 2 * s).fill({ color: statusColor(strength) });
    g.rect(x, gy + 3 * s, (w * u.morale) / 1000, 2 * s).fill({ color: statusColor(u.morale) });

    if (this.cam.scale >= 14 || selected) {
      this.labels.place(`bn:${u.id}`, u.name, u.position.x, gy + 6 * s, this.cam.scale, { size: 10, color: 0xffffff, bold: selected });
    }
  }

  private drawOverlay(t: TacticalSummary | null) {
    const s = 1 / this.cam.scale;
    const g = this.overlay.clear();
    this.overlayLabels.begin();
    if (this.box) {
      const { from, to } = this.box;
      g.rect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y))
        .fill({ color: COLORS.selected, alpha: 0.08 })
        .stroke({ width: 1 * s, color: COLORS.selected, alpha: 0.8 });
    }
    // Order preview: where the selected battalions will head, keeping formation.
    if (t && this.mode !== 'select' && this.cursor && this.selection.size > 0) {
      const sel = t.units.filter((u) => this.selection.has(u.id));
      if (sel.length > 0) {
        const cx = sel.reduce((a, u) => a + u.position.x, 0) / sel.length;
        const cy = sel.reduce((a, u) => a + u.position.y, 0) / sel.length;
        const color = this.mode === 'attack' ? COLORS.contact : COLORS.path;
        for (const u of sel) {
          const to = { x: this.cursor.x + u.position.x - cx, y: this.cursor.y + u.position.y - cy };
          dashed(g, u.position, to, 4 * s, 3 * s).stroke({ width: 1.5 * s, color, alpha: 0.8 });
          g.circle(to.x, to.y, 3 * s).stroke({ width: 1.5 * s, color });
        }
        const km = Math.hypot(this.cursor.x - cx, this.cursor.y - cy);
        this.overlayLabels.place('distance', `${this.mode === 'attack' ? 'Attack' : 'Move'} · ${km.toFixed(1)} km`, this.cursor.x, this.cursor.y + 8 * s, this.cam.scale, {
          size: 12,
          color: 0xffffff,
          bold: true,
        });
      }
    }
    this.overlayLabels.end();
  }
}
