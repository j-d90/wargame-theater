// Headless replay viewer: npm run replay -- save.json [--decisions] [--quiet]
// Rebuilds a saved game from its scenario, seed and command log, prints a line
// per game day and the decisions along the way, and checks that the result
// matches the saved snapshot exactly. Exits non-zero if it doesn't.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadScenario } from '@tow/content';
import { TICKS_PER_DAY, checkSave, createWorld, hashState, replay, summarize } from '@tow/sim';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { decisions: { type: 'boolean' }, quiet: { type: 'boolean' } } });
const file = positionals[0];
if (!file) {
  console.error('usage: npm run replay -- save.json [--decisions] [--quiet]');
  process.exit(2);
}

const save = checkSave(JSON.parse(readFileSync(file, 'utf8')));
const world = createWorld(loadScenario(save.scenarioId), { seed: save.seed });
console.log(`${save.scenarioId}, seed ${save.seed}: ${save.commands.length} orders over ${(save.tick / TICKS_PER_DAY).toFixed(1)} days`);

let shown = 0;
const started = performance.now();
replay(world, save.commands, save.tick, (w) => {
  if (values.decisions) {
    for (const d of w.decisions.slice(shown)) {
      if (d.level !== 'minor') console.log(`  day ${(d.tick / TICKS_PER_DAY).toFixed(1)}  ${d.level.padEnd(8)} ${d.text}`);
    }
    shown = w.decisions.length;
  }
  if (!values.quiet && w.tick % TICKS_PER_DAY === 0) {
    const s = summarize(w);
    const sides = s.sides.map((x) => `${x.name} ${(x.combatPowerRatio / 10).toFixed(0)}%`).join(', ');
    const held = s.objectives.filter((o) => o.holder).map((o) => `${o.name}: ${s.sides.find((x) => x.id === o.holder)?.name ?? o.holder}`);
    console.log(`day ${String(s.day).padStart(2)}  power ${sides}${held.length ? `  |  ${held.length} objectives held` : ''}`);
  }
});
const ok = hashState(world) === save.hash;
console.log(`${ok ? 'MATCH' : 'MISMATCH'}: replayed to day ${(world.tick / TICKS_PER_DAY).toFixed(1)} in ${((performance.now() - started) / 1000).toFixed(1)} s; hash ${hashState(world)} vs saved ${save.hash}`);
process.exitCode = ok ? 0 : 1;
