import { expect, test } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, PrivateRole, PublicRoom, RoomReply, RoomSession, ServerToClientEvents } from "@everest/shared";
import { buildApp } from "../app.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
function value<T>(reply: RoomReply<T>): T {
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
function updated(client: Client, predicate: (room: PublicRoom) => boolean): Promise<PublicRoom> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off("room:updated", listener); reject(new Error("No llegó la actualización")); }, 3000);
    const listener = (room: PublicRoom) => {
      if (predicate(room)) { clearTimeout(timer); client.off("room:updated", listener); resolve(room); }
    };
    client.on("room:updated", listener);
  });
}

test("cinco sockets: sincronización, inicio único, roles privados y reconexión real", async () => {
  const app = buildApp();
  const clients: Client[] = [];
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Puerto no disponible");
    const url = `http://127.0.0.1:${address.port}`;
    async function connect(): Promise<Client> {
      const client: Client = io(url, { autoConnect: false, reconnection: false, timeout: 2000 });
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
        client.connect();
      });
      return client;
    }
    const players = await Promise.all(Array.from({ length: 5 }, () => connect()));
    const host = players[0]!;
    const observer = players[4]!;
    const publicMessages: PublicRoom[] = [];
    const privateMessages = players.map(() => [] as PrivateRole[]);
    const observerPublic: PublicRoom[] = [];
    players.forEach((client, i) => {
      client.on("room:updated", (room) => publicMessages.push(room));
      client.on("game:role", (role) => privateMessages[i]!.push(role));
    });
    observer.on("room:updated", (room) => observerPublic.push(room));
    const created = value<RoomSession>(await host.timeout(3000).emitWithAck("room:create", { name: "Ana" }));
    const ready = updated(host, (room) => room.participants.length === 4);
    const sessions = [created];
    for (let i = 1; i < 4; i++) sessions.push(value<RoomSession>(await players[i]!.timeout(3000).emitWithAck("room:join", { name: `Persona ${i}`, code: created.room.code })));
    expect((await ready).participants.every((participant) => participant.connected)).toBe(true);
    expect(privateMessages.every((messages) => messages.length === 0)).toBe(true);
    expect(await observer.timeout(3000).emitWithAck("room:join", { name: "Quinta", code: created.room.code }))
      .toEqual({ ok: false, error: "room-full" });
    expect(await players[1]!.timeout(3000).emitWithAck("room:start")).toEqual({ ok: false, error: "not-creator" });
    const rolePromises = players.slice(0, 4).map((client) => new Promise<PrivateRole>((resolve) => client.once("game:role", resolve)));
    const replies = await Promise.all([
      host.timeout(3000).emitWithAck("room:start"), host.timeout(3000).emitWithAck("room:start"),
    ]);
    expect(replies.map((reply) => reply.ok)).toEqual([true, false]);
    expect(replies[1]).toEqual({ ok: false, error: "already-started" });
    const assignments = await Promise.all(rolePromises);
    expect(new Set(assignments.map((assignment) => assignment.role)).size).toBe(4);
    assignments.forEach((assignment, i) => {
      expect(assignment.participantId).toBe(sessions[i]!.credential.participantId);
      expect(privateMessages[i]).toEqual([assignment]);
      expect(assignment.sheet.name.length).toBeGreaterThan(0);
      expect(assignment.sheet.knowledge.length).toBeGreaterThan(0);
    });
    const disconnected = updated(host, (room) => room.participants[1]?.connected === false);
    players[1]!.disconnect();
    expect((await disconnected).status).toBe("started");
    const replacement = await connect();
    expect(await replacement.timeout(3000).emitWithAck("room:resume", { ...sessions[1]!.credential, token: "0".repeat(64) }))
      .toEqual({ ok: false, error: "invalid-credentials" });
    const privateRole = new Promise<PrivateRole>((resolve) => replacement.once("game:role", resolve));
    const resumed = value<RoomSession>(await replacement.timeout(3000).emitWithAck("room:resume", sessions[1]!.credential));
    expect(resumed.room.participants).toHaveLength(4);
    expect(await privateRole).toEqual(assignments[1]);
    // Barrera de ida y vuelta: las emisiones anteriores ya han llegado al observador.
    await observer.timeout(3000).emitWithAck("client:ping");
    expect(observerPublic).toEqual([]);
    expect(privateMessages[4]).toEqual([]);
    expect(publicMessages.length).toBeGreaterThan(0);
    for (const room of publicMessages) {
      expect(JSON.stringify(room)).not.toMatch(/(?:dos|2) unidades médicas|garantizad[oa]s?/i);
      expect(Object.keys(room).sort()).toEqual(["code", "creatorId", "participants", "status"]);
      for (const participant of room.participants) expect(Object.keys(participant).sort()).toEqual(["connected", "id", "name"]);
      for (const session of sessions) expect(JSON.stringify(room)).not.toContain(session.credential.token);
      for (const assignment of assignments) {
        expect(JSON.stringify(room)).not.toContain(assignment.sheet.objective);
        for (const entry of assignment.sheet.knowledge) expect(JSON.stringify(room)).not.toContain(entry.text);
      }
    }
  } finally {
    clients.forEach((client) => client.disconnect());
    await app.close();
  }
});
