import { expect, test, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, OwnVote, PublicVote, RoundOneSummary, RoomReply, RoomSession, ServerToClientEvents, VoteInput } from "@everest/shared";
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
  routeRandom: ReturnType<typeof vi.fn<() => number>>;
  clock: TestClock; manager: RoomManager; connect: () => Promise<Client>;
  room: () => Promise<{ clients: Client[]; sessions: RoomSession[]; vote: PublicVote }>;
}) => Promise<void>) {
  const clock = new TestClock();
  const routeRandom = vi.fn(() => 0.99);
  const manager = new RoomManager(() => 0, clock, routeRandom);
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
    await run({ clock, manager, connect, room, routeRandom });
  } finally { all.forEach((client) => client.disconnect()); await app.close(); expect(clock.tasks.size).toBe(0); }
}
const input = (vote: PublicVote, optionId = "rescue"): VoteInput => ({ decisionId: vote.decisionId, attemptId: vote.attemptId, optionId });
const cast = (client: Client, vote: PublicVote, optionId = "rescue") => client.timeout(2000).emitWithAck("vote:cast", input(vote, optionId));

test("10A: live vote replacement is synchronized, restored by F5 and closes immediately on the new majority", async () => {
  await fixture(async ({ room, manager, connect }) => {
    const { clients, sessions, vote } = await room(); const code = sessions[0]!.room.code;
    for (const [i, option] of [[0, "rescue"], [1, "rescue"], [2, "abandon"]] as const) expect((await cast(clients[i]!, vote, option)).ok).toBe(true);
    const updates = clients.map(c => nextVote(c, v => v.status === "open"));
    const changed = await cast(clients[0]!, vote, "abandon");
    expect(changed).toMatchObject({ ok: true, own: { optionId: "abandon" } });
    (await Promise.all(updates)).forEach(v => expect(v).toEqual(vote));
    expect(manager.roundSummary(code)).toBeNull();
    const oldId = clients[0]!.id!; clients[0]!.disconnect();
    await vi.waitFor(() => expect(manager.privateRole(oldId)).toBeNull());
    const replacement = await connect(); clients[0] = replacement;
    const restored = new Promise<OwnVote>(resolve => replacement.once("vote:own", resolve));
    expect((await replacement.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential)).ok).toBe(true);
    expect(await restored).toMatchObject({ optionId: "abandon", attemptId: vote.attemptId });
    const closed = clients.map(c => nextVote(c, v => v.status === "closed"));
    expect((await cast(clients[1]!, vote, "abandon")).ok).toBe(true);
    (await Promise.all(closed)).forEach(v => expect(v).toMatchObject({ result: "ABANDON_APPROVED", deadline: vote.deadline }));
    expect(await cast(replacement, vote, "rescue")).toEqual({ ok: false, error: "closed" });
  });
});

test("10A: four real sessions keep vitals and history private through R2 ordering and F5", async () => {
  await fixture(async ({ room, manager, connect, routeRandom, clock }) => {
    const { clients, sessions } = await room(); const code = sessions[0]!.room.code;
    clock.advance(60_000); clock.advance(30_000); // Real injuries, allowing medical activity.
    await clients[0]!.timeout(2000).emitWithAck("round:advance");
    expect(manager.publicVote(code)).toBeNull();
    expect(manager.roundTwoView(code)).toMatchObject({ phase: "route-pending", npc: "pending", movement: null, result: null });
    const maintenance = clients.find(c => manager.privateRole(c.id!)?.role === "maintenance")!;
    expect((await maintenance.timeout(2000).emitWithAck("route:reveal")).ok).toBe(true);
    expect((await maintenance.timeout(2000).emitWithAck("route:reveal")).ok).toBe(true);
    const internal = (manager as unknown as { rooms: Map<string, { game: { state: import("../simulation/state.js").SimulationState } }> }).rooms.get(code)!.game;
    expect(internal.state.routeRevelations).toEqual([{ routeId: "ventilation", round: 2, characterId: internal.state.characters.find(c => c.role === "maintenance")!.id, initiallyUnknownToOthers: true, sharedAt: clock.now() }]);
    await clients[0]!.timeout(2000).emitWithAck("route:open");
    const route = manager.publicVote(code)!;
    for (const c of clients.slice(0, 3)) await cast(c, route, "ventilation");
    expect(manager.roundTwoView(code)).toMatchObject({ phase: "rescue-vote", movement: null, result: null, routeChoice: { result: { outcome: "ventilation" } } });
    expect(routeRandom).not.toHaveBeenCalled();
    expect(internal.state.characters.every(c => c.energy === 75)).toBe(true);
    await finishNpc(manager, clients, code, "rescue", false);
    expect(manager.roundTwoView(code)?.phase).toBe("transport-pending");
    expect(internal.state.characters.every(c => c.energy === 50)).toBe(true);
    expect(routeRandom).not.toHaveBeenCalled();
    const medic = clients.find(c => manager.privateRole(c.id!)?.role === "medic")!;
    const bellhop = clients.find(c => manager.privateRole(c.id!)?.role === "bellhop")!;
    const supplies = manager.suppliesView(code)!;
    await medic.timeout(2000).emitWithAck("medical:treat", { requestId: "10A-treatment", gameId: supplies.gameId, round: 2, targetParticipantId: sessions[1]!.credential.participantId });
    await bellhop.timeout(2000).emitWithAck("pack:give", { requestId: "10A-pack", windowId: supplies.windowId!, targetParticipantId: sessions[1]!.credential.participantId });
    const raw = { supplies: manager.suppliesView(code)!, medical: manager.medicalView(code)!, activity: manager.activityView(code)!, summary: manager.roundSummary(code)! };
    for (let i = 0; i < 4; i++) {
      const c = clients[i]!; const id = sessions[i]!.credential.participantId; const isMedic = c === medic;
      const received = nextSupplies(c, v => v.round === 2);
      const activity = new Promise<import("@everest/shared").GameActivityView>(resolve => c.once("game:activity", resolve));
      const medical = nextMedical(c, v => v.round === 2);
      const summary = new Promise<RoundOneSummary>(resolve => c.once("round:completed", resolve));
      expect((await c.timeout(2000).emitWithAck("room:resume", sessions[i]!.credential)).ok).toBe(true);
      const view = await received;
      view.characters.forEach((p, j) => {
        expect(p.health).toBe(i === j || isMedic ? raw.supplies.characters[j]!.health : undefined);
        expect(p.energy).toBe(i === j ? raw.supplies.characters[j]!.energy : undefined);
        expect(p.status).toBe("active");
      });
      (await activity).entries.forEach(e => expect(e.restored).toBe(e.targetParticipantId === id || isMedic && e.kind === "treatment" ? raw.activity.entries.find(r => r.id === e.id)!.restored : undefined));
      (await medical).treatments.forEach(t => expect(t.healthRestored).toBe(t.participantId === id || isMedic ? raw.medical.treatments.find(r => r.participantId === t.participantId)!.healthRestored : undefined));
      (await summary).characters.forEach((p, j) => { expect(p.energy).toBe(i === j ? raw.summary.characters[j]!.energy : undefined); expect(p.health).toBe(i === j || isMedic ? raw.summary.characters[j]!.health : undefined); });
    }
    const before = JSON.stringify(internal.state); const npc = manager.publicVote(code)!;
    const old = clients[3]!.id!; clients[3]!.disconnect(); await vi.waitFor(() => expect(manager.privateRole(old)).toBeNull());
    const replacement = await connect(); clients[3] = replacement;
    const restored = nextSupplies(replacement, v => v.round === 2);
    await replacement.timeout(2000).emitWithAck("room:resume", sessions[3]!.credential);
    expect((await restored).characters.filter(p => p.energy !== undefined)).toHaveLength(1);
    expect(JSON.stringify(internal.state)).toBe(before); expect(manager.publicVote(code)).toEqual(npc);
    await continueMovement(manager, clients[0]!, code);
    expect(manager.roundTwoView(code)?.phase).toBe("completed"); expect(routeRandom).toHaveBeenCalledTimes(1);
    expect(internal.state.routeRevelations).toHaveLength(1);
  });
});

async function finishNpc(manager: RoomManager, clients: Client[], code: string, option = "rescue", move = true) {
  const npc = manager.publicVote(code)!;
  if (manager.roundTwoView(code)?.phase !== "rescue-vote") { if (move) await continueMovement(manager, clients[0]!, code); return; }
  for (const client of clients.slice(0, 3)) expect((await cast(client, npc, option)).ok).toBe(true);
  if (move) await continueMovement(manager, clients[0]!, code);
}
async function continueMovement(manager: RoomManager, host: Client, code: string) {
  const prep = manager.transportView(code)?.cases.at(-1);
  if (prep?.phase === "preparation") expect((await host.timeout(2000).emitWithAck("transport:open", { preparationId: prep.preparationId })).ok).toBe(true);
}
// Public collective facts remain synchronized; individual numeric fields are projected separately.
function publicFacts(value: unknown): string {
  return JSON.stringify(value, (key, entry) => ["health", "energy", "damage", "healthRestored", "restored", "routeEnergy", "transportEnergy", "danger", "resourceActions", "privateRoute"].includes(key) ? undefined : entry);
}

test("8D: una actualización por cliente, recibos repetidos sin emisiones ni historial duplicados", async () => {
  await fixture(async ({ room, manager, connect }) => {
    const { clients, sessions, vote } = await room(); const code = sessions[0]!.room.code;
    for (const client of clients.slice(0, 3)) await cast(client, vote);
    await Promise.all(clients.map(c => c.timeout(2000).emitWithAck("client:ping")));
    const counts = [0, 0, 0, 0];
    const activity: import("@everest/shared").GameActivityView[] = [];
    clients.forEach((c, i) => { c.on("supplies:updated", () => { counts[i] = (counts[i] ?? 0) + 1; }); c.on("game:activity", value => { activity[i] = value; }); });
    const bellhop = clients.find(c => manager.privateRole(c.id!)?.role === "bellhop")!;
    const medic = clients.find(c => manager.privateRole(c.id!)?.role === "medic")!;
    const pack = { requestId: crypto.randomUUID(), windowId: manager.suppliesView(code)!.windowId!, targetParticipantId: sessions[0]!.credential.participantId };
    const replies = await Promise.all([bellhop.timeout(2000).emitWithAck("pack:give", pack), bellhop.timeout(2000).emitWithAck("pack:give", pack)]);
    expect(replies.every(r => r.ok)).toBe(true);
    await Promise.all(clients.map(c => c.timeout(2000).emitWithAck("client:ping")));
    expect(counts).toEqual([1, 1, 1, 1]); expect(new Set(activity.map(a => publicFacts(a))).size).toBe(1);
    expect(activity[0]!.entries).toMatchObject([{ kind: "pack", restored: 25 }]);
    // Salud preparada exclusivamente en la prueba para comprobar la recuperación real hasta el máximo.
    const game = (manager as unknown as { rooms: Map<string, { game: { state: import("../simulation/state.js").SimulationState } }> }).rooms.get(code)!.game;
    game.state = { ...game.state, characters: game.state.characters.map((c, i) => i === 0 ? { ...c, health: 95 } : c) };
    const treatment = { requestId: crypto.randomUUID(), gameId: manager.suppliesView(code)!.gameId, round: 1 as const, targetParticipantId: sessions[0]!.credential.participantId };
    expect((await medic.timeout(2000).emitWithAck("medical:treat", treatment)).ok).toBe(true);
    expect((await medic.timeout(2000).emitWithAck("medical:treat", treatment)).ok).toBe(true);
    await Promise.all(clients.map(c => c.timeout(2000).emitWithAck("client:ping")));
    expect(counts).toEqual([2, 2, 2, 2]); expect(activity[0]!.entries).toHaveLength(2);
    expect(activity[0]!.entries[1]).toMatchObject({ kind: "treatment", restored: 5 });
    expect(JSON.stringify(activity)).not.toMatch(/token|objective|responsibility|knowledge|actorId|role/);
    const before = manager.activityView(code);
    const index = clients.indexOf(bellhop); const observer = clients.find(c => c !== bellhop)!;
    const left = new Promise<void>(resolve => observer.once("room:updated", () => resolve())); bellhop.disconnect(); await left;
    const replacement = await connect();
    const restored = new Promise<import("@everest/shared").GameActivityView>(resolve => replacement.once("game:activity", resolve));
    await replacement.timeout(2000).emitWithAck("room:resume", sessions[index]!.credential);
    expect(await restored).toEqual(manager.sessionProjection(replacement.id!, before));
    expect((await replacement.timeout(2000).emitWithAck("pack:give", pack)).ok).toBe(true);
    expect(manager.activityView(code)).toEqual(before);
  });
});

