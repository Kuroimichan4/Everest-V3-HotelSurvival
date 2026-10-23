import { expect, test } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, OwnVote, PublicVote, RoomReply, RoomSession, ServerToClientEvents, VoteInput } from "@everest/shared";
import { buildApp } from "../app.js";
import { RoomManager } from "./manager.js";
import type { VotingClock } from "./voting.js";

class TestClock implements VotingClock {
  time = 1000;
  tasks = new Map<number, { at: number; callback: () => void }>();
  serial = 0;
  now = () => this.time;
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.serial;
    this.tasks.set(id, { at: this.time + delay, callback });
    return () => { this.tasks.delete(id); };
  };
  advance(ms: number) {
    this.time += ms;
    for (const [id, task] of [...this.tasks]) if (task.at <= this.time) { this.tasks.delete(id); task.callback(); }
  }
}
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
function value<T>(reply: RoomReply<T>): T { if (!reply.ok) throw new Error(reply.error); return reply.value; }
function nextVote(client: Client, predicate: (vote: PublicVote) => boolean): Promise<PublicVote> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off("vote:updated", listener); reject(new Error("Sin actualización de voto")); }, 2000);
    function listener(vote: PublicVote) { if (predicate(vote)) { clearTimeout(timer); client.off("vote:updated", listener); resolve(vote); } }
    client.on("vote:updated", listener);
  });
}
async function fixture(run: (context: {
  clock: TestClock; manager: RoomManager; connect: () => Promise<Client>;
  room: () => Promise<{ clients: Client[]; sessions: RoomSession[]; vote: PublicVote }>;
}) => Promise<void>) {
  const clock = new TestClock();
  const manager = new RoomManager(() => 0, clock);
  const app = buildApp({ roomManager: manager });
  const all: Client[] = [];
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Sin puerto");
    const url = `http://127.0.0.1:${address.port}`;
    async function connect() {
      const client: Client = io(url, { autoConnect: false, reconnection: false });
      all.push(client);
      await new Promise<void>((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); client.connect(); });
      return client;
    }
    async function room() {
      const clients = await Promise.all(Array.from({ length: 4 }, connect));
      const sessions = [value<RoomSession>(await clients[0]!.timeout(2000).emitWithAck("room:create", { name: "Ana" }))];
      for (const client of clients.slice(1)) sessions.push(value<RoomSession>(await client.timeout(2000).emitWithAck("room:join", { name: "Jugador", code: sessions[0]!.room.code })));
      const pending = clients.map((client) => nextVote(client, () => true));
      expect((await clients[0]!.timeout(2000).emitWithAck("room:start")).ok).toBe(true);
      const votes = await Promise.all(pending);
      expect(votes.every((vote) => JSON.stringify(vote) === JSON.stringify(votes[0]))).toBe(true);
      return { clients, sessions, vote: votes[0]! };
    }
    await run({ clock, manager, connect, room });
  } finally { all.forEach((client) => client.disconnect()); await app.close(); expect(clock.tasks.size).toBe(0); }
}
const input = (vote: PublicVote, optionId = "rescue"): VoteInput => ({ decisionId: vote.decisionId, attemptId: vote.attemptId, optionId });
const cast = (client: Client, vote: PublicVote, optionId = "rescue") => client.timeout(2000).emitWithAck("vote:cast", input(vote, optionId));

