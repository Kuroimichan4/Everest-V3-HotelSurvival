import { completeIntermediateFixture } from "../../test-support/final-stage.js";
import { expect, test, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, RoundFourView, RoomSession } from "@everest/shared";
import { buildApp } from "../app.js";
import { RoomManager } from "./manager.js";
import type { VotingClock } from "./voting.js";
import { activeScene, emptyGame, gameReducer, type GameState } from "../../../web/src/game-state.js";
import { bindGameSocket } from "../../../web/src/game-socket.js";
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

class InactionClock implements VotingClock {
  time = 1000;
  tasks = new Set<{ at: number; callback: () => void }>();
  now = () => this.time;
  schedule = (callback: () => void, delay: number) => {
    const task = { at: this.time + delay, callback }; this.tasks.add(task);
    return () => { this.tasks.delete(task); };
  };
  advance(ms: number) {
    this.time += ms;
    for (const task of [...this.tasks]) if (task.at <= this.time) { this.tasks.delete(task); task.callback(); }
  }
}

test("NPC inaction broadcasts one transition to all four real client reducers, including F5 and delayed auxiliary snapshots", async () => {
  const clock = new InactionClock(); const random = vi.fn(() => 0.99);
  const manager = new RoomManager(() => 0, clock, random); const app = buildApp({ roomManager: manager });
  const all: Client[] = []; const cleanups: (() => void)[] = [];
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address(); if (!address || typeof address === "string") throw new Error("No port");
    async function connect() {
      const client: Client = io(`http://127.0.0.1:${(address as { port: number }).port}`, { autoConnect: false, reconnection: false }); all.push(client);
      await new Promise<void>((resolve, reject) => { client.once("connect", resolve); client.once("connect_error", reject); client.connect(); });
      return client;
    }
    const clients = await Promise.all([connect(), connect(), connect(), connect()]);
    const sessions: RoomSession[] = [];
    const created = await clients[0]!.timeout(3000).emitWithAck("room:create", { name: "Host" });
    if (!created.ok) throw new Error(created.error); sessions.push(created.value); const code = created.value.room.code;
    for (let i = 1; i < 4; i++) {
      const joined = await clients[i]!.timeout(3000).emitWithAck("room:join", { name: `Person ${i}`, code });
      if (!joined.ok) throw new Error(joined.error); sessions.push(joined.value);
    }
    await clients[0]!.timeout(3000).emitWithAck("room:start");
    const priorVote = (optionId: string) => {
      const v = manager.publicVote(code)!;
      for (const i of [0, 1, 2]) expect(manager.vote(clients[i]!.id!, { decisionId: v.decisionId, attemptId: v.attemptId, optionId }).ok).toBe(true);
    };
    priorVote("abandon"); manager.advanceRound(clients[0]!.id!);
    manager.routeAction(clients[0]!.id!, "open"); priorVote("unstable-corridor"); priorVote("abandon");
    manager.openTransport(clients[0]!.id!, { preparationId: manager.transportView(code)!.cases.at(-1)!.preparationId });
    manager.roundThreeAction(clients[0]!.id!, "advance"); manager.roundThreeAction(clients[0]!.id!, "open"); priorVote("metal-debris");
    const supplies = manager.suppliesView(code)!;
    const states: GameState[] = clients.map(c => ({ ...emptyGame, supplies, role: manager.privateRole(c.id!) }));
    const views: RoundFourView[][] = [[], [], [], []];
    const attach = (client: Client, i: number) => {
      const cleanup = bindGameSocket(client, action => {
        // Modelar recepción retrasada: tres clientes conservan el snapshot auxiliar de R3.
        if (i > 0 && action.type === "supplies" && action.value?.round === 6) return;
        states[i] = gameReducer(states[i]!, action);
      }, { participantId: () => sessions[i]!.credential.participantId, connect: () => {}, disconnect: () => {}, error: () => {} });
      const listener = (view: RoundFourView) => { views[i]!.push(view); };
      client.on("round-six:updated", listener);
      const unbind = () => { cleanup(); client.off("round-six:updated", listener); };
      cleanups.push(unbind); return unbind;
    };
    let hostCleanup = attach(clients[0]!, 0); for (let i = 1; i < 4; i++) attach(clients[i]!, i);
    completeIntermediateFixture(manager, code, clients[0]!.id!, clients.map(c => c.id!));
    random.mockReturnValue(0.6);
    expect((await clients[0]!.timeout(3000).emitWithAck("round-six:advance")).ok).toBe(true);
    random.mockReturnValue(0.99);
    await vi.waitFor(() => expect(views.map(a => a.length)).toEqual([1, 1, 1, 1]));
    const npcVote = manager.publicVote(code)!;
    expect(states.map(s => activeScene(s).vote?.attemptId)).toEqual(Array(4).fill(npcVote.attemptId));
    expect(states.every(s => activeScene(s).kind === "round-four")).toBe(true);
    expect(new Set(states.map(s => s.role!.role)).size).toBe(4);
    expect((await clients[0]!.timeout(3000).emitWithAck("vote:cast", { decisionId: npcVote.decisionId, attemptId: npcVote.attemptId, optionId: "assist" })).ok).toBe(true);
    await vi.waitFor(() => expect(views.slice(1).every(a => a.length === 2)).toBe(true));
    clock.advance(7000);
    const oldId = clients[0]!.id!; hostCleanup(); clients[0]!.disconnect();
    await vi.waitFor(() => expect(manager.privateRole(oldId)).toBe(null));
    states[0] = { ...emptyGame, supplies }; const resumed = await connect(); clients[0] = resumed; hostCleanup = attach(resumed, 0);
    expect((await resumed.timeout(3000).emitWithAck("room:resume", sessions[0]!.credential)).ok).toBe(true);
    await vi.waitFor(() => expect(states[0]!.ownVote?.optionId).toBe("assist"));
    expect(activeScene(states[0]!).vote).toMatchObject({ decisionId: npcVote.decisionId, deadline: npcVote.deadline, serverNow: clock.now() });
    expect(resumed.listeners("round-six:updated")).toHaveLength(2); // binder + observador de prueba
    const counts = views.map(a => a.length); const resources = manager.suppliesView(code)!;
    clock.advance(53000);
    await vi.waitFor(() => expect(views.map(a => a.length)).toEqual(counts.map(n => n + 1)));
    const retry = manager.publicVote(code)!;
    expect(retry).toMatchObject({ decisionId: npcVote.decisionId, attemptNumber: 2, deadline: clock.now() + 30000 });
    for (const s of states) {
      expect(s.roundFour!.npc.message).toBe("El superviviente parece debilitarse a cada segundo que pasa");
      expect(activeScene(s).vote).toMatchObject({ attemptId: retry.attemptId, deadline: retry.deadline });
    }
    clock.advance(30000);
    await vi.waitFor(() => expect(views.map(a => a.length)).toEqual(counts.map(n => n + 2)));
    for (const s of states) {
      expect(s.roundFour).toMatchObject({ phase: "preparation", npc: { status: "dead", vote: { status: "closed", result: "NO_AGREEMENT" } },
        collapse: null, surcharge: 0, selection: null, movement: null });
      expect(activeScene(s)).toMatchObject({ round: 6, kind: "round-four", vote: null });
    }
    expect(manager.suppliesView(code)!.inventory).toEqual(resources.inventory);
    expect(manager.suppliesView(code)!.characters).toEqual(resources.characters);
    expect(manager.publicVote(code)).toBe(null);
    expect(clock.tasks.size).toBe(0);
    const settled = views.map(a => a.length);
    for (const client of clients) manager.votingSession(client.id!);
    clock.advance(30000);
    expect(views.map(a => a.length)).toEqual(settled);
    expect((await resumed.timeout(3000).emitWithAck("round-six:open")).ok).toBe(true);
    await vi.waitFor(() => expect(states.every(s => s.roundFour!.phase === "exit-voting")).toBe(true));
    const exit = manager.publicVote(code)!; expect(exit.decisionId).not.toBe(npcVote.decisionId);
    for (const i of [0, 1, 2]) expect((await clients[i]!.timeout(3000).emitWithAck("vote:cast",
      { decisionId: exit.decisionId, attemptId: exit.attemptId, optionId: "exterior-crack" })).ok).toBe(true);
    await vi.waitFor(() => expect(states.every(s => s.roundFour!.phase === "completed")).toBe(true));
    expect(manager.roundFourView(code)).toMatchObject({ npc: { status: "dead" }, movement: { rescuedNpc: false, routeId: "exterior-crack" }, collapse: null });
  } finally { cleanups.forEach(c => c()); all.forEach(c => c.disconnect()); manager.dispose(); await app.close(); }
}, 15000);