// Preparacion de energia exclusiva de pruebas que aislan rutas de otras mecanicas.
function prepareEnergy(manager: RoomManager, code: string, energy: number) {
  const game = (manager as unknown as { rooms: Map<string, { game: { state: import("../simulation/state.js").SimulationState } }> }).rooms.get(code)!.game;
  game.state = { ...game.state, characters: game.state.characters.map(c => ({ ...c, energy })) };
}

function nextTransport(client: Client, predicate: (state: import("@everest/shared").TransportView) => boolean) {
  return new Promise<import("@everest/shared").TransportView>((resolve, reject) => {
    const timer = setTimeout(() => { client.off("transport:updated", listener); reject(new Error("Missing transport update")); }, 2000);
    function listener(state: import("@everest/shared").TransportView) {
      if (predicate(state)) { clearTimeout(timer); client.off("transport:updated", listener); resolve(state); }
    }
    client.on("transport:updated", listener);
  });
}

test.each([2, 3] as const)("8C.1: recuperación y packs sincronizados en cuatro sesiones, F5 y aislamiento, ronda %i", async round => {
  await fixture(async ({ room, manager, connect, routeRandom }) => {
    const first = await room(); const other = await room(); const code = first.sessions[0]!.room.code;
    const otherBefore = manager.suppliesView(other.sessions[0]!.room.code);
    const foreign: unknown[] = [];
    other.clients[0]!.on("round-two:updated", s => foreign.push(s)); other.clients[0]!.on("round-three:updated", s => foreign.push(s));
    for (const c of first.clients.slice(0, 3)) await cast(c, first.vote, "abandon");
    await first.clients[0]!.timeout(2000).emitWithAck("round:advance");

    if (round === 3) {
      await first.clients[0]!.timeout(2000).emitWithAck("route:open");
      const route = manager.publicVote(code)!; for (const c of first.clients.slice(0, 3)) await cast(c, route, "unstable-corridor");
      await finishNpc(manager, first.clients, code, "abandon");
      await first.clients[0]!.timeout(2000).emitWithAck("round-three:advance");
    }
    const update = (c: Client, predicate: (s: import("@everest/shared").RoundTwoView | import("@everest/shared").RoundThreeView) => boolean) =>
      round === 2 ? nextRoundTwo(c, predicate) : nextRoundThree(c, predicate);
    const current = () => round === 2 ? manager.roundTwoView(code)! : manager.roundThreeView(code)!;
    prepareEnergy(manager, code, 100); routeRandom.mockClear();
    await first.clients[0]!.timeout(2000).emitWithAck(round === 2 ? "route:open" : "round-three:open");
    const old = manager.publicVote(code)!; const costly = round === 2 ? "shoring" : "fire-door";
    for (const c of first.clients.slice(0, 2)) await cast(c, old, costly);
    prepareEnergy(manager, code, 20); const before = manager.suppliesView(code)!;
    const recoveries = first.clients.map(c => update(c, s => !!s.recovery));
    await cast(first.clients[2]!, old, costly);
    if (round === 2) await finishNpc(manager, first.clients, code, "abandon");
    const blocked = await Promise.all(recoveries);
    expect(new Set(blocked.map(s => publicFacts(s))).size).toBe(1);
    expect(manager.suppliesView(code)!.characters).toEqual(before.characters);
    expect(routeRandom).not.toHaveBeenCalled();
    async function reload(predicate: (s: import("@everest/shared").RoundTwoView | import("@everest/shared").RoundThreeView) => boolean) {
      const disconnected = new Promise<void>(resolve => first.clients[1]!.once("room:updated", () => resolve()));
      first.clients[0]!.disconnect(); await disconnected;
      const replacement = await connect(); first.clients[0] = replacement;
      const restored = update(replacement, predicate);
      await replacement.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential);
      return restored;
    }
    expect(await reload(s => !!s.recovery)).toEqual(blocked[0]);
    const preparation = first.clients.map(c => update(c, s => !s.recovery && (s.round === 2 ? s.routeChoice?.phase === "preparation" : s.phase === "preparation")));
    expect((await first.clients[1]!.timeout(2000).emitWithAck("route:retry", { decisionId: old.decisionId })).ok).toBe(true);
    const prepared = await Promise.all(preparation);
    expect(new Set(prepared.map(s => publicFacts(s))).size).toBe(1);
    expect(await reload(s => !s.recovery)).toEqual(prepared[0]);
    const unlocked = first.clients.map(c => update(c, s => (s.round === 2 ? s.routeChoice!.options : s.options).find(o => o.id === costly)?.availability.status === "available"));
    const windowId = manager.suppliesView(code)!.windowId!;
    for (const session of first.sessions) expect((await first.clients[2]!.timeout(2000).emitWithAck("pack:give", { requestId: crypto.randomUUID(), windowId, targetParticipantId: session.credential.participantId })).ok).toBe(true);
    expect(new Set((await Promise.all(unlocked)).map(s => publicFacts(s))).size).toBe(1);
    await first.clients[0]!.timeout(2000).emitWithAck(round === 2 ? "route:open" : "round-three:open");
    const next = manager.publicVote(code)!; expect(next.decisionId).not.toBe(old.decisionId);
    expect(await cast(first.clients[0]!, old, costly)).toEqual({ ok: false, error: "wrong-decision" });
    const completed = first.clients.map(c => update(c, s => s.phase === "completed"));
    for (const c of first.clients.slice(0, 3)) await cast(c, next, round === 2 ? "unstable-corridor" : "pipe-gallery");
    if (round === 2) await finishNpc(manager, first.clients, code, "abandon");
    expect(new Set((await Promise.all(completed)).map(s => publicFacts(s))).size).toBe(1);
    expect(current().failedSelections).toHaveLength(1);
    expect(routeRandom).toHaveBeenCalledTimes(1);
    const final = manager.suppliesView(code)!;
    expect(final.inventory.packs).toBe(4); expect(final.characters.every(c => c.energy === 25)).toBe(true);
    await first.clients[1]!.timeout(2000).emitWithAck("route:retry", { decisionId: old.decisionId });
    expect(manager.suppliesView(code)).toEqual(final); expect(routeRandom).toHaveBeenCalledTimes(1);
    await other.clients[0]!.timeout(2000).emitWithAck("client:ping");
    expect(foreign).toEqual([]); expect(manager.suppliesView(other.sessions[0]!.room.code)).toEqual(otherBefore);
    expect(JSON.stringify(current())).not.toMatch(/accidentProbability|LOW|BAJO|objective|token|responsibility/);
  });
});

test.each(["carry-all", "carry-one", "leave-all"])("8B: cuatro sesiones, F5, aislamiento y peticiones simultáneas: %s", async option => {
  await fixture(async ({ room, manager, connect, routeRandom }) => {
    const first = await room(); const other = await room();
    const { clients, sessions } = first; const code = sessions[0]!.room.code;
    const otherBefore = manager.suppliesView(other.sessions[0]!.room.code);
    for (const client of clients.slice(0, 3)) await cast(client, first.vote, "abandon");
    await clients[0]!.timeout(2000).emitWithAck("round:advance");
    await clients[0]!.timeout(2000).emitWithAck("route:open");
    for (const client of clients.slice(0, 3)) await cast(client, manager.publicVote(code)!, "unstable-corridor");
    await finishNpc(manager, clients, code, "abandon");
    await clients[0]!.timeout(2000).emitWithAck("round-three:advance");
    // Escenario determinista de agotamiento, exclusivamente dentro del test.
    const game = (manager as unknown as { rooms: Map<string, { game: { state: import("../simulation/state.js").SimulationState } }> }).rooms.get(code)!.game;
    game.state = { ...game.state, characters: game.state.characters.map((c, i) => ({ ...c, energy: i < 2 ? 0 : 100 })) };
    await clients[0]!.timeout(2000).emitWithAck("round-three:open");
    const route = manager.publicVote(code)!;
    const preparation = clients.map(c => nextTransport(c, s => s.cases.at(-1)?.phase === "preparation"));
    for (const client of clients.slice(0, 3)) await cast(client, route, "pipe-gallery");
    const prepared = await Promise.all(preparation);
    expect(new Set(prepared.map(s => publicFacts(s))).size).toBe(1);
    const preparationId = prepared[0]!.cases.at(-1)!.preparationId;
    const opens = await Promise.all([clients[2]!, clients[3]!].map(c => c.timeout(2000).emitWithAck("transport:open", { preparationId })));
    expect(opens.every(reply => reply.ok)).toBe(true);
    let vote = manager.publicVote(code)!;
    expect(vote.requiredVotes).toBe(2);
    expect(await cast(clients[0]!, vote, option)).toEqual({ ok: false, error: "not-authorized" });
    const outsider = await connect();
    expect(await cast(outsider, vote, option)).toEqual({ ok: false, error: "invalid-session" });
    expect((await cast(clients[2]!, vote, option)).ok).toBe(true);
    expect((await cast(clients[2]!, vote, option)).ok).toBe(true);
    const disconnected = new Promise<void>(resolve => clients[3]!.once("room:updated", () => resolve()));
    clients[2]!.disconnect(); await disconnected;
    const replacement = await connect(); clients[2] = replacement;
    const restored = nextTransport(replacement, s => s.cases.at(-1)?.phase === "voting");
    const own = new Promise<OwnVote>(resolve => replacement.once("vote:own", resolve));
    await replacement.timeout(2000).emitWithAck("room:resume", sessions[2]!.credential);
    expect((await restored).cases.at(-1)!.vote).toMatchObject({ decisionId: vote.decisionId, attemptId: vote.attemptId, deadline: vote.deadline });
    expect((await own).optionId).toBe(option);
    if (option === "carry-one") {
      expect((await cast(clients[3]!, vote, option)).ok).toBe(true);
      const intermediate = manager.transportView(code)!.cases.at(-1)!;
      expect(intermediate).toMatchObject({ phase: "selection", abandonedIds: [], transportedIds: [] });
      expect(game.state.characters.every(c => !c.eliminated)).toBe(true);
      vote = intermediate.vote!;
      expect((await cast(clients[2]!, vote, "person-1")).ok).toBe(true);
    }
    routeRandom.mockClear();
    const rejected: unknown[] = [];
    routeRandom.mockImplementation(() => {
      rejected.push(manager.givePack(clients[2]!.id!, { requestId: crypto.randomUUID(), windowId: preparationId, targetParticipantId: sessions[1]!.credential.participantId }));
      return 0.99;
    });
    const updates = clients.map(c => nextTransport(c, s => s.cases.at(-1)?.phase === "completed"));
    const revoked = option === "carry-all" ? Promise.resolve() : new Promise<void>(resolve => clients[0]!.once("game:role-unavailable", resolve));
    const replies = await Promise.all([cast(clients[3]!, vote, option === "carry-one" ? "person-1" : option), cast(clients[3]!, vote, option === "carry-one" ? "person-1" : option)]);
    expect(replies.filter(reply => reply.ok)).toHaveLength(1);
    const final = await Promise.all(updates);
    await revoked;
    expect(new Set(final.map(s => publicFacts(s))).size).toBe(1);
    expect(routeRandom).toHaveBeenCalledTimes(1);
    expect(rejected).toEqual([{ ok: false, error: "supplies-not-open" }]);
    const result = final[0]!.cases.at(-1)!;
    expect(result.decisions).toHaveLength(option === "carry-one" ? 2 : 1);
    expect(result.transportedIds).toHaveLength(option === "carry-all" ? 2 : option === "carry-one" ? 1 : 0);
    expect(result.abandonedIds).toHaveLength(option === "carry-all" ? 0 : option === "carry-one" ? 1 : 2);
    expect(manager.roundThreeView(code)!.selection!.decisionId).toBe(route.decisionId);
    expect(manager.suppliesView(code)!.inventory).toEqual({ packs: 8, medicalUnits: 4 });
    expect(game.state.tools.crowbar).toBe("available");
    expect(JSON.stringify(final[0])).not.toMatch(/characterId|accidentProbability|token|responsibility|LOW/);
    if (option !== "carry-all") {
      const left = new Promise<void>(resolve => clients[3]!.once("room:updated", () => resolve()));
      clients[0]!.disconnect(); await left;
      const abandoned = await connect();
      const leaks: unknown[] = []; abandoned.on("game:role", role => leaks.push(role));
      const recovered = nextTransport(abandoned, s => s.cases.at(-1)?.phase === "completed");
      await abandoned.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential);
      expect(await recovered).toEqual(final[0]);
      await abandoned.timeout(2000).emitWithAck("client:ping");
      expect(leaks).toEqual([]);
      expect(await cast(abandoned, vote, "carry-all")).toEqual({ ok: false, error: "dead" });
    }
    const before = manager.suppliesView(code);
    await clients[3]!.timeout(2000).emitWithAck("transport:open", { preparationId });
    expect(manager.suppliesView(code)).toEqual(before);
    expect(routeRandom).toHaveBeenCalledTimes(1);
    expect(manager.suppliesView(other.sessions[0]!.room.code)).toEqual(otherBefore);
  });
});

