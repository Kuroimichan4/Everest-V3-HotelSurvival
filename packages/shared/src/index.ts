// Contratos publicos. No colocar secretos ni catalogos internos del juego aqui.
export interface HealthResponse {
  status: "ok";
  service: "everest-server";
}

export interface ServerReadyPayload {
  service: "everest-server";
}

export interface PingResponse {
  ok: true;
}

export interface ClientToServerEvents {
  "client:ping": (acknowledge: (response: PingResponse) => void) => void;
}

export interface ServerToClientEvents {
  "server:ready": (payload: ServerReadyPayload) => void;
}
