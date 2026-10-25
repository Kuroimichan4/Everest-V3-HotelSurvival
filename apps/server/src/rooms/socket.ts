import type { Server } from "socket.io";
import type { ClientToServerEvents, PublicRoom, RoomReply, RoomSession, ServerToClientEvents } from "@everest/shared";
import { RoomManager } from "./manager.js";

export function registerRooms(io: Server<ClientToServerEvents, ServerToClientEvents>, manager = new RoomManager()): () => void {
  const channel = (code: string) => `room:${code}`;
  const publish = (room: PublicRoom) => { io.to(channel(room.code)).emit("room:updated", room); };
  const emitGame = <K extends keyof ServerToClientEvents>(code: string, event: K, payload: Parameters<ServerToClientEvents[K]>[0]) => {
    for (const member of io.sockets.adapter.rooms.get(channel(code)) ?? []) {
      const client = io.sockets.sockets.get(member);
      if (client) (client.emit as (...args: unknown[]) => void)(event, manager.sessionProjection(member, payload));
    }
  };
  manager.onFinished = code => {
    const result = manager.finalResult(code);
    if (!result) return;
    emitGame(code, "game:finished", result);
    for (const member of io.sockets.adapter.rooms.get(channel(code)) ?? []) {
      const objective = manager.objectiveSession(member);
      if (objective) io.sockets.sockets.get(member)?.emit("game:objective", objective);
    }
  };
  manager.onSuppliesChanged = (code) => {
    for (const member of io.sockets.adapter.rooms.get(channel(code)) ?? []) {
      if (!manager.privateRole(member)) io.sockets.sockets.get(member)?.emit("game:role-unavailable");
    }
    const transport = manager.transportView(code);
    if (transport) emitGame(code, "transport:updated", transport);
    const supplies = manager.suppliesView(code);
    if (supplies) emitGame(code, "supplies:updated", supplies);
    const activity = manager.activityView(code);
    if (activity) emitGame(code, "game:activity", activity);
    const medical = manager.medicalView(code);
    if (medical) emitGame(code, "medical:updated", medical);
    const roundTwo = manager.roundTwoView(code);
    if (roundTwo) emitGame(code, "round-two:updated", roundTwo);
    const roundFour = manager.roundFourView(code);
    if (roundFour) emitGame(code, "round-four:updated", roundFour);
    const roundThree = manager.roundThreeView(code);
    if (roundThree) emitGame(code, "round-three:updated", roundThree);
  };
  manager.onVotingChanged = (code) => {
    manager.onSuppliesChanged(code);
    const vote = manager.publicVote(code);
    if (vote) emitGame(code, "vote:updated", vote);
    const summary = manager.roundSummary(code);
    if (summary) emitGame(code, "round:completed", summary);
  };
  const sendVoting = (socketId: string) => {
    const state = manager.votingSession(socketId);
    const final = manager.finalSession(socketId);
    if (final) io.sockets.sockets.get(socketId)?.emit("game:finished", manager.sessionProjection(socketId, final));
    const objective = manager.objectiveSession(socketId);
    if (objective) io.sockets.sockets.get(socketId)?.emit("game:objective", objective);
    const transport = manager.transportSession(socketId);
    if (transport) io.sockets.sockets.get(socketId)?.emit("transport:updated", manager.sessionProjection(socketId, transport));
    const supplies = manager.suppliesSession(socketId);
    if (supplies) io.sockets.sockets.get(socketId)?.emit("supplies:updated", manager.sessionProjection(socketId, supplies));
    const activity = manager.activitySession(socketId);
    if (activity) io.sockets.sockets.get(socketId)?.emit("game:activity", manager.sessionProjection(socketId, activity));
    const medical = manager.medicalSession(socketId);
    if (medical) io.sockets.sockets.get(socketId)?.emit("medical:updated", manager.sessionProjection(socketId, medical));
    const roundTwo = manager.roundTwoSession(socketId);
    if (roundTwo) io.sockets.sockets.get(socketId)?.emit("round-two:updated", manager.sessionProjection(socketId, roundTwo));
    const roundFour = manager.roundFourSession(socketId);
    if (roundFour) io.sockets.sockets.get(socketId)?.emit("round-four:updated", manager.sessionProjection(socketId, roundFour));
    const roundThree = manager.roundThreeSession(socketId);
    if (roundThree) io.sockets.sockets.get(socketId)?.emit("round-three:updated", manager.sessionProjection(socketId, roundThree));
    const summary = manager.summarySession(socketId);
    if (summary) io.sockets.sockets.get(socketId)?.emit("round:completed", manager.sessionProjection(socketId, summary));
    if (state) {
      io.sockets.sockets.get(socketId)?.emit("vote:updated", state.public);
      io.sockets.sockets.get(socketId)?.emit("vote:own", state.own);
    }
  };

  io.on("connection", (socket) => {
    socket.on("round-four:advance", ack => { if (typeof ack === "function") ack(manager.roundFourAction(socket.id, "advance")); });
    socket.on("round-four:open", ack => { if (typeof ack === "function") ack(manager.roundFourAction(socket.id, "open")); });
    socket.on("round-four:retry", (input, ack) => { if (typeof ack === "function") ack(manager.roundFourAction(socket.id, "retry", input)); });
    socket.on("route:retry", (input, ack) => { if (typeof ack === "function") ack(manager.retryRoute(socket.id, input)); });
    socket.on("transport:open", (input, ack) => { if (typeof ack === "function") ack(manager.openTransport(socket.id, input)); });
    socket.on("round-three:advance", (ack) => { if (typeof ack === "function") ack(manager.roundThreeAction(socket.id, "advance")); });
    socket.on("round-three:open", (ack) => { if (typeof ack === "function") ack(manager.roundThreeAction(socket.id, "open")); });
    socket.on("medical:treat", (input, ack) => {
      if (typeof ack === "function") ack(manager.treat(socket.id, input));
    });
    socket.on("pack:give", (input, ack) => {
      if (typeof ack === "function") ack(manager.givePack(socket.id, input));
    });
    socket.on("route:reveal", (ack) => { if (typeof ack === "function") ack(manager.routeAction(socket.id, "reveal")); });
    socket.on("route:open", (ack) => { if (typeof ack === "function") ack(manager.routeAction(socket.id, "open")); });
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
