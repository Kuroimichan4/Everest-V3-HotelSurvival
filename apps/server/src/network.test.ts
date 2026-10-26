import { expect, test } from 'vitest';
import { readNetworkConfig } from '../../../config/network.mjs';
import { buildApp } from './app.js';
import { io } from 'socket.io-client';

// Synthetic configuration fixtures, never defaults for the delivered application.
const host = '10.42.0.7';
test('default config remains localhost with a loopback backend', () => {
  expect(readNetworkConfig({})).toMatchObject({ mode: 'local', frontendHost: 'localhost', frontendPort: 5173, backendHost: '127.0.0.1', backendPort: 3001, backendUrl: 'http://127.0.0.1:3001', webOrigins: ['http://localhost:5173'] });
  expect(readNetworkConfig({ EVEREST_LAN_HOST: host }).frontendHost).toBe('localhost');
});
test('LAN binds only the selected private interface and authorizes exact frontend origins', () => {
  expect(readNetworkConfig({ EVEREST_NETWORK_MODE: 'lan', EVEREST_LAN_HOST: host, FRONTEND_PORT: '5199' })).toMatchObject({
    frontendHost: host, frontendPort: 5199, backendHost: '127.0.0.1', webOrigins: ['http://localhost:5199', `http://${host}:5199`],
  });
});
test.each(['', '0.0.0.0', '::', '::1', '127.0.0.1', '8.8.8.8', '169.254.1.1', '172.15.1.1', '172.32.1.1', '192.169.1.1', 'example.com', '*'])('LAN refuses non-private or wildcard interface %s', ip => {
  expect(() => readNetworkConfig({ EVEREST_NETWORK_MODE: 'lan', EVEREST_LAN_HOST: ip })).toThrow('EVEREST_LAN_HOST');
});
test.each([
  { EVEREST_NETWORK_MODE: 'public' }, { HOST: '0.0.0.0' }, { HOST: host }, { BACKEND_URL: 'http://example.com:3001' },
  { BACKEND_URL: 'http://user:secret@localhost:3001' }, { BACKEND_URL: 'http://localhost:3001/private' }, { PORT: '0' },
  { FRONTEND_PORT: '65536' }, { WEB_ORIGIN: '*' }, { WEB_ORIGIN: 'http://*.invalid' }, { WEB_ORIGIN: 'http://localhost:5173/path' },
  { EVEREST_NETWORK_MODE: 'lan', EVEREST_LAN_HOST: host, WEB_ORIGIN: 'https://example.com' },
])('unsafe network configuration is rejected: %j', env => {
  expect(() => readNetworkConfig(env)).toThrow();
});
test('Socket server refuses wildcard origins', () => { for (const origin of ['*', 'http://*.invalid']) expect(() => buildApp({ webOrigins: [origin] })).toThrow(); });
test.each(['polling', 'websocket'] as const)('Socket %s accepts localhost/LAN and rejects unauthorized browser origins', async transport => {
  const origins = ['http://localhost:5173', `http://${host}:5173`]; const app = buildApp({ webOrigins: origins });
  try {
    await app.listen({ host: '127.0.0.1', port: 0 }); const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('port');
    for (const origin of [...origins, 'http://untrusted.invalid', 'null']) {
      const client = io(`http://127.0.0.1:${address.port}`, { autoConnect: false, reconnection: false, timeout: 1000, transports: [transport], extraHeaders: { Origin: origin } });
      try {
        const connected = await new Promise<boolean>(resolve => { client.once('connect', () => resolve(true)); client.once('connect_error', () => resolve(false)); client.connect(); });
        expect(connected).toBe(origins.includes(origin));
        if (connected) expect(await client.timeout(2000).emitWithAck('client:ping')).toEqual({ ok: true });
      } finally { client.disconnect(); }
    }
  } finally { await app.close(); }
});