test.each(["rescue", "abandon"])("cuatro sockets reciben mayoría inmediata de %s, sin filtraciones ni interferencia entre salas", async (option) => {
  await fixture(async ({ room, clock, connect }) => {
    const first = await room();
    const second = await room();
    expect(clock.tasks.size).toBe(2);
    expect(await cast(second.clients[0]!, first.vote)).toEqual({ ok: false, error: "wrong-decision" });
    const outsider = await connect();
    expect(await cast(outsider, first.vote)).toEqual({ ok: false, error: "invalid-session" });
    const forged = { ...input(first.vote), participantId: first.sessions[1]!.credential.participantId };
    expect(await first.clients[0]!.timeout(2000).emitWithAck("vote:cast", forged)).toEqual({ ok: false, error: "invalid-input" });
    expect(await cast(first.clients[0]!, first.vote, "missing")).toEqual({ ok: false, error: "invalid-option" });
    expect((await cast(first.clients[0]!, first.vote, option)).ok).toBe(true);
    expect((await cast(first.clients[0]!, first.vote, option)).ok).toBe(true);
    expect((await cast(first.clients[1]!, first.vote, option)).ok).toBe(true);
    const closed = first.clients.map((client) => nextVote(client, (vote) => vote.status === "closed"));
    expect((await cast(first.clients[2]!, first.vote, option)).ok).toBe(true);
    const results = await Promise.all(closed);
    expect(new Set(results.map((vote) => JSON.stringify(vote))).size).toBe(1);
    expect(results[0]!.result).toBe(option === "rescue" ? "RESCUE_APPROVED" : "ABANDON_APPROVED");
    expect(await cast(first.clients[3]!, first.vote, option)).toEqual({ ok: false, error: "closed" });
    const secondState = new Promise<OwnVote>((resolve) => second.clients[3]!.once("vote:own", resolve));
    // Una reautenticación de la misma conexión solo recupera la decisión existente.
    await second.clients[3]!.timeout(2000).emitWithAck("room:resume", second.sessions[3]!.credential);
    expect((await secondState).optionId).toBeNull();
    expect(clock.tasks.size).toBe(1);
    for (const vote of results) {
      expect(Object.keys(vote).sort()).toEqual(["attemptId", "attemptNumber", "deadline", "decisionId", "requiredVotes", "result", "round", "serverNow", "status"]);
      const serialized = JSON.stringify(vote);
      for (const session of first.sessions) expect(serialized).not.toContain(session.credential.token);
      expect(serialized).not.toMatch(/knowledge|objective|conference|palanca|votes|participantId/);
    }
  });
});

test("reconexión recupera voto propio y plazo; votos mezclados vencen automáticamente en dos intentos", async () => {
  await fixture(async ({ room, clock, connect, manager }) => {
    const { clients, sessions, vote } = await room();
    for (let i = 0; i < 4; i++) expect((await cast(clients[i]!, vote, i % 2 ? "abandon" : "rescue")).ok).toBe(true);
    clock.advance(10_000);
    const disconnected = new Promise<void>((resolve) => clients[1]!.once("room:updated", () => resolve()));
    clients[0]!.disconnect();
    await disconnected;
    expect(manager.votingSession(clients[1]!.id!)!.public.requiredVotes).toBe(3);
    const replacement = await connect();
    clients[0] = replacement;
    const resumed = nextVote(replacement, () => true);
    const own = new Promise<OwnVote>((resolve) => replacement.once("vote:own", resolve));
    expect((await replacement.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential)).ok).toBe(true);
    expect(await resumed).toMatchObject({ decisionId: vote.decisionId, attemptId: vote.attemptId, deadline: vote.deadline, requiredVotes: 3, status: "open" });
    expect((await own).optionId).toBe("rescue");
    expect(clock.tasks.size).toBe(1);
    const second = clients.map((client) => nextVote(client, (state) => state.attemptNumber === 2));
    clock.advance(50_000);
    const states = await Promise.all(second);
    const retry = states[0]!;
    expect(retry.deadline - retry.serverNow).toBe(30_000);
    expect(retry.attemptId).not.toBe(vote.attemptId);
    expect(await cast(replacement, vote)).toEqual({ ok: false, error: "wrong-attempt" });
    const closed = clients.map((client) => nextVote(client, (state) => state.result === "NO_AGREEMENT"));
    clock.advance(30_000);
    expect((await Promise.all(closed)).every((state) => state.result === "NO_AGREEMENT")).toBe(true);
    expect(clock.tasks.size).toBe(0);
    // Resultado conservado para reconexiones posteriores y futura resolución.
    const final = nextVote(replacement, (state) => state.status === "closed");
    await replacement.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential);
    expect((await final).result).toBe("NO_AGREEMENT");
  });
});

test("rechaza un voto fuera de plazo aunque el planificador aún no haya ejecutado el vencimiento", async () => {
  await fixture(async ({ room, clock }) => {
    const { clients, vote } = await room();
    clock.time = vote.deadline;
    expect(await cast(clients[0]!, vote)).toEqual({ ok: false, error: "expired" });
    expect(clock.tasks.size).toBe(1);
  });
});
