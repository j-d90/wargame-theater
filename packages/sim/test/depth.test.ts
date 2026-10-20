// M6: decision points, saves and replays, AI competence and player takeover.
import { describe, expect, it } from 'vitest';
import { loadScenario } from '@tow/content';
import {
  TICKS_PER_DAY,
  applyCommand,
  checkSave,
  cloneWorld,
  createWorld,
  decisionMatches,
  hashState,
  lastDecisionId,
  makeSave,
  nextDecision,
  replay,
  run,
  step,
  tacticalInterval,
  withdrawDelay,
  type Command,
  type Decision,
  type TimedCommand,
  type WorldState,
} from '../src/index.ts';
import { duelWorld, placeAt } from './duel.ts';

const kinds = (w: WorldState) => w.decisions.map((d) => d.kind);

describe('decision points', () => {
  it('notes units making contact, once per spell of fighting', () => {
    const w = duelWorld();
    run(w, 2);
    expect(w.decisions).toEqual([]);
    placeAt(w, 'b1', 50, 0);
    placeAt(w, 'r1', 60, 0);
    run(w, 3);
    const contact = w.decisions.filter((d) => d.kind === 'contact');
    expect(contact.map((d) => d.side).sort()).toEqual(['blue', 'red']);
    expect(contact[0]!.level).toBe('major');
    expect(contact.find((d) => d.side === 'blue')!.text).toMatch(/Blue 1 is in contact/);
    run(w, 10);
    expect(w.decisions.filter((d) => d.kind === 'contact')).toHaveLength(2);
  });

  it('notes objectives changing hands for both sides, and arrivals', () => {
    const w = duelWorld();
    step(w);
    applyCommand(w, { type: 'move', formation: 'b2', to: { x: 58, y: 22 } });
    run(w, 3 * TICKS_PER_DAY);
    const taken = w.decisions.find((d) => d.kind === 'objective-taken')!;
    expect(taken).toMatchObject({ side: 'blue', level: 'major', subject: 'town' });
    expect(w.decisions.find((d) => d.kind === 'objective-lost')).toMatchObject({ side: 'red', subject: 'town' });
    expect(kinds(w)).toContain('arrived');
  });

  it('numbers decisions in order and finds the next one that passes a filter', () => {
    const w = duelWorld();
    placeAt(w, 'b1', 50, 0);
    placeAt(w, 'r1', 60, 0);
    step(w);
    step(w);
    const ids = w.decisions.map((d) => d.id);
    expect(ids).toEqual(ids.map((_, i) => i + 1));
    expect(nextDecision(w, 0, 'blue', { minLevel: 'major' })?.side).toBe('blue');
    expect(nextDecision(w, 0, 'blue', { minLevel: 'critical' })).toBeNull();
    expect(nextDecision(w, 0, 'blue', { minLevel: 'critical', kinds: { contact: true } })?.kind).toBe('contact');
    expect(nextDecision(w, lastDecisionId(w), 'blue', { minLevel: 'minor' })).toBeNull();
  });

  it('filters by side, level and kind', () => {
    const d: Decision = { id: 1, tick: 0, side: 'red', kind: 'arrived', level: 'minor', text: '', at: null, subject: null };
    expect(decisionMatches(d, 'blue', { minLevel: 'minor' })).toBe(false);
    expect(decisionMatches(d, 'red', { minLevel: 'minor' })).toBe(true);
    expect(decisionMatches(d, 'red', { minLevel: 'major' })).toBe(false);
    expect(decisionMatches(d, 'red', { minLevel: 'minor', kinds: { arrived: false } })).toBe(false);
    expect(decisionMatches({ ...d, side: null }, 'blue', { minLevel: 'minor' })).toBe(true);
  });

  it('gives Desert Storm a handful of critical moments and many more for a close commander', () => {
    const w = createWorld(loadScenario('desert-storm'), { seed: 1 });
    run(w, 43 * TICKS_PER_DAY);
    const mine = w.decisions.filter((d) => d.side === null || d.side === 'coalition');
    const critical = mine.filter((d) => d.level === 'critical');
    expect(critical.length).toBeGreaterThanOrEqual(2);
    expect(critical.length).toBeLessThanOrEqual(10);
    expect(critical.map((d) => d.text).join('\n')).toMatch(/cease-fire/i);
    expect(mine.length).toBeGreaterThanOrEqual(150);
  });
});

