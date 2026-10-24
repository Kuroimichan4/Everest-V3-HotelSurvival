import { expect, test, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, RoundFourView, RoomSession } from "@everest/shared";
import { buildApp } from "../app.js";
import { RoomManager } from "./manager.js";
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

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
    await vote("abandon"); await clients[0]!.timeout(3000).emitWithAck("round:advance"); await vote("abandon");
    await clients[0]!.timeout(3000).emitWithAck("route:open"); await vote("unstable-corridor");
    await clients[0]!.timeout(3000).emitWithAck("round-three:advance"); await clients[0]!.timeout(3000).emitWithAck("round-three:open"); await vote("metal-debris");
    const bellhop = clients.find(c => manager.privateRole(c.id!)?.role === "bellhop")!;
    for (let i = 0; i < 4; i++) for (let n = 0; n < 2; n++) expect((await bellhop.timeout(3000).emitWithAck("pack:give",
      { requestId: crypto.randomUUID(), windowId: manager.suppliesView(code)!.windowId!, targetParticipantId: sessions[i]!.credential.participantId })).ok).toBe(true);
    const outsider = await connect(); const otherUpdates = vi.fn(); outsider.on("round-four:updated", otherUpdates);
    const other = await outsider.timeout(3000).emitWithAck("room:create", { name: "Other room" });
    if (!other.ok) throw new Error(other.error);
    for (let i = 0; i < 3; i++) {
      const extra = await connect();
      expect((await extra.timeout(3000).emitWithAck("room:join", { name: `Other ${i}`, code: other.value.room.code })).ok).toBe(true);
    }
    expect((await outsider.timeout(3000).emitWithAck("room:start")).ok).toBe(true);
    const otherVote = manager.publicVote(other.value.room.code);
    const snapshots: RoundFourView[][] = [[], [], [], []];
    clients.forEach((c, i) => c.on("round-four:updated", view => snapshots[i]!.push(view)));
    random.mockReturnValue(0.9);
    expect((await clients[0]!.timeout(3000).emitWithAck("round-four:advance")).ok).toBe(true);
    random.mockReturnValue(0.99);
    await vi.waitFor(() => expect(snapshots.map(a => a.length)).toEqual([1, 1, 1, 1]));
    expect(snapshots.every(a => a[0]!.npc.encounter === "immobile")).toBe(true);
    const secretFields = /token|tokenHash|sheet|knowledge|personalItems|accidentProbability|EXTREME|danger/;
    expect(JSON.stringify(snapshots)).not.toMatch(secretFields);
    expect((await cast(0, "medical-assist")).ok).toBe(true);
    const voteBefore = manager.publicVote(code)!;
    const oldId = clients[0]!.id!; clients[0]!.disconnect();
    await vi.waitFor(() => expect(manager.privateRole(oldId)).toBe(null));
    const resumed = await connect(); const own = vi.fn(); const privateSheet = vi.fn(); const received = vi.fn();
    resumed.on("vote:own", own); resumed.on("game:role", privateSheet); resumed.on("round-four:updated", received);
    const resume = await resumed.timeout(3000).emitWithAck("room:resume", sessions[0]!.credential);
    expect(resume.ok).toBe(true); clients[0] = resumed;
    await vi.waitFor(() => expect(own).toHaveBeenCalled());
    expect(own.mock.lastCall![0]).toMatchObject({ optionId: "medical-assist", attemptId: voteBefore.attemptId });
    expect(manager.publicVote(code)!.deadline).toBe(voteBefore.deadline);
    expect(privateSheet.mock.lastCall![0].participantId).toBe(sessions[0]!.credential.participantId);
    expect((await cast(1, "medical-assist")).ok).toBe(true); expect((await cast(2, "medical-assist")).ok).toBe(true);
    expect(manager.roundFourView(code)!.npc.status).toBe("awaiting-effort");
    const inventory = manager.suppliesView(code)!.inventory;
    expect((await clients[0]!.timeout(3000).emitWithAck("round-four:open")).ok).toBe(true);
    random.mockReturnValue(0); await vote("exterior-crack");
    const done = manager.roundFourView(code)!; expect(done.phase).toBe("completed");
    expect(done.movement!.inventory.medicalUnits).toBe(inventory.medicalUnits - 1);
    expect(done.movement!.victims).toHaveLength(2);
    await vi.waitFor(() => expect(snapshots.slice(1).every(a => a.at(-1)?.phase === "completed")).toBe(true));
    expect(snapshots.slice(1).every(a => JSON.stringify(a.at(-1)) === JSON.stringify(done))).toBe(true);
    expect(received.mock.lastCall![0]).toEqual(done);
    const calls = random.mock.calls.length; const count = snapshots[1]!.length;
    await clients[0]!.timeout(3000).emitWithAck("round-four:advance");
    await clients[0]!.timeout(3000).emitWithAck("round-four:retry", { preparationId: done.preparationId });
    expect(manager.roundFourView(code)).toEqual(done);
    expect(random).toHaveBeenCalledTimes(calls); expect(snapshots[1]).toHaveLength(count);
    const resumeId = resumed.id!; resumed.disconnect(); await vi.waitFor(() => expect(manager.privateRole(resumeId)).toBe(null));
    const final = await connect(); const finalView = vi.fn(); final.on("round-four:updated", finalView);
    expect((await final.timeout(3000).emitWithAck("room:resume", sessions[0]!.credential)).ok).toBe(true);
    await vi.waitFor(() => expect(finalView).toHaveBeenCalled()); expect(finalView.mock.lastCall![0]).toEqual(done);
    expect(random).toHaveBeenCalledTimes(calls); expect(otherUpdates).not.toHaveBeenCalled();
    expect(manager.roundFourSession(outsider.id!)).toBe(null);
    expect(manager.publicVote(other.value.room.code)).toEqual(otherVote);
    expect(manager.suppliesView(other.value.room.code)!.inventory).toEqual({ packs: 8, medicalUnits: 4 });
  } finally { all.forEach(c => c.disconnect()); manager.dispose(); await app.close(); }
}, 15000);
