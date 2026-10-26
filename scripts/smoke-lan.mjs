// Run after npm run build. Isolated local services and demo rooms; no provider calls.
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { io } from 'socket.io-client';
import { buildApp } from '../apps/server/dist/app.js';
import { RoomManager } from '../apps/server/dist/rooms/manager.js';
import { readNetworkConfig } from '../config/network.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const lanHost = Object.values(networkInterfaces()).flatMap(items => items ?? []).find(i => !i.internal && i.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address;
assert.ok(lanHost, 'Se necesita una interfaz IPv4 privada para la comprobación LAN.');
const freePort = host => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject); server.listen(0, host, () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(20); } throw new Error('No se sincronizaron los clientes.'); };
for (const mode of ['local', 'lan']) {
  const frontendPort = await freePort(mode === 'lan' ? lanHost : 'localhost');
  const variables = { EVEREST_NETWORK_MODE: mode, EVEREST_LAN_HOST: lanHost, FRONTEND_PORT: String(frontendPort), HOST: '127.0.0.1', WEB_ORIGIN: `http://localhost:${frontendPort}` };
  const network = readNetworkConfig({ ...variables, PORT: '3001', BACKEND_URL: 'http://127.0.0.1:3001' });
  const manager = new RoomManager(); // Default demonstration adapter, independent of private .env.
  const app = buildApp({ roomManager: manager, webOrigins: network.webOrigins });
  const clients = []; let vite; const saved = new Map();
  try {
    await app.listen({ host: network.backendHost, port: 0 }); const backend = app.server.address();
    assert.equal(backend.address, '127.0.0.1');
    Object.assign(variables, { PORT: String(backend.port), BACKEND_URL: `http://127.0.0.1:${backend.port}` });
    for (const [key, value] of Object.entries(variables)) { saved.set(key, process.env[key]); process.env[key] = value; }
    vite = await createServer({ configFile: path.join(root, 'apps/web/vite.config.ts'), root: path.join(root, 'apps/web'), logLevel: 'silent' }); await vite.listen();
    const origin = network.webOrigin;
    const html = await fetch(origin); assert.equal(html.status, 200); assert.match(await html.text(), /id="root"/);
    assert.equal((await fetch(origin + '/src/main.tsx')).status, 200);
    const health = await fetch(origin + '/api/health', { headers: { Origin: origin } }); assert.equal((await health.json()).status, 'ok');
    const allowedCors = await fetch(origin + '/src/main.tsx', { headers: { Origin: origin } }); assert.equal(allowedCors.headers.get('access-control-allow-origin'), origin);
    const forbiddenCors = await fetch(origin + '/src/main.tsx', { headers: { Origin: 'http://untrusted.invalid' } }); assert.notEqual(forbiddenCors.headers.get('access-control-allow-origin'), '*'); assert.notEqual(forbiddenCors.headers.get('access-control-allow-origin'), 'http://untrusted.invalid');
    if (mode === 'lan') {
      assert.equal((await fetch(origin + '/@fs/' + path.join(root, '.env').replaceAll('\\', '/'))).status, 403);
      assert.equal((await fetch(origin + '/@fs/' + path.join(root, 'apps/server/src/config.ts').replaceAll('\\', '/'))).status, 403);
      await assert.rejects(fetch(`http://${lanHost}:${backend.port}/api/health`, { signal: AbortSignal.timeout(500) }));
    }
    const connect = async transport => {
      const client = io(origin, { autoConnect: false, reconnection: false, timeout: 2000, transports: [transport], extraHeaders: { Origin: origin } }); clients.push(client);
      await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); client.connect(); }); return client;
    };
    const players = await Promise.all(['polling', 'websocket', 'polling', 'websocket'].map(connect));
    const sessions = []; const roles = players.map(() => null); const chats = players.map(() => null);
    const attach = (client, i) => { client.on('game:role', value => { roles[i] = value; }); client.on('chat:updated', value => { chats[i] = value; }); }; players.forEach(attach);
    const first = await players[0].timeout(3000).emitWithAck('room:create', { name: 'Network Host' }); assert.equal(first.ok, true); sessions.push(first.value);
    for (let i = 1; i < 4; i++) { const joined = await players[i].timeout(3000).emitWithAck('room:join', { code: first.value.room.code, name: 'Participant ' + i }); assert.equal(joined.ok, true); sessions.push(joined.value); }
    assert.equal((await players[0].timeout(3000).emitWithAck('room:start')).ok, true); await wait(() => roles.every(Boolean));
    roles.forEach((role, i) => assert.equal(role.participantId, sessions[i].credential.participantId));
    await wait(() => chats.every(c => c?.messages.length === 1));
    assert.equal((await players[1].timeout(3000).emitWithAck('chat:send', { requestId: 1, text: 'Comprobación multijugador local.' })).ok, true); await wait(() => chats.every(c => c?.messages.length === 2));
    const vote = manager.publicVote(first.value.room.code); const deadline = vote.deadline;
    for (const player of players.slice(0, 3)) assert.equal((await player.timeout(3000).emitWithAck('vote:cast', { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: 'abandon' })).ok, true);
    assert.equal(manager.publicVote(first.value.room.code).status, 'closed'); assert.equal(manager.publicVote(first.value.room.code).deadline, deadline);
    const previous = players[3].id; players[3].disconnect(); await wait(() => manager.privateRole(previous) === null);
    players[3] = await connect('websocket'); attach(players[3], 3); assert.equal((await players[3].timeout(3000).emitWithAck('room:resume', sessions[3].credential)).ok, true);
    for (const transport of ['polling', 'websocket']) {
      const rejected = io(origin, { autoConnect: false, reconnection: false, timeout: 1000, transports: [transport], extraHeaders: { Origin: 'http://untrusted.invalid' } }); clients.push(rejected);
      const accepted = await new Promise(resolve => { rejected.once('connect', () => resolve(true)); rejected.once('connect_error', () => resolve(false)); rejected.connect(); }); assert.equal(accepted, false); rejected.disconnect();
    }
    console.log(JSON.stringify({ mode, html: true, httpProxy: true, polling: true, websocket: true, fourPrivateRoles: true, synchronizedChat: true, demoNpc: true, voting: true, resume: true, forbiddenOriginsRejected: true, backendLoopback: true, ...(mode === 'lan' ? { privateFilesBlocked: true, backendUnreachableOnLan: true } : {}) }));
  } finally {
    clients.forEach(client => client.disconnect()); if (vite) await vite.close(); await app.close();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
