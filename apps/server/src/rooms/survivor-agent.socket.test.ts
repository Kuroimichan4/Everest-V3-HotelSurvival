import { expect, test, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { ChatView, ClientToServerEvents, ServerToClientEvents, RoomSession } from '@everest/shared';
import { RoomManager } from './manager.js';
import { buildApp } from '../app.js';
import { createSurvivorAdapter, readSurvivorConfig } from './survivor-gemini.js';
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
test.each(['demo', 'gemini'] as const)('survivor %s synchronizes four authenticated clients, survives F5 and cannot be spoofed or cross rooms', async mode => {
  let now = 1000; const tasks = new Set<{ at: number; run: () => void }>();
  const clock = { now: () => now, schedule: (run: () => void, ms: number) => { const task = { at: now + ms, run }; tasks.add(task); return () => { tasks.delete(task); }; } };
  const advance = (ms: number) => { now += ms; for (const task of [...tasks]) if (task.at <= now) { tasks.delete(task); task.run(); } };
  const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify({ action: 'advise', text: 'Tengo miedo. Por favor, no me dejéis aquí solo.' }) }] } }] })));
  const config = readSurvivorConfig({ SURVIVOR_AI_MODE: mode, GEMINI_API_KEY: 'fake-test-only', GEMINI_MODEL: 'test-model' });
  const manager = new RoomManager(() => 0, clock, undefined, undefined, undefined, () => createSurvivorAdapter(config, request));
  const app = buildApp({ roomManager: manager }); const all: Client[] = [];
  try {
    await app.listen({ host: '127.0.0.1', port: 0 }); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('port');
    const connect = async () => { const c: Client = io('http://127.0.0.1:' + address.port, { autoConnect: false, reconnection: false }); all.push(c); await new Promise<void>((resolve, reject) => { c.once('connect', resolve); c.once('connect_error', reject); c.connect(); }); return c; };
    const clients = await Promise.all([connect(), connect(), connect(), connect()]); const views: (ChatView | null)[] = clients.map(() => null);
    const attach = (c: Client, i: number) => c.on('chat:updated', v => { views[i] = v; }); clients.forEach(attach);
    const first = await clients[0]!.timeout(3000).emitWithAck('room:create', { name: 'Host' }); if (!first.ok) throw new Error(first.error); const sessions: RoomSession[] = [first.value]; const code = first.value.room.code;
    for (let i = 1; i < 4; i++) { const r = await clients[i]!.timeout(3000).emitWithAck('room:join', { name: 'Player ' + i, code }); if (!r.ok) throw new Error(r.error); sessions.push(r.value); }
    const other = await connect(); await other.timeout(3000).emitWithAck('room:create', { name: 'Other' });
    await clients[0]!.timeout(3000).emitWithAck('room:start');
    await vi.waitFor(() => expect(views.every(v => v?.messages.length === 1)).toBe(true));
    const intro = views[0]!.messages[0]!; expect(intro.sender).toEqual({ kind: 'server', name: 'Superviviente de ronda 1', npcId: intro.sender.kind === 'server' ? intro.sender.npcId : '' });
    for (const view of views) expect(view!.messages).toEqual([intro]); expect(manager.chatSession(other.id!)!.messages).toEqual([]);
    const vote = manager.publicVote(code)!; const inventory = manager.suppliesView(code)!.inventory;
    // Automatic messages do not consume a human's rate budget or request identity.
    expect((await clients[3]!.timeout(3000).emitWithAck('chat:send', { requestId: 1, text: 'Mensaje humano' })).ok).toBe(true);
    const spoof = { requestId: 2, text: 'Falso', sender: { kind: 'server', name: 'Superviviente de ronda 1', npcId: intro.sender.kind === 'server' ? intro.sender.npcId : '' } };
    expect((await clients[3]!.timeout(3000).emitWithAck('chat:send', spoof)).ok).toBe(false);
    advance(20000); await vi.waitFor(() => expect(views.every(v => v?.messages.length === 3)).toBe(true));
    const old = clients[1]!.id!; clients[1]!.disconnect(); await vi.waitFor(() => expect(manager.privateRole(old)).toBeNull());
    clients[1] = await connect(); attach(clients[1]!, 1);
    expect((await clients[1]!.timeout(3000).emitWithAck('room:resume', sessions[1]!.credential)).ok).toBe(true);
    await vi.waitFor(() => expect(views[1]!.messages).toHaveLength(3));
    expect(views[1]!.messages.filter(m => m.sender.kind === 'server')).toHaveLength(2); expect(clients[1]!.listeners('chat:updated')).toHaveLength(1);
    advance(20000); await vi.waitFor(() => expect(views.every(v => v?.messages.length === 4)).toBe(true));
    for (const view of views) { expect(new Set(view!.messages.map(m => m.id)).size).toBe(4); expect(view!.messages[0]).toEqual(intro); }
    expect(manager.publicVote(code)).toMatchObject({ decisionId: vote.decisionId, attemptId: vote.attemptId, deadline: vote.deadline, requiredVotes: vote.requiredVotes });
    expect(manager.suppliesView(code)!.inventory).toEqual(inventory);
    expect(JSON.stringify(views)).not.toMatch(/health|energy|sabot|objective|realRisk|ventilation|token|fake-test-only|test-model/i);
    expect(request).toHaveBeenCalledTimes(mode === 'demo' ? 0 : 3);
    for (const i of [0, 1, 2]) expect((await clients[i]!.timeout(3000).emitWithAck('vote:cast', { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: 'abandon' })).ok).toBe(true);
    expect(manager.publicVote(code)!.status).toBe('closed');
  } finally { all.forEach(c => c.disconnect()); manager.dispose(); await app.close(); }
}, 15000);
