import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { io } from "socket.io-client";

const envPath = new URL("../.env", import.meta.url);
if (existsSync(envPath)) loadEnvFile(envPath);

const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const html = await fetch(webOrigin, { signal: AbortSignal.timeout(5_000) });
assert.equal(html.status, 200, "Vite debe servir el frontend");
assert.match(await html.text(), /id="root"/, "Debe existir el contenedor de React");
console.log("OK: frontend servido por HTTP");

const health = await fetch(new URL("/api/health", webOrigin), { signal: AbortSignal.timeout(5_000) });
assert.equal(health.status, 200, "El proxy debe alcanzar Fastify");
assert.deepEqual(await health.json(), { status: "ok", service: "everest-server" });
console.log("OK: frontend -> proxy HTTP -> Fastify");

// Verificar ambos transportes a traves de Vite, no solo la conexion directa al backend.
for (const transport of ["polling", "websocket"]) {
  const socket = io(webOrigin, {
    autoConnect: false,
    reconnection: false,
    transports: [transport],
    timeout: 4_000,
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Sin respuesta Socket.IO (${transport})`)), 5_000);
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
      socket.once("server:ready", (payload) => {
        clearTimeout(timer);
        if (payload.service !== "everest-server") reject(new Error("Servicio inesperado"));
        else resolve();
      });
      socket.connect();
    });
    assert.deepEqual(await socket.timeout(3_000).emitWithAck("client:ping"), { ok: true });
    console.log(`OK: Socket.IO a traves del frontend (${transport}, ida y vuelta)`);
  } finally {
    socket.disconnect();
  }
}
