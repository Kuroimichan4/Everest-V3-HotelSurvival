import { isIP } from 'node:net';

const loopback = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
function port(value, fallback, name) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`${name} debe estar entre 1 y 65535.`);
  return number;
}
function exactOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new Error('WEB_ORIGIN debe ser un origen HTTP(S) concreto.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password || url.hostname.includes('*')) throw new Error('WEB_ORIGIN debe ser un origen HTTP(S) concreto, sin rutas ni comodines.');
  return url.origin;
}
/** Shared by Vite and Node; no credentials or provider settings are read here. */
export function readNetworkConfig(env) {
  const mode = env.EVEREST_NETWORK_MODE ?? 'local';
  if (!['local', 'lan'].includes(mode)) throw new Error('EVEREST_NETWORK_MODE debe ser local o lan.');
  const backendHost = env.HOST ?? '127.0.0.1';
  if (!loopback(backendHost)) throw new Error('HOST debe ser loopback; solo Vite puede exponerse a la LAN.');
  const backendPort = port(env.PORT, 3001, 'PORT');
  const frontendPort = port(env.FRONTEND_PORT, 5173, 'FRONTEND_PORT');
  const backendUrl = env.BACKEND_URL ?? `http://${backendHost === '::1' ? '[::1]' : backendHost}:${backendPort}`;
  let target; try { target = new URL(backendUrl); } catch { throw new Error('BACKEND_URL debe apuntar a Fastify en loopback.'); }
  if (target.protocol !== 'http:' || !loopback(target.hostname) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('BACKEND_URL debe ser HTTP en loopback, sin credenciales, rutas ni consultas.');
  const localOrigin = `http://localhost:${frontendPort}`;
  let frontendHost = 'localhost'; let webOrigins;
  if (mode === 'lan') {
    const host = env.EVEREST_LAN_HOST ?? '';
    const [a, b] = host.split('.').map(Number);
    if (isIP(host) !== 4 || !(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) throw new Error('EVEREST_LAN_HOST debe ser la IPv4 privada de tu interfaz LAN, no un comodín ni una IP pública.');
    frontendHost = host;
    webOrigins = [localOrigin, `http://${host}:${frontendPort}`];
    if (env.WEB_ORIGIN && !webOrigins.includes(exactOrigin(env.WEB_ORIGIN))) throw new Error('WEB_ORIGIN no coincide con los orígenes local/LAN autorizados.');
  } else webOrigins = [exactOrigin(env.WEB_ORIGIN ?? localOrigin)];
  return { mode, frontendHost, frontendPort, backendHost, backendPort, backendUrl, webOrigin: webOrigins.at(-1), webOrigins };
}