test("four real socket sessions: synchronized NPC, own votes, F5, single costs and accident; separate room isolated", async () => {
  const random = vi.fn(() => 0.99);
  const manager = new RoomManager(() => 0, { now: () => 1000, schedule: () => () => {} }, random);
  const app = buildApp({ roomManager: manager }); const all: Client[] = [];
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address(); if (!address || typeof address === "string") throw new Error("No port");
    async function connect() {
      const c: Client = io(`http://127.0.0.1:${(address as { port: number }).port}`, { autoConnect: false, reconnection: false }); all.push(c);
      await new Promise<void>((resolve, reject) => { c.once("connect", resolve); c.once("connect_error", reject); c.connect(); }); return c;
    }
    const clients = await Promise.all([connect(), connect(), connect(), connect()]);
    const sessions: RoomSession[] = [];
    const first = await clients[0]!.timeout(3000).emitWithAck("room:create", { name: "Host" });
    if (!first.ok) throw new Error(first.error); sessions.push(first.value); const code = first.value.room.code;
    for (let i = 1; i < 4; i++) {
      const r = await clients[i]!.timeout(3000).emitWithAck("room:join", { name: `Persona ${i}`, code });
      if (!r.ok) throw new Error(r.error); sessions.push(r.value);
    }
    expect((await clients[0]!.timeout(3000).emitWithAck("room:start")).ok).toBe(true);
    const cast = async (i: number, optionId: string) => {
      const vote = manager.publicVote(code)!;
      return clients[i]!.timeout(3000).emitWithAck("vote:cast", { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId });
    };
    const vote = async (id: string) => { for (const i of [0, 1, 2]) expect((await cast(i, id)).ok).toBe(true); };
    await vote("abandon"); await clients[0]!.timeout(3000).emitWithAck("round:advance");
    await clients[0]!.timeout(3000).emitWithAck("route:open"); await vote("unstable-corridor"); await vote("abandon");
    await clients[0]!.timeout(3000).emitWithAck("transport:open", { preparationId: manager.transportView(code)!.cases.at(-1)!.preparationId });
    await clients[0]!.timeout(3000).emitWithAck("round-three:advance"); await clients[0]!.timeout(3000).emitWithAck("round-three:open"); await vote("metal-debris");
    const bellhop = clients.find(c => manager.privateRole(c.id!)?.role === "bellhop")!;
    for (let i = 0; i < 4; i++) for (let n = 0; n < 2; n++) expect((await bellhop.timeout(3000).emitWithAck("pack:give",
      { requestId: crypto.randomUUID(), windowId: manager.suppliesView(code)!.windowId!, targetParticipantId: sessions[i]!.credential.participantId })).ok).toBe(true);
    const outsider = await connect(); const otherUpdates = vi.fn(); outsider.on("round-six:updated", otherUpdates);
    const other = await outsider.timeout(3000).emitWithAck("room:create", { name: "Other room" });
    if (!other.ok) throw new Error(other.error);
    for (let i = 0; i < 3; i++) {
      const extra = await connect();
      expect((await extra.timeout(3000).emitWithAck("room:join", { name: `Other ${i}`, code: other.value.room.code })).ok).toBe(true);
    }
    expect((await outsider.timeout(3000).emitWithAck("room:start")).ok).toBe(true);
    const otherVote = manager.publicVote(other.value.room.code);
    const snapshots: RoundFourView[][] = [[], [], [], []];
    clients.forEach((c, i) => c.on("round-six:updated", view => snapshots[i]!.push(view)));
    completeIntermediateFixture(manager, code, clients[0]!.id!, clients.map(c => c.id!));
    random.mockReturnValue(0.9);
    expect((await clients[0]!.timeout(3000).emitWithAck("round-six:advance")).ok).toBe(true);
    random.mockReturnValue(0.99);
    await vi.waitFor(() => expect(snapshots.map(a => a.length)).toEqual([1, 1, 1, 1]));
    expect(snapshots.every(a => a[0]!.npc.encounter === "immobile")).toBe(true);
    const secretFields = /token|tokenHash|sheet|knowledge|personalItems|accidentProbability/;
    expect(JSON.stringify(snapshots)).not.toMatch(secretFields);
    snapshots.forEach(a=>expect(a[0]!.options.every(o=>o.danger===undefined)).toBe(true));
    expect((await cast(0, "medical-assist")).ok).toBe(true);
    const voteBefore = manager.publicVote(code)!;
    const oldId = clients[0]!.id!; clients[0]!.disconnect();
    await vi.waitFor(() => expect(manager.privateRole(oldId)).toBe(null));
    const resumed = await connect(); const own = vi.fn(); const privateSheet = vi.fn(); const received = vi.fn();
    resumed.on("vote:own", own); resumed.on("game:role", privateSheet); resumed.on("round-six:updated", received);
    const resume = await resumed.timeout(3000).emitWithAck("room:resume", sessions[0]!.credential);
    expect(resume.ok).toBe(true); clients[0] = resumed;
    await vi.waitFor(() => expect(own).toHaveBeenCalled());
    expect(own.mock.lastCall![0]).toMatchObject({ optionId: "medical-assist", attemptId: voteBefore.attemptId });
    expect(manager.publicVote(code)!.deadline).toBe(voteBefore.deadline);
    expect(privateSheet.mock.lastCall![0].participantId).toBe(sessions[0]!.credential.participantId);
    expect((await cast(1, "medical-assist")).ok).toBe(true); expect((await cast(2, "medical-assist")).ok).toBe(true);
    expect(manager.roundFourView(code)!.npc.status).toBe("awaiting-effort");
    const inventory = manager.suppliesView(code)!.inventory;
    expect((await clients[0]!.timeout(3000).emitWithAck("round-six:open")).ok).toBe(true);
    random.mockReturnValue(0); await vote("exterior-crack");
    const done = manager.roundFourView(code)!; expect(done.phase).toBe("completed");
    expect(done.movement!.inventory.medicalUnits).toBe(inventory.medicalUnits - 1);
    expect(done.movement!.victims).toHaveLength(3);
    await vi.waitFor(() => expect(snapshots.slice(1).every(a => a.at(-1)?.phase === "completed")).toBe(true));
    snapshots.slice(1).forEach((a, i) => expect(a.at(-1)).toEqual(manager.sessionProjection(clients[i + 1]!.id!, done)));
    expect(received.mock.lastCall![0]).toEqual(manager.sessionProjection(resumed.id!, done));
    const calls = random.mock.calls.length; const count = snapshots[1]!.length;
    await clients[0]!.timeout(3000).emitWithAck("round-six:advance");
    await clients[0]!.timeout(3000).emitWithAck("round-six:retry", { preparationId: done.preparationId });
    expect(manager.roundFourView(code)).toEqual(done);
    expect(random).toHaveBeenCalledTimes(calls); expect(snapshots[1]).toHaveLength(count);
    const resumeId = resumed.id!; resumed.disconnect(); await vi.waitFor(() => expect(manager.privateRole(resumeId)).toBe(null));
    const final = await connect(); const finalView = vi.fn(); final.on("round-six:updated", finalView);
    expect((await final.timeout(3000).emitWithAck("room:resume", sessions[0]!.credential)).ok).toBe(true);
    await vi.waitFor(() => expect(finalView).toHaveBeenCalled()); expect(finalView.mock.lastCall![0]).toEqual(manager.sessionProjection(final.id!, done));
    expect(random).toHaveBeenCalledTimes(calls); expect(otherUpdates).not.toHaveBeenCalled();
    expect(manager.roundFourSession(outsider.id!)).toBe(null);
    expect(manager.publicVote(other.value.room.code)).toEqual(otherVote);
    expect(manager.suppliesView(other.value.room.code)!.inventory).toEqual({ packs: 8, medicalUnits: 4 });
  } finally { all.forEach(c => c.disconnect()); manager.dispose(); await app.close(); }
}, 15000);
