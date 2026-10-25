import { afterEach, expect, test, vi } from 'vitest';
import { RoomManager } from './manager.js';
import { createInitialState, type SimulationState } from '../simulation/state.js';
import type { RoomReply } from '@everest/shared';
import type { SurvivorAdapter } from './survivor-agent.js';
const managers: RoomManager[] = []; afterEach(() => managers.splice(0).forEach(m => m.dispose()));
const value = <T>(r: RoomReply<T>) => { if (!r.ok) throw new Error(r.error); return r.value; };
function fixture(adapter?: () => SurvivorAdapter) {
  let now = 1000; const tasks = new Set<{ at: number; run: () => void }>(); const choose = vi.fn(() => 0);
  const clock = { now: () => now, schedule: (run: () => void, ms: number) => { const task = { at: now + ms, run }; tasks.add(task); return () => { tasks.delete(task); }; } };
  const m = new RoomManager(choose, clock, () => .99, undefined, undefined, adapter); managers.push(m);
  const sessions = [value(m.create('s0', 'Host'))]; const code = sessions[0]!.room.code;
  for (let i = 1; i < 4; i++) sessions.push(value(m.join('s' + i, 'Person ' + i, code))); m.start('s0');
  const room = (m as unknown as { rooms: Map<string, { creatorId: string; game: { id: string; state: SimulationState } | null }> }).rooms.get(code)!;
  const finish = () => { room.game!.state = { ...room.game!.state, characters: room.game!.state.characters.map((c, i) => ({ ...c, health: i === 3 ? 100 : 0, eliminated: i === 3 })) }; return m.finalResult(code)!; };
  return { m, sessions, code, room, finish, choose, tasks, advance: (ms: number) => { now += ms; for (const t of [...tasks]) if (t.at <= now) { tasks.delete(t); t.run(); } } };
}
test('only the authenticated host can reset a finished game with all four connected', () => {
  const f = fixture(); const gameId = f.room.game!.id;
  expect(f.m.restart('none', {})).toMatchObject({ ok: false, error: 'invalid-credentials' });
  expect(f.m.restart('s1', {})).toMatchObject({ ok: false, error: 'not-creator' });
  expect(f.m.restart('s0', { gameId, resultId: 'not-final' })).toMatchObject({ ok: false, error: 'game-not-finished' });
  const final = f.finish(); const request = { gameId, resultId: final.id }; const before = structuredClone(final);
  expect(f.m.restart('s0', { ...request, participantId: f.sessions[1]!.credential.participantId }).ok).toBe(false);
  f.m.disconnect('s3'); expect(f.m.restart('s0', request)).toMatchObject({ ok: false, error: 'not-four-connected' });
  expect(f.m.finalResult(f.code)).toEqual(before); f.m.resume('r3', f.sessions[3]!.credential);
  expect(f.m.restart('s0', request).ok).toBe(true); expect(f.m.finalResult(f.code)).toBeNull(); expect(final).toEqual(before);
});
test('eliminated host resets once, preserves identities and returns everyone to a clean lobby', () => {
  const f = fixture(); f.m.sendChat('s0', { requestId: 1, text: 'OLD CHAT' }); const final = f.finish(); const event = vi.fn(); f.m.onRoomReset = event;
  const request = { gameId: final.gameId, resultId: final.id }; const rooms = [f.m.restart('s0', request), f.m.restart('s0', request)];
  expect(rooms[0]).toEqual(rooms[1]); expect(event).toHaveBeenCalledTimes(1); expect(f.tasks.size).toBe(0);
  for (let i = 0; i < 4; i++) { expect(f.m.privateRole('s' + i)).toBeNull(); expect(f.m.objectiveSession('s' + i)).toBeNull(); expect(f.m.sabotageSession('s' + i)).toBeNull(); expect(f.m.personalDeathSession('s' + i)).toBeNull(); expect(f.m.chatSession('s' + i)!.messages).toEqual([]); }
  f.m.disconnect('s0'); const restored = value(f.m.resume('restored', f.sessions[0]!.credential)); expect(restored.room.status).toBe('waiting'); expect(restored.room.creatorId).toBe(f.sessions[0]!.credential.participantId);
  expect(restored.room.participants.map(p => p.id)).toEqual(f.sessions.map(p => p.credential.participantId));
});
test('second start uses fresh identities, resources, roles, receipts, objectives and timers; stale reset rejected', () => {
  const f = fixture(); const old = f.room.game!; const oldRoles = old.state.characters.map(c => c.role); const final = f.finish();
  f.m.restart('s0', { gameId: final.gameId, resultId: final.id }); f.choose.mockImplementation(() => 0); const calls = f.choose.mock.calls.length;
  // Another valid RNG outcome proves the existing shuffle is invoked again.
  const choose = f.choose as unknown as { mockImplementation(fn: (max: number) => number): void }; choose.mockImplementation(max => max - 1);
  expect(f.m.start('s0').ok).toBe(true); const fresh = f.room.game!; const initial = createInitialState();
  expect(f.choose.mock.calls.length - calls).toBe(3); expect(fresh.id).not.toBe(old.id); expect(fresh.state.characters.map(c => c.id)).not.toEqual(old.state.characters.map(c => c.id));
  expect(fresh.state.characters.map(c => c.role)).not.toEqual(oldRoles); expect(fresh.state.characters.every(c => c.health === 100 && c.energy === 100 && !c.eliminated)).toBe(true);
  expect(fresh.state.inventory).toEqual(initial.inventory); expect(fresh.state.currentRound).toBe(1); expect(fresh.state.medicalSabotage).toBeUndefined(); expect(fresh.state.medicalTreatments).toBeUndefined(); expect(fresh.state.routeRevelations).toBeUndefined();
  expect(f.m.finalResult(f.code)).toBeNull(); expect(f.m.publicVote(f.code)!.attemptNumber).toBe(1); expect(f.tasks.size).toBe(3);
  const bellhop = [0, 1, 2, 3].find(i => f.m.privateRole('s' + i)?.role === 'bellhop')!;
  expect(f.m.sabotageMedication('s' + bellhop, { gameId: fresh.id, requestId: 'fresh-sabotage' }).ok).toBe(true);
  expect(f.m.sabotageMedication('s' + bellhop, { gameId: fresh.id, requestId: 'another' }).ok).toBe(false);
  expect(f.m.restart('s0', { gameId: final.gameId, resultId: final.id })).toMatchObject({ ok: false, error: 'wrong-game' }); expect(f.room.game).toBe(fresh);
  expect(f.m.chatSession('s0')!.messages).toHaveLength(1); expect(f.m.chatSession('s0')!.messages[0]!.sender.kind).toBe('server');
});
test('new game gets a fresh adapter and budget; delayed old response can never publish', async () => {
  let resolve!: (value: unknown) => void; const factory = vi.fn<() => SurvivorAdapter>();
  factory.mockReturnValueOnce({ mode: 'pending-test', respond: () => new Promise(r => { resolve = r; }) });
  factory.mockReturnValue({ mode: 'silent-test', respond: () => ({ action: 'none' }) });
  const f = fixture(factory); const final = f.finish(); f.m.restart('s0', { gameId: final.gameId, resultId: final.id }); f.m.start('s0');
  resolve({ action: 'advise', text: 'OLD NPC RESPONSE' }); await Promise.resolve(); expect(factory).toHaveBeenCalledTimes(2); expect(f.m.chatSession('s0')!.messages).toEqual([]);
});
test('reset is isolated from other rooms in the same manager', () => {
  const f = fixture(); const other = value(f.m.create('other0', 'Other'));
  for (let i = 1; i < 4; i++) f.m.join('other' + i, 'Other ' + i, other.room.code); f.m.start('other0'); f.m.sendChat('other0', { requestId: 1, text: 'OTHER ROOM' });
  const before = { supplies: f.m.suppliesView(other.room.code), chat: f.m.chatSession('other0'), vote: f.m.publicVote(other.room.code) };
  const final = f.finish(); f.m.restart('s0', { gameId: final.gameId, resultId: final.id });
  expect({ supplies: f.m.suppliesView(other.room.code), chat: f.m.chatSession('other0'), vote: f.m.publicVote(other.room.code) }).toEqual(before);
});
