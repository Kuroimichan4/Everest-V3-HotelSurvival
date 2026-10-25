import { expect, test, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, GameFinalResult, PrivateObjectiveEvidence, RoomSession } from "@everest/shared";
import { RoomManager } from "./manager.js";
import { buildApp } from "../app.js";
import type { ObjectiveLedger } from "../simulation/objective-evidence.js";
import type { SimulationState } from "../simulation/state.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
test.each([[0, null], [0.6, "assist"], [0.9, "carry"]] as const)("deterministic final through four sockets: encounter %s, rescue %s, one result and immutable F5", async (roll, choice) => {
  const random = vi.fn(() => 0.99); const manager = new RoomManager(() => 0, { now: () => 1000, schedule: () => () => {} }, random);
  const app = buildApp({ roomManager: manager }); const all: Client[] = [];
  try {
    await app.listen({ host: "127.0.0.1", port: 0 }); const address = app.server.address(); if (!address || typeof address === "string") throw new Error("No port");
    async function connect() {
      const c: Client = io(`http://127.0.0.1:${(address as { port: number }).port}`, { autoConnect: false, reconnection: false }); all.push(c);
      await new Promise<void>((resolve, reject) => { c.once("connect", resolve); c.once("connect_error", reject); c.connect(); }); return c;
    }
    const clients = await Promise.all([connect(), connect(), connect(), connect()]); const sessions: RoomSession[] = [];
    const created = await clients[0]!.timeout(3000).emitWithAck("room:create", { name: "Host" }); if (!created.ok) throw new Error(created.error);
    sessions.push(created.value); const code = created.value.room.code;
    for (let i = 1; i < 4; i++) { const r = await clients[i]!.timeout(3000).emitWithAck("room:join", { name: `Person ${i}`, code }); if (!r.ok) throw new Error(r.error); sessions.push(r.value); }
    await clients[0]!.timeout(3000).emitWithAck("room:start");
    const vote = async (optionId: string) => {
      const v = manager.publicVote(code)!;
      for (const i of [0, 1, 2]) expect((await clients[i]!.timeout(3000).emitWithAck("vote:cast", { decisionId: v.decisionId, attemptId: v.attemptId, optionId })).ok).toBe(true);
    };
    await vote("abandon"); await clients[0]!.timeout(3000).emitWithAck("round:advance");
    const maintenance = clients.find(c => manager.privateRole(c.id!)?.role === "maintenance")!;
    expect((await maintenance.timeout(3000).emitWithAck("route:reveal")).ok).toBe(true);
    expect((await maintenance.timeout(3000).emitWithAck("route:reveal")).ok).toBe(true);
    await clients[0]!.timeout(3000).emitWithAck("route:open"); await vote("unstable-corridor"); await vote("abandon");
    await clients[0]!.timeout(3000).emitWithAck("transport:open", { preparationId: manager.transportView(code)!.cases.at(-1)!.preparationId });
    await clients[0]!.timeout(3000).emitWithAck("round-three:advance"); await clients[0]!.timeout(3000).emitWithAck("round-three:open"); await vote("metal-debris");
    const bellhop = clients.find(c => manager.privateRole(c.id!)?.role === "bellhop")!;
    for (let i = 0; i < 4; i++) for (let n = 0; n < 2; n++) expect((await bellhop.timeout(3000).emitWithAck("pack:give",
      { requestId: crypto.randomUUID(), windowId: manager.suppliesView(code)!.windowId!, targetParticipantId: sessions[i]!.credential.participantId })).ok).toBe(true);
    // Preparar un herido de prueba; el tratamiento y su autoría se registran por el RPC real.
    const internal = (manager as unknown as { rooms: Map<string, { game: { state: SimulationState; objectiveLedger?: ObjectiveLedger } }> }).rooms.get(code)!.game;
    internal.state = { ...internal.state, characters: internal.state.characters.map((c, i) => i === 0 ? { ...c, health: 80 } : c) };
    const medic = clients.find(c => manager.privateRole(c.id!)?.role === "medic")!;
    const medicParticipantId = sessions[clients.indexOf(medic)]!.credential.participantId;
    const treatment = { requestId: "real-medical-evidence", gameId: manager.suppliesView(code)!.gameId, round: 3 as const, targetParticipantId: sessions[0]!.credential.participantId };
    expect((await medic.timeout(3000).emitWithAck("medical:treat", treatment)).ok).toBe(true);
    expect((await medic.timeout(3000).emitWithAck("medical:treat", treatment)).ok).toBe(true);
    expect(manager.objectiveSession(medic.id!)).toBe(null);
    // Reconnect before finalization: evidence remains attached to the authenticated identity.
    const previousArchitect = clients[1]!.id!; clients[1]!.disconnect();
    await vi.waitFor(() => expect(manager.privateRole(previousArchitect)).toBeNull());
    clients[1] = await connect();
    expect((await clients[1]!.timeout(3000).emitWithAck("room:resume", sessions[1]!.credential)).ok).toBe(true);
    const results: GameFinalResult[][] = [[], [], [], []]; const objectives: PrivateObjectiveEvidence[][] = [[], [], [], []];
    clients.forEach((c, i) => { c.on("game:finished", r => results[i]!.push(r)); c.on("game:objective", r => objectives[i]!.push(r)); });
    const outsider = await connect(); const otherFinal = vi.fn(); outsider.on("game:finished", otherFinal);
    await outsider.timeout(3000).emitWithAck("room:create", { name: "Other room" });
    const original = internal.state.characters;
    internal.state = { ...internal.state, characters: original.map(c => ({ ...c, energy: 100 })) };
    for (const round of [4, 5] as const) {
      expect((await clients[0]!.timeout(3000).emitWithAck("intermediate:action", { round, action: "advance" })).ok).toBe(true);
      for (let replay = 0; replay < 2; replay++) expect((await maintenance.timeout(3000).emitWithAck("intermediate:action", { round, action: "reveal" })).ok).toBe(true);
      await clients[0]!.timeout(3000).emitWithAck("intermediate:action", { round, action: "open" });
      await vote(round === 4 ? "cracked-stairs" : roll === 0 ? "restaurant-corridor" : "collapsed-kitchen");
    }
    internal.state = { ...internal.state, characters: original };
    random.mockReturnValue(roll); await clients[0]!.timeout(3000).emitWithAck("round-four:advance"); random.mockReturnValue(0.99);
    expect(manager.finalResult(code)).toBe(null);
    if (choice) {
      await vote(choice); expect(manager.roundFourView(code)!.npc.status).toBe("awaiting-effort");
      expect(manager.finalResult(code)).toBe(null);
    } else expect(manager.roundFourView(code)!.npc.encounter).toBe("none");
    await clients[0]!.timeout(3000).emitWithAck("round-four:open"); const exitVote = manager.publicVote(code)!; await vote(roll === 0 ? "revolving-door" : "exterior-crack");
    await vi.waitFor(() => expect(results.map(a => a.length)).toEqual([1, 1, 1, 1]));
    await vi.waitFor(() => expect(objectives.map(a => a.length)).toEqual([1, 1, 1, 1]));
    const final = manager.finalResult(code)!;
    expect(final).toMatchObject({ kind: "evacuation-completed", counts: { evacuated: 4, dead: 0, abandoned: 0, rescuedNpcs: choice ? 1 : 0 } });
    expect(final.npcs[2]).toMatchObject({ status: choice ? "rescued" : "absent", evacuated: !!choice });
    for (let i = 0; i < 4; i++) {
      expect(results[i]![0]).toEqual(manager.sessionProjection(clients[i]!.id!, final));
      results[i]![0]!.humans.forEach((p, j) => {
        expect(p.energy).toBe(i === j ? final.humans[j]!.energy : undefined);
        expect(p.health).toBe(i === j || clients[i] === medic ? final.humans[j]!.health : undefined);
      });
      expect(objectives[i]![0]!.participantId).toBe(sessions[i]!.credential.participantId);
    }
    expect(internal.objectiveLedger!.patients).toHaveLength(1);
    expect(internal.objectiveLedger!.patients[0]!.treatments).toEqual([{ round: 3, restored: 20, requestId: treatment.requestId, administratorId: medicParticipantId }]);
    expect(internal.objectiveLedger!.patients[0]!.evacuated).toBe(true);
    expect(objectives[clients.indexOf(medic)]![0]!.evaluation).toBe("fulfilled");
    expect(internal.objectiveLedger!.routes.find(r => r.round === 3)).toMatchObject({ forcedByNoAgreement: false, realRisk: "MODERATE" });
    expect(internal.objectiveLedger!.maintenance.revelations).toHaveLength(3);
    expect(internal.objectiveLedger!.maintenance.openings).toEqual([]);
    expect(objectives[clients.indexOf(maintenance)]![0]!.evaluation).toBe("fulfilled");
    expect(objectives[1]![0]!.evaluation).toBe(roll === 0 ? "fulfilled" : "unfulfilled");
    for (const i of [0, 1, 3]) expect(JSON.stringify(objectives[i])).not.toMatch(/sabot|poison|venen|victimId|actorId/i);
    const storedLedger = JSON.stringify(internal.objectiveLedger);
    expect(JSON.stringify(final)).not.toMatch(/objective|knowledge|sheet|accidentProbability|score|ranking/);
    expect(otherFinal).not.toHaveBeenCalled();
    const calls = random.mock.calls.length; const resources = manager.suppliesView(code)!;
    expect((await clients[0]!.timeout(3000).emitWithAck("vote:cast", { decisionId: exitVote.decisionId, attemptId: exitVote.attemptId, optionId: "exterior-crack" })).ok).toBe(false);
    expect((await bellhop.timeout(3000).emitWithAck("pack:give", { requestId: "new-after-final", windowId: "old-window", targetParticipantId: sessions[0]!.credential.participantId })).ok).toBe(false);
    expect((await clients[0]!.timeout(3000).emitWithAck("round-three:advance")).ok).toBe(false);
    expect(manager.suppliesView(code)).toEqual(resources); expect(manager.finalResult(code)).toEqual(final); expect(random).toHaveBeenCalledTimes(calls);
    const oldId = clients[0]!.id!; clients[0]!.disconnect(); await vi.waitFor(() => expect(manager.privateRole(oldId)).toBe(null));
    const restored = await connect(); const received = vi.fn(); const own = vi.fn(); restored.on("game:finished", received); restored.on("game:objective", own);
    expect((await restored.timeout(3000).emitWithAck("room:resume", sessions[0]!.credential)).ok).toBe(true);
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1)); expect(received.mock.lastCall![0]).toEqual(manager.sessionProjection(restored.id!, final));
    await vi.waitFor(() => expect(own).toHaveBeenCalledTimes(1)); expect(own.mock.lastCall![0]).toEqual(objectives[0]![0]);
    expect(results.slice(1).every(a => a.length === 1)).toBe(true); expect(random).toHaveBeenCalledTimes(calls);
    expect(JSON.stringify(internal.objectiveLedger)).toBe(storedLedger);
    const mutable = manager.finalResult(code)!; mutable.humans[0]!.health = 0; expect(manager.finalResult(code)).toEqual(final);
  } finally { all.forEach(c => c.disconnect()); manager.dispose(); await app.close(); }
}, 15000);
