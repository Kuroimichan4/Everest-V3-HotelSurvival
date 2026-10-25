import { afterEach, expect, test, vi } from 'vitest';
import type { RoomReply } from '@everest/shared';
import { RoomManager } from './manager.js';
import type { SimulationState } from '../simulation/state.js';
import { applyTransportIncident } from '../simulation/transport-crisis.js';

const managers: RoomManager[] = [];
afterEach(() => managers.splice(0).forEach(m => m.dispose()));
const value = <T>(r: RoomReply<T>) => { if (!r.ok) throw new Error(r.error); return r.value; };
function fixture() {
  let time = 1000;
  const tasks = new Set<{ at: number; run: () => void }>();
  const clock = { now: () => time, schedule: (run: () => void, delay: number) => {
    const task = { at: time + delay, run }; tasks.add(task); return () => { tasks.delete(task); };
  } };
  const advance = (ms: number) => { time += ms; for (const t of [...tasks]) if (t.at <= time) { tasks.delete(t); t.run(); } };
  const choose = vi.fn((max: number) => max - 1);
  // The initial shuffle is deterministic; clear it before counting succession draws.
  const random = vi.fn(() => 0);
  const m = new RoomManager(choose, clock, random);
  managers.push(m);
  const sessions = [value(m.create('s0', 'Host'))];
  const code = sessions[0]!.room.code;
  for (let i = 1; i < 4; i++) sessions.push(value(m.join('s' + i, 'Person ' + i, code)));
  m.start('s0'); choose.mockClear();
  const internals = m as unknown as {
    rooms: Map<string, { creatorId: string; game: { state: SimulationState; resolvingMovement?: boolean } }>;
    publishVoting(room: unknown): void;
  };
  const room = internals.rooms.get(code)!;
  const publish = () => internals.publishVoting(room);
  const vote = (optionId: string, voters = [0, 1, 2]) => {
    const v = m.publicVote(code)!;
    for (const i of voters) expect(m.vote('s' + i, { decisionId: v.decisionId, attemptId: v.attemptId, optionId }).ok).toBe(true);
  };
  const toThree = () => {
    random.mockReturnValue(.99); vote('abandon'); m.advanceRound('s0'); m.routeAction('s0', 'open');
    vote('unstable-corridor'); vote('abandon');
    m.openTransport('s0', { preparationId: m.transportView(code)!.cases.at(-1)!.preparationId });
    expect(m.roundThreeAction('s0', 'advance').ok).toBe(true);
  };
  const energize = () => { room.game.state = { ...room.game.state, characters: room.game.state.characters.map(c => ({ ...c, energy: 100 })) }; };
  return { m, sessions, code, room, publish, vote, choose, random, advance, toThree, energize };
}

test('environmental death during pipe gallery transfers host even without an accident', () => {
  const f = fixture(); f.toThree();
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 5 : 100 })) };
  f.m.roundThreeAction('s0', 'open'); f.vote('pipe-gallery');
  expect(f.room.game.state.characters[0]!.health).toBe(0);
  expect(f.room.creatorId).toBe(f.sessions[3]!.credential.participantId);
  expect(f.choose).toHaveBeenCalledExactlyOnceWith(3);
  f.energize(); expect(f.m.intermediateAction('s3', { round: 4, action: 'advance' }).ok).toBe(true);
});

test('replica after two failed votes transfers host and preserves the forced route consequence', () => {
  const f = fixture(); f.toThree(); f.m.roundThreeAction('s0', 'open'); f.vote('pipe-gallery'); f.energize();
  expect(f.m.intermediateAction('s0', { round: 4, action: 'advance' }).ok).toBe(true);
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 10 : 100 })) };
  f.m.intermediateAction('s0', { round: 4, action: 'open' }); f.advance(60000); f.advance(30000);
  expect(f.room.game.state.characters[0]!.health).toBe(0);
  expect(f.room.game.state.intermediateConsequences).toHaveLength(1);
  expect(f.room.creatorId).toBe(f.sessions[3]!.credential.participantId);
  expect(f.choose).toHaveBeenCalledExactlyOnceWith(3);
  f.energize(); expect(f.m.intermediateAction('s3', { round: 5, action: 'advance' }).ok).toBe(true);
});

test('death during the final exit preserves the final result without drawing a new host', () => {
  const f = fixture(); f.toThree(); f.m.roundThreeAction('s0', 'open'); f.vote('pipe-gallery');
  for (const round of [4, 5] as const) { f.energize(); f.m.intermediateAction('s0', { round, action: 'advance' }); f.m.intermediateAction('s0', { round, action: 'open' }); f.vote(round === 4 ? 'cracked-stairs' : 'collapsed-kitchen'); }
  f.energize(); f.m.roundFourAction('s0', 'advance'); f.vote('abandon');
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 10 : 100 })) };
  f.random.mockReturnValue(0); f.m.roundFourAction('s0', 'open'); f.vote('exterior-crack');
  const result = f.m.finalResult(f.code); expect(result).toBeTruthy();
  expect(f.room.game.state.characters[0]!.health).toBe(0); expect(f.choose).not.toHaveBeenCalled();
  f.publish(); expect(f.m.finalResult(f.code)).toEqual(result);
  expect(f.m.roundFourAction('s3', 'advance')).toMatchObject({ ok: false });
  expect(f.m.finalResult(f.code)).toEqual(result);
});

