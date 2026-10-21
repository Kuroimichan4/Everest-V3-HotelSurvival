import { expect, test } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@everest/shared";
import { buildApp } from "./app.js";

test("Fastify responde a la comprobacion HTTP", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "everest-server" });
  } finally {
    await app.close();
  }
});

test("Socket.IO conecta y responde a un mensaje del cliente", async () => {
  const app = buildApp();
  let client: Socket<ServerToClientEvents, ClientToServerEvents> | undefined;
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Puerto no disponible");
    client = io(`http://127.0.0.1:${address.port}`, {
      autoConnect: false,
      reconnection: false,
      timeout: 3_000,
    });
    const socket = client;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No llego server:ready")), 4_000);
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
      socket.once("server:ready", (payload) => {
        clearTimeout(timer);
        if (payload.service !== "everest-server") reject(new Error("Servicio inesperado"));
        else resolve();
      });
    });
    socket.connect();
    await ready;
    expect(await socket.timeout(3_000).emitWithAck("client:ping")).toEqual({ ok: true });
  } finally {
    client?.disconnect();
    await app.close();
  }
});
