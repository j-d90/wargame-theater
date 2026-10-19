import { loadScenario, validateScenario, type ResolvedScenario, type ScenarioInput } from '@tow/content';
import { createWorld, type CreateWorldOptions, type WorldState } from '../src/index.ts';

export function tinyWorld(options: CreateWorldOptions = {}): WorldState {
  return createWorld(loadScenario('tiny'), options);
}

/**
 * port -> depot-a -> depot-b, with formation "a" drawing from depot-a and "b"
 * from depot-b. Small enough to reason about tick by tick.
 */
export function chainScenarioRaw(): ScenarioInput {
  return {
    id: 'chain',
    name: 'Chain',
    seed: 7,
    days: 20,
    nations: ['blueland'],
    formations: [
      { id: 'root', name: 'Root', nation: 'blueland', echelon: 'corps', position: { x: 0, y: 0 }, supplyNode: 'depot-a' },
      { id: 'a', name: 'A', nation: 'blueland', echelon: 'division', parent: 'root', template: 'test-division', position: { x: 1, y: 0 } },
      { id: 'b', name: 'B', nation: 'blueland', echelon: 'division', parent: 'root', template: 'test-division', position: { x: 2, y: 0 }, supplyNode: 'depot-b' },
    ],
    supply: {
      nodes: [
        { id: 'port', name: 'Port', kind: 'source', position: { x: 0, y: 0 }, capacity: 100000, stock: 50000, productionPerTick: 50 },
        { id: 'depot-a', name: 'Depot A', kind: 'depot', position: { x: 1, y: 0 }, capacity: 1000, stock: 500 },
        { id: 'depot-b', name: 'Depot B', kind: 'depot', position: { x: 2, y: 0 }, capacity: 1000, stock: 500 },
      ],
      links: [
        { id: 'port-a', from: 'port', to: 'depot-a', mode: 'road', capacityPerTick: 40 },
        { id: 'a-b', from: 'depot-a', to: 'depot-b', mode: 'road', capacityPerTick: 20 },
      ],
    },
    events: [],
  };
}

export function resolve(raw: unknown): ResolvedScenario {
  const r = validateScenario(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}

export function chainWorld(mutate?: (raw: ScenarioInput) => void, options: CreateWorldOptions = {}) {
  const raw = chainScenarioRaw();
  mutate?.(raw);
  return createWorld(resolve(raw), options);
}
