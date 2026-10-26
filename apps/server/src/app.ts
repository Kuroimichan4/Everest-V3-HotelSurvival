import Fastify from "fastify";
import { Server } from "socket.io";
import type { ClientToServerEvents, HealthResponse, ServerToClientEvents } from "@everest/shared";
import { registerRooms } from "./rooms/socket.js";
import { RoomManager } from "./rooms/manager.js";

interface AppOptions {
  roomManager?: RoomManager;
  logger?: boolean;
  webOrigin?: string;
  webOrigins?: string[];
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const origins = options.webOrigins ?? [options.webOrigin ?? 'http://localhost:5173'];
  if (!origins.length || origins.some(origin => {
    try { const u = new URL(origin); return !['http:', 'https:'].includes(u.protocol) || u.origin !== origin || !!u.username || !!u.password || u.hostname.includes('*'); }
    catch { return true; }
  })) throw new Error('Se requieren orígenes HTTP(S) concretos.');
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    serveClient: false,
    cors: { origin: origins, methods: ["GET", "POST"] },
    // Browser WebSockets bypass CORS, so enforce the same exact origin list at handshake.
    // Native clients without Origin still use the existing authenticated room protocol.
    allowRequest: (request, done) => done(null, request.headers.origin === undefined || origins.includes(request.headers.origin)),
  });
  const disposeRooms = registerRooms(io, options.roomManager);
  app.get<{ Reply: HealthResponse }>("/api/health", async () => ({
    status: "ok",
    service: "everest-server",
  }));
  io.on("connection", (socket) => {
    socket.emit("server:ready", { service: "everest-server" });
    socket.on("client:ping", (acknowledge) => {
      if (typeof acknowledge === "function") acknowledge({ ok: true });
    });
  });
  // Cerrar transportes antes del HTTP evita dejar conexiones abiertas al detener el proceso.
  app.addHook("preClose", async () => {
    disposeRooms();
    io.disconnectSockets(true);
    io.engine.close();
  });
  app.addHook("onClose", async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  return app;
}