test.each(["rescue", "abandon", "none"])("ronda 2 sincronizada, aislada y recuperable: %s", async option => {
  await fixture(async ({ room, manager, clock, connect }) => {
    const first = await room();
    const other = await room();
    expect(await first.clients[0]!.timeout(2000).emitWithAck("round:advance")).toEqual({ ok: false, error: "round-not-ready" });
    for (const client of first.clients.slice(0, 3)) await cast(client, first.vote);
    const summary = manager.roundSummary(first.sessions[0]!.room.code)!;
    expect(await first.clients[1]!.timeout(2000).emitWithAck("round:advance")).toEqual({ ok: false, error: "not-creator" });
    expect((await first.clients[0]!.timeout(2000).emitWithAck("round:advance")).ok).toBe(true);
    expect(manager.publicVote(first.sessions[0]!.room.code)).toBeNull();
    await first.clients[0]!.timeout(2000).emitWithAck("route:open");
    const routeVote = manager.publicVote(first.sessions[0]!.room.code)!;
    const updates = first.clients.map(client => nextVote(client, v => v.round === 2 && v.decisionId !== routeVote.decisionId));
    for (const c of first.clients.slice(0, 3)) await cast(c, routeVote, "unstable-corridor");
    const votes = await Promise.all(updates);
    let vote = votes[0]!;
    expect(new Set(votes.map(v => publicFacts(v))).size).toBe(1);
    expect(vote).toMatchObject({ round: 2, requiredVotes: 3, attemptNumber: 1 });
    expect(vote.deadline - vote.serverNow).toBe(60_000);
    expect(await first.clients[0]!.timeout(2000).emitWithAck("round:advance")).toEqual({ ok: false, error: "round-not-ready" });
    expect(await cast(other.clients[0]!, vote)).toEqual({ ok: false, error: "wrong-decision" });
    const outsider = await connect();
    expect(await cast(outsider, vote)).toEqual({ ok: false, error: "invalid-session" });
    expect(await cast(first.clients[0]!, first.vote)).toEqual({ ok: false, error: "wrong-decision" });
    const before = manager.roundTwoSession(first.clients[0]!.id!)!;
    expect(before.characters).toEqual(summary.characters);
    expect(before.inventory).toEqual(summary.inventory);
    expect(before.previousNpc).toBe("rescued");
    const own = option === "none" ? "rescue" : option;
    await cast(first.clients[0]!, vote, own);
    await cast(first.clients[0]!, vote, own);
    expect((await cast(first.clients[0]!, vote, own === "rescue" ? "abandon" : "rescue")).ok).toBe(true);
    expect(manager.votingSession(first.clients[0]!.id!)!.own.optionId).toBe(own === "rescue" ? "abandon" : "rescue");
    await cast(first.clients[0]!, vote, own);
    expect(manager.publicVote(first.sessions[0]!.room.code)?.status).toBe("open");
    const disconnected = new Promise<void>(resolve => first.clients[1]!.once("room:updated", () => resolve()));
    first.clients[0]!.disconnect();
    await disconnected;
    const replacement = await connect();
    first.clients[0] = replacement;
    const restored = nextVote(replacement, v => v.round === 2);
    const restoredOwn = new Promise<OwnVote>(resolve => replacement.once("vote:own", resolve));
    await replacement.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential);
    expect(await restored).toMatchObject({ decisionId: vote.decisionId, attemptId: vote.attemptId, deadline: vote.deadline });
    expect((await restoredOwn).optionId).toBe(own);
    if (option === "none") {
      const retry = nextVote(replacement, v => v.attemptNumber === 2);
      clock.advance(60_000);
      vote = await retry;
      expect(vote.deadline - vote.serverNow).toBe(30_000);
      const closed = nextVote(replacement, v => v.status === "closed");
      clock.advance(30_000);
      expect((await closed).result).toBe("NO_AGREEMENT");
    } else {
      await cast(first.clients[1]!, vote, option);
      expect(manager.publicVote(first.sessions[0]!.room.code)?.status).toBe("open");
      await cast(first.clients[2]!, vote, option);
    }
    const final = manager.roundTwoSession(replacement.id!)!;
    expect(final.phase).toBe("transport-pending");
    expect(final.characters.map(c => [c.health, c.energy])).toEqual(Array.from({ length: 4 }, () => [option === "none" ? 90 : 100, option === "rescue" ? 25 : 50]));
    expect(final.npc).toBe(option === "rescue" ? "rescued" : "abandoned");
    expect(await cast(first.clients[3]!, vote)).toEqual({ ok: false, error: "closed" });
    const snapshot = new Promise<import("@everest/shared").RoundTwoView>(resolve => replacement.once("round-two:updated", resolve));
    await replacement.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential);
    expect(await snapshot).toEqual(manager.sessionProjection(replacement.id!, final));
    expect(manager.roundSummary(first.sessions[0]!.room.code)).toEqual(summary);
    expect(manager.roundTwoSession(other.clients[0]!.id!)).toBeNull();
    expect(manager.privateRole(replacement.id!)).not.toBeNull();
  });
});

test.each(["rescue", "abandon"])("cuatro sockets reciben mayoría inmediata de %s, sin filtraciones ni interferencia entre salas", async (option) => {
  await fixture(async ({ room, clock, connect, manager }) => {
    const first = await room();
    const second = await room();
    expect(clock.tasks.size).toBe(6); // Two votes plus two timed NPC arguments per room.
    expect(await cast(second.clients[0]!, first.vote)).toEqual({ ok: false, error: "wrong-decision" });
    const outsider = await connect();
    expect(await cast(outsider, first.vote)).toEqual({ ok: false, error: "invalid-session" });
    const forged = { ...input(first.vote), participantId: first.sessions[1]!.credential.participantId };
    expect(await first.clients[0]!.timeout(2000).emitWithAck("vote:cast", forged)).toEqual({ ok: false, error: "invalid-input" });
    expect(await cast(first.clients[0]!, first.vote, "missing")).toEqual({ ok: false, error: "invalid-option" });
    expect((await cast(first.clients[0]!, first.vote, option)).ok).toBe(true);
    expect((await cast(first.clients[0]!, first.vote, option)).ok).toBe(true);
    expect((await cast(first.clients[1]!, first.vote, option)).ok).toBe(true);
    const summaries = first.clients.map((client) => new Promise<RoundOneSummary>((resolve) => client.once("round:completed", resolve)));
    const closed = first.clients.map((client) => nextVote(client, (vote) => vote.status === "closed"));
    expect((await cast(first.clients[2]!, first.vote, option)).ok).toBe(true);
    const results = await Promise.all(closed);
    const finalSummaries = await Promise.all(summaries);
    expect(new Set(finalSummaries.map((summary) => publicFacts(summary))).size).toBe(1);
    const summary = manager.roundSummary(first.sessions[0]!.room.code)!;
    finalSummaries.forEach((v, i) => expect(v).toEqual(manager.sessionProjection(first.clients[i]!.id!, summary)));
    expect(summary).toMatchObject({ round: 1, completed: true, npc: option === "rescue" ? "rescued" : "abandoned", microearthquake: false, inventory: { packs: 8, medicalUnits: 4 } });
    expect(summary.characters.map((character) => [character.participantId, character.health, character.energy]))
      .toEqual(first.sessions.map((session) => [session.credential.participantId, 100, option === "rescue" ? 50 : 75]));
    expect(JSON.stringify(summary)).not.toMatch(/knowledge|objective|role|characterId|token/);
    const resumedSummary = new Promise<RoundOneSummary>((resolve) => first.clients[0]!.once("round:completed", resolve));
    await first.clients[0]!.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential);
    expect(await resumedSummary).toEqual(manager.sessionProjection(first.clients[0]!.id!, summary));
    expect(new Set(results.map((vote) => publicFacts(vote))).size).toBe(1);
    expect(results[0]!.result).toBe(option === "rescue" ? "RESCUE_APPROVED" : "ABANDON_APPROVED");
    expect(await cast(first.clients[3]!, first.vote, option)).toEqual({ ok: false, error: "closed" });
    expect(manager.roundSummary(first.sessions[0]!.room.code)).toEqual(summary);
    expect(manager.roundSummary(second.sessions[0]!.room.code)).toBeNull();
    const secondClosed = nextVote(second.clients[0]!, (vote) => vote.status === "closed");
    const concurrent = await Promise.all(second.clients.map((client) => cast(client, second.vote, "abandon")));
    expect(concurrent.filter((reply) => reply.ok)).toHaveLength(3);
    await secondClosed;
    const otherSummary = manager.roundSummary(second.sessions[0]!.room.code)!;
    expect(otherSummary.gameId).not.toBe(summary.gameId);
    expect(otherSummary.characters.every((character) => character.energy === 75)).toBe(true);
    expect(manager.roundSummary(first.sessions[0]!.room.code)).toEqual(summary);
    const secondState = new Promise<OwnVote>((resolve) => second.clients[3]!.once("vote:own", resolve));
    // Una reautenticación de la misma conexión solo recupera la decisión existente.
    await second.clients[3]!.timeout(2000).emitWithAck("room:resume", second.sessions[3]!.credential);
    expect((await secondState).optionId).toBeNull();
    expect(clock.tasks.size).toBe(0);
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
    expect(clock.tasks.size).toBe(3); // Vote deadline plus NPC arguments at 20/40 seconds.
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
    const summary = manager.summarySession(replacement.id!)!;
    expect(summary).toMatchObject({ result: "NO_AGREEMENT", microearthquake: true, npc: "abandoned" });
    expect(summary.characters.map((character) => [character.health, character.energy]))
      .toEqual(Array.from({ length: 4 }, () => [90, 75]));
    expect(summary.inventory).toEqual({ packs: 8, medicalUnits: 4 });
    const disconnectedAgain = new Promise<void>((resolve) => clients[1]!.once("room:updated", () => resolve()));
    replacement.disconnect();
    await disconnectedAgain;
    const finalClient = await connect();
    const restored = new Promise<RoundOneSummary>((resolve) => finalClient.once("round:completed", resolve));
    await finalClient.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential);
    expect(await restored).toEqual(manager.sessionProjection(finalClient.id!, summary));
    const final = nextVote(finalClient, (state) => state.status === "closed");
    await finalClient.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential);
    expect((await final).result).toBe("NO_AGREEMENT");
  });
});

