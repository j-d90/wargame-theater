// Headless runner: npm run sim -- <scenario-id | path/to/scenario.json> [--days N] [--seed N] [--units]
// Prints a state summary at the end of every game day. Scenarios with opposing
// sides print a campaign view (both sides run by AI); --units adds every unit.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadScenario } from '@tow/content';
import { TICKS_PER_DAY, createWorld, formatTick, run, summarize, type WorldSummary } from '@tow/sim';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: 'string' },
    seed: { type: 'string' },
    units: { type: 'boolean' },
  },
});

const target = positionals[0] ?? 'tiny';
const raw: unknown = target.endsWith('.json') ? JSON.parse(readFileSync(target, 'utf8')) : target;

let resolved;
try {
  resolved = loadScenario(raw);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const days = values.days !== undefined ? Number(values.days) : resolved.scenario.days;
const seed = values.seed !== undefined ? Number(values.seed) : undefined;
if (!Number.isInteger(days) || days <= 0) throw new Error(`--days must be a positive integer`);
if (seed !== undefined && !Number.isInteger(seed)) throw new Error(`--seed must be an integer`);

const world = createWorld(resolved, seed === undefined ? {} : { seed });
const pct = (permille: number) => `${(permille / 10).toFixed(1)}%`.padStart(6);

function calendar(s: WorldSummary): string {
  if (!s.startDate) return '';
  const d = new Date(`${s.startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + s.day);
  return ` ${d.toISOString().slice(0, 10)}`;
}

function printSides(s: WorldSummary): void {
  for (const side of s.sides) {
    const air = side.air ? `  air ${pct(side.air.pool)} sup ${pct(side.air.superiority)}` : '';
    const ai = side.ai ? `  [${side.ai.controlled ? side.ai.phase : 'player'}]` : '';
    console.log(
      `  ${side.name.padEnd(10)} power ${pct(side.combatPowerRatio)}  str ${String(side.strength).padStart(6)}/${side.initialStrength}` +
        `  units ${String(side.formations).padStart(2)}  lost ${side.losses}  surrendered ${side.surrendered}${air}${ai}`,
    );
  }
  const names = new Map(s.sides.map((x) => [x.id, x.name]));
  const objectives = s.objectives.map((o) => `${o.name}: ${o.holder ? names.get(o.holder) : '-'}`);
  console.log(`  objectives: ${objectives.join(' | ')}`);
  console.log(`  engagements: ${s.engagements.length}`);
  const st = s.strategy;
  if (!st) return;
  const gauge = (label: string, v: number | null) => (v === null ? '' : ` ${label} ${pct(v).trim()}`);
  const actors = st.actors.map(
    (a) => `${a.name}${gauge('sup', a.support)}${gauge('coh', a.cohesion)}${gauge('pat', a.patience)}${gauge('stab', a.stability)}${a.status === 'active' || a.status === 'neutral' ? '' : ` [${a.status}]`}`,
  );
  console.log(`  actors: ${actors.join(' | ')}`);
  if (st.missiles) console.log(`  missiles: ${st.missiles.launchers} launchers, ${st.missiles.fired} fired, ${st.missiles.hits} hit, suppression ${pct(st.missiles.suppression).trim()}`);
  // Events since the previous summary, oldest first.
  for (const e of [...st.log].reverse().filter((x) => x.tick > s.tick - TICKS_PER_DAY)) console.log(`  ${e.kind === 'crisis' ? '!!' : e.kind === 'warning' ? ' !' : '  '} ${e.text}`);
}

function printDay(s: WorldSummary): void {
  console.log(`\n=== ${formatTick(s.tick)}${calendar(s)} (end of day ${s.day - 1})  hash ${s.hash}`);
  const campaign = s.sides.length > 1;
  if (campaign) printSides(s);
  if (campaign && !values.units) return;
  for (const f of s.active) {
    const tag = f.aggregated ? ' [agg]' : '';
    console.log(
      `  ${(f.name + tag).padEnd(22)} str ${String(f.strength).padStart(5)}  rdy ${pct(f.readiness)}  mor ${pct(f.morale)}` +
        `  sup ${pct(f.supplyLevel)}  mob ${pct(f.mobility)}  cp ${String(f.combatPower).padStart(5)}`,
    );
  }
  const nodes = s.nodes.map((n) => `${n.id} ${n.stock}/${n.capacity}${n.disrupted ? ' CUT' : ''}`);
  console.log(`  depots: ${nodes.join(' | ')}`);
  const links = s.links.map((l) => `${l.id} ${l.disrupted ? 'CUT' : `${l.flow}/${l.capacity}`}`);
  console.log(`  links:  ${links.join(' | ')}`);
}

console.log(`${resolved.scenario.name}  seed ${world.seed}  ${days} days`);
const started = performance.now();
run(world, days * TICKS_PER_DAY, (w) => {
  if (w.tick % TICKS_PER_DAY === 0) printDay(summarize(w));
});
const elapsed = performance.now() - started;
console.log(
  `\nDone: ${days * TICKS_PER_DAY} ticks in ${elapsed.toFixed(0)} ms ` +
    `(${(elapsed / (days * TICKS_PER_DAY)).toFixed(3)} ms/tick, includes printing). Final hash ${summarize(world).hash}`,
);
