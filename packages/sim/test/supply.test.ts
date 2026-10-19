import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_DAY,
  activeFormations,
  applyCommand,
  combatPower,
  linkThroughput,
  mobility,
  run,
  step,
  summarize,
  supplyLevel,
  type WorldState,
} from '../src/index.ts';
import { chainWorld, tinyWorld } from './helpers.ts';

const f = (w: WorldState, id: string) => w.formations[id]!.stats;
const node = (w: WorldState, id: string) => w.supply.nodes[id]!;
const link = (w: WorldState, id: string) => w.supply.links[id]!;

function totalSupply(w: WorldState): number {
  let total = 0;
  for (const n of Object.values(w.supply.nodes)) total += n.stock;
  for (const a of activeFormations(w)) total += a.stats.stock;
  return total;
}

describe('supply propagation', () => {
  it('keeps every formation fed and ready in steady state', () => {
    const w = chainWorld();
    run(w, 5 * TICKS_PER_DAY);
    for (const id of ['a', 'b']) {
      expect(supplyLevel(f(w, id))).toBeGreaterThan(950);
      expect(f(w, id).readiness).toBe(1000);
    }
  });

  it('moves supply one hop per tick', () => {
    const w = chainWorld((raw) => {
      for (const n of raw.supply.nodes) if (n.kind === 'depot') n.stock = 0;
          });
    step(w);
    expect(node(w, 'depot-a').stock).toBeGreaterThan(0);
    expect(node(w, 'depot-b').stock).toBe(0);
    step(w);
    expect(node(w, 'depot-b').stock).toBeGreaterThan(0);
  });

  it('conserves supply: the total changes only by production minus consumption', () => {
    const w = chainWorld();
    for (let t = 0; t < 3 * TICKS_PER_DAY; t++) {
      const before = totalSupply(w);
      const produced = Math.min(50, node(w, 'port').capacity - node(w, 'port').stock);
      const consumed = activeFormations(w).reduce((s, a) => s + Math.min(a.stats.supplyPerTick, a.stats.stock + 1e9), 0);
      step(w);
      expect(totalSupply(w)).toBe(before + produced - consumed);
    }
  });

  it('cutting a link starves only what is downstream of it', () => {
    const w = chainWorld();
    applyCommand(w, { type: 'setDisrupted', target: { kind: 'link', id: 'a-b' }, disrupted: true });
    let peak = node(w, 'depot-b').stock;
    for (let t = 0; t < 8 * TICKS_PER_DAY; t++) {
      step(w);
      expect(link(w, 'a-b').lastFlow).toBe(0);
      expect(node(w, 'depot-b').stock).toBeLessThanOrEqual(peak);
      peak = node(w, 'depot-b').stock;
    }
    // Downstream: depot and unit run dry, readiness and morale fall, then mobility and combat power.
    expect(node(w, 'depot-b').stock).toBe(0);
    expect(f(w, 'b').stock).toBe(0);
    expect(f(w, 'b').readiness).toBeLessThan(500);
    expect(f(w, 'b').morale).toBeLessThan(1000);
    expect(mobility(f(w, 'b'), w.rules)).toBeLessThan(1000);
    expect(combatPower(f(w, 'b'))).toBeLessThan(combatPower(f(w, 'a')));
    // Upstream is untouched.
    expect(f(w, 'a').readiness).toBe(1000);
    expect(supplyLevel(f(w, 'a'))).toBeGreaterThan(950);
  });

  it('disrupting a node propagates through every hop below it', () => {
    const w = chainWorld();
    applyCommand(w, { type: 'setDisrupted', target: { kind: 'node', id: 'depot-a' }, disrupted: true });
    run(w, 8 * TICKS_PER_DAY);
    expect(link(w, 'port-a').lastFlow).toBe(0);
    expect(link(w, 'a-b').lastFlow).toBe(0);
    expect(f(w, 'a').readiness).toBeLessThan(500);
    expect(f(w, 'b').readiness).toBeLessThan(500);
    // A disrupted node keeps its stock but can't use it.
    expect(node(w, 'depot-a').stock).toBe(500);
  });

  it('restoring a link lets downstream units recover', () => {
    const w = chainWorld();
    applyCommand(w, { type: 'setDisrupted', target: { kind: 'link', id: 'a-b' }, disrupted: true });
    run(w, 8 * TICKS_PER_DAY);
    const low = f(w, 'b').readiness;
    applyCommand(w, { type: 'setDisrupted', target: { kind: 'link', id: 'a-b' }, disrupted: false });
    run(w, 8 * TICKS_PER_DAY);
    expect(f(w, 'b').readiness).toBeGreaterThan(low);
    expect(supplyLevel(f(w, 'b'))).toBeGreaterThan(900);
  });

  it('link capacity caps throughput, and shortfall shows up downstream', () => {
    // Demand at depot-b (10/tick) exceeds a 4/tick link.
    const w = chainWorld((raw) => {
      raw.supply.links[1]!.capacityPerTick = 4;
      raw.supply.nodes[2]!.stock = 0;
    });
    for (let t = 0; t < 10 * TICKS_PER_DAY; t++) {
      step(w);
      expect(link(w, 'a-b').lastFlow).toBeLessThanOrEqual(linkThroughput(link(w, 'a-b')));
    }
    expect(link(w, 'a-b').lastFlow).toBe(4);
    expect(f(w, 'b').readiness).toBeLessThan(1000);
  });

  it('daily efficiency rolls stay within each link\'s variance', () => {
    const w = chainWorld((raw) => {
      raw.supply.links[0]!.variance = 200;
    });
    for (let d = 0; d < 20; d++) {
      run(w, TICKS_PER_DAY);
      expect(link(w, 'port-a').efficiency).toBeGreaterThanOrEqual(800);
      expect(link(w, 'port-a').efficiency).toBeLessThanOrEqual(1000);
      expect(link(w, 'a-b').efficiency).toBe(1000); // variance 0
    }
  });

  it('an aggregated formation draws from its own supply node', () => {
    const w = chainWorld((raw) => {
      raw.formations[0]!.aggregated = true; // root draws from depot-a
    });
    applyCommand(w, { type: 'setDisrupted', target: { kind: 'link', id: 'a-b' }, disrupted: true });
    run(w, 6 * TICKS_PER_DAY);
    // b's cut is invisible while the corps is one block fed from depot-a (M1 LOD rule).
    expect(f(w, 'root').readiness).toBe(1000);
  });

  it('tiny scenario: 3rd Division starves after the day-15 cut and recovers after day 25', () => {
    const w = tinyWorld();
    run(w, 22 * TICKS_PER_DAY);
    let s = summarize(w);
    const by = (id: string) => s.active.find((a) => a.id === id)!;
    expect(by('div-3').readiness).toBeLessThan(500);
    expect(by('div-3').supplyLevel).toBe(0);
    expect(by('div-2').readiness).toBe(1000);
    expect(by('bde-1-1').readiness).toBe(1000);

    run(w, 21 * TICKS_PER_DAY);
    s = summarize(w);
    expect(s.day).toBe(43);
    expect(by('div-3').readiness).toBe(1000);
    expect(by('div-1').aggregated).toBe(true);
  });
});
