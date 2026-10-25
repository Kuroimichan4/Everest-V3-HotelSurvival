import { expect, test } from 'vitest';
import { RoomChat } from './chat.js';
import { RoomManager } from './manager.js';
import type { SimulationState } from '../simulation/state.js';
const sender = { kind: 'human' as const, participantId: 'p', name: 'Persona', role: 'maintenance' as const };
test.each([null, {}, { requestId: 1, text: '' }, { requestId: 1, text: '   \n' }, { requestId: 1, text: 'a'.repeat(401) },
  { requestId: -1, text: 'hello' }, { requestId: 1.5, text: 'hello' }, { requestId: 1, text: 5 },
  { requestId: 1, text: 'hello', sender: { kind: 'server' } }, { requestId: 1, text: 'hello', name: 'Victim' }])('invalid or forged chat input is rejected: %j', input => {
  const c = new RoomChat(); expect(c.send(input, sender, 1000, true).ok).toBe(false); expect(c.messages).toEqual([]);
});
test('normalizes edges, preserves multiline literal HTML, canonical identity, order and unique identifiers', () => {
  const c = new RoomChat(); c.send({ requestId: 1, text: '  <script>alert(1)</script>\nHola  ' }, sender, 1000, true);
  c.send({ requestId: 2, text: 'Segundo' }, sender, 2000, true);
  expect(c.messages.map(m => m.sequence)).toEqual([1, 2]); expect(new Set(c.messages.map(m => m.id)).size).toBe(2);
  expect(c.messages[0]).toMatchObject({ text: '<script>alert(1)</script>\nHola', sender });
});
test('rate limit survives retry, exact duplicate is idempotent, conflicting or evicted retry is rejected', () => {
  const c = new RoomChat(); const input = { requestId: 1, text: 'first' }; const reply = c.send(input, sender, 1000, true);
  expect(c.send(input, sender, 1001, true)).toEqual(reply); expect(c.messages).toHaveLength(1);
  expect(c.send({ requestId: 1, text: 'different' }, sender, 2000, true)).toMatchObject({ ok: false, error: 'stale-request' });
  expect(c.send({ requestId: 2, text: 'second' }, sender, 1999, true)).toMatchObject({ ok: false, error: 'rate-limited' });
  for (let i = 2; i <= 152; i++) expect(c.send({ requestId: i, text: '' + i }, sender, i * 1000, true).ok).toBe(true);
  expect(c.messages).toHaveLength(150); expect(c.messages[0]!.sequence).toBe(3);
  expect(c.send(input, sender, 200000, true)).toMatchObject({ ok: false, error: 'stale-request' });
  expect(c.sequence).toBe(152); expect(c.nextRequest('p')).toBe(153);
});
test('rate budgets are per participant and readonly never consumes requests', () => {
  const c = new RoomChat(); expect(c.send({ requestId: 1, text: 'no' }, sender, 1000, false)).toMatchObject({ ok: false, error: 'read-only' });
  expect(c.nextRequest('p')).toBe(1); expect(c.send({ requestId: 1, text: 'yes' }, sender, 1000, true).ok).toBe(true);
  expect(c.send({ requestId: 1, text: 'other' }, { ...sender, participantId: 'q' }, 1000, true).ok).toBe(true);
});
test('400 characters are accepted without truncation', () => {
  const c = new RoomChat(); expect(c.send({ requestId: 1, text: 'x'.repeat(400) }, sender, 1000, true).ok).toBe(true);
  expect(c.messages[0]!.text).toHaveLength(400);
});
test.each([1, 2, 3, 4, 5, 6] as const)('chat is independent of round %i and cannot change simulation state', round => {
  const m = new RoomManager(() => 0); try {
    const r = m.create('s0', 'Host'); if (!r.ok) throw new Error(r.error);
    for (let i = 1; i < 4; i++) m.join('s' + i, 'Person ' + i, r.value.room.code); m.start('s0');
    const game = (m as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(r.value.room.code)!.game;
    game.state = { ...game.state, currentRound: round }; const state = JSON.stringify(game.state);
    expect(m.sendChat('s3', { requestId: 1, text: 'Debatimos la decisión.' }).ok).toBe(true);
    expect(JSON.stringify(game.state)).toBe(state);
  } finally { m.dispose(); }
});
test('manager authenticates lobby and active sessions; death, abandonment and finalization are read-only', () => {
  const m = new RoomManager(() => 0); try {
    expect(m.sendChat('outsider', { requestId: 1, text: 'no' })).toMatchObject({ ok: false, error: 'invalid-session' });
    const created = m.create('s0', 'Host'); if (!created.ok) throw new Error(created.error);
    const code = created.value.room.code; for (let i = 1; i < 4; i++) m.join('s' + i, 'Person ' + i, code);
    expect(m.sendChat('s0', { requestId: 1, text: 'Lobby' }).ok).toBe(true); expect(m.chatSession('s0')!.messages[0]!.sender).not.toHaveProperty('role');
    m.start('s0'); const game = (m as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game;
    const before = JSON.stringify(game.state); expect(m.sendChat('s3', { requestId: 1, text: 'Revelar ventilación; tratar; dar pack; votar' }).ok).toBe(true);
    expect(JSON.stringify(game.state)).toBe(before);
    game.state = { ...game.state, characters: game.state.characters.map((c, i) => ({ ...c, health: i === 0 ? 0 : c.health, eliminated: i === 1 })) };
    for (const i of [0, 1]) expect(m.sendChat('s' + i, { requestId: 2, text: 'no' })).toMatchObject({ ok: false, error: 'read-only' });
    game.state = { ...game.state, characters: game.state.characters.map(c => ({ ...c, health: 0 })) }; m.finalResult(code);
    expect(m.chatSession('s2')!.canWrite).toBe(false); expect(m.chatSession('s2')!.messages).toHaveLength(2);
  } finally { m.dispose(); }
});
