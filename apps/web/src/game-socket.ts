import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@everest/shared";
import type { GameUpdate } from "./game-state";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
/** La conexión pertenece al Lobby. Cada alta tiene una baja exacta, también bajo StrictMode. */
export function bindGameSocket(socket: GameSocket, dispatch: (event: GameUpdate) => void, lifecycle: {
  connect: () => void; disconnect: () => void; error: () => void; participantId: () => string | undefined;
}): () => void {
  let active = true;
  const push = (event: GameUpdate) => { if (active) dispatch(event); };
  const room: ServerToClientEvents["room:updated"] = value => push({ type: "room", value });
  const role: ServerToClientEvents["game:role"] = value => { if (value.participantId === lifecycle.participantId()) push({ type: "role", value }); };
  const revoke = () => push({ type: "role", value: null });
  const vote: ServerToClientEvents["vote:updated"] = value => push({ type: "vote", value });
  const own: ServerToClientEvents["vote:own"] = value => push({ type: "ownVote", value });
  const summary: ServerToClientEvents["round:completed"] = value => push({ type: "summary", value });
  const second: ServerToClientEvents["round-two:updated"] = value => push({ type: "roundTwo", value });
  const fourth: ServerToClientEvents["round-four:updated"] = value => push({ type: "roundFour", value });
  const third: ServerToClientEvents["round-three:updated"] = value => push({ type: "roundThree", value });
  const supplies: ServerToClientEvents["supplies:updated"] = value => push({ type: "supplies", value });
  const medical: ServerToClientEvents["medical:updated"] = value => push({ type: "medical", value });
  const transport: ServerToClientEvents["transport:updated"] = value => push({ type: "transport", value });
  const activity: ServerToClientEvents["game:activity"] = value => push({ type: "activity", value });
  const connect = () => { if (active) lifecycle.connect(); };
  const disconnect = () => { if (active) { push({ type: "disconnect" }); lifecycle.disconnect(); } };
  const error = () => { if (active) lifecycle.error(); };
  socket.on("connect", connect); socket.on("disconnect", disconnect); socket.on("connect_error", error);
  socket.on("room:updated", room); socket.on("game:role", role); socket.on("game:role-unavailable", revoke);
  socket.on("vote:updated", vote); socket.on("vote:own", own); socket.on("round:completed", summary);
  socket.on("round-two:updated", second); socket.on("round-three:updated", third); socket.on("round-four:updated", fourth);
  socket.on("supplies:updated", supplies); socket.on("medical:updated", medical);
  socket.on("transport:updated", transport); socket.on("game:activity", activity);
  return () => {
    active = false;
    socket.off("connect", connect); socket.off("disconnect", disconnect); socket.off("connect_error", error);
    socket.off("room:updated", room); socket.off("game:role", role); socket.off("game:role-unavailable", revoke);
    socket.off("vote:updated", vote); socket.off("vote:own", own); socket.off("round:completed", summary);
    socket.off("round-two:updated", second); socket.off("round-three:updated", third); socket.off("round-four:updated", fourth);
    socket.off("supplies:updated", supplies); socket.off("medical:updated", medical);
    socket.off("transport:updated", transport); socket.off("game:activity", activity);
  };
}
