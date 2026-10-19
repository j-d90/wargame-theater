// A tiny two-sided scenario on open ground for combat, air and AI tests.
import type { ScenarioInput } from '@tow/content';
import { createWorld, type CreateWorldOptions, type WorldState } from '../src/index.ts';
import { resolve } from './helpers.ts';

export function duelRaw(): ScenarioInput {
  return {
    id: 'duel',
    name: 'Duel',
    seed: 3,
    days: 30,
    nations: ['blueland', 'redland'],
    sides: [
      { id: 'blue', name: 'Blue', nations: ['blueland'] },
      { id: 'red', name: 'Red', nations: ['redland'] },
    ],
    formations: [
      { id: 'blue-hq', name: 'Blue HQ', nation: 'blueland', echelon: 'corps', position: { x: 0, y: 0 }, supplyNode: 'blue-depot' },
      { id: 'b1', name: 'Blue 1', nation: 'blueland', echelon: 'division', parent: 'blue-hq', template: 'test-division', position: { x: 0, y: 0 } },
      { id: 'b2', name: 'Blue 2', nation: 'blueland', echelon: 'division', parent: 'blue-hq', template: 'test-division', position: { x: 0, y: 40 } },
      { id: 'red-hq', name: 'Red HQ', nation: 'redland', echelon: 'corps', position: { x: 100, y: 0 }, supplyNode: 'red-depot' },
      { id: 'r1', name: 'Red 1', nation: 'redland', echelon: 'division', parent: 'red-hq', template: 'test-division', position: { x: 100, y: 0 } },
      { id: 'r2', name: 'Red 2', nation: 'redland', echelon: 'division', parent: 'red-hq', template: 'test-division', position: { x: 100, y: 40 } },
    ],
    supply: {
      nodes: [
        { id: 'blue-port', name: 'Blue Port', kind: 'source', side: 'blue', position: { x: -100, y: 0 }, capacity: 100000, stock: 50000, productionPerTick: 100 },
        { id: 'blue-depot', name: 'Blue Depot', kind: 'depot', side: 'blue', position: { x: -20, y: 20 }, capacity: 10000, stock: 5000, mobile: true, speedKmPerDay: 100 },
        { id: 'red-port', name: 'Red Port', kind: 'source', side: 'red', position: { x: 200, y: 0 }, capacity: 100000, stock: 50000, productionPerTick: 100 },
        { id: 'red-depot', name: 'Red Depot', kind: 'depot', side: 'red', position: { x: 120, y: 20 }, capacity: 10000, stock: 5000 },
      ],
      links: [
        { id: 'blue-road', from: 'blue-port', to: 'blue-depot', mode: 'road', capacityPerTick: 60 },
        { id: 'red-road', from: 'red-port', to: 'red-depot', mode: 'road', capacityPerTick: 60 },
      ],
    },
    objectives: [{ id: 'town', name: 'Town', position: { x: 60, y: 20 }, holder: 'red', radiusKm: 20 }],
    events: [],
  };
}

export function duelWorld(mutate?: (raw: ScenarioInput) => void, options: CreateWorldOptions = {}): WorldState {
  const raw = duelRaw();
  mutate?.(raw);
  return createWorld(resolve(raw), options);
}

/** Put two formations face to face, `km` apart. */
export function placeAt(w: WorldState, id: string, x: number, y: number) {
  w.formations[id]!.position = { x, y };
}