test("rechaza un voto fuera de plazo aunque el planificador aún no haya ejecutado el vencimiento", async () => {
  await fixture(async ({ room, clock }) => {
    const { clients, vote } = await room();
    clock.time = vote.deadline;
    expect(await cast(clients[0]!, vote)).toEqual({ ok: false, error: "expired" });
    expect(clock.tasks.size).toBe(2); // Retry deadline and the argument at 15 seconds.
  });
});

test.each(["ventilation", "shoring", "unstable-corridor", "NO_AGREEMENT", "ventilation-retry"])("5C.1: revelation, frozen options, recovery and result %s", async scenario => {
  const outcome = scenario === "ventilation-retry" ? "ventilation" : scenario;
  await fixture(async ({ room, manager, clock, connect }) => {
    const first = await room();
    const other = await room();
    const host = first.clients[0]!;
    const code = first.sessions[0]!.room.code;
    const view = () => manager.roundTwoView(code)!;
    expect(await host.timeout(2000).emitWithAck("route:open")).toEqual({ ok: false, error: "route-not-ready" });
    for (const client of first.clients.slice(0, 3)) await cast(client, first.vote);
    await host.timeout(2000).emitWithAck("round:advance");
    const rescueVote = first.vote;
    prepareEnergy(manager, code, 50);
    const before = view();
    expect(before.routeChoice).toMatchObject({ phase: "preparation", ventilationRevealed: false, vote: null, result: null });
    expect(before.routeChoice!.options.map(o => o.id)).toEqual(["unstable-corridor", "shoring"]);
    expect(JSON.stringify(before)).not.toContain('"ventilation"');
    expect(await cast(host, rescueVote, "ventilation")).toMatchObject({ ok: false });
    const preparationSnapshot = new Promise<import("@everest/shared").RoundTwoView>(resolve => host.once("round-two:updated", resolve));
    await host.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential);
    expect(await preparationSnapshot).toEqual(manager.sessionProjection(host.id!, before));
    for (const client of other.clients.slice(0, 3)) await cast(client, other.vote);
    await other.clients[0]!.timeout(2000).emitWithAck("round:advance");

    const otherBefore = manager.roundTwoView(other.sessions[0]!.room.code);
    const maintenance = first.clients.find(c => manager.privateRole(c.id!)?.role === "maintenance")!;
    expect(await host.timeout(2000).emitWithAck("route:reveal")).toEqual({ ok: false, error: "not-authorized" });
    const outsider = await connect();
    expect(await outsider.timeout(2000).emitWithAck("route:reveal")).toEqual({ ok: false, error: "invalid-session" });
    expect(await first.clients[1]!.timeout(2000).emitWithAck("route:open")).toEqual({ ok: false, error: "not-creator" });
    const otherUpdates: unknown[] = [];
    other.clients[0]!.on("round-two:updated", state => otherUpdates.push(state));
    if (outcome === "ventilation") {
      const updates = first.clients.map(client => new Promise<import("@everest/shared").RoundTwoView>(resolve => client.once("round-two:updated", resolve)));
      expect(await maintenance.timeout(2000).emitWithAck("route:reveal")).toEqual({ ok: true });
      const states = await Promise.all(updates);
      expect(new Set(states.map(state => publicFacts(state))).size).toBe(1);
      expect(states[0]!.routeChoice!.options.map(o => o.id)).toContain("ventilation");
      expect(await maintenance.timeout(2000).emitWithAck("route:reveal")).toEqual({ ok: true });
      expect(states[0]).toEqual(manager.sessionProjection(host.id!, view()));
    }
    expect(await host.timeout(2000).emitWithAck("route:open")).toEqual({ ok: true });
    let vote = manager.publicVote(code)!;
    expect(vote.deadline - vote.serverNow).toBe(60_000);
    expect(vote.requiredVotes).toBe(3);
    expect(await host.timeout(2000).emitWithAck("route:open")).toEqual({ ok: true });
    expect(manager.publicVote(code)).toEqual(vote);
    if (outcome !== "ventilation") {
      expect(await cast(host, vote, "ventilation")).toEqual({ ok: false, error: "invalid-option" });
      expect(await maintenance.timeout(2000).emitWithAck("route:reveal")).toEqual({ ok: false, error: "preparation-closed" });
    }
    expect(await cast(other.clients[0]!, vote, "shoring")).toEqual({ ok: false, error: "route-not-open" });
    const forgedRouteVote = { ...input(vote, "shoring"), participantId: first.sessions[1]!.credential.participantId };
    expect(await host.timeout(2000).emitWithAck("vote:cast", forgedRouteVote)).toEqual({ ok: false, error: "invalid-input" });
    if (scenario === "ventilation-retry") {
      const firstAttempt = vote;
      await cast(host, vote, "shoring");
      clock.advance(60_000);
      vote = manager.publicVote(code)!;
      expect(vote.attemptNumber).toBe(2);
      expect(vote.deadline - vote.serverNow).toBe(30_000);
      expect(await cast(host, firstAttempt, "ventilation")).toEqual({ ok: false, error: "wrong-attempt" });
      expect(manager.votingSession(host.id!)!.own.optionId).toBeNull();
    }
    if (outcome === "NO_AGREEMENT") {
      clock.advance(60_000);
      vote = manager.publicVote(code)!;
      expect(vote.attemptNumber).toBe(2);
      expect(vote.deadline - vote.serverNow).toBe(30_000);
      expect(await cast(host, before.routeChoice!.vote ?? rescueVote, "shoring")).toEqual({ ok: false, error: "wrong-decision" });
      clock.advance(30_000);
    } else {
      expect((await cast(host, vote, outcome)).ok).toBe(true);
      expect((await cast(host, vote, outcome)).ok).toBe(true);
      const active = view();
      const restoredOwn = new Promise<OwnVote>(resolve => host.once("vote:own", resolve));
      await host.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential);
      expect((await restoredOwn).optionId).toBe(outcome);
      expect(view()).toEqual(active);
      await cast(first.clients[1]!, vote, outcome);
      expect(manager.publicVote(code)!.status).toBe("open");
      await cast(first.clients[2]!, vote, outcome);
    }
    await finishNpc(manager, first.clients, code, "abandon");
    const final = view();
    expect(final.routeChoice).toMatchObject({ phase: "selected", result: { decisionId: vote.decisionId, outcome } });
    const cost = outcome === "ventilation" ? 30 : outcome === "shoring" ? 40 : 20;
    expect(final.phase).toBe("completed");
    expect(final.characters).toEqual(before.characters.map((c,i) => ({ ...c, energy: c.energy! - cost - (outcome === "shoring" && ["maintenance","architect-engineer"].includes(manager.privateRole(first.clients[i]!.id!)!.role) ? 5 : 0), health: c.health! - (outcome === "NO_AGREEMENT" ? 10 : 0) })));
    expect(final.movement).toMatchObject({ status: "completed", accident: false, energyCost: cost });
    expect(final.inventory).toEqual(before.inventory);
    expect(final.microearthquake).toBe(false);
    expect(await cast(first.clients[3]!, vote, "shoring")).toEqual({ ok: false, error: "wrong-decision" });
    const disconnected = new Promise<void>(resolve => first.clients[1]!.once("room:updated", () => resolve()));
    host.disconnect(); await disconnected;
    const replacement = await connect();
    const restored = new Promise<import("@everest/shared").RoundTwoView>(resolve => replacement.once("round-two:updated", resolve));
    expect((await replacement.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential)).ok).toBe(true);
    expect(await restored).toEqual(manager.sessionProjection(replacement.id!, final));
    expect(manager.privateRole(replacement.id!)).not.toBeNull();
    expect(await replacement.timeout(2000).emitWithAck("route:open")).toEqual({ ok: true });
    clock.advance(90_000);
    expect(view()).toEqual({ ...final, routeChoice: { ...final.routeChoice!, vote: { ...final.routeChoice!.vote!, serverNow: clock.now() } } });
    await other.clients[0]!.timeout(2000).emitWithAck("client:ping");
    expect(otherUpdates).toEqual([]);
    expect(manager.roundTwoView(other.sessions[0]!.room.code)).toEqual(otherBefore);
    const serialized = JSON.stringify(manager.sessionProjection(first.clients.find(c=>c.connected && manager.privateRole(c.id!)?.role!=="architect-engineer")!.id!, final));
    expect(serialized).not.toMatch(/probability|danger|LOW|BAJO|0\.1|10 %|knowledge|objective|token/);
    for (const option of final.routeChoice!.options) expect(Object.keys(option).sort()).toEqual(["availability", "blocked", "danger", "description", "energyCost", "id", "name"]);
    for (const client of first.clients.slice(1)) expect(JSON.stringify(manager.privateRole(client.id!))).not.toMatch(/LOW|BAJO|10 %|0\.1/);
  });
});


function nextRoundTwo(client: Client, predicate: (state: import("@everest/shared").RoundTwoView) => boolean) {
  return new Promise<import("@everest/shared").RoundTwoView>((resolve, reject) => {
    const timer = setTimeout(() => { client.off("round-two:updated", listener); reject(new Error("Missing round two summary")); }, 2000);
    function listener(state: import("@everest/shared").RoundTwoView) {
      if (predicate(state)) { clearTimeout(timer); client.off("round-two:updated", listener); resolve(state); }
    }
    client.on("round-two:updated", listener);
  });
}

