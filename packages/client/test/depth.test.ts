// M6 acceptance: one campaign playable in about 10 minutes (Quick) or across
// many hours (Commander), saves that load and replays that match.
import { describe, expect, it } from 'vitest';
import { hashState, lastDecisionId, type DecisionFilter } from '@tow/sim';
import { ReplayHost, SimHost } from '../src/worker/host.ts';
import { DEPTH } from '../src/worker/protocol.ts';

/** Skip from decision to decision, as the player pressing "Next decision", until the war ends. */
function session(filter: DecisionFilter) {
  const host = new SimHost('desert-storm');
  // The AI drives the coalition throughout, standing in for the player's default answers.
  host.command({ type: 'setAiControl', side: 'coalition', controlled: true });
  let seen = lastDecisionId(host.world);
  const stops: string[] = [];
  const t0 = performance.now();
  while (!host.finished && host.world.strategy!.ceasefire.tick === null) {
    const r = host.resolve(seen, 'coalition', filter, 60_000);
    if (r.decision) {
      seen = r.decision.id;
      stops.push(`day ${(r.decision.tick / 96).toFixed(1)}: ${r.decision.text}`);
    }
  }
  return { stops, ms: performance.now() - t0, host };
}

describe('the depth dial', () => {
  it('Quick plays the whole campaign in a handful of stops: about 10 minutes', { timeout: 120_000 }, () => {
    const { stops, ms, host } = session(DEPTH.quick.filter);
    console.log(`Quick: ${stops.length} stops, ${(ms / 1000).toFixed(1)} s of simulation\n  ${stops.join('\n  ')}`);
    expect(host.world.strategy!.ceasefire.tick).not.toBeNull();
    expect(stops.length).toBeGreaterThanOrEqual(1);
    expect(stops.length).toBeLessThanOrEqual(12);
    expect(ms).toBeLessThan(30_000);
  });

  it('Commander stops for the player far more often: a game of many hours', { timeout: 120_000 }, () => {
    const commander = session(DEPTH.commander.filter);
    const operational = session(DEPTH.operational.filter);
    console.log(`Commander: ${commander.stops.length} stops; Operational: ${operational.stops.length}`);
    expect(commander.stops.length).toBeGreaterThanOrEqual(150);
    expect(operational.stops.length).toBeGreaterThan(12);
    expect(operational.stops.length).toBeLessThan(commander.stops.length);
  });
});

describe('auto-resolve', () => {
  it('gives exactly the same war as running the clock, however it is sliced', () => {
    const plain = new SimHost('desert-storm', { seed: 4 });
    plain.advance(600);
    const sliced = new SimHost('desert-storm', { seed: 4 });
    // A filter nothing passes, and a tiny time budget: many short slices.
    const never = { minLevel: 'critical' as const, kinds: { strategic: false, 'action-available': false, offensive: false } };
    while (sliced.world.tick < 600) {
      const r = sliced.resolve(lastDecisionId(sliced.world), 'coalition', never, 0.5);
      if (r.ran === 0) sliced.advance(1);
      if (sliced.world.tick > 600) break;
    }
    // Slices can overshoot by a tick or two; compare at the same tick.
    const target = sliced.world.tick;
    plain.advance(target - plain.world.tick);
    expect(hashState(sliced.world)).toBe(hashState(plain.world));
  });
});

describe('saves', () => {
  it('a loaded save continues exactly as the unbroken game, and its log replays to the same world', () => {
    const a = new SimHost('desert-storm', { seed: 5, competence: { iraq: 1000 } });
    a.advance(200);
    a.command({ type: 'move', formation: 'us-1ad', to: { x: 700, y: 800 } });
    a.advance(300);
    const save = JSON.parse(JSON.stringify(a.save({ name: 'x' })));
    const { host: b, rebuilt } = SimHost.fromSave(save);
    expect(rebuilt).toBe(false);
    expect(b.world.sides['iraq']!.ai!.config.competence).toBe(1000);
    a.advance(400);
    b.advance(400);
    expect(hashState(b.world)).toBe(hashState(a.world));
    expect(b.verify()).toBe(true);
  });

  it('rebuilds a save from an older version by replaying its orders', () => {
    const a = new SimHost('desert-storm');
    a.advance(150);
    a.command({ type: 'setAiCompetence', side: 'iraq', competence: 250 });
    a.advance(150);
    const save = { ...a.save(), version: 0, world: null as never };
    const { host, rebuilt } = SimHost.fromSave(save);
    expect(rebuilt).toBe(true);
    expect(hashState(host.world)).toBe(hashState(a.world));
  });
});

describe('replays', () => {
  it('play back a saved game exactly, and seek back and forth to any point', () => {
    const game = new SimHost('desert-storm', { seed: 9 });
    game.advance(300);
    game.command({ type: 'move', formation: 'us-3ad', to: { x: 650, y: 820 } });
    game.advance(500);
    const save = game.save();
    const r = new ReplayHost(save);
    expect(r.endTick).toBe(800);
    r.advance(800);
    expect(r.matchesSave()).toBe(true);
    // Seek back to before the order, then forward past it.
    const mid = new SimHost('desert-storm', { seed: 9 });
    mid.advance(300);
    mid.command({ type: 'move', formation: 'us-3ad', to: { x: 650, y: 820 } });
    mid.advance(250);
    r.seek(100);
    expect(r.world.tick).toBe(100);
    r.seek(550);
    expect(hashState(r.world)).toBe(hashState(mid.world));
    r.seek(800);
    expect(r.matchesSave()).toBe(true);
  });
});