/** Play `ticks` ticks, sending each scripted command at its tick, and log them as a host does. */
function play(w: WorldState, script: TimedCommand[], ticks: number): TimedCommand[] {
  const log: TimedCommand[] = [];
  for (let t = 0; t < ticks; t++) {
    for (const c of script.filter((x) => x.tick === w.tick)) {
      const { tick: _t, ...cmd } = c;
      applyCommand(w, cmd as Command);
      log.push({ ...c });
    }
    step(w);
  }
  return log;
}

/** b1 20 km from r1, so an attack soon makes contact. */
function base(): WorldState {
  const w = duelWorld();
  placeAt(w, 'b1', 50, 0);
  placeAt(w, 'r1', 70, 0);
  return w;
}

describe('saves and replays', () => {
  const script: TimedCommand[] = [
    { tick: 3, type: 'move', formation: 'b1', to: { x: 70, y: 0 }, kind: 'attack' },
    { tick: 40, type: 'setDisrupted', target: { kind: 'link', id: 'red-road' }, disrupted: true },
    { tick: 30, type: 'openBattle', formation: 'b1' },
  ];

  it('replaying the command log from the start reproduces the game exactly', () => {
    const w = base();
    const log = play(w, script, 120);
    expect(Object.keys(w.battles).length + w.nextBattle).toBeGreaterThan(1);
    const again = replay(base(), log, 120);
    expect(hashState(again)).toBe(hashState(w));
  });

  it('a save restores the world and continues identically to an unbroken game', () => {
    const w = base();
    const log = play(w, script, 50);
    const save = checkSave(JSON.parse(JSON.stringify(makeSave(w, log, { name: 'test' }))));
    expect(save.hash).toBe(hashState(w));
    expect(save.meta).toEqual({ name: 'test' });
    const loaded = save.world;
    expect(hashState(loaded)).toBe(save.hash);
    const rest = script.filter((c) => c.tick >= 50);
    play(w, rest, 70);
    play(loaded, rest, 70);
    expect(hashState(loaded)).toBe(hashState(w));
  });

  it('replays from a snapshot taken mid-way, as the replay viewer seeks', () => {
    const w = base();
    const log = play(w, script, 120);
    const keyframes: WorldState[] = [];
    replay(base(), log, 120, (k) => {
      if (k.tick % 30 === 0) keyframes.push(cloneWorld(k));
    });
    const from = keyframes.find((k) => k.tick === 60)!;
    expect(hashState(replay(cloneWorld(from), log, 120))).toBe(hashState(w));
  });

  it('rejects files that are not saves, or are damaged', () => {
    expect(() => checkSave({ hello: 1 })).toThrow(/not a Theater of War save/);
    const save = makeSave(duelWorld(), []);
    expect(() => checkSave({ ...save, commands: [{ type: 'halt' }] })).toThrow(/bad command log/);
    expect(() => checkSave({ ...save, version: 999 })).toThrow(/newer version/);
  });
});

describe('AI competence and player takeover', () => {
  it('scales how fast commands react', () => {
    expect(withdrawDelay(1000)).toBe(0);
    expect(withdrawDelay(0)).toBe(TICKS_PER_DAY);
    expect(tacticalInterval(1000)).toBe(2);
    expect(tacticalInterval(0)).toBe(8);
    expect(tacticalInterval(null)).toBe(4);
  });

  it('can be changed mid-game, within 0..1000', () => {
    const w = createWorld(loadScenario('desert-storm'), { seed: 1 });
    applyCommand(w, { type: 'setAiCompetence', side: 'iraq', competence: 1000 });
    expect(w.sides['iraq']!.ai!.config.competence).toBe(1000);
    expect(() => applyCommand(w, { type: 'setAiCompetence', side: 'iraq', competence: 1001 })).toThrow(/0 to 1000/);
  });

  it('leaves formations the player has taken alone while the AI runs the rest', () => {
    const w = createWorld(loadScenario('desert-storm'), { seed: 1 });
    applyCommand(w, { type: 'setFormationControl', formation: 'us-1ad', player: true });
    const ai = w.sides['coalition']!.ai!;
    run(w, TICKS_PER_DAY);
    expect(ai.issued['us-1ad']).toBeUndefined();
    expect(ai.issued['us-3ad']).toBeDefined();
    applyCommand(w, { type: 'setFormationControl', formation: 'us-1ad', player: false });
    run(w, TICKS_PER_DAY);
    expect(ai.issued['us-1ad']).toBeDefined();
  });
});
