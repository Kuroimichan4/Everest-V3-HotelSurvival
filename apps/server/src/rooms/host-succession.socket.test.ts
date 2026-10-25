import { expect, test, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, RoomSession, PublicRoom } from '@everest/shared';
import { buildApp } from '../app.js';
import { RoomManager } from './manager.js';
import type { SimulationState } from '../simulation/state.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
test('four clients receive one ordinary-accident handoff, preserve identities on F5 and reject the former host', async () => {
  let handoff = false;
  const choose = vi.fn((max: number) => handoff ? max - 1 : 0);
  const manager = new RoomManager(choose, undefined, () => 0);
  const app = buildApp({ roomManager: manager }); const sockets: Client[] = [];
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('port');
    const connect = async () => {
      const c: Client = io('http://127.0.0.1:' + address.port, { autoConnect: false, reconnection: false }); sockets.push(c);
      await new Promise<void>((resolve, reject) => { c.once('connect', resolve); c.once('connect_error', reject); c.connect(); }); return c;
    };
    const clients = await Promise.all([connect(), connect(), connect(), connect()]);
    const updates: PublicRoom[][] = clients.map(() => []);
    const attach = (c: Client, i: number) => c.on('room:updated', r => { updates[i]!.push(r); }); clients.forEach(attach);
    const sessions: RoomSession[] = [];
    const created = await clients[0]!.timeout(3000).emitWithAck('room:create', { name: 'Host' });
    if (!created.ok) throw new Error(created.error); sessions.push(created.value); const code = created.value.room.code;
    for (let i = 1; i < 4; i++) { const joined = await clients[i]!.timeout(3000).emitWithAck('room:join', { name: 'Person ' + i, code }); if (!joined.ok) throw new Error(joined.error); sessions.push(joined.value); }
    await clients[0]!.timeout(3000).emitWithAck('room:start');
    const game = (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game;
    const roles = clients.map(c => manager.privateRole(c.id!)!.role);
    const vote = async (optionId: string) => { const v = manager.publicVote(code)!; for (const i of [0, 1, 2]) expect((await clients[i]!.timeout(3000).emitWithAck('vote:cast', { decisionId: v.decisionId, attemptId: v.attemptId, optionId })).ok).toBe(true); };
    await vote('abandon'); await clients[0]!.timeout(3000).emitWithAck('round:advance');
    game.state = { ...game.state, characters: game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 10 : 100 })) };
    await clients[0]!.timeout(3000).emitWithAck('route:open'); await vote('unstable-corridor'); await vote('abandon');
    const other = manager.create('other0', 'Other'); if (!other.ok) throw new Error(other.error);
    for (let i = 1; i < 4; i++) manager.join('other' + i, 'Other ' + i, other.value.room.code);
    manager.start('other0');
    const otherBefore = manager.suppliesView(other.value.room.code);
    handoff = true; choose.mockClear();
    await clients[0]!.timeout(3000).emitWithAck('transport:open', { preparationId: manager.transportView(code)!.cases.at(-1)!.preparationId });
    const successor = sessions[3]!.credential.participantId;
    await vi.waitFor(() => expect(updates.every(list => list.at(-1)?.creatorId === successor)).toBe(true));
    for (const list of updates) expect(list.filter(r => r.creatorId === successor)).toHaveLength(1);
    expect(choose).toHaveBeenCalledExactlyOnceWith(3);
    expect(manager.suppliesView(other.value.room.code)).toEqual(otherBefore);
    expect(manager.advanceRound('other1')).toMatchObject({ ok: false, error: 'not-creator' });
    const state = structuredClone(game.state);
    for (const i of [0, 3]) {
      const old = clients[i]!.id!; clients[i]!.disconnect(); await vi.waitFor(() => expect(manager.privateRole(old)).toBeNull());
      clients[i] = await connect(); attach(clients[i]!, i);
      const resumed = await clients[i]!.timeout(3000).emitWithAck('room:resume', sessions[i]!.credential);
      expect(resumed).toMatchObject({ ok: true, value: { room: { creatorId: successor } } });
    }
    expect(game.state).toEqual(state); expect(choose).toHaveBeenCalledTimes(1);
    expect(manager.privateRole(clients[0]!.id!)).toBeNull();
    for (const i of [1, 2, 3]) expect(manager.privateRole(clients[i]!.id!)!.role).toBe(roles[i]);
    expect((await clients[0]!.timeout(3000).emitWithAck('round-three:advance')).ok).toBe(false);
    expect((await clients[1]!.timeout(3000).emitWithAck('round-three:advance')).ok).toBe(false);
    expect((await clients[3]!.timeout(3000).emitWithAck('round-three:advance')).ok).toBe(true);
    expect((await clients[3]!.timeout(3000).emitWithAck('round-three:open')).ok).toBe(true);
    // Host authority does not confer the physician's resource permissions.
    expect((await clients[3]!.timeout(3000).emitWithAck('medical:treat', { gameId: manager.suppliesView(code)!.gameId, requestId: 'unauthorized', round: 3, targetParticipantId: successor })).ok).toBe(false);
    expect(choose).toHaveBeenCalledTimes(1);
  } finally { sockets.forEach(c => c.disconnect()); manager.dispose(); await app.close(); }
}, 15000);
