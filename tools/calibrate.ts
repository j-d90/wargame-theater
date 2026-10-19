// Runs the Desert Storm campaign AI-vs-AI across seeds and checks it against
// the plausibility bands. Usage: npm run calibrate [-- --seeds 20]
import { parseArgs } from 'node:util';
import { missedBands, runCampaign } from '../packages/sim/test/campaign.ts';

const { values } = parseArgs({ options: { seeds: { type: 'string' } } });
const n = Number(values.seeds ?? 20);
const f = (v: number | null, d = 1) => (v === null ? '  -  ' : v.toFixed(d).padStart(5));
const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(6);
let passed = 0;
console.log('seed  G-day  G-days  KC holder  Iraq left  surr  coal loss  RG left  reg left  ms/tick');
for (let seed = 1; seed <= n; seed++) {
  const m = runCampaign(seed);
  const missed = missedBands(m);
  if (missed.length === 0) passed++;
  console.log(
    `${String(seed).padStart(4)}  ${f(m.groundWarDay)}  ${f(m.groundWarDays)}   ${(m.kuwaitCityHolder ?? '-').padEnd(9)}  ${pct(m.iraqPowerLeft)}  ${pct(m.iraqSurrenderShare)}  ${pct(m.coalitionLossShare)}  ${pct(m.rgLeft)}   ${pct(m.regularLeft)}  ${m.msPerTick.toFixed(2)}` +
      (missed.length ? `   MISS: ${missed.join('; ')}` : ''),
  );
}
console.log(`\n${passed}/${n} runs inside every band (target: at least ${Math.ceil(n * 0.9)}).`);