const movementScenarios = [
  ...(["ventilation", "shoring", "unstable-corridor"] as const).flatMap(route => [false, true].map(accident => ({ route, accident, rescueAgreement: true }))),
  ...[false, true].flatMap(accident => [false, true].map(rescueAgreement => ({ route: "NO_AGREEMENT" as const, accident, rescueAgreement }))),
];
test.each(movementScenarios)("5C.2 synchronized movement $route / accident $accident / rescue agreement $rescueAgreement", async ({ route, accident, rescueAgreement }) => {
  await fixture(async ({ room, manager, clock, connect, routeRandom }) => {
    routeRandom.mockReturnValue(accident ? 0 : 0.99);
    const first = await room();
    const second = await room();
    async function prepare(target: typeof first, _agreed: boolean) {
      for (const client of target.clients.slice(0, 3)) await cast(client, target.vote);
      await target.clients[0]!.timeout(2000).emitWithAck("round:advance");
    }
    // Finish the other rescue before advancing clocks in the first room.
    await prepare(second, true);
    await prepare(first, rescueAgreement);
    const host = first.clients[0]!;
    const code = first.sessions[0]!.room.code;
    const secondBefore = manager.roundTwoView(second.sessions[0]!.room.code)!;
    prepareEnergy(manager, code, 75);
    const before = manager.roundTwoView(code)!;
    if (route === "ventilation") {
      const maintenance = first.clients.find(c => manager.privateRole(c.id!)?.role === "maintenance")!;
      expect((await maintenance.timeout(2000).emitWithAck("route:reveal")).ok).toBe(true);
    }
    expect((await host.timeout(2000).emitWithAck("route:open")).ok).toBe(true);
    const vote = manager.publicVote(code)!;
    const summaries = first.clients.map(client => nextRoundTwo(client, state => state.phase === "completed"));
    if (route === "NO_AGREEMENT") { clock.advance(60_000); clock.advance(30_000); }
    else for (const client of first.clients.slice(0, 3)) expect((await cast(client, vote, route)).ok).toBe(true);
    if (rescueAgreement) await finishNpc(manager, first.clients, code, "rescue", false);
    else { clock.advance(60_000); clock.advance(30_000); }
    prepareEnergy(manager, code, 50);
    const beforeMovement = manager.roundTwoView(code)!;
    await continueMovement(manager, host, code);
    const results = await Promise.all(summaries);
    expect(new Set(results.map(state => publicFacts(state))).size).toBe(1);
    const final = manager.roundTwoView(code)!;
    const actualRoute = route === "NO_AGREEMENT" ? "unstable-corridor" : route;
    const cost = actualRoute === "ventilation" ? 30 : actualRoute === "shoring" ? 40 : 20;
    const damage = actualRoute === "ventilation" ? 5 : actualRoute === "shoring" ? 10 : 20;
    expect(final.movement).toMatchObject({ status: "completed", routeId: actualRoute, forced: route === "NO_AGREEMENT", microearthquake: route === "NO_AGREEMENT", energyCost: cost, accident });
    if (final.movement?.status !== "completed") throw new Error("Missing movement");
    expect(final.movement.victims).toEqual(accident ? first.sessions.slice(0, 3).map(session => ({ participantId: session.credential.participantId, name: session.room.participants.find(p => p.id === session.credential.participantId)!.name, damage })) : []);
    expect(final.characters.map(c => [c.health, c.energy])).toEqual(beforeMovement.characters.map((c, i) => [c.health! - (route === "NO_AGREEMENT" ? 10 : 0) - (accident && i < 3 ? damage : 0), c.energy! - cost - (actualRoute === "shoring" && ["maintenance","architect-engineer"].includes(manager.privateRole(first.clients[i]!.id!)!.role) ? 5 : 0)]));
    expect(final.microearthquake).toBe(!rescueAgreement);
    expect(final.npc).toBe(rescueAgreement ? "rescued" : "abandoned");
    expect(final.previousNpc).toBe("rescued");
    expect(final.inventory).toEqual(before.inventory);
    expect(routeRandom).toHaveBeenCalledTimes(accident ? 4 : 1);
    // Closing events, duplicate votes, opening again and resume never rerun the movement.
    await cast(first.clients[3]!, manager.publicVote(code)!, actualRoute);
    await host.timeout(2000).emitWithAck("route:open");
    const disconnected = new Promise<void>(resolve => first.clients[1]!.once("room:updated", () => resolve()));
    host.disconnect(); await disconnected;
    const replacement = await connect();
    const restored = nextRoundTwo(replacement, state => state.phase === "completed");
    expect((await replacement.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential)).ok).toBe(true);
    expect(await restored).toEqual(manager.sessionProjection(replacement.id!, final));
    expect(manager.privateRole(replacement.id!)).not.toBeNull();
    clock.advance(90_000);
    expect(manager.roundTwoView(code)!.movement).toEqual(final.movement);
    expect(manager.roundTwoView(code)!.characters).toEqual(final.characters);
    expect(routeRandom).toHaveBeenCalledTimes(accident ? 4 : 1);
    expect(manager.roundTwoView(second.sessions[0]!.room.code)).toEqual(secondBefore);
    expect(JSON.stringify(manager.sessionProjection(first.clients.find(c=>c.connected && manager.privateRole(c.id!)?.role!=="architect-engineer")!.id!, final))).not.toMatch(/probability|danger|LOW|BAJO|random|0\.1|token|knowledge|objective|characterId/);
    expect(await replacement.timeout(2000).emitWithAck("round:advance")).toEqual({ ok: false, error: "round-not-ready" });
  });
});

test("5C.2 blocked movement persists without partial effects or another roll", async () => {
  await fixture(async ({ room, manager, routeRandom, clock }) => {
    routeRandom.mockReturnValue(NaN);
    const { clients, sessions, vote } = await room();
    const host = clients[0]!;
    const code = sessions[0]!.room.code;
    for (const client of clients.slice(0, 3)) await cast(client, vote);
    await host.timeout(2000).emitWithAck("round:advance");
    const before = manager.roundTwoView(code)!;
    await host.timeout(2000).emitWithAck("route:open");
    const blocked = clients.map(client => nextRoundTwo(client, state => state.phase === "movement-blocked"));
    clock.advance(60_000); clock.advance(30_000);
    await finishNpc(manager, clients, code, "abandon");
    const states = await Promise.all(blocked);
    expect(new Set(states.map(s => publicFacts(s))).size).toBe(1);
    const final = manager.roundTwoView(code)!;
    expect(final.movement).toMatchObject({ status: "blocked", reason: "invalid-random" });
    expect(final.characters).toEqual(before.characters);
    expect(final.inventory).toEqual(before.inventory);
    expect(routeRandom).toHaveBeenCalledTimes(1);
    const restored = nextRoundTwo(host, state => state.phase === "movement-blocked");
    await host.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential);
    expect(await restored).toEqual(manager.sessionProjection(host.id!, final));
    await host.timeout(2000).emitWithAck("route:open");
    await cast(clients[3]!, vote, "unstable-corridor");
    expect(routeRandom).toHaveBeenCalledTimes(1);
    expect(manager.roundTwoView(code)).toEqual(final);
  });
});


function nextSupplies(client: Client, predicate: (state: import("@everest/shared").SuppliesView) => boolean) {
  return new Promise<import("@everest/shared").SuppliesView>((resolve, reject) => {
    const timer = setTimeout(() => { client.off("supplies:updated", listener); reject(new Error("Missing supplies update")); }, 2000);
    function listener(state: import("@everest/shared").SuppliesView) {
      if (predicate(state)) { clearTimeout(timer); client.off("supplies:updated", listener); resolve(state); }
    }
    client.on("supplies:updated", listener);
  });
}

test.each([1, 2] as const)("6A: four sockets, current supplies, historical summary and F5 after round %i", async round => {
  await fixture(async ({ room, manager, connect }) => {
    const first = await room();
    const other = await room();
    const code = first.sessions[0]!.room.code;
    for (const client of first.clients.slice(0, 3)) await cast(client, first.vote);
    if (round === 2) {
      await first.clients[0]!.timeout(2000).emitWithAck("round:advance");
      await first.clients[0]!.timeout(2000).emitWithAck("route:open");
      const route = manager.publicVote(code)!;
      for (const client of first.clients.slice(0, 3)) await cast(client, route, "unstable-corridor");
      await finishNpc(manager, first.clients, code);
    }
    const bellhopIndex = first.clients.findIndex(client => manager.privateRole(client.id!)?.role === "bellhop");
    const bellhop = first.clients[bellhopIndex]!;
    const before = manager.suppliesView(code)!;
    const history = round === 1 ? manager.roundSummary(code) : manager.roundTwoView(code);
    const otherBefore = manager.suppliesView(other.sessions[0]!.room.code);
    const otherUpdates: unknown[] = [];
    other.clients[0]!.on("supplies:updated", state => otherUpdates.push(state));
    const request = { requestId: crypto.randomUUID(), windowId: before.windowId!, targetParticipantId: first.sessions[0]!.credential.participantId };
    for (const client of first.clients.filter(client => client !== bellhop)) expect(await client.timeout(2000).emitWithAck("pack:give", request)).toEqual({ ok: false, error: "not-authorized" });
    const updates = first.clients.map(client => nextSupplies(client, state => state.inventory.packs === 7));
    const replies = await Promise.all([bellhop.timeout(2000).emitWithAck("pack:give", request), bellhop.timeout(2000).emitWithAck("pack:give", request)]);
    expect(replies.every(reply => reply.ok)).toBe(true);
    const states = await Promise.all(updates);
    expect(new Set(states.map(state => publicFacts(state))).size).toBe(1);
    const final = manager.suppliesView(code)!;
    expect(final.characters).toEqual(before.characters.map((c, i) => i === 0 ? { ...c, energy: c.energy! + 25 } : c));
    expect(final.inventory).toEqual({ ...before.inventory, packs: 7 });
    expect(round === 1 ? manager.roundSummary(code) : manager.roundTwoView(code)).toEqual(history);
    const disconnected = new Promise<void>(resolve => first.clients[0]!.once("room:updated", () => resolve()));
    bellhop.disconnect(); await disconnected;
    const replacement = await connect();
    const restored = nextSupplies(replacement, state => state.round === round);
    expect((await replacement.timeout(2000).emitWithAck("room:resume", first.sessions[bellhopIndex]!.credential)).ok).toBe(true);
    expect(await restored).toEqual(manager.sessionProjection(replacement.id!, final));
    expect(await replacement.timeout(2000).emitWithAck("pack:give", request)).toEqual({ ok: true, requestId: request.requestId });
    expect(manager.suppliesView(code)).toEqual(final);
    expect(manager.privateRole(replacement.id!)?.role).toBe("bellhop");
    expect(manager.suppliesView(other.sessions[0]!.room.code)).toEqual(otherBefore);
    await other.clients[0]!.timeout(2000).emitWithAck("client:ping");
    expect(otherUpdates).toEqual([]);
    expect(JSON.stringify(final)).not.toMatch(/role|knowledge|objective|characterId|token|probability|danger|random/);
  });
});

test("6A: concurrent requests cannot spend the same last pack", async () => {
  await fixture(async ({ room, manager }) => {
    const { clients, sessions, vote } = await room();
    const code = sessions[0]!.room.code;
    for (const client of clients.slice(0, 3)) await cast(client, vote);
    const bellhop = clients.find(client => manager.privateRole(client.id!)?.role === "bellhop")!;
    const windowId = manager.suppliesView(code)!.windowId!;
    const input = (index: number) => ({ requestId: crypto.randomUUID(), windowId, targetParticipantId: sessions[index]!.credential.participantId });
    for (const index of [0, 0, 1, 1, 2, 2, 3]) expect((await bellhop.timeout(2000).emitWithAck("pack:give", input(index))).ok).toBe(true);
    expect(manager.suppliesView(code)!.inventory.packs).toBe(1);
    const updates = clients.map(client => nextSupplies(client, state => state.inventory.packs === 0));
    const replies = await Promise.all([bellhop.timeout(2000).emitWithAck("pack:give", input(3)), bellhop.timeout(2000).emitWithAck("pack:give", input(3))]);
    expect(replies.filter(reply => reply.ok)).toHaveLength(1);
    expect(replies.find(reply => !reply.ok)).toEqual({ ok: false, error: "no-packs" });
    const states = await Promise.all(updates);
    expect(new Set(states.map(state => publicFacts(state))).size).toBe(1);
    expect(states[0]!.inventory.packs).toBe(0);
    expect(manager.suppliesView(code)!.characters.every(c => c.energy === 100)).toBe(true);
    states.forEach((v, i) => expect(v).toEqual(manager.sessionProjection(clients[i]!.id!, manager.suppliesView(code))));
  });
});


