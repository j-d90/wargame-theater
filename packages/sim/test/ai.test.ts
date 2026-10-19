import { describe, expect, it } from 'vitest';
import type { ScenarioInput } from '@tow/content';
import { TICKS_PER_DAY, applyCommand, decisionInterval, distanceKm, run, step, type WorldState } from '../src/index.ts';
import { duelWorld } from './duel.ts';

function offensiveVsDefensive(edit?: (raw: ScenarioInput) => void): WorldState {
  return duelWorld((raw) => {
    raw.sides![0]!.ai = {
      posture: 'offensive',
      competence: 1000,
      offensive: {
        earliestDay: 2,
        latestDay: 4,
        launchWhenEnemyBelow: 0,
        plans: [{ corps: 'blue-hq', assembly: { x: 0, y: 20 }, objectives: ['town'], depot: 'blue-depot' }],
      },
    };
    raw.sides![1]!.ai = {
      posture: 'defensive',
      competence: 1000,
      defensive: { reserves: ['red-hq'], reactionKm: 60, withdrawBelow: 100, withdrawWhenLost: [], withdrawTo: { x: 180, y: 20 } },
    };
    edit?.(raw);
  });
}

const near = (w: WorldState, id: string, p: { x: number; y: number }, km: number) => distanceKm(w.formations[id]!.position, p) <= km;

describe('theater AI', () => {
  it('decides more often at higher competence', () => {
    expect(decisionInterval(1000)).toBeLessThan(decisionInterval(0));
  });

  it('gathers at the assembly area, then launches on the latest day and takes the objective', () => {
    const w = offensiveVsDefensive();
    run(w, TICKS_PER_DAY);
    expect(w.sides['blue']!.ai!.phase).toBe('prepare');
    expect(near(w, 'b1', { x: 0, y: 20 }, 25)).toBe(true);
    run(w, 4 * TICKS_PER_DAY);
    expect(w.sides['blue']!.ai!.phase).toBe('offensive');
    expect(w.sides['blue']!.ai!.offensiveTick).toBe(4 * TICKS_PER_DAY);
    run(w, 10 * TICKS_PER_DAY);
    expect(w.objectives['town']!.holder).toBe('blue');
  });

  it('pulls its mobile depot forward behind the advance', () => {
    const w = offensiveVsDefensive();
    const start = { ...w.supply.nodes['blue-depot']!.position };
    run(w, 8 * TICKS_PER_DAY);
    expect(w.supply.nodes['blue-depot']!.position.x).toBeGreaterThan(start.x + 20);
  });

  it('defending reserves strike enemies that come within reach', () => {
    const w = offensiveVsDefensive((raw) => {
      raw.formations.find((f) => f.id === 'b1')!.position = { x: 60, y: 0 };
    });
    applyCommand(w, { type: 'setAiControl', side: 'blue', controlled: false });
    step(w);
    expect(w.formations['r1']!.order?.kind).toBe('attack');
  });

  it('withdraws once a listed objective is lost', () => {
    const w = offensiveVsDefensive((raw) => {
      raw.sides![1]!.ai!.defensive!.withdrawWhenLost = ['town'];
    });
    applyCommand(w, { type: 'setAiControl', side: 'blue', controlled: false });
    w.objectives['town']!.holder = 'blue';
    step(w);
    expect(w.sides['red']!.ai!.phase).toBe('withdraw');
    expect(w.formations['r2']!.order?.kind).toBe('retreat');
  });

  it('gives no orders while a player controls the side', () => {
    const w = offensiveVsDefensive();
    applyCommand(w, { type: 'setAiControl', side: 'blue', controlled: false });
    run(w, 2 * TICKS_PER_DAY);
    expect(w.formations['b1']!.order).toBeNull();
    expect(w.formations['b1']!.position).toEqual({ x: 0, y: 0 });
  });
});