test.each([0, 1, 2])('the existing RNG can select active candidate %i without changing resources', index => {
  const f = fixture(); f.choose.mockReturnValue(index);
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 0 : 100 })) };
  const before = structuredClone(f.room.game.state); f.publish();
  expect(f.room.creatorId).toBe(f.sessions[index + 1]!.credential.participantId);
  expect(f.room.game.state).toEqual(before); expect(f.choose).toHaveBeenCalledExactlyOnceWith(3);
});

test('approved abandonment in a real transport decision transfers host and lets the successor advance', () => {
  const f = fixture(); f.random.mockReturnValue(.99);
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, energy: i === 0 ? 0 : 100 })) };
  f.vote('abandon');
  f.m.openTransport('s0', { preparationId: f.m.transportView(f.code)!.cases.at(-1)!.preparationId });
  f.vote('leave-all', [1, 2]);
  expect(f.room.game.state.characters[0]!.eliminated).toBe(true);
  expect(f.room.creatorId).toBe(f.sessions[3]!.credential.participantId);
  expect(f.choose).toHaveBeenCalledExactlyOnceWith(3);
  expect(f.m.advanceRound('s3').ok).toBe(true);
});

test('ordinary route accident transfers host once and the successor advances round three', () => {
  const f = fixture(); f.vote('abandon'); expect(f.m.advanceRound('s0').ok).toBe(true);
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 10 : 100 })) };
  f.m.routeAction('s0', 'open'); f.vote('unstable-corridor'); f.vote('abandon');
  expect(f.m.openTransport('s0', { preparationId: f.m.transportView(f.code)!.cases.at(-1)!.preparationId }).ok).toBe(true);
  expect(f.room.game.state.characters[0]!.health).toBe(0);
  expect(f.room.creatorId).toBe(f.sessions[3]!.credential.participantId);
  expect(f.choose).toHaveBeenCalledExactlyOnceWith(3);
  expect(f.m.personalDeathSession('s0')!.kind).toBe('accident');
  expect(f.m.roundThreeAction('s0', 'advance')).toMatchObject({ ok: false });
  expect(f.m.roundThreeAction('s3', 'advance').ok).toBe(true);
  f.publish(); f.m.finalResult(f.code); expect(f.choose).toHaveBeenCalledTimes(1);
});

test.each(['gas', 'explosion'] as const)('%s damage uses common succession without changing an open vote or deadline', kind => {
  const f = fixture(); const before = f.m.publicVote(f.code)!;
  const roles = f.room.game.state.characters.map(c => c.role);
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 5 : 100 })) };
  f.room.game.state = applyTransportIncident(f.room.game.state, 'incident', 1, kind, 1000).state;
  const committed = structuredClone(f.room.game.state);
  f.publish();
  expect(f.room.creatorId).toBe(f.sessions[3]!.credential.participantId);
  expect(f.room.game.state).toEqual(committed);
  expect(f.m.publicVote(f.code)).toEqual(before);
  expect(f.room.game.state.characters.map(c => c.role)).toEqual(roles);
  f.room.game.state = applyTransportIncident(f.room.game.state, 'incident', 1, kind, 2000).state;
  f.publish(); expect(f.choose).toHaveBeenCalledExactlyOnceWith(3);
});

test('definitive abandonment selects the only active human, including an exhausted survivor', () => {
  const f = fixture();
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 1 ? 0 : c.health, energy: 0, eliminated: i === 0 || i === 2 })) };
  f.publish(); expect(f.room.creatorId).toBe(f.sessions[3]!.credential.participantId);
  expect(f.choose).toHaveBeenCalledExactlyOnceWith(1);
});

test('no survivor closes the game without a draw; subsequent publications never change final state', () => {
  const f = fixture(); f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map(c => ({ ...c, health: 0 })) };
  f.publish(); const result = f.m.finalResult(f.code);
  expect(result).toMatchObject({ kind: 'no-active-humans' });
  f.publish(); expect(f.m.finalResult(f.code)).toEqual(result); expect(f.choose).not.toHaveBeenCalled();
  expect(f.m.advanceRound('s0')).toMatchObject({ ok: false, error: 'game-finished' });
});

test('movement defers succession until all consequences finish; reconnection and disconnect do not reroll', () => {
  const f = fixture(); const roles = f.room.game.state.characters.map(c => c.role);
  f.room.game.resolvingMovement = true;
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 0 : 100 })) };
  f.publish(); expect(f.choose).not.toHaveBeenCalled();
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, eliminated: i === 3 })) };
  f.room.game.resolvingMovement = false; f.publish();
  expect(f.room.creatorId).toBe(f.sessions[2]!.credential.participantId);
  expect(f.choose).toHaveBeenCalledExactlyOnceWith(2);
  for (const i of [0, 2]) { f.m.disconnect('s' + i); const r = value(f.m.resume('r' + i, f.sessions[i]!.credential)); expect(r.room.creatorId).toBe(f.room.creatorId); }
  expect(f.room.game.state.characters.map(c => c.role)).toEqual(roles);
  expect(f.m.privateRole('r0')).toBeNull(); f.publish(); expect(f.choose).toHaveBeenCalledTimes(1);
  f.m.disconnect('r2'); f.publish(); expect(f.choose).toHaveBeenCalledTimes(1);
});

test('rooms remain isolated and a living host is never replaced for temporary disconnection', () => {
  const f = fixture(); const g = fixture(); const other = g.room.creatorId;
  f.m.disconnect('s0'); f.publish(); expect(f.choose).not.toHaveBeenCalled();
  f.room.game.state = { ...f.room.game.state, characters: f.room.game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 0 : 100 })) };
  f.publish(); expect(g.room.creatorId).toBe(other); expect(g.choose).not.toHaveBeenCalled();
});
