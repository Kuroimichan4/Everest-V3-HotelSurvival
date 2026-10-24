import type { Server } from "socket.io";
import type { ClientToServerEvents, PublicRoom, RoomReply, RoomSession, ServerToClientEvents } from "@everest/shared";
import { RoomManager } from "./manager.js";

export function registerRooms(io: Server<ClientToServerEvents, ServerToClientEvents>, manager = new RoomManager()): () => void {
  const channel = (code: string) => `room:${code}`;
  const publish = (room: PublicRoom) => { io.to(channel(room.code)).emit("room:updated", room); };
  manager.onVotingChanged = (code) => {
    const vote = manager.publicVote(code);
    if (vote) io.to(channel(code)).emit("vote:updated", vote);
    const roundTwo = manager.roundTwoView(code);
    if (roundTwo) io.to(channel(code)).emit("round-two:updated", roundTwo);
    const summary = manager.roundSummary(code);
    if (summary) io.to(channel(code)).emit("round:completed", summary);
  };
  const sendVoting = (socketId: string) => {
    const state = manager.votingSession(socketId);
    const roundTwo = manager.roundTwoSession(socketId);
    if (roundTwo) io.sockets.sockets.get(socketId)?.emit("round-two:updated", roundTwo);
    const summary = manager.summarySession(socketId);
    if (summary) io.sockets.sockets.get(socketId)?.emit("round:completed", summary);
    if (state) {
      io.sockets.sockets.get(socketId)?.emit("vote:updated", state.public);
      io.sockets.sockets.get(socketId)?.emit("vote:own", state.own);
    }
  };

  io.on("connection", (socket) => {
    socket.on("round:advance", (ack) => {
      if (typeof ack === "function") ack(manager.advanceRound(socket.id));
    });
    socket.on("vote:cast", (input, ack) => {
      if (typeof ack === "function") ack(manager.vote(socket.id, input));
    });
    const enter = async (result: RoomReply<RoomSession>, ack: (result: RoomReply<RoomSession>) => void) => {
      if (result.ok) {
        await socket.join(channel(result.value.room.code));
        // Si se desconectó mientras entraba en el canal, no dejar una plaza conectada fantasma.
        if (!socket.connected) return;
        ack(result);
        publish(result.value.room);
        const role = manager.privateRole(socket.id);
        if (role) socket.emit("game:role", role);
        sendVoting(socket.id);
      } else ack(result);
    };
    socket.on("room:create", (input, ack) => {
      if (typeof ack === "function") void enter(manager.create(socket.id, input?.name), ack);
    });
    socket.on("room:join", (input, ack) => {
      if (typeof ack === "function") void enter(manager.join(socket.id, input?.name, input?.code), ack);
    });
    socket.on("room:resume", (input, ack) => {
      if (typeof ack === "function") void enter(manager.resume(socket.id, input), ack);
    });
    socket.on("room:start", (ack) => {
      if (typeof ack !== "function") return;
      const result = manager.start(socket.id);
      ack(result);
      if (!result.ok) return;
      publish(result.value);
      for (const member of io.sockets.adapter.rooms.get(channel(result.value.code)) ?? []) {
        const role = manager.privateRole(member);
        if (role) io.sockets.sockets.get(member)?.emit("game:role", role);
        sendVoting(member);
      }
    });
    socket.on("disconnect", () => {
      const room = manager.disconnect(socket.id);
      if (room) publish(room);
    });
  });
  return () => manager.dispose();
}
