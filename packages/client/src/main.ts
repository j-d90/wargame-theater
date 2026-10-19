// M1 has no rendering. This page only proves the client builds against the sim;
// views, UI panels, and the sim worker arrive in later milestones.
import { loadScenario } from '@tow/content';
import { TICKS_PER_DAY, createWorld, run, summarize } from '@tow/sim';

const world = createWorld(loadScenario('tiny'));
run(world, TICKS_PER_DAY);
const s = summarize(world);

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.textContent = `Theater of War: M1 headless core. Tiny scenario, day ${s.day}, state hash ${s.hash}.`;
}
