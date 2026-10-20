import { describe, expect, it } from 'vitest';
import { latLonToXY, loadScenario } from '@tow/content';
import {
  TICKS_PER_DAY,
  actionStatus,
  activeFormations,
  applyCommand,
  beyondMandate,
  createWorld,
  movementRefusal,
  regionAt,
  run,
  step,
  strategyPhase,
  type WorldState,
} from '../src/index.ts';

const resolved = loadScenario('desert-storm');
const world = () => createWorld(resolved);
const at = (lat: number, lon: number) => latLonToXY(resolved.map!.frame, lat, lon);
const actor = (w: WorldState, id: string) => w.strategy!.actors[id]!;
const act = (w: WorldState, side: string, action: string) => applyCommand(w, { type: 'strategicAction', side, action });

/** Hand both sides to the player so the strategic AI doesn't act during a test. */
function manual(w: WorldState): WorldState {
  applyCommand(w, { type: 'setAiControl', side: 'coalition', controlled: false });
  applyCommand(w, { type: 'setAiControl', side: 'iraq', controlled: false });
  return w;
}

describe('regions, mandate and legal limits', () => {
  it('knows which country a position is in', () => {
    const w = world();
    expect(regionAt(w, at(29.3, 47.7))).toBe('kuwait');
    expect(regionAt(w, at(32.0, 44.5))).toBe('iraq');
    expect(regionAt(w, at(26.0, 45.0))).toBe('saudi-arabia');
    expect(regionAt(w, at(27.3, 50.6))).toBeNull(); // the Gulf
  });

  it('allows southern Iraq under the mandate but not deeper', () => {
    const w = world();
    expect(beyondMandate(w, 'coalition', at(30.5, 46.5))).toBe(false); // south of 31.15 N
    expect(beyondMandate(w, 'coalition', at(32.5, 45.8))).toBe(true); // Al Kut
    expect(beyondMandate(w, 'iraq', at(32.5, 45.8))).toBe(false); // the mandate binds only the coalition
  });

  it('Arab contingents refuse orders into Iraq in realistic mode, not in sandbox', () => {
    const w = manual(world());
    const egypt = w.formations['eg-3mech']!;
    const busayyah = at(30.12, 46.12);
    expect(movementRefusal(w, egypt, busayyah)).toMatch(/Egyptian government will not send its forces into iraq/);
    expect(() => applyCommand(w, { type: 'move', formation: 'eg-3mech', to: busayyah })).toThrow(/will not send/);
    expect(movementRefusal(w, w.formations['us-1ad']!, busayyah)).toBeNull();
    applyCommand(w, { type: 'setRulesMode', mode: 'sandbox' });
    expect(() => applyCommand(w, { type: 'move', formation: 'eg-3mech', to: busayyah })).not.toThrow();
  });
});

describe('strategic actions and escalation locks', () => {
  it('locks countervalue bombing under realistic rules and unlocks it in sandbox', () => {
    const w = manual(world());
    const status = actionStatus(w, 'coalition', 'countervalue-bombing');
    expect(status).toMatchObject({ available: false, locked: true });
    expect(status.reason).toMatch(/war crime/);
    expect(() => act(w, 'coalition', 'countervalue-bombing')).toThrow(/war crime/);
    applyCommand(w, { type: 'setRulesMode', mode: 'sandbox' });
    const before = actor(w, 'egyptian-government').cohesion!;
    act(w, 'coalition', 'countervalue-bombing');
    // The lock is lifted, but the modelled consequences still apply.
    expect(actor(w, 'egyptian-government').cohesion).toBe(before - 350);
  });

  it('charges political capital, enforces cooldowns and one-shot actions', () => {
    const w = manual(world());
    actor(w, 'israeli-government').patience = 500;
    const capital = w.strategy!.capital['coalition']!;
    act(w, 'coalition', 'press-israel');
    expect(w.strategy!.capital['coalition']).toBe(capital - 100);
    expect(actor(w, 'israeli-government').patience).toBe(650);
    expect(actionStatus(w, 'coalition', 'press-israel').reason).toMatch(/available again in 3 d/);
    run(w, 3 * TICKS_PER_DAY);
    expect(actionStatus(w, 'coalition', 'press-israel').available).toBe(true);
    w.strategy!.capital['coalition'] = 50;
    expect(actionStatus(w, 'coalition', 'press-israel').reason).toMatch(/needs 100 political capital/);
  });

  it('checks requirements and side', () => {
    const w = manual(world());
    expect(actionStatus(w, 'coalition', 'pursue-into-iraq').reason).toMatch(/needs Kuwait City/);
    expect(actionStatus(w, 'coalition', 'declare-ceasefire').reason).toMatch(/conditions are not met/);
    expect(actionStatus(w, 'iraq', 'press-israel').reason).toMatch(/not this side/);
    expect(() => act(w, 'coalition', 'nonsense')).toThrow(/unknown action/);
  });

  it('deploys Patriots only while batteries are free', () => {
    const w = manual(world());
    act(w, 'coalition', 'patriots-israel');
    act(w, 'coalition', 'patriots-israel');
    expect(w.strategy!.missiles!.patriotsAt['israel']).toBe(2);
    expect(actionStatus(w, 'coalition', 'patriots-israel').reason).toMatch(/no Patriot batteries free/);
  });
});

