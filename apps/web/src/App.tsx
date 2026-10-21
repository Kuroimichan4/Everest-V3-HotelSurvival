import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, HealthResponse, ServerToClientEvents } from "@everest/shared";

type ConnectionStatus = "Comprobando…" | "Conectado" | "Sin conexión";

export function App() {
  const [httpStatus, setHttpStatus] = useState<ConnectionStatus>("Comprobando…");
  const [socketStatus, setSocketStatus] = useState<ConnectionStatus>("Comprobando…");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function checkBackend() {
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        if (!response.ok) throw new Error("El servidor no responde correctamente.");
        const health = (await response.json()) as Partial<HealthResponse>;
        if (health.status !== "ok" || health.service !== "everest-server") {
          throw new Error("Respuesta de servidor inesperada.");
        }
        if (active) setHttpStatus("Conectado");
      } catch {
        if (active) setHttpStatus("Sin conexión");
      }
    }

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false });
    socket.on("server:ready", (payload) => {
      if (payload.service !== "everest-server") return;
      socket.timeout(3_000).emit("client:ping", (error, response) => {
        if (active) setSocketStatus(!error && response?.ok ? "Conectado" : "Sin conexión");
      });
    });
    socket.on("disconnect", () => { if (active) setSocketStatus("Sin conexión"); });
    socket.on("connect_error", () => { if (active) setSocketStatus("Sin conexión"); });
    void checkBackend();
    socket.connect();
    return () => {
      active = false;
      controller.abort();
      socket.disconnect();
    };
  }, []);

  return (
    <main className="shell">
      <p className="eyebrow">EVEREST V3 · PROYECTO EN DESARROLLO</p>
      <h1>Hotel Survival</h1>
      <p className="intro">Simulación multijugador de gestión de crisis.</p>
      <section className="connection-panel" aria-labelledby="connection-title">
        <h2 id="connection-title">Estado de conexión</h2>
        <dl aria-live="polite">
          <div><dt>Servidor</dt><dd>{httpStatus}</dd></div>
          <div><dt>Tiempo real</dt><dd>{socketStatus}</dd></div>
        </dl>
      </section>
      <p className="notice">La simulación todavía no está disponible.</p>
    </main>
  );
}
