import { afterEach, expect, test, vi } from "vitest";
import type { RoomReply } from "@everest/shared";
import type { SimulationState } from "../simulation/state.js";
import { RoomManager } from "./manager.js";
import type { VotingClock } from "./voting.js";

class Clock implements VotingClock {
  time = 1000; tasks = new Set<{ at: number; run: () => void }>();
  now = () => this.time;
  schedule = (run: () => void, delay: number) => { const t = { at: this.time + delay, run }; this.tasks.add(t); return () => { this.tasks.delete(t); }; };
  advance(ms: number) { this.time += ms; for (const t of [...this.tasks]) if (t.at <= this.time) { this.tasks.delete(t); t.run(); } }
}
const managers: RoomManager[] = [];
afterEach(() => managers.splice(0).forEach(m => m.dispose()));
function value<T>(r: RoomReply<T>): T { if (!r.ok) throw new Error(r.error); return r.value; }
function setup(round: 2 | 3, energies = [100, 100, 100, 100]) {
  const clock = new Clock(); const random = vi.fn(() => 0.99); const manager = new RoomManager(() => 0, clock, random); managers.push(manager);
  const first = value(manager.create("s0", "P0")); const code = first.room.code;
  const sessions = [first, ...[1, 2, 3].map(i => value(manager.join(`s${i}`, `P${i}`, code)))];
  manager.start("s0");
  const vote = (optionId: string, voters = [0, 1, 2]) => {
    const current = manager.publicVote(code)!;
    return voters.map(i => manager.vote(`s${i}`, { decisionId: current.decisionId, attemptId: current.attemptId, optionId }));
  };
  vote("abandon"); manager.advanceRound("s0"); vote("abandon");
  if (round === 3) { manager.routeAction("s0", "open"); vote("unstable-corridor"); manager.roundThreeAction("s0", "advance"); }
  const game = () => (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game;
  const changeEnergy = (values: number[]) => { game().state = { ...game().state, characters: game().state.characters.map((c, i) => ({ ...c, energy: values[i]! })) }; };
  changeEnergy(energies); random.mockClear();
  const open = () => round === 2 ? manager.routeAction("s0", "open") : manager.roundThreeAction("s0", "open");
  const view = () => round === 2 ? manager.roundTwoView(code)! : manager.roundThreeView(code)!;
  const options = () => round === 2 ? manager.roundTwoView(code)!.routeChoice!.options : manager.roundThreeView(code)!.options;
  const give = (i: number) => manager.givePack("s2", { requestId: crypto.randomUUID(), windowId: manager.suppliesView(code)!.windowId!, targetParticipantId: sessions[i]!.credential.participantId });
  return { manager, code, clock, random, sessions, game, changeEnergy, open, vote, view, options, give };
}

test.each([2, 3] as const)("ronda %i mantiene visibles las rutas inviables y rechaza votos manipulados", round => {
  const f = setup(round, [20, 20, 20, 20]);
  expect(f.options()).toHaveLength(round === 2 ? 2 : 3);
  expect(f.options().filter(o => o.availability.status === "available")).toHaveLength(1);
  expect(f.open().ok).toBe(true); // Una sola ruta viable sigue necesitando mayoría colectiva.
  const expensive = round === 2 ? "shoring" : "metal-debris";
  const before = f.game().state;
  for (const reply of f.vote(expensive)) expect(reply).toEqual({ ok: false, error: "invalid-option" });
  expect(f.game().state).toBe(before); expect(f.random).not.toHaveBeenCalled();
  expect(f.manager.publicVote(f.code)!.requiredVotes).toBe(3);
  const cheap = round === 2 ? "unstable-corridor" : "pipe-gallery";
  f.vote(cheap, [0, 1]); expect(f.view().phase).not.toBe("completed");
  f.vote(cheap, [2]); expect(f.view().phase).toBe("completed");
  expect(f.manager.suppliesView(f.code)!.characters.every(c => c.energy === 0)).toBe(true);
});

test.each([2, 3] as const)("ronda %i actualiza disponibilidad con packs en preparación y congela al votar", round => {
  const f = setup(round, [30, 30, 30, 30]); const costly = round === 2 ? "shoring" : "metal-debris";
  expect(f.options().find(o => o.id === costly)!.availability.status).toBe("unavailable");
  f.give(0); f.give(1);
  expect(f.options().find(o => o.id === costly)!.availability.status).toBe("with-help");
  const snapshot = f.options(); f.open();
  const input = { requestId: crypto.randomUUID(), windowId: "old-window", targetParticipantId: f.sessions[2]!.credential.participantId };
  expect(f.manager.givePack("s2", input)).toEqual({ ok: false, error: "supplies-not-open" });
  expect(f.options()).toEqual(snapshot);
  f.vote(costly);
  expect(f.manager.transportView(f.code)!.cases.at(-1)!.phase).toBe("preparation");
  expect(f.random).not.toHaveBeenCalled();
  expect(f.game().state.characters.some(c => c.eliminated)).toBe(false);
});

test.each([2, 3] as const)("ronda %i recupera selección obsoleta, conserva estado y exige nueva mayoría", round => {
  const f = setup(round); f.open(); const expensive = round === 2 ? "shoring" : "fire-door";
  const old = f.manager.publicVote(f.code)!; f.vote(expensive, [0, 1]);
  // Simula una selección heredada cuyo estado ya no puede pagar la ruta; sin API de depuración.
  f.changeEnergy([20, 20, 20, 20]); const before = f.game().state;
  f.vote(expensive, [2]);
  expect(f.view().recovery).toMatchObject({ decisionId: old.decisionId, forced: false });
  expect(f.game().state).toBe(before); expect(f.random).not.toHaveBeenCalled();
  f.manager.disconnect("s1"); expect(f.manager.resume("replacement", f.sessions[1]!.credential).ok).toBe(true);
  expect((round === 2 ? f.manager.roundTwoSession("replacement") : f.manager.roundThreeSession("replacement"))!.recovery).toEqual(f.view().recovery);
  expect(f.manager.retryRoute("outsider", { decisionId: old.decisionId })).toEqual({ ok: false, error: "invalid-session" });
  expect(f.manager.retryRoute("replacement", { decisionId: "wrong" }).ok).toBe(false);
  expect(f.manager.retryRoute("replacement", { decisionId: old.decisionId }).ok).toBe(true);
  const restored = f.game().state;
  expect(restored.characters).toBe(before.characters); expect(restored.inventory).toBe(before.inventory); expect(restored.tools).toBe(before.tools);
  expect(f.view().failedSelections).toMatchObject([{ decisionId: old.decisionId, outcome: expensive }]);
  expect(f.manager.retryRoute("s0", { decisionId: old.decisionId }).ok).toBe(true);
  expect(f.view().failedSelections).toHaveLength(1);
  expect(f.open().ok).toBe(true); const next = f.manager.publicVote(f.code)!;
  expect(next.decisionId).not.toBe(old.decisionId);
  expect(f.manager.vote("s0", { decisionId: old.decisionId, attemptId: old.attemptId, optionId: expensive })).toEqual({ ok: false, error: "wrong-decision" });
  const alternative = round === 2 ? "unstable-corridor" : "pipe-gallery";
  f.vote(alternative, [0, 2]); expect(f.view().phase).not.toBe("completed");
  f.vote(alternative, [3]); expect(f.view().phase).toBe("completed");
  expect(f.random).toHaveBeenCalledTimes(1);
  expect(f.manager.suppliesView(f.code)!.characters.map(c => [c.energy, c.health])).toEqual(Array(4).fill([0, round === 2 ? 100 : 80]));
  f.manager.retryRoute("s0", { decisionId: old.decisionId });
  expect(f.random).toHaveBeenCalledTimes(1);
});

test.each([2, 3] as const)("ronda %i forzada imposible conserva obligación y recupera con packs sin penalización duplicada", round => {
  const f = setup(round); f.open(); const vote = f.manager.publicVote(f.code)!;
  f.changeEnergy([5, 5, 5, 5]); const before = f.game().state;
  f.clock.advance(60_000); f.clock.advance(30_000);
  expect(f.view().recovery).toMatchObject({ decisionId: vote.decisionId, forced: true });
  expect(f.game().state).toBe(before); expect(f.random).not.toHaveBeenCalled();
  expect(f.manager.retryRoute("s0", { decisionId: vote.decisionId })).toEqual({ ok: false, error: "forced-route-energy-pending" });
  for (const i of [0, 1, 2, 3]) expect(f.give(i).ok).toBe(true);
  expect(f.manager.retryRoute("s0", { decisionId: vote.decisionId }).ok).toBe(true);
  expect(f.view().phase).toBe("completed");
  expect(f.manager.suppliesView(f.code)!.characters.map(c => [c.energy, c.health])).toEqual(Array(4).fill([10, round === 2 ? 90 : 80]));
  expect(f.manager.suppliesView(f.code)!.inventory.packs).toBe(4);
  expect(f.random).toHaveBeenCalledTimes(1);
  expect(f.manager.retryRoute("s0", { decisionId: vote.decisionId }).ok).toBe(false);
  expect(f.random).toHaveBeenCalledTimes(1);
});

test("revelación de ventilación sobrevive a recuperar selección y no publica riesgos privados", () => {
  const f = setup(2); f.manager.routeAction("s3", "reveal"); f.open(); f.vote("shoring", [0, 1]);
  f.changeEnergy([20, 20, 20, 20]); f.vote("shoring", [2]);
  f.manager.retryRoute("s0", { decisionId: f.view().recovery!.decisionId });
  expect(f.options().map(o => o.id)).toContain("ventilation");
  expect(JSON.stringify(f.options())).not.toMatch(/LOW|BAJO|probability|accidentProbability|objective|token/);
});

test("una sala no puede recuperar decisiones ajenas", () => {
  const first = setup(3); const other = setup(3);
  first.open(); first.vote("fire-door", [0, 1]); first.changeEnergy([20, 20, 20, 20]); first.vote("fire-door", [2]);
  const before = other.game().state;
  expect(other.manager.retryRoute("s0", { decisionId: first.view().recovery!.decisionId }).ok).toBe(false);
  expect(other.game().state).toBe(before);
});

test.each([2, 3] as const)("ronda %i reconoce un bloqueo energético guardado al reconectar", round => {
  const f = setup(round); f.open(); f.vote(round === 2 ? "shoring" : "fire-door", [0, 1]);
  f.changeEnergy([20, 20, 20, 20]); f.vote(round === 2 ? "shoring" : "fire-door", [2]);
  const decisionId = f.view().recovery!.decisionId;
  // Representación guardada por los motores anteriores. Solo se construye en pruebas.
  const game = f.game() as ReturnType<typeof f.game> & { recovery?: unknown };
  delete game.recovery;
  if (round === 2) game.state = { ...game.state, roundTwo: { ...game.state.roundTwo!, movement: { status: "blocked", decisionId, error: "transport-vote-pending" } } };
  else game.state = { ...game.state, roundThreeRoute: { status: "blocked", requestId: decisionId, routeId: "fire-door", error: "transport-vote-pending" } };
  const before = game.state;
  f.manager.disconnect("s1"); f.manager.resume("restored", f.sessions[1]!.credential);
  expect(f.manager.suppliesSession("restored")!.windowId).not.toBeNull();
  expect(f.view().recovery).toMatchObject({ decisionId, forced: false });
  expect(f.manager.retryRoute("restored", { decisionId }).ok).toBe(true);
  expect(game.state.characters).toBe(before.characters); expect(game.state.inventory).toBe(before.inventory);
  expect(f.random).not.toHaveBeenCalled();
});

test("un bloqueo posterior al azar no admite recuperar la selección ni repetir la tirada", () => {
  const f = setup(3); f.random.mockReturnValue(Number.NaN); f.open(); f.vote("fire-door");
  const selection = f.manager.roundThreeView(f.code)!.selection!;
  expect(f.view().recovery).toBeUndefined();
  const before = f.game().state;
  expect(f.manager.retryRoute("s0", { decisionId: selection.decisionId })).toEqual({ ok: false, error: "route-not-recoverable" });
  expect(f.game().state).toBe(before); expect(f.random).toHaveBeenCalledTimes(1);
});