function nextMedical(client: Client, predicate: (state: import("@everest/shared").MedicalView) => boolean) {
  return new Promise<import("@everest/shared").MedicalView>((resolve, reject) => {
    const timer = setTimeout(() => { client.off("medical:updated", listener); reject(new Error("Missing medical update")); }, 2000);
    function listener(state: import("@everest/shared").MedicalView) {
      if (predicate(state)) { clearTimeout(timer); client.off("medical:updated", listener); resolve(state); }
    }
    client.on("medical:updated", listener);
  });
}

test.each(["before", "after"])("6B: direct medical treatment %s displacement, four sockets and F5", async timing => {
  await fixture(async ({ room, manager, connect, clock, routeRandom }) => {
    routeRandom.mockReturnValue(0);
    const first = await room();
    const other = await room();
    const code = first.sessions[0]!.room.code;
    // Real injuries from the already approved first-round consequences.
    clock.advance(60_000); clock.advance(30_000);
    const firstHistory = manager.roundSummary(code)!;
    await first.clients[0]!.timeout(2000).emitWithAck("round:advance");
    async function finishMovement() {
      await first.clients[0]!.timeout(2000).emitWithAck("route:open");
      const vote = manager.publicVote(code)!;
      for (const client of first.clients.slice(0, 3)) await cast(client, vote, "unstable-corridor");
      await finishNpc(manager, first.clients, code);
    }
    if (timing === "after") await finishMovement();
    const medicIndex = first.clients.findIndex(client => manager.privateRole(client.id!)?.role === "medic");
    const medic = first.clients[medicIndex]!;
    const before = manager.medicalView(code)!;
    const voteBefore = manager.publicVote(code)!;
    const historyBefore = manager.roundTwoView(code)!;
    const timers = clock.tasks.size;
    const rolls = routeRandom.mock.calls.length;
    const request = { requestId: crypto.randomUUID(), gameId: before.gameId, round: before.round, targetParticipantId: first.sessions[medicIndex]!.credential.participantId };
    for (const client of first.clients.filter(c => c !== medic)) expect(await client.timeout(2000).emitWithAck("medical:treat", request)).toEqual({ ok: false, error: "not-authorized" });
    const otherBefore = manager.medicalView(other.sessions[0]!.room.code)!;
    const otherUpdates: unknown[] = [];
    other.clients[0]!.on("medical:updated", state => otherUpdates.push(state));
    const updates = first.clients.map(client => nextMedical(client, state => state.inventory.medicalUnits === 3));
    const supplies = first.clients.map(client => nextSupplies(client, state => state.inventory.medicalUnits === 3));
    const replies = await Promise.all([medic.timeout(2000).emitWithAck("medical:treat", request), medic.timeout(2000).emitWithAck("medical:treat", request)]);
    expect(replies.every(reply => reply.ok)).toBe(true);
    const states = await Promise.all(updates);
    expect(new Set(states.map(state => publicFacts(state))).size).toBe(1);
    const final = manager.medicalView(code)!;
    expect(final.characters).toEqual(before.characters.map((c, i) => i === medicIndex ? { ...c, health: Math.min(100, c.health! + 20) } : c));
    expect(final.inventory).toEqual({ ...before.inventory, medicalUnits: 3 });
    expect(final.treatments).toEqual([{ round: 2, participantId: request.targetParticipantId, healthRestored: final.characters[medicIndex]!.health! - before.characters[medicIndex]!.health! }]);
    (await Promise.all(supplies)).forEach((state, i) => expect(state.characters).toEqual(manager.sessionProjection(first.clients[i]!.id!, final).characters));
    expect(clock.tasks.size).toBe(timers);
    expect(routeRandom).toHaveBeenCalledTimes(rolls);
    expect(manager.publicVote(code)).toEqual(voteBefore);
    expect(manager.roundSummary(code)).toEqual(firstHistory);
    if (timing === "after") expect(manager.roundTwoView(code)).toEqual(historyBefore);
    expect(await medic.timeout(2000).emitWithAck("medical:treat", { ...request, requestId: crypto.randomUUID() })).toEqual({ ok: false, error: "treatment-used" });
    const disconnected = new Promise<void>(resolve => first.clients[(medicIndex + 1) % 4]!.once("room:updated", () => resolve()));
    medic.disconnect(); await disconnected;
    const replacement = await connect(); first.clients[medicIndex] = replacement;
    const restored = nextMedical(replacement, state => state.inventory.medicalUnits === 3);
    expect((await replacement.timeout(2000).emitWithAck("room:resume", first.sessions[medicIndex]!.credential)).ok).toBe(true);
    expect(await restored).toEqual(manager.sessionProjection(replacement.id!, final));
    expect(manager.privateRole(replacement.id!)?.role).toBe("medic");
    expect(await replacement.timeout(2000).emitWithAck("medical:treat", request)).toEqual({ ok: true, requestId: request.requestId });
    expect(manager.medicalView(code)).toEqual(final);
    if (timing === "before") {
      await finishMovement();
      expect(await replacement.timeout(2000).emitWithAck("medical:treat", { ...request, requestId: crypto.randomUUID() })).toEqual({ ok: false, error: "treatment-used" });
      expect(manager.medicalView(code)!.characters[medicIndex]!.health).toBe(80); // 90 + 10 de cura - 20 de accidente.
    }
    await other.clients[0]!.timeout(2000).emitWithAck("client:ping");
    expect(otherUpdates).toEqual([]);
    expect(manager.medicalView(other.sessions[0]!.room.code)).toEqual(otherBefore);
    expect(JSON.stringify(final)).not.toMatch(/role|knowledge|objective|characterId|token|probability|danger|random/);
  });
});

test("6B: last medical unit is atomic across simultaneous treatments of different humans", async () => {
  await fixture(async ({ room, manager, clock }) => {
    const { clients, sessions } = await room();
    const code = sessions[0]!.room.code;
    clock.advance(60_000); clock.advance(30_000);
    const medic = clients.find(client => manager.privateRole(client.id!)?.role === "medic")!;
    const input = (index: number) => {
      const current = manager.medicalView(code)!;
      return { requestId: crypto.randomUUID(), gameId: current.gameId, round: current.round, targetParticipantId: sessions[index]!.credential.participantId };
    };
    for (const i of [0, 1, 2]) expect((await medic.timeout(2000).emitWithAck("medical:treat", input(i))).ok).toBe(true);
    expect(manager.medicalView(code)!.inventory.medicalUnits).toBe(1);
    await clients[0]!.timeout(2000).emitWithAck("round:advance");
    await clients[0]!.timeout(2000).emitWithAck("route:open");
    const route = manager.publicVote(code)!; for (const c of clients.slice(0, 3)) await cast(c, route, "unstable-corridor");
    clock.advance(60_000); clock.advance(30_000); // Lesiones nuevas, ronda distinta y un ?nico recurso compartido.
    const before = manager.medicalView(code)!;
    const updates = clients.map(client => nextMedical(client, state => state.inventory.medicalUnits === 0));
    const replies = await Promise.all([medic.timeout(2000).emitWithAck("medical:treat", input(0)), medic.timeout(2000).emitWithAck("medical:treat", input(1))]);
    expect(replies.filter(reply => reply.ok)).toHaveLength(1);
    expect(replies.find(reply => !reply.ok)).toEqual({ ok: false, error: "no-medical-units" });
    const results = await Promise.all(updates);
    expect(new Set(results.map(state => publicFacts(state))).size).toBe(1);
    const final = manager.medicalView(code)!;
    expect(final.inventory).toEqual({ ...before.inventory, medicalUnits: 0 });
    expect(final.treatments.filter(t => t.round === 2)).toHaveLength(1);
    expect(final.characters[0]!.health).toBe(100);
    expect(final.characters[1]!.health).toBe(before.characters[1]!.health);
    expect(manager.publicVote(code)!.status).toBe("closed");
    expect(manager.roundTwoView(code)!.phase).toBe("transport-pending"); // Tratar no abre ni resuelve la ruta.
  });
});


function nextRoundThree(client: Client, predicate: (state: import("@everest/shared").RoundThreeView) => boolean) {
  return new Promise<import("@everest/shared").RoundThreeView>((resolve, reject) => {
    const timer = setTimeout(() => { client.off("round-three:updated", listener); reject(new Error("Missing round three update")); }, 2000);
    function listener(state: import("@everest/shared").RoundThreeView) {
      if (predicate(state)) { clearTimeout(timer); client.off("round-three:updated", listener); resolve(state); }
    }
    client.on("round-three:updated", listener);
  });
}

