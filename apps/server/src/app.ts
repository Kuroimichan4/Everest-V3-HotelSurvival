import Fastify from "fastify";
import { Server } from "socket.io";
import type { ClientToServerEvents, HealthResponse, ServerToClientEvents } from "@everest/shared";
import { registerRooms } from "./rooms/socket.js";
import { RoomManager } from "./rooms/manager.js";

interface AppOptions {
  roomManager?: RoomManager;
  logger?: boolean;
  webOrigin?: string;
}

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    serveClient: false,
    cors: { origin: options.webOrigin ?? "http://localhost:5173", methods: ["GET", "POST"] },
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
