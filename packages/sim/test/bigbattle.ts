// A synthetic stress battle: two lines of test divisions, each in contact
// with the next, so one detailed battle takes in all of them (8 battalions
// per division: 125 a side gives 2,000 battalions). Shared by the
// performance test and profiling scripts.
import type { ScenarioInput } from '@tow/content';
import { applyCommand, createWorld, step, type WorldState } from '../src/index.ts';
import { resolve } from './helpers.ts';

export function bigBattleRaw(perSide: number): ScenarioInput {
  const formations: ScenarioInput['formations'] = [
    { id: 'blue-hq', name: 'Blue HQ', nation: 'blueland', echelon: 'army', position: { x: 0, y: 0 }, supplyNode: 'blue-depot' },
    { id: 'red-hq', name: 'Red HQ', nation: 'redland', echelon: 'army', position: { x: 100, y: 0 }, supplyNode: 'red-depot' },
  ];
  for (let i = 0; i < perSide; i++) {
    formations.push({ id: `b${i}`, name: `B${i}`, nation: 'blueland', echelon: 'division', parent: 'blue-hq', template: 'test-division', position: { x: 50, y: i * 4 } });
    formations.push({ id: `r${i}`, name: `R${i}`, nation: 'redland', echelon: 'division', parent: 'red-hq', template: 'test-division', position: { x: 62, y: i * 4 } });
  }
  return {
    id: 'big-battle',
    name: 'Big battle',
    seed: 1,
    days: 2,
    nations: ['blueland', 'redland'],
    sides: [
      { id: 'blue', name: 'Blue', nations: ['blueland'] },
      { id: 'red', name: 'Red', nations: ['redland'] },
    ],
    formations,
    supply: {
      nodes: [
        { id: 'blue-depot', name: 'Blue depot', kind: 'source', side: 'blue', position: { x: 20, y: perSide * 2 }, capacity: 10_000_000, stock: 1_000_000, productionPerTick: 5000 },
        { id: 'red-depot', name: 'Red depot', kind: 'source', side: 'red', position: { x: 90, y: perSide * 2 }, capacity: 10_000_000, stock: 1_000_000, productionPerTick: 5000 },
      ],
      links: [],
    },
    events: [],
  };
}

/** The battle opened and blue attacking along the whole line. */
export function bigBattleWorld(perSide: number): WorldState {
  const w = createWorld(resolve(bigBattleRaw(perSide)), { seed: 1 });
  step(w);
  applyCommand(w, { type: 'openBattle', formation: 'b0' });
  for (let i = 0; i < perSide; i++) applyCommand(w, { type: 'move', formation: `b${i}`, to: { x: 120, y: i * 4 }, kind: 'attack' });
  return w;
}