const roundThreeScenarios = [
  ...(["fire-door", "pipe-gallery", "metal-debris", "NO_AGREEMENT"] as const).flatMap(route => [false, true].map(accident => ({ route, accident, reward: 0.99, retry: false }))),
  { route: "metal-debris" as const, accident: false, reward: 0.1, retry: false },
  { route: "fire-door" as const, accident: false, reward: 0.99, retry: true },
];
test.each(roundThreeScenarios)("7B: four sockets round 3 $route accident $accident reward $reward", async ({ route, accident, reward, retry }) => {
  await fixture(async ({ room, manager, connect, clock, routeRandom }) => {
    const first = await room(); const other = await room();
    const code = first.sessions[0]!.room.code;
    const host = () => first.clients[0]!;
    expect(await host().timeout(2000).emitWithAck("round-three:advance")).toEqual({ ok: false, error: "round-not-ready" });
    expect(await host().timeout(2000).emitWithAck("round-three:open")).toEqual({ ok: false, error: "round-not-ready" });
    async function finishTwo(target: typeof first) {
      for (const client of target.clients.slice(0, 3)) await cast(client, target.vote);
      await target.clients[0]!.timeout(2000).emitWithAck("round:advance");
      expect(await target.clients[0]!.timeout(2000).emitWithAck("round-three:advance")).toEqual({ ok: false, error: "round-not-ready" });
      await target.clients[0]!.timeout(2000).emitWithAck("route:open");
      const routeVote = manager.publicVote(target.sessions[0]!.room.code)!;
      for (const client of target.clients.slice(0, 3)) await cast(client, routeVote, "unstable-corridor");
      await finishNpc(manager, target.clients, target.sessions[0]!.room.code);
    }
    await finishTwo(first); await finishTwo(other);
    const bellhop = first.clients.find(c => manager.privateRole(c.id!)?.role === "bellhop")!;
    const suppliesTwo = manager.suppliesView(code)!;
    for (const session of first.sessions) for (let count = 0; count < 2; count++) expect((await bellhop.timeout(2000).emitWithAck("pack:give", { requestId: crypto.randomUUID(), windowId: suppliesTwo.windowId!, targetParticipantId: session.credential.participantId })).ok).toBe(true);
    const before = manager.suppliesView(code)!;
    expect(before.characters.every(c => c.energy === 55)).toBe(true);
    const sheets = first.clients.map(client => manager.privateRole(client.id!));
    const historyTwo = manager.roundTwoView(code)!;
    const otherBefore = manager.suppliesView(other.sessions[0]!.room.code);
    const unrelated: unknown[] = [];
    other.clients[0]!.on("round-three:updated", state => unrelated.push(state));
    expect(await first.clients[1]!.timeout(2000).emitWithAck("round-three:advance")).toEqual({ ok: false, error: "not-creator" });
    const preparing = first.clients.map(client => nextRoundThree(client, state => state.phase === "preparation"));
    expect(await host().timeout(2000).emitWithAck("round-three:advance")).toEqual({ ok: true });
    const preparations = await Promise.all(preparing);
    expect(new Set(preparations.map(state => publicFacts(state))).size).toBe(1);
    const prep = manager.roundThreeView(code)!;
    expect(prep.options.map(o => o.id)).toEqual(["fire-door", "pipe-gallery", "metal-debris"]);
    expect(prep.vote).toBeNull(); expect(prep.movement).toBeNull(); expect(prep.afterRoute).toBeNull();
    expect(clock.tasks.size).toBe(0);
    expect(manager.suppliesView(code)).toEqual({ ...before, round: 3, windowId: expect.any(String) });
    expect(manager.publicVote(code)).toBeNull();
    expect(await cast(host(), first.vote, "fire-door")).toEqual({ ok: false, error: "route-not-open" });
    expect(await host().timeout(2000).emitWithAck("round-three:advance")).toEqual({ ok: true });
    expect(manager.roundThreeView(code)).toEqual(prep);
    expect(await first.clients[1]!.timeout(2000).emitWithAck("round-three:open")).toEqual({ ok: false, error: "not-creator" });
    for (const option of prep.options) expect(Object.keys(option).sort()).toEqual(["availability", "danger", "description", "energyCost", "id", "name"]);
    const publicText = JSON.stringify(manager.sessionProjection(first.clients.find(c=>c.connected && manager.privateRole(c.id!)?.role!=="architect-engineer")!.id!, prep));
    expect(publicText).not.toMatch(/probability|danger|random|medical-conference-room|supply-warehouse|gained|LOW|MODERATE|EXTREME/);
    for (const sheet of sheets) {
      expect(publicText).not.toContain(sheet!.sheet.objective);
      for (const knowledge of sheet!.sheet.knowledge) expect(publicText).not.toContain(knowledge.text);
    }
    async function reload(phase: "preparation" | "voting" | "completed") {
      const disconnected = new Promise<void>(resolve => first.clients[1]!.once("room:updated", () => resolve()));
      host().disconnect(); await disconnected;
      const replacement = await connect(); first.clients[0] = replacement;
      const restored = nextRoundThree(replacement, state => state.phase === phase);
      expect((await replacement.timeout(2000).emitWithAck("room:resume", first.sessions[0]!.credential)).ok).toBe(true);
      expect(manager.privateRole(replacement.id!)).toEqual(sheets[0]);
      return restored;
    }
    expect(await reload("preparation")).toEqual(manager.sessionProjection(host().id!, prep));
    expect((await host().timeout(2000).emitWithAck("round-three:open")).ok).toBe(true);
    let vote = manager.publicVote(code)!;
    expect(vote).toMatchObject({ round: 3, attemptNumber: 1, requiredVotes: 3, status: "open" });
    expect(vote.deadline - vote.serverNow).toBe(60_000);
    expect(await host().timeout(2000).emitWithAck("round-three:open")).toEqual({ ok: true });
    expect(manager.publicVote(code)).toEqual(vote);
    expect(await cast(other.clients[0]!, vote, "fire-door")).toEqual({ ok: false, error: "wrong-decision" });
    const outsider = await connect();
    expect(await cast(outsider, vote, "fire-door")).toEqual({ ok: false, error: "invalid-session" });
    const forged = { ...input(vote, "fire-door"), participantId: first.sessions[1]!.credential.participantId };
    expect(await host().timeout(2000).emitWithAck("vote:cast", forged)).toEqual({ ok: false, error: "invalid-input" });
    expect(await cast(host(), vote, "invented")).toEqual({ ok: false, error: "invalid-option" });
    const votedRoute = route === "NO_AGREEMENT" ? "fire-door" : route;
    expect((await cast(host(), vote, votedRoute)).ok).toBe(true);
    expect((await cast(host(), vote, votedRoute)).ok).toBe(true);
    const active = manager.roundThreeView(code)!;
    expect(await reload("voting")).toEqual(manager.sessionProjection(host().id!, active));
    expect(manager.votingSession(host().id!)!.own.optionId).toBe(votedRoute);
    const pending = first.clients.map(client => nextRoundThree(client, state => state.phase === "completed"));
    routeRandom.mockClear();
    routeRandom.mockReturnValue(accident ? 0 : 0.99);
    if (route === "metal-debris") {
      routeRandom.mockReturnValueOnce(accident ? 0 : 0.99);
      if (accident) routeRandom.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0);
      routeRandom.mockReturnValueOnce(reward);
    }
    if (retry) {
      const oldAttempt = vote;
      const next = nextVote(host(), state => state.round === 3 && state.attemptNumber === 2);
      clock.advance(60_000); vote = await next;
      expect(vote.deadline - vote.serverNow).toBe(30_000);
      expect(await cast(host(), oldAttempt, votedRoute)).toEqual({ ok: false, error: "wrong-attempt" });
      expect(manager.votingSession(host().id!)!.own.optionId).toBeNull();
      expect((await cast(host(), vote, votedRoute)).ok).toBe(true);
    }
    if (route === "NO_AGREEMENT") {
      const retry = nextVote(host(), state => state.round === 3 && state.attemptNumber === 2);
      clock.advance(60_000); vote = await retry;
      expect(vote.deadline - vote.serverNow).toBe(30_000);
      expect(manager.votingSession(host().id!)!.own.optionId).toBeNull();
      clock.advance(30_000);
    } else {
      await cast(first.clients[1]!, vote, route);
      expect(manager.publicVote(code)!.status).toBe("open");
      await cast(first.clients[2]!, vote, route);
    }
    const results = await Promise.all(pending);
    expect(new Set(results.map(state => publicFacts(state))).size).toBe(1);
    const final = manager.roundThreeView(code)!;
    const actual = route === "NO_AGREEMENT" ? "pipe-gallery" : route;
    const cost = actual === "fire-door" ? 30 : actual === "pipe-gallery" ? 20 : 40;
    const damage = actual === "pipe-gallery" ? 30 : 10;
    expect(final.selection!.outcome).toBe(route);
    expect(final.forced).toBe(route === "NO_AGREEMENT"); expect(final.earthquake).toBe(final.forced);
    expect(final.blockedRoutes).toEqual(final.forced ? ["fire-door", "metal-debris"] : []);
    expect(final.movement).toMatchObject({ routeId: actual, accident, energyCost: cost, crowbarLost: actual === "fire-door" });
    expect(final.afterRoute!.characters.map(c => [c.health, c.energy])).toEqual(before.characters.map((c, i) => [c.health! - (actual === "pipe-gallery" ? 20 : 0) - (accident && i < 3 ? damage : 0), c.energy! - cost]));
    expect(final.movement!.gained).toEqual({ packs: actual === "metal-debris" ? reward < 0.7 ? 4 : 8 : 0, medicalUnits: actual === "fire-door" ? 2 : 0 });
    expect(final.afterRoute!.crowbar).toBe(actual === "fire-door" ? "lost" : "available");
    const calls = (accident ? 4 : 1) + (actual === "metal-debris" ? 1 : 0);
    expect(routeRandom).toHaveBeenCalledTimes(calls);
    expect(await cast(first.clients[3]!, vote, actual)).toEqual({ ok: false, error: "closed" });
    expect(await reload("completed")).toEqual(manager.sessionProjection(host().id!, final));
    await host().timeout(2000).emitWithAck("round-three:open");
    await host().timeout(2000).emitWithAck("round-three:advance");
    clock.advance(90_000);
    expect(manager.roundThreeView(code)!.movement).toEqual(final.movement);
    expect(manager.suppliesView(code)!.inventory).toEqual(final.afterRoute!.inventory);
    expect(routeRandom).toHaveBeenCalledTimes(calls);
    expect(manager.roundTwoView(code)).toEqual(historyTwo);
    expect(manager.suppliesView(other.sessions[0]!.room.code)).toEqual(otherBefore);
    expect(unrelated).toEqual([]);
    expect(JSON.stringify(manager.sessionProjection(first.clients.find(c=>c.connected && manager.privateRole(c.id!)?.role!=="architect-engineer")!.id!, final))).not.toMatch(/probability|danger|random|characterId|token|knowledge|objective/);
    expect(await host().timeout(2000).emitWithAck("round:advance")).toEqual({ ok: false, error: "round-not-ready" });
  });
});


test("7B: packs and medical treatments round 3 preserve history, round limits and reconnection", async () => {
  await fixture(async ({ room, manager, routeRandom, connect }) => {
    const { clients, sessions, vote } = await room();
    const code = sessions[0]!.room.code;
    const host = clients[0]!;
    for (const client of clients.slice(0, 3)) await cast(client, vote);
    await host.timeout(2000).emitWithAck("round:advance");
    routeRandom.mockReturnValue(0);
    await host.timeout(2000).emitWithAck("route:open");
    const routeTwo = manager.publicVote(code)!;
    for (const client of clients.slice(0, 3)) await cast(client, routeTwo, "unstable-corridor");
      await finishNpc(manager, clients, code);
    const bellhop = clients.find(c => manager.privateRole(c.id!)?.role === "bellhop")!;
    const medic = clients.find(c => manager.privateRole(c.id!)?.role === "medic")!;
    const before = manager.suppliesView(code)!;
    for (const session of sessions) expect((await bellhop.timeout(2000).emitWithAck("pack:give", { requestId: crypto.randomUUID(), windowId: before.windowId!, targetParticipantId: session.credential.participantId })).ok).toBe(true);
    const medicalTwo = { requestId: crypto.randomUUID(), gameId: before.gameId, round: 2 as const, targetParticipantId: sessions[0]!.credential.participantId };
    expect((await medic.timeout(2000).emitWithAck("medical:treat", medicalTwo)).ok).toBe(true);
    const currentTwo = manager.suppliesView(code)!;
    await host.timeout(2000).emitWithAck("round-three:advance");
    expect(manager.suppliesView(code)).toEqual({ ...currentTwo, round: 3, windowId: expect.any(String) });
    expect(await bellhop.timeout(2000).emitWithAck("pack:give", { requestId: crypto.randomUUID(), windowId: before.windowId!, targetParticipantId: sessions[0]!.credential.participantId })).toEqual({ ok: false, error: "supplies-not-open" });
    expect(await medic.timeout(2000).emitWithAck("medical:treat", { ...medicalTwo, requestId: crypto.randomUUID() })).toEqual({ ok: false, error: "wrong-round" });
    const preTreatment = { requestId: crypto.randomUUID(), gameId: before.gameId, round: 3 as const, targetParticipantId: sessions[1]!.credential.participantId };
    expect((await medic.timeout(2000).emitWithAck("medical:treat", preTreatment)).ok).toBe(true);
    await host.timeout(2000).emitWithAck("round-three:open");
    const thirdVote = manager.publicVote(code)!;
    for (const client of clients.slice(0, 3)) await cast(client, thirdVote, "pipe-gallery");
    const history = manager.roundThreeView(code)!;
    expect(history.afterRoute!.characters.slice(0, 2).map(c => [c.health, c.energy])).toEqual([[50, 10], [50, 10]]);
    const actual = manager.suppliesView(code)!;
    const calls = routeRandom.mock.calls.length;
    const postTreatment = { ...medicalTwo, requestId: crypto.randomUUID(), round: 3 as const };
    const medicalUpdates = clients.map(c => nextMedical(c, state => state.inventory.medicalUnits === 1));
    expect((await medic.timeout(2000).emitWithAck("medical:treat", postTreatment)).ok).toBe(true);
    (await Promise.all(medicalUpdates)).forEach((state, i) => expect(state.characters[0]!.health).toBe(i === 0 || manager.privateRole(clients[i]!.id!)?.role === "medic" ? 70 : undefined));
    expect(await medic.timeout(2000).emitWithAck("medical:treat", { ...preTreatment, requestId: crypto.randomUUID() })).toEqual({ ok: false, error: "treatment-used" });
    const pack = { requestId: crypto.randomUUID(), windowId: actual.windowId!, targetParticipantId: sessions[0]!.credential.participantId };
    const packUpdates = clients.map(c => nextSupplies(c, state => state.inventory.packs === 3));
    expect((await bellhop.timeout(2000).emitWithAck("pack:give", pack)).ok).toBe(true);
    const currentStates = await Promise.all(packUpdates);
    expect(new Set(currentStates.map(s => publicFacts(s))).size).toBe(1);
    expect(currentStates[0]!.characters[0]).toMatchObject({ health: 70, energy: 35 });
    expect(currentStates[0]!.inventory).toEqual({ packs: 3, medicalUnits: 1 });
    expect(manager.medicalView(code)!.treatments.map(t => [t.round, t.participantId])).toEqual([[2, sessions[0]!.credential.participantId], [3, sessions[1]!.credential.participantId], [3, sessions[0]!.credential.participantId]]);
    const disconnected = new Promise<void>(resolve => clients[1]!.once("room:updated", () => resolve()));
    medic.disconnect(); await disconnected;
    const replacement = await connect();
    const restored = nextMedical(replacement, state => state.round === 3);
    await replacement.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential);
    expect((await restored).inventory).toEqual({ packs: 3, medicalUnits: 1 });
    expect((await replacement.timeout(2000).emitWithAck("medical:treat", postTreatment)).ok).toBe(true);
    expect((await bellhop.timeout(2000).emitWithAck("pack:give", pack)).ok).toBe(true);
    expect(currentStates[0]).toEqual(manager.sessionProjection(replacement.id!, manager.suppliesView(code)));
    expect(manager.roundThreeView(code)).toEqual(history);
    expect(routeRandom).toHaveBeenCalledTimes(calls);
  });
});


