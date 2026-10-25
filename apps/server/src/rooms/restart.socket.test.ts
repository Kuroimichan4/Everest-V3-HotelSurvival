import { expect, test, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, RoomSession, PublicRoom, PrivateRole } from '@everest/shared';
import { RoomManager } from './manager.js';
import { buildApp } from '../app.js';
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
test('four real clients finish six rounds, reset together, refresh, then play with fresh state', async () => {
  let now = 1000; const tasks = new Set<{ run: () => void; at: number }>();
  const clock = { now: () => now, schedule: (run: () => void, delay: number) => { const task = { run, at: now + delay }; tasks.add(task); return () => { tasks.delete(task); }; } };
  const choose = vi.fn(() => 0); const m = new RoomManager(choose, clock, () => .99); const app = buildApp({ roomManager: m }); const all: Client[] = [];
  try {
    await app.listen({ host: '127.0.0.1', port: 0 }); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('port');
    const connect = async () => { const c: Client = io('http://127.0.0.1:' + address.port, { autoConnect: false, reconnection: false }); all.push(c); await new Promise<void>((resolve, reject) => { c.once('connect', resolve); c.once('connect_error', reject); c.connect(); }); return c; };
    const clients = await Promise.all([connect(), connect(), connect(), connect()]); const sessions: RoomSession[] = [];
    const rooms: (PublicRoom | null)[] = clients.map(() => null); const resets = clients.map(() => 0); const roles: (PrivateRole | null)[] = clients.map(() => null);
    const attach = (c: Client, i: number) => { c.on('room:updated', r => { rooms[i] = r; }); c.on('room:reset', r => { rooms[i] = r; roles[i] = null; resets[i] = resets[i]! + 1; }); c.on('game:role', r => { roles[i] = r; }); }; clients.forEach(attach);
    const r = await clients[0]!.timeout(3000).emitWithAck('room:create', { name: 'Host' }); if (!r.ok) throw new Error(r.error); sessions.push(r.value); const code = r.value.room.code;
    for (let i = 1; i < 4; i++) { const joined = await clients[i]!.timeout(3000).emitWithAck('room:join', { code, name: 'Person ' + i }); if (!joined.ok) throw new Error(joined.error); sessions.push(joined.value); }
    expect((await clients[0]!.timeout(3000).emitWithAck('room:start')).ok).toBe(true);
    const firstId = m.suppliesView(code)!.gameId; const firstVote = m.publicVote(code)!;
    const vote = async (optionId: string) => { const v = m.publicVote(code)!; for (const i of [0, 1, 2]) expect((await clients[i]!.timeout(3000).emitWithAck('vote:cast', { decisionId: v.decisionId, attemptId: v.attemptId, optionId })).ok).toBe(true); };
    const refresh = async (i: number) => { const old = clients[i]!.id!; clients[i]!.disconnect(); roles[i] = null; await vi.waitFor(() => expect(m.privateRole(old)).toBeNull()); clients[i] = await connect(); attach(clients[i]!, i); const reply = await clients[i]!.timeout(3000).emitWithAck('room:resume', sessions[i]!.credential); if (!reply.ok) throw new Error(reply.error); return reply.value; };
    expect((await clients[3]!.timeout(3000).emitWithAck('chat:send', { requestId: 1, text: 'CHAT DE LA PRIMERA PARTIDA' })).ok).toBe(true);
    await vote('abandon'); await clients[0]!.timeout(3000).emitWithAck('round:advance'); await clients[3]!.timeout(3000).emitWithAck('route:reveal'); await clients[0]!.timeout(3000).emitWithAck('route:open'); await vote('unstable-corridor'); await vote('abandon');
    await clients[0]!.timeout(3000).emitWithAck('transport:open', { preparationId: m.transportView(code)!.cases.at(-1)!.preparationId });
    await clients[0]!.timeout(3000).emitWithAck('round-three:advance'); await clients[0]!.timeout(3000).emitWithAck('round-three:open'); await vote('pipe-gallery');
    expect((await clients[0]!.timeout(3000).emitWithAck('medical:treat', { gameId: firstId, requestId: 'old-treatment', round: 3, targetParticipantId: sessions[1]!.credential.participantId })).ok).toBe(true);
    expect((await clients[2]!.timeout(3000).emitWithAck('medical:sabotage', { gameId: firstId, requestId: 'old-sabotage' })).ok).toBe(true);
    for (const round of [4, 5] as const) { expect((await clients[0]!.timeout(3000).emitWithAck('intermediate:action', { round, action: 'advance' })).ok).toBe(true); await clients[3]!.timeout(3000).emitWithAck('intermediate:action', { round, action: 'reveal' }); await clients[0]!.timeout(3000).emitWithAck('intermediate:action', { round, action: 'open' }); await vote(round === 4 ? 'cracked-stairs' : 'collapsed-kitchen'); }
    await clients[0]!.timeout(3000).emitWithAck('round-six:advance'); await vote('abandon'); await clients[0]!.timeout(3000).emitWithAck('round-six:open'); await vote('exterior-crack');
    const final = m.finalResult(code)!; expect(final).toMatchObject({ kind: 'evacuation-completed', counts: { evacuated: 4 } }); const preserved = structuredClone(final); expect(tasks.size).toBe(0);
    await refresh(0); expect(m.finalSession(clients[0]!.id!)).toEqual(preserved);
    const input = { gameId: firstId, resultId: final.id };
    expect((await clients[1]!.timeout(3000).emitWithAck('room:restart', input))).toMatchObject({ ok: false, error: 'not-creator' }); expect(m.finalResult(code)).toEqual(preserved);
    // F5 races the reset. A temporarily absent participant may safely defer the reset.
    const [replies] = await Promise.all([Promise.all([clients[0]!.timeout(3000).emitWithAck('room:restart', input), clients[0]!.timeout(3000).emitWithAck('room:restart', input)]), refresh(1)]);
    for (const reply of replies) if (!reply.ok) expect(reply.error).toBe('not-four-connected');
    if (!replies.some(v => v.ok)) expect((await clients[0]!.timeout(3000).emitWithAck('room:restart', input)).ok).toBe(true);
    await vi.waitFor(() => expect([resets[0], resets[2], resets[3]]).toEqual([1, 1, 1])); expect(resets[1]).toBeLessThanOrEqual(1);
    expect(roles).toEqual([null, null, null, null]); expect(tasks.size).toBe(0); expect(m.finalResult(code)).toBeNull();
    for (const c of clients) { expect(m.chatSession(c.id!)!.messages).toEqual([]); expect(m.objectiveSession(c.id!)).toBeNull(); expect(m.sabotageSession(c.id!)).toBeNull(); }
    expect((await refresh(1)).room.status).toBe('waiting'); expect(clients[1]!.listeners('room:reset')).toHaveLength(1); const resetCounts = [...resets];
    const beforeShuffle = choose.mock.calls.length; now += 5000; expect((await clients[0]!.timeout(3000).emitWithAck('room:start')).ok).toBe(true); expect(choose.mock.calls.length - beforeShuffle).toBe(3);
    await vi.waitFor(() => expect(roles.every(Boolean) && rooms.every(v => v?.status === 'started')).toBe(true));
    const supplies = m.suppliesView(code)!; expect(supplies.gameId).not.toBe(firstId); expect(supplies.inventory).toMatchObject({ packs: 8, medicalUnits: 4 }); expect(supplies.characters.every(c => c.health === 100 && c.energy === 100)).toBe(true);
    expect(m.publicVote(code)).toMatchObject({ round: 1, attemptNumber: 1, deadline: now + 60000 }); expect(m.publicVote(code)!.decisionId).not.toBe(firstVote.decisionId); expect(tasks.size).toBe(3);
    expect(m.roundTwoView(code)).toBeNull(); expect(m.roundThreeView(code)).toBeNull(); expect(m.roundFourView(code)).toBeNull();
    expect(m.chatSession(clients[0]!.id!)!.messages).toHaveLength(1); expect(JSON.stringify(m.chatSession(clients[0]!.id!))).not.toContain('CHAT DE LA PRIMERA PARTIDA');
    expect(m.sabotageSession(clients[2]!.id!)!.performed).toBe(false);
    expect((await clients[2]!.timeout(3000).emitWithAck('medical:sabotage', { gameId: firstId, requestId: 'old-sabotage' })).ok).toBe(false);
    expect((await clients[0]!.timeout(3000).emitWithAck('medical:treat', { gameId: firstId, requestId: 'old-treatment', round: 3, targetParticipantId: sessions[1]!.credential.participantId })).ok).toBe(false);
    expect((await clients[2]!.timeout(3000).emitWithAck('medical:sabotage', { gameId: supplies.gameId, requestId: 'fresh' })).ok).toBe(true);
    expect((await clients[0]!.timeout(3000).emitWithAck('room:restart', input))).toMatchObject({ ok: false, error: 'wrong-game' });
    expect((await refresh(2)).room.status).toBe('started'); expect(m.suppliesSession(clients[2]!.id!)!.gameId).toBe(supplies.gameId); expect(resets).toEqual(resetCounts);
    expect(final).toEqual(preserved);
  } finally { all.forEach(c => c.disconnect()); m.dispose(); await app.close(); }
}, 15000);
