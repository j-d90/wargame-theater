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

describe('zooming into a battle', () => {
  it("opens Desert Storm's largest battle and sends its battalions within the 200 ms budget", { timeout: 60_000 }, () => {
    const host = new SimHost('desert-storm');
    // Run AI against AI into the ground war.
    host.command({ type: 'setAiControl', side: 'coalition', controlled: true });
    host.advance(37 * 96);
    // The largest group of formations linked by contact.
    const links = new Map<string, string[]>();
    for (const [a, b] of host.world.contacts) {
      links.set(a, [...(links.get(a) ?? []), b]);
      links.set(b, [...(links.get(b) ?? []), a]);
    }
    let best: string[] = [];
    const seen = new Set<string>();
    for (const start of links.keys()) {
      if (seen.has(start)) continue;
      const group = [start];
      seen.add(start);
      for (let i = 0; i < group.length; i++) {
        for (const n of links.get(group[i]!) ?? []) if (!seen.has(n)) (seen.add(n), group.push(n));
      }
      if (group.length > best.length) best = group;
    }
    expect(best.length).toBeGreaterThanOrEqual(2);

    const t0 = performance.now();
    const battle = host.openBattle(best[0]!);
    const summary = host.snapshot(battle);
    const ms = performance.now() - t0;
    expect(summary.tactical?.battle.id).toBe(battle);
    expect(summary.tactical!.units.length).toBeGreaterThan(best.length);
    expect(ms).toBeLessThan(200);
    // Zooming out again: the theater summary without battalion detail.
    const t1 = performance.now();
    const theater = host.snapshot(null);
    expect(performance.now() - t1).toBeLessThan(200);
    expect(theater.tactical).toBeNull();
    expect(theater.active.filter((f) => f.battle === battle).length).toBe(best.length);
  });

  it('explains why a battle cannot be opened', () => {
    const host = new SimHost('desert-storm');
    expect(() => host.openBattle('us-1ad')).toThrow(/not in contact/);
  });
});