describe('the missile crisis', () => {
  it('unanswered missile hits run down Israeli patience until Israel intervenes, splitting the coalition', () => {
    const w = manual(world());
    const m = w.strategy!.missiles!;
    m.launchers = 100;
    m.launchesPerLauncherPerDay = 0.2;
    let day = 0;
    while (actor(w, 'israeli-government').status === 'neutral' && day++ < 20) run(w, TICKS_PER_DAY);
    expect(actor(w, 'israeli-government').status).toBe('intervened');
    expect(m.fired).toBeGreaterThan(0);
    run(w, TICKS_PER_DAY);
    expect(actor(w, 'egyptian-government').status).toBe('withdrawn');
    expect(w.formations['eg-3mech']!.status).toBe('withdrawn');
    expect(activeFormations(w).some((f) => f.nation === 'egypt')).toBe(false);
    expect(w.strategy!.log.some((e) => e.kind === 'crisis' && /Israeli government/.test(e.text))).toBe(true);
  });

  it('launcher hunting suppresses launches', () => {
    const quiet = manual(world());
    const hunting = manual(world());
    for (const w of [quiet, hunting]) w.strategy!.missiles!.launchesPerLauncherPerDay = 0.3;
    const share = (scudHunt: number) => ({ counterAir: 1000 - scudHunt, interdiction: 0, attrition: 0, support: 0, scudHunt, strategic: 0 });
    applyCommand(quiet, { type: 'setAirAllocation', side: 'coalition', allocation: share(0) });
    applyCommand(hunting, { type: 'setAirAllocation', side: 'coalition', allocation: share(400) });
    run(quiet, 10 * TICKS_PER_DAY);
    run(hunting, 10 * TICKS_PER_DAY);
    expect(hunting.strategy!.missiles!.suppression).toBeGreaterThan(400);
    expect(hunting.strategy!.missiles!.fired).toBeLessThan(quiet.strategy!.missiles!.fired * 0.75);
    expect(hunting.strategy!.missiles!.launchers).toBeLessThan(quiet.strategy!.missiles!.launchers);
  });
});

describe('withdrawal costs', () => {
  it('a host nation leaving takes its air bases and squeezes its ports', () => {
    const w = manual(world());
    const sorties = w.sides['coalition']!.air!.sortiesPerDay;
    actor(w, 'saudi-government').cohesion = 100;
    w.tick = TICKS_PER_DAY; // daily phase
    strategyPhase(w);
    expect(actor(w, 'saudi-government').status).toBe('withdrawn');
    expect(w.sides['coalition']!.air!.sortiesPerDay).toBe(sorties / 2);
    expect(w.supply.nodes['dammam-port']!.industry).toBe(400);
    // The withdrawal costs 120 support, on top of the day's ordinary changes.
    expect(actor(w, 'us-government').support).toBeLessThanOrEqual(800 - 120);
    expect(actor(w, 'us-government').support).toBeGreaterThan(800 - 140);
  });
});

describe('strategic bombing', () => {
  it('wears down enemy industry and regime stability, at a cost in support', () => {
    const w = manual(world());
    applyCommand(w, {
      type: 'setAirAllocation',
      side: 'coalition',
      allocation: { counterAir: 200, interdiction: 0, attrition: 0, support: 0, scudHunt: 0, strategic: 800 },
    });
    run(w, 6 * TICKS_PER_DAY);
    expect(w.supply.nodes['baghdad-source']!.industry).toBeLessThan(700);
    expect(w.supply.nodes['dammam-port']!.industry).toBe(1000);
    expect(actor(w, 'iraqi-leadership').stability).toBeLessThan(790);
    expect(actor(w, 'us-government').support).toBeLessThan(800 - 6);
  });
});

describe('cease-fire', () => {
  function liberated(): WorldState {
    const w = world();
    for (const id of ['kuwait-city', 'kuwait-airport', 'mutla-ridge']) w.objectives[id]!.holder = 'coalition';
    return w;
  }

  it('the coalition AI declares a cease-fire a day after liberation, and fighting stops', () => {
    const w = liberated();
    step(w);
    expect(w.strategy!.liberatedTick).toBe(0);
    run(w, TICKS_PER_DAY - 1);
    expect(w.strategy!.ceasefire.tick).toBeNull();
    run(w, 2);
    expect(w.strategy!.ceasefire.tick).not.toBeNull();
    // Put enemies face to face: no fire is exchanged under a cease-fire.
    w.formations['us-1ad']!.position = { ...w.formations['iq-27id']!.position };
    const strength = w.formations['iq-27id']!.stats.strength;
    run(w, TICKS_PER_DAY);
    expect(w.contacts).toEqual([]);
    expect(w.formations['iq-27id']!.stats.strength).toBe(strength);
    expect(actionStatus(w, 'coalition', 'press-israel').reason).toMatch(/cease-fire is in force/);
  });

  it('public pressure forces a cease-fire after liberation once support collapses', () => {
    const w = manual(liberated());
    step(w);
    actor(w, 'us-government').support = 400;
    run(w, TICKS_PER_DAY);
    expect(w.strategy!.ceasefire.reason).toMatch(/public pressure/);
  });

  it('pursuing past the mandate rallies the defenders instead', () => {
    const w = manual(liberated());
    w.objectives['kuwait-city']!.holder = 'coalition';
    const morale = w.formations['iq-rg-hammurabi']!.stats.morale;
    act(w, 'coalition', 'pursue-into-iraq');
    expect(w.strategy!.pursuing['coalition']).toBe(true);
    expect(w.formations['iq-rg-hammurabi']!.stats.morale).toBe(Math.min(1000, morale + 150));
    expect(actionStatus(w, 'coalition', 'pursue-into-iraq').reason).toMatch(/already done/);
  });
});