test("7B: an exhausted round 3 pauses before movement and reaches four sockets and survives reconnection without another roll", async () => {
  await fixture(async ({ room, manager, routeRandom, connect }) => {
    const { clients, sessions, vote } = await room();
    const host = clients[0]!; const code = sessions[0]!.room.code;
    for (const client of clients.slice(0, 3)) await cast(client, vote);
    await host.timeout(2000).emitWithAck("round:advance");
    await host.timeout(2000).emitWithAck("route:open");
    const secondRoute = manager.publicVote(code)!;
    for (const client of clients.slice(0, 3)) await cast(client, secondRoute, "unstable-corridor");
      await finishNpc(manager, clients, code);
    await host.timeout(2000).emitWithAck("round-three:advance");
    const before = manager.suppliesView(code)!;
    expect(before.characters.every(c => c.energy === 5)).toBe(true);
    routeRandom.mockClear();
    expect(await host.timeout(2000).emitWithAck("round-three:open")).toEqual({ ok: false, error: "no-available-routes" });
    const updates = clients.map(c => nextRoundThree(c, state => state.phase === "preparation"));
    for (let i = 0; i < 4; i++) await clients[i]!.timeout(2000).emitWithAck("room:resume", sessions[i]!.credential);
    const states = await Promise.all(updates);
    expect(new Set(states.map(s => publicFacts(s))).size).toBe(1);
    const final = manager.roundThreeView(code)!;
    expect(final).toMatchObject({ phase: "preparation", blocked: null, movement: null, afterRoute: null });
    expect(final.options.every(o => o.availability.status === "unavailable")).toBe(true);
    expect(manager.suppliesView(code)).toEqual(before);
    const disconnected = new Promise<void>(resolve => clients[1]!.once("room:updated", () => resolve()));
    host.disconnect(); await disconnected;
    const replacement = await connect();
    const restored = nextRoundThree(replacement, state => state.phase === "preparation");
    await replacement.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential);
    expect(await restored).toEqual(manager.sessionProjection(replacement.id!, final));
    await replacement.timeout(2000).emitWithAck("round-three:open");
    await replacement.timeout(2000).emitWithAck("round-three:advance");
    expect(routeRandom).not.toHaveBeenCalled();
    expect(manager.suppliesView(code)).toEqual({ ...before, windowId: expect.any(String) });
  });
});


test.each([2, 3] as const)("8A: packs in round %i preparation, F5 and rejection inside movement", async round => {
  await fixture(async ({ room, manager, connect, routeRandom }) => {
    const first = await room(); const other = await room();
    async function prepare(target: typeof first) {
      for (const client of target.clients.slice(0, 3)) await cast(client, target.vote);
      await target.clients[0]!.timeout(2000).emitWithAck("round:advance");
      if (round === 3) {
        await target.clients[0]!.timeout(2000).emitWithAck("route:open");
        const vote = manager.publicVote(target.sessions[0]!.room.code)!;
        for (const client of target.clients.slice(0, 3)) await cast(client, vote, "unstable-corridor");
      await finishNpc(manager, target.clients, target.sessions[0]!.room.code);
        await target.clients[0]!.timeout(2000).emitWithAck("round-three:advance");
      }
    }
    await prepare(first); await prepare(other);
    const code = first.sessions[0]!.room.code;
    prepareEnergy(manager, code, round === 3 ? 50 : 25);
    const before = manager.suppliesView(code)!;
    expect(before.windowId).not.toBeNull();
    const otherBefore = manager.suppliesView(other.sessions[0]!.room.code);
    const bellhopIndex = first.clients.findIndex(c => manager.privateRole(c.id!)?.role === "bellhop");
    let bellhop = first.clients[bellhopIndex]!;
    const input = { requestId: crypto.randomUUID(), windowId: before.windowId!, targetParticipantId: first.sessions[0]!.credential.participantId };
    const updates = first.clients.map(client => nextSupplies(client, state => state.inventory.packs === 7));
    expect((await bellhop.timeout(2000).emitWithAck("pack:give", input)).ok).toBe(true);
    const all = await Promise.all(updates);
    expect(new Set(all.map(state => publicFacts(state))).size).toBe(1);
    expect(all[0]!.characters[0]!.energy).toBe(before.characters[0]!.energy! + 25);
    const disconnected = new Promise<void>(resolve => first.clients[0]!.once("room:updated", () => resolve()));
    bellhop.disconnect(); await disconnected;
    bellhop = await connect(); first.clients[bellhopIndex] = bellhop;
    const restored = nextSupplies(bellhop, state => state.round === round);
    await bellhop.timeout(2000).emitWithAck("room:resume", first.sessions[bellhopIndex]!.credential);
    expect(await restored).toEqual(manager.sessionProjection(bellhop.id!, manager.suppliesView(code)!));
    expect((await bellhop.timeout(2000).emitWithAck("pack:give", input)).ok).toBe(true);
    const rejectedDuringResolution: unknown[] = [];
    routeRandom.mockImplementation(() => {
      rejectedDuringResolution.push(manager.givePack(bellhop.id!, { ...input, requestId: crypto.randomUUID() }));
      return 0.99;
    });
    const open = round === 2 ? "route:open" as const : "round-three:open" as const;
    await first.clients[0]!.timeout(2000).emitWithAck(open);
    expect(manager.suppliesView(code)!.windowId).toBeNull();
    expect(await bellhop.timeout(2000).emitWithAck("pack:give", { ...input, requestId: crypto.randomUUID() })).toEqual({ ok: false, error: "supplies-not-open" });
    const vote = manager.publicVote(code)!;
    for (const client of first.clients.slice(0, 3)) await cast(client, vote, round === 2 ? "unstable-corridor" : "fire-door");
    if (round === 2) await finishNpc(manager, first.clients, code, "abandon");
    expect(rejectedDuringResolution).toEqual([{ ok: false, error: "supplies-not-open" }]);
    expect(manager.suppliesView(code)!.inventory.packs).toBe(7);
    expect(manager.suppliesView(code)!.windowId).not.toBe(input.windowId);
    expect(await bellhop.timeout(2000).emitWithAck("pack:give", { ...input, requestId: crypto.randomUUID() })).toEqual({ ok: false, error: "supplies-not-open" });
    expect(manager.suppliesView(other.sessions[0]!.room.code)).toEqual(otherBefore);
  });
});


test("8A: cumulative deaths are synchronized, private sheets revoked and effects not repeated after F5", async () => {
  await fixture(async ({ room, manager, clock, routeRandom, connect }) => {
    const { clients, sessions } = await room();
    const code = sessions[0]!.room.code;
    routeRandom.mockReturnValue(0);
    clock.advance(60_000); clock.advance(30_000);
    await clients[0]!.timeout(2000).emitWithAck("round:advance");
    await clients[0]!.timeout(2000).emitWithAck("route:open");
    clock.advance(60_000); clock.advance(30_000);
    clock.advance(60_000); clock.advance(30_000);
    await continueMovement(manager, clients[0]!, code);
    expect(manager.suppliesView(code)!.characters.map(c => c.health)).toEqual([50, 50, 50, 70]);
    await clients[0]!.timeout(2000).emitWithAck("round-three:advance");
    await clients[0]!.timeout(2000).emitWithAck("round-three:open");
    const vote = manager.publicVote(code)!;
    const revoked = clients.slice(0, 3).map(client => new Promise<void>(resolve => client.once("game:role-unavailable", resolve)));
    const updates = clients.map(client => nextRoundThree(client, state => state.phase === "completed"));
    for (const client of clients.slice(0, 3)) await cast(client, vote, "pipe-gallery");
    await Promise.all(revoked);
    const states = await Promise.all(updates);
    expect(new Set(states.map(state => publicFacts(state))).size).toBe(1);
    const final = manager.roundThreeView(code)!;
    expect(final.afterRoute!.characters.map(c => c.health)).toEqual([0, 0, 0, 50]);
    expect(final.movement!.victims.map(v => v.participantId)).toEqual(sessions.slice(0, 3).map(s => s.credential.participantId));
    expect(manager.privateRole(clients[0]!.id!)).toBeNull();
    expect(manager.privateRole(clients[1]!.id!)).toBeNull();
    const pack = { requestId: crypto.randomUUID(), windowId: manager.suppliesView(code)!.windowId!, targetParticipantId: sessions[0]!.credential.participantId };
    expect(await clients[2]!.timeout(2000).emitWithAck("pack:give", pack)).toEqual({ ok: false, error: "bellhop-dead" });
    // La sesión sigue siendo válida, pero la muerte retira la autoridad activa.
    expect(await clients[0]!.timeout(2000).emitWithAck("vote:cast", {
      decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: "pipe-gallery",
    })).toEqual({ ok: false, error: "dead" });
    expect(await clients[0]!.timeout(2000).emitWithAck("medical:treat", {
      requestId: crypto.randomUUID(), gameId: manager.suppliesView(code)!.gameId,
      round: 3, targetParticipantId: sessions[2]!.credential.participantId,
    })).toEqual({ ok: false, error: "medic-dead" });
    expect(manager.roundThreeView(code)).toEqual(final);
    const calls = routeRandom.mock.calls.length;
    const disconnected = new Promise<void>(resolve => clients[2]!.once("room:updated", () => resolve()));
    clients[0]!.disconnect(); await disconnected;
    const replacement = await connect();
    const leaked: unknown[] = [];
    replacement.on("game:role", role => leaked.push(role));
    const restored = nextRoundThree(replacement, state => state.phase === "completed");
    await replacement.timeout(2000).emitWithAck("room:resume", sessions[0]!.credential);
    expect(await restored).toEqual(manager.sessionProjection(replacement.id!, final));
    await replacement.timeout(2000).emitWithAck("client:ping");
    expect(leaked).toEqual([]);
    expect(routeRandom).toHaveBeenCalledTimes(calls);
  });
});
