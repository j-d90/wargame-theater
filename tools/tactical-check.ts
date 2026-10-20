// Detailed resolver vs aggregate combat on standard engagements.
// Usage: npm run tactical-check -- [--seeds N] [--only id] [--verbose]
import { ENGAGEMENTS, checkEngagement } from '../packages/sim/test/tactical.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const seeds = Number(opt('--seeds') ?? 20);
const only = opt('--only');
const verbose = args.includes('--verbose');
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const outs = (o: Record<string, number>) => Object.entries(o).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');

let failed = 0;
for (const e of ENGAGEMENTS) {
  if (only && e.id !== only) continue;
  const t0 = performance.now();
  const c = checkEngagement(e, seeds);
  const ok = c.passes >= Math.ceil(seeds * 0.8);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${e.name}: ${c.passes}/${seeds} seeds agree (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  for (const side of ['blue', 'red']) {
    console.log(`    ${side.padEnd(4)} losses ${pct(c.mean.aggregate[side]!)} aggregate, ${pct(c.mean.detailed[side]!)} detailed; outcome ${outs(c.outcomes.aggregate[side]!)} | ${outs(c.outcomes.detailed[side]!)}`);
  }
  if (verbose) for (const f of c.failures) console.log(`      ${f}`);
}
process.exitCode = failed > 0 ? 1 : 0;
