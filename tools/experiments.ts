// The M4 experiments: do strategic choices measurably change the theater war?
// Each pairs two coalition policies across the same seeds. Usage: npm run experiments [-- --seeds 20]
import { parseArgs } from 'node:util';
import { EXPERIMENTS, runExperiment } from '../packages/sim/test/campaign.ts';

const { values } = parseArgs({ options: { seeds: { type: 'string' }, verbose: { type: 'boolean' } } });
const n = Number(values.seeds ?? 20);
for (const e of EXPERIMENTS) {
  const r = runExperiment(e, n);
  console.log(`\n${e.name}: ${r.passed}/${n} seed pairs show the effect (target ${Math.ceil(n * 0.8)})`);
  console.log(`  ${e.describe(r.a, r.b)}`);
  if (values.verbose) {
    r.a.forEach((a, i) => {
      const b = r.b[i]!;
      const row = (m: typeof a) =>
        `G ${m.groundWarDay?.toFixed(1) ?? '-'} KC ${m.groundWarDays === null ? '-' : (m.groundWarDay! + m.groundWarDays).toFixed(1)} loss ${(m.coalitionLossShare * 100).toFixed(2)}% RG ${(m.rgLeft * 100).toFixed(0)}% atG ${m.iraqPowerAtGroundWar === null ? '-' : (m.iraqPowerAtGroundWar * 100).toFixed(0)}% sup ${(m.minSupport / 10).toFixed(0)}% wd ${m.withdrawnActors.length} isr ${m.israelIntervened ? 'Y' : 'n'}`;
      console.log(`    seed ${a.seed} ${e.shows(a, b) ? 'ok  ' : 'MISS'}  A: ${row(a)}  |  B: ${row(b)}`);
    });
  }
}
