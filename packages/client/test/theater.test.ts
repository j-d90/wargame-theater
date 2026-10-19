import { describe, expect, it } from 'vitest';
import { loadScenario } from '@tow/content';
import { createWorld, summarize } from '@tow/sim';
import { MAX_SCALE, boundsOf, fit, pan, toScreen, toWorld, zoomAt } from '../src/views/theater/camera.ts';
import { distanceToSegment, hitTest } from '../src/views/theater/hit.ts';

describe('camera', () => {
  const cam = { scale: 2, x: 100, y: 50 };

  it('round-trips screen and world coordinates', () => {
    const s = toScreen(cam, { x: 10, y: 20 });
    expect(s).toEqual({ x: 120, y: 90 });
    expect(toWorld(cam, s.x, s.y)).toEqual({ x: 10, y: 20 });
  });

  it('zooms about the cursor and clamps the scale', () => {
    const z = zoomAt(cam, 300, 200, 1.5);
    expect(z.scale).toBe(3);
    const before = toWorld(cam, 300, 200);
    const after = toWorld(z, 300, 200);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAt(cam, 0, 0, 1e6).scale).toBe(MAX_SCALE);
  });

  it('pans by screen pixels', () => {
    expect(pan(cam, 5, -5)).toEqual({ scale: 2, x: 105, y: 45 });
  });

  it('fits bounds into the view, centred', () => {
    const c = fit({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 520, 400, 10);
    expect(c.scale).toBe(5);
    expect(toScreen(c, { x: 50, y: 25 })).toEqual({ x: 260, y: 200 });
  });

  it('grows small bounds to a minimum size', () => {
    expect(boundsOf([{ x: 10, y: 10 }], 100)).toEqual({ minX: -40, minY: -40, maxX: 60, maxY: 60 });
  });
});

describe('hit testing', () => {
  const summary = summarize(createWorld(loadScenario('gulf-sandbox')));
  const unit = summary.active.find((f) => f.id === 'div-e1')!;
  const node = summary.nodes.find((n) => n.id === 'dammam-port')!;

  it('finds units under the pointer, within the counter at any zoom', () => {
    expect(hitTest(summary, unit.position, 1)).toEqual({ kind: 'formation', id: 'div-e1' });
    expect(hitTest(summary, { x: unit.position.x + 10 / 2, y: unit.position.y }, 2)).toEqual({ kind: 'formation', id: 'div-e1' });
    expect(hitTest(summary, { x: unit.position.x + 40, y: unit.position.y }, 2)?.id).not.toBe('div-e1');
  });

  it('finds depots and supply lines', () => {
    expect(hitTest(summary, node.position, 1)).toEqual({ kind: 'node', id: 'dammam-port' });
    const hafar = summary.nodes.find((n) => n.id === 'log-base-hafar')!;
    const mid = { x: (node.position.x + hafar.position.x) / 2, y: (node.position.y + hafar.position.y) / 2 };
    expect(hitTest(summary, mid, 1)).toEqual({ kind: 'link', id: 'road-dammam-hafar' });
  });

  it('returns null over empty ground', () => {
    expect(hitTest(summary, { x: 50, y: 50 }, 1)).toBeNull();
  });

  it('measures distance to a segment, including past its ends', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });
});
