// Strategic AI. Once a day, each AI-controlled side weighs its strategic
// options: answering missile strikes on a neutral (Patriots, pressure for
// restraint), declaring a cease-fire once its aims are met or pressing on,
// and any strategic actions its doctrine calls for. Air shares for launcher
// hunting and strategic bombing are set with the rest of the air plan in
// theater.ts.

import { TICKS_PER_DAY, dayOf } from '../core/time.ts';
import { sortedIds, type SideState, type WorldState } from '../core/world.ts';
import { actionStatus, ceasefireInForce, takeAction } from '../strategy/strategic.ts';

function tryAction(world: WorldState, side: string, id: string): boolean {
  if (!actionStatus(world, side, id).available) return false;
  takeAction(world, side, id);
  return true;
}

export function strategicAiPhase(world: WorldState): void {
  const s = world.strategy;
  if (!s || ceasefireInForce(world)) return;
  for (const id of sortedIds(world.sides)) {
    const side = world.sides[id]!;
    const st = side.ai?.config.strategy;
    if (!side.ai?.controlled || !st) continue;
    ceasefireOrPursue(world, side);
    if (world.tick % TICKS_PER_DAY !== 0) continue;

    const actions = s.actions.filter((a) => a.side === id);
    if (st.scudResponse === 'historical' && s.missiles && s.missiles.side !== id) {
      // Defend whoever is being hit; press a wavering neutral to hold back.
      const struck = new Set(s.missiles.recent.map((x) => x.target));
      for (const a of actions.filter((x) => x.kind === 'deploy-patriots')) {
        if (a.target && struck.has(a.target) && (s.missiles.patriotsAt[a.target] ?? 0) < 2) tryAction(world, id, a.id);
      }
      for (const a of actions.filter((x) => x.kind === 'pressure')) {
        const target = a.target ? s.actors[a.target] : undefined;
        // A sharper command presses sooner: at 70% patience when fully competent, 50% at none.
        const threshold = 500 + side.ai.config.competence / 5;
        if (target?.status === 'neutral' && target.patience !== null && target.patience < threshold) tryAction(world, id, a.id);
      }
    }
    const withdrawing = side.ai.phase === 'withdraw';
    for (const u of st.useActions) {
      if (dayOf(world.tick) >= u.fromDay && (!u.whenWithdrawing || withdrawing)) tryAction(world, id, u.action);
    }
  }
}

/** After liberation: declare a cease-fire after a pause, or press on if doctrine says so. */
function ceasefireOrPursue(world: WorldState, side: SideState) {
  const s = world.strategy!;
  const st = side.ai!.config.strategy!;
  const actions = s.actions.filter((a) => a.side === side.id);
  if (st.pursueAfterLiberation) {
    // Press on as soon as the action allows it, without waiting for the rest of liberation.
    for (const a of actions.filter((x) => x.kind === 'pursue')) tryAction(world, side.id, a.id);
    return;
  }
  if (s.ceasefireSpec?.side !== side.id || s.liberatedTick === null) return;
  if (world.tick - s.liberatedTick < (st.ceasefireAfterHours * TICKS_PER_DAY) / 24) return;
  for (const a of actions.filter((x) => x.kind === 'declare-ceasefire')) tryAction(world, side.id, a.id);
}
