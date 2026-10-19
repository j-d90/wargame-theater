import { describe, expect, it } from 'vitest';
import { hashState } from '@tow/sim';
import { MAX_TICKS_PER_FRAME, ticksDue } from '../src/worker/clock.ts';
import { SimHost } from '../src/worker/host.ts';

describe('ticksDue', () => {
  it('converts elapsed time to whole ticks and carries the remainder', () => {
    let carry = 0;
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const r = ticksDue(carry, 50, 4); // 0.2 ticks per frame
      carry = r.carry;
      total += r.ticks;
    }
    expect(total).toBe(4); // one second at 4 ticks/s
  });

  it('runs nothing while paused and drops the carry', () => {
    expect(ticksDue(0.7, 1000, 0)).toEqual({ ticks: 0, carry: 0 });
  });

  it('caps a long stall', () => {
    expect(ticksDue(0, 60_000, 96).ticks).toBe(MAX_TICKS_PER_FRAME);
  });
});

describe('SimHost', () => {
  it('rejects bad commands without throwing or changing the world', () => {
    const host = new SimHost('gulf-sandbox');
    const before = hashState(host.world);
    expect(host.command({ type: 'move', formation: 'bde-c1-1', to: { x: 0, y: 0 } })).toMatch(/not an active formation/);
    expect(host.command({ type: 'expand', formation: 'div-w1' })).toMatch(/not aggregated/);
    expect(hashState(host.world)).toBe(before);
    expect(host.log).toHaveLength(0);
  });

  it('logs accepted commands with their tick, and replaying the log reproduces the world', () => {
    const host = new SimHost('gulf-sandbox');
    host.advance(10);
    expect(host.command({ type: 'move', formation: 'div-w1', to: { x: 700, y: 900 } })).toBeNull();
    host.advance(200);
    expect(host.command({ type: 'setDisrupted', target: { kind: 'link', id: 'road-hafar-rafha' }, disrupted: true })).toBeNull();
    host.advance(300);
    expect(host.log.map((c) => c.tick)).toEqual([10, 210]);

    const replay = new SimHost('gulf-sandbox');
    for (const { tick, ...cmd } of host.log) {
      replay.advance(tick - replay.world.tick);
      replay.command(cmd);
    }
    replay.advance(host.world.tick - replay.world.tick);
    expect(hashState(replay.world)).toBe(hashState(host.world));
  });

  it('stops at the scenario end', () => {
    const host = new SimHost('tiny');
    expect(host.advance(10_000)).toBe(43 * 96);
    expect(host.finished).toBe(true);
    expect(host.advance(5)).toBe(0);
  });
});
