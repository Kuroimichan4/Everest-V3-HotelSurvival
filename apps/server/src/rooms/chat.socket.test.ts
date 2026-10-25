import { expect, test, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { ChatView, ClientToServerEvents, ServerToClientEvents, RoomSession } from '@everest/shared';
import { buildApp } from '../app.js';
import { RoomManager } from './manager.js';
import type { SimulationState } from '../simulation/state.js';
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
test('four real clients: lobby history, canonical role, order, room isolation, live vote and F5', async () => {
  let now = 1000; const tasks = new Set<() => void>();
  const manager = new RoomManager(() => 0, { now: () => now, schedule: fn => { tasks.add(fn); return () => { tasks.delete(fn); }; } }, undefined, undefined, undefined, { mode: 'silent-chat-test', respond: () => ({ action: 'none' }) });
  const app = buildApp({ roomManager: manager }); const sockets: Client[] = [];
  try {
    await app.listen({ host: '127.0.0.1', port: 0 }); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('port');
    const connect = async () => { const c: Client = io('http://127.0.0.1:' + address.port, { autoConnect: false, reconnection: false }); sockets.push(c); await new Promise<void>((resolve, reject) => { c.once('connect', resolve); c.once('connect_error', reject); c.connect(); }); return c; };
    const clients = await Promise.all([connect(), connect(), connect(), connect()]); const sessions: RoomSession[] = [];
    const latest: (ChatView | null)[] = clients.map(() => null); const updates = clients.map(() => 0);
    const attach = (c: Client, i: number) => c.on('chat:updated', v => { latest[i] = v; updates[i] = updates[i]! + 1; }); clients.forEach(attach);
    const created = await clients[0]!.timeout(3000).emitWithAck('room:create', { name: 'Host' }); if (!created.ok) throw new Error(created.error); sessions.push(created.value); const code = created.value.room.code;
    expect((await clients[0]!.timeout(3000).emitWithAck('chat:send', { requestId: 1, text: '  Hola desde el lobby  ' })).ok).toBe(true);
    for (let i = 1; i < 4; i++) { const r = await clients[i]!.timeout(3000).emitWithAck('room:join', { name: 'Person ' + i, code }); if (!r.ok) throw new Error(r.error); sessions.push(r.value); }
    await vi.waitFor(() => expect(latest.every(v => v?.messages.length === 1)).toBe(true));
    const outsider = await connect();
    expect((await outsider.timeout(3000).emitWithAck('chat:send', { requestId: 1, text: 'unauthenticated' }))).toMatchObject({ ok: false, error: 'invalid-session' });
    const other = await outsider.timeout(3000).emitWithAck('room:create', { name: 'Other' }); if (!other.ok) throw new Error(other.error);
    expect(manager.chatSession(outsider.id!)!.messages).toEqual([]);
    await clients[0]!.timeout(3000).emitWithAck('room:start');
    const maintenance = clients.findIndex(c => manager.privateRole(c.id!)?.role === 'maintenance');
    const actor = clients[maintenance]!; now = 2000;
    const game = (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game;
    const state = JSON.stringify(game.state); const vote = manager.publicVote(code)!; const scheduled = [...tasks];
    const input = { requestId: manager.chatSession(actor.id!)!.nextRequestId, text: 'Conozco una ruta. <script>alert(1)</script>' };
    const replies = await Promise.all([actor.timeout(3000).emitWithAck('chat:send', input), actor.timeout(3000).emitWithAck('chat:send', input)]);
    expect(replies[0]).toEqual(replies[1]); expect(replies[0]!.ok).toBe(true);
    await vi.waitFor(() => expect(latest.every(v => v?.messages.length === 2)).toBe(true));
    expect(latest[0]!.messages[1]!.sender).toEqual({ kind: 'human', participantId: sessions[maintenance]!.credential.participantId, name: 'Person ' + maintenance, role: 'maintenance' });
    expect(JSON.stringify(game.state)).toBe(state); expect(manager.publicVote(code)).toEqual(vote); expect([...tasks]).toEqual(scheduled);
    const forged = { requestId: 99, text: 'spoof', name: 'Host', sender: { kind: 'server' } };
    expect((await actor.timeout(3000).emitWithAck('chat:send', forged)).ok).toBe(false);
    expect((await actor.timeout(3000).emitWithAck('chat:send', { requestId: input.requestId + 1, text: 'spam' }))).toMatchObject({ ok: false, error: 'rate-limited' });
    expect(manager.chatSession(outsider.id!)!.messages).toEqual([]);
    const old = actor.id!; actor.disconnect(); await vi.waitFor(() => expect(manager.privateRole(old)).toBeNull());
    const restored = await connect(); clients[maintenance] = restored; attach(restored, maintenance);
    expect((await restored.timeout(3000).emitWithAck('room:resume', sessions[maintenance]!.credential)).ok).toBe(true);
    await vi.waitFor(() => expect(latest[maintenance]!.messages).toEqual(manager.chatSession(restored.id!)!.messages));
    expect(restored.listeners('chat:updated')).toHaveLength(1);
    expect((await restored.timeout(3000).emitWithAck('chat:send', { requestId: input.requestId + 1, text: 'spam after F5' }))).toMatchObject({ ok: false, error: 'rate-limited' });
    now = 3000; expect((await restored.timeout(3000).emitWithAck('chat:send', { requestId: input.requestId + 1, text: 'Después de F5' })).ok).toBe(true);
    await vi.waitFor(() => expect(latest.every(v => v?.messages.length === 3)).toBe(true));
    for (const v of latest) { expect(v!.messages.map(m => m.sequence)).toEqual([1, 2, 3]); expect(new Set(v!.messages.map(m => m.id)).size).toBe(3); expect(JSON.stringify(v)).not.toMatch(/health|energy|riskCategory|medicalSabotage|objective|token|realRisk/); }
    // Voting stays usable, independent of chat and its request identifiers.
    for (const i of [0, 1, 2]) expect((await clients[i]!.timeout(3000).emitWithAck('vote:cast', { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: 'abandon' })).ok).toBe(true);
    expect(manager.publicVote(code)!.status).toBe('closed');
    game.state = { ...game.state, characters: game.state.characters.map(c => ({ ...c, health: 0 })) }; manager.finalResult(code);
    await vi.waitFor(() => expect(latest.every(v => v?.canWrite === false)).toBe(true));
    expect((await restored.timeout(3000).emitWithAck('chat:send', { requestId: input.requestId + 2, text: 'no' }))).toMatchObject({ ok: false, error: 'read-only' });
    expect(latest[maintenance]!.messages).toHaveLength(3);
  } finally { sockets.forEach(c => c.disconnect()); manager.dispose(); await app.close(); }
}, 15000);
