import { afterEach, expect, test, vi } from "vitest";
import type { RoomReply } from "@everest/shared";
import type { SimulationState } from "../simulation/state.js";
import { RoomManager } from "./manager.js";
import type { VotingClock } from "./voting.js";

class Clock implements VotingClock {
  time = 1000;
  tasks = new Set<{ at: number; run: () => void }>();
  now = () => this.time;
  schedule = (run: () => void, delay: number) => {
    const task = { at: this.time + delay, run }; this.tasks.add(task); return () => { this.tasks.delete(task); };
  };
  advance(ms: number) { this.time += ms; for (const task of [...this.tasks]) if (task.at <= this.time) { this.tasks.delete(task); task.run(); } }
}
const managers: RoomManager[] = [];
afterEach(() => { managers.splice(0).forEach(m => m.dispose()); });
function value<T>(reply: RoomReply<T>): T { if (!reply.ok) throw new Error(reply.error); return reply.value; }

function setup(round: 1 | 2 | 3 = 3, energies = [0, 100, 100, 100], route = "fire-door", dead: number[] = [], rescue = "abandon") {
  const clock = new Clock(); const random = vi.fn(() => 0.99);
  const manager = new RoomManager(() => 0, clock, random); managers.push(manager);
  const first = value(manager.create("s0", "P0"));
  const sessions = [first, ...[1, 2, 3].map(i => value(manager.join(`s${i}`, `P${i}`, first.room.code)))];
  const code = first.room.code; manager.start("s0");
  const state = () => (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game.state;
  const change = (transform: (state: SimulationState) => SimulationState) => {
    (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game.state = transform(state());
  };
  const vote = (optionId: string, voters = [0, 1, 2]) => {
    const current = manager.publicVote(code)!;
    return voters.map(i => manager.vote(`s${i}`, { decisionId: current.decisionId, attemptId: current.attemptId, optionId }));
  };
  if (round > 1) { vote("abandon"); manager.advanceRound("s0"); }
  if (round === 3) { manager.routeAction("s0", "open"); vote("unstable-corridor"); vote("abandon"); manager.openTransport("s0", { preparationId: manager.transportView(code)!.cases.at(-1)!.preparationId }); manager.roundThreeAction("s0", "advance"); }
  const roles = [0, 1, 2, 3].map(i => manager.privateRole(`s${i}`)!.role);
  change(s => ({ ...s, characters: s.characters.map((c, i) => ({ ...c, energy: energies[i]!, health: dead.includes(i) ? 0 : c.health })) }));
  random.mockClear();
  if (round === 1) vote(rescue, [0, 1, 2, 3].filter(i => !dead.includes(i)).slice(0, Math.floor((4 - dead.length) / 2) + 1));
  else {
    const opened = round === 2 ? manager.routeAction("s0", "open") : manager.roundThreeAction("s0", "open");
    if (opened.ok) {
      const voters = [0, 1, 2, 3].filter(i => !dead.includes(i)).slice(0, Math.floor((4 - dead.length) / 2) + 1);
      vote(round === 2 ? "unstable-corridor" : route, voters);
      if (round === 2) {
        vote("abandon", voters);
        const prep = manager.transportView(code)!.cases.at(-1);
        if (prep && !prep.exhaustedIds.length) manager.openTransport("s0", { preparationId: prep.preparationId });
      }
    }
  }
  const view = () => manager.transportView(code)!.cases.at(-1)!;
  const supplies = () => manager.suppliesView(code)!;
  const open = (socket = "s1") => manager.openTransport(socket, { preparationId: view().preparationId });
  const id = (i: number) => sessions[i]!.credential.participantId;
  return { manager, clock, random, code, sessions, roles, state, change, vote, view, supplies, open, id };
}

test.each([1, 2, 3] as const)("ronda %i sin agotados sigue normal y no crea votación adicional", round => {
  const f = setup(round, [100, 100, 100, 100]);
  if (round === 1) expect(f.manager.transportView(f.code)).toEqual({ cases: [] });
  else expect(f.manager.transportView(f.code)!.cases.at(-1)).toMatchObject({ phase: "completed", decisions: [] });
  expect(f.supplies().windowId).not.toBeNull();
  expect(round === 1 ? f.manager.roundSummary(f.code)!.completed : round === 2 ? f.manager.roundTwoView(f.code)!.phase === "completed" : f.manager.roundThreeView(f.code)!.phase === "completed").toBe(true);
});

test.each([1, 2, 3] as const)("ronda %i conserva ruta, no cobra antes de votar y ejecuta transporte una vez", round => {
  const f = setup(round);
  expect(f.view()).toMatchObject({ phase: "preparation", exhaustedIds: [f.id(0)], decisions: [] });
  expect(f.supplies().characters.map(c => c.energy)).toEqual([0, 100, 100, 100]);
  expect(f.random).not.toHaveBeenCalled();
  const routeId = f.view().routeId;
  expect(f.open().ok).toBe(true);
  expect(f.view().vote!.requiredVotes).toBe(2);
  expect(f.view().eligibleIds).toEqual([f.id(1), f.id(2), f.id(3)]);
  expect(f.vote("carry-all", [0])[0]).toEqual({ ok: false, error: "not-authorized" });
  const current = f.view().vote!;
  expect(f.vote("carry-all", [1])[0]!.ok).toBe(true);
  expect(f.view().phase).toBe("voting");
  expect(f.vote("carry-all", [1])[0]!.ok).toBe(true);
  expect(f.view().vote!.status).toBe("open");
  expect(f.vote("carry-all", [2])[0]!.ok).toBe(true);
  const final = f.view(); const state = f.state(); const calls = f.random.mock.calls.length;
  expect(final).toMatchObject({ phase: "completed", routeId, transportedIds: [f.id(0)], abandonedIds: [] });
  expect(final.charges).toHaveLength(4);
  expect(final.charges[0]).toMatchObject({ kind: "transported", routeEnergy: 0, transportEnergy: 0 });
  expect(final.charges.slice(1).every(c => c.transportEnergy === 15 && c.routeEnergy === final.routeCost)).toBe(true);
  expect(f.supplies().characters.map(c => c.energy)).toEqual([0, ...[1, 2, 3].map(() => 100 - final.routeCost - 15)]);
  f.open();
  expect(f.manager.vote("s2", { decisionId: current.decisionId, attemptId: current.attemptId, optionId: "carry-all" }).ok).toBe(false);
  expect(f.state()).toBe(state); expect(f.random).toHaveBeenCalledTimes(calls);
});

test("packs en preparación recuperan energía y evitan la votación innecesaria", () => {
  const f = setup(3, [5, 100, 100, 100]); const pack = { requestId: crypto.randomUUID(), windowId: f.view().preparationId, targetParticipantId: f.id(0) };
  expect(f.manager.givePack("s2", pack).ok).toBe(true); // Botones en la asignación determinista.
  expect(f.view().exhaustedIds).toEqual([]);
  expect(f.open().ok).toBe(true);
  expect(f.view()).toMatchObject({ phase: "completed", vote: null, transportedIds: [], abandonedIds: [] });
  expect(f.supplies().characters[0]!.energy).toBe(0);
  expect(f.supplies().inventory.packs).toBe(7);
  expect(f.manager.givePack("s2", pack).ok).toBe(true);
  expect(f.supplies().inventory.packs).toBe(7);
});

test("durante la votación no cambia el plan mediante packs y se valida sesión, sala y campos", () => {
  const f = setup(); const other = setup();
  const preparationId = f.view().preparationId;
  expect(f.manager.openTransport("unknown", { preparationId })).toEqual({ ok: false, error: "invalid-session" });
  expect(f.manager.openTransport("s1", { preparationId, participantId: f.id(0) })).toEqual({ ok: false, error: "invalid-input" });
  expect(f.manager.openTransport("s1", { preparationId: other.view().preparationId })).toEqual({ ok: false, error: "wrong-preparation" });
  f.open();
  const before = f.state();
  expect(f.manager.givePack("s2", { requestId: crypto.randomUUID(), windowId: preparationId, targetParticipantId: f.id(0) })).toEqual({ ok: false, error: "supplies-not-open" });
  expect(f.manager.vote("unknown", { ...f.view().vote, optionId: "carry-all" })).toEqual({ ok: false, error: "invalid-session" });
  const vote = f.view().vote!;
  other.open();
  expect(other.manager.vote("s1", { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: "carry-all" })).toEqual({ ok: false, error: "wrong-decision" });
  expect(f.manager.vote("s1", { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: "carry-all", participantId: f.id(2) })).toEqual({ ok: false, error: "invalid-input" });
  expect(f.state()).toBe(before);
});

test.each(["carry-all", "leave-all", "carry-one"])("dos agotados: resultado %s", option => {
  const f = setup(3, [0, 0, 60, 60]); f.open("s2");
  expect(f.view().vote!.requiredVotes).toBe(2);
  expect(f.vote(option, [2])[0]!.ok).toBe(true);
  expect(f.vote(option, [3])[0]!.ok).toBe(true);
  if (option === "carry-one") {
    const initialDecision = f.view().decisions[0]!.vote.decisionId;
    expect(f.view()).toMatchObject({ phase: "selection", abandonedIds: [], transportedIds: [] });
    expect(f.state().characters.every(c => !c.eliminated)).toBe(true);
    expect(f.view().vote!.decisionId).not.toBe(initialDecision);
    expect(f.vote("person-1", [1])[0]).toEqual({ ok: false, error: "not-authorized" });
    f.vote("person-1", [2, 3]);
    expect(f.view().transportedIds).toEqual([f.id(1)]);
    expect(f.view().abandonedIds).toEqual([f.id(0)]);
    expect(f.supplies().characters.map(c => c.energy)).toEqual([0, 0, 15, 15]);
  } else {
    expect(f.view().transportedIds).toEqual(option === "carry-all" ? [f.id(0), f.id(1)] : []);
    expect(f.view().abandonedIds).toEqual(option === "leave-all" ? [f.id(0), f.id(1)] : []);
    expect(f.supplies().characters.slice(2).map(c => c.energy)).toEqual(option === "carry-all" ? [0, 0] : [30, 30]);
  }
  expect(f.view().phase).toBe("completed");
  expect(f.supplies().inventory).toEqual({ packs: 8, medicalUnits: 6 });
});

test("los que caminan pero no pueden portear no votan; planes impagables se rechazan", () => {
  const f = setup(3, [0, 0, 45, 30]); f.open("s2");
  expect(f.view().eligibleIds).toEqual([f.id(2)]);
  expect(f.view().options.find(o => o.id === "carry-all")!.viable).toBe(false);
  expect(f.vote("carry-all", [2])[0]).toEqual({ ok: false, error: "transport-plan-infeasible" });
  expect(f.vote("leave-all", [3])[0]).toEqual({ ok: false, error: "not-authorized" });
  expect(f.supplies().characters.map(c => c.energy)).toEqual([0, 0, 45, 30]);
  f.vote("carry-one", [2]); f.vote("person-0", [2]);
  expect(f.view().phase).toBe("completed");
  expect(f.supplies().characters.map(c => c.energy)).toEqual([0, 0, 0, 0]);
});

test.each(["transport", "recipient"])("60/30 segundos y desacuerdo seguro en etapa %s", stage => {
  const f = setup(3, [0, 0, 100, 100]); f.open("s2");
  if (stage === "recipient") f.vote("carry-one", [2, 3]);
  const original = f.state(); const first = f.view().vote!;
  expect(first.deadline - first.serverNow).toBe(60_000);
  f.clock.advance(60_000);
  const second = f.view().vote!;
  expect(second).toMatchObject({ attemptNumber: 2, requiredVotes: 2 });
  expect(second.deadline - second.serverNow).toBe(30_000);
  expect(f.manager.vote("s2", { decisionId: first.decisionId, attemptId: first.attemptId, optionId: "leave-all" })).toEqual({ ok: false, error: "wrong-attempt" });
  f.clock.advance(30_000);
  expect(f.view()).toMatchObject({ phase: "pending", reason: "transport-no-agreement", abandonedIds: [] });
  expect(f.state()).toBe(original); expect(f.random).not.toHaveBeenCalled();
  expect(f.supplies().windowId).toBeNull();
  f.open(); expect(f.state()).toBe(original);
});

test.each([
  { energies: [0, 0, 0, 100], dead: [], reason: "more-than-two-exhausted" },
  { energies: [0, 30, 30, 30], dead: [], reason: "no-eligible-carriers" },
  { energies: [0, 0, 0, 0], dead: [1, 2, 3], reason: "no-eligible-carriers" },
])("bloqueo seguro $reason sin abandono ni costes", ({ energies, dead, reason }) => {
  const f = setup(3, energies, "fire-door", dead); const before = f.state();
  expect(f.manager.transportView(f.code)!.cases.filter(c => c.round === 3)).toEqual([]);
  expect(f.manager.roundThreeView(f.code)!.options.every(o => o.availability.status === "unavailable")).toBe(true);
  expect(f.manager.roundThreeView(f.code)!.options[0]!.availability.reason).toBe(reason === "more-than-two-exhausted" ? reason : "route-energy-insufficient");
  expect(f.manager.roundThreeAction("s0", "open")).toEqual({ ok: false, error: "no-available-routes" });
  expect(f.state()).toBe(before); expect(f.random).not.toHaveBeenCalled();
});

test("muertos no votan y abandonados no se reactivan, reciben suministros ni conservan ficha", () => {
  const f = setup(3, [0, 100, 100, 100], "pipe-gallery", [3]);
  f.open();
  expect(f.vote("carry-all", [3])[0]).toEqual({ ok: false, error: "dead" });
  f.vote("leave-all", [1, 2]);
  expect(f.state().characters[0]).toMatchObject({ health: 100, eliminated: true });
  expect(f.manager.privateRole("s0")).toBeNull();
  expect(f.vote("carry-all", [0])[0]).toEqual({ ok: false, error: "dead" });
  const inventory = f.supplies().inventory;
  expect(f.manager.givePack("s2", { requestId: crypto.randomUUID(), windowId: f.supplies().windowId!, targetParticipantId: f.id(0) })).toEqual({ ok: false, error: "character-dead" });
  f.manager.disconnect("s0");
  expect(f.manager.resume("replacement", f.sessions[0]!.credential).ok).toBe(true);
  expect(f.manager.privateRole("replacement")).toBeNull();
  expect(f.manager.transportSession("replacement")).toEqual(f.manager.transportView(f.code));
  expect(f.supplies().inventory).toEqual(inventory);
});

test.each([0, 2])("abandonar especialista %i no inventa relevo ni pierde palanca o duplica recursos", specialist => {
  const energies = [100, 100, 100, 100]; energies[specialist] = 0;
  const f = setup(3, energies, "pipe-gallery");
  f.change(s => ({ ...s, characters: s.characters.map((c, i) => i === specialist ? { ...c, personalItems: [{ id: "personal-map", kind: "map" }] } : c) }));
  f.open(); f.vote("leave-all", [0, 1, 2, 3].filter(i => i !== specialist).slice(0, 2));
  expect(f.state().tools.crowbar).toBe("available");
  expect(f.state().inventory).toEqual({ packs: 8, medicalUnits: 4 });
  expect(f.state().sharedItems).toEqual([{ id: "personal-map", kind: "map" }]);
  expect(f.state().characters[specialist]!.personalItems).toEqual([]);
  expect(f.view().transfers).toEqual([{ participantId: f.id(specialist), items: [{ id: "personal-map", kind: "map" }] }]);
  f.open(); expect(f.state().sharedItems).toHaveLength(1);
  const active = [0, 1, 2, 3].find(i => i !== specialist)!;
  const targetParticipantId = f.id(active);
  const reply = specialist === 2 ? f.manager.givePack("s2", { requestId: crypto.randomUUID(), windowId: f.supplies().windowId!, targetParticipantId })
    : f.manager.treat("s0", { requestId: crypto.randomUUID(), gameId: f.supplies().gameId, round: 3, targetParticipantId });
  expect(reply).toEqual({ ok: false, error: specialist === 2 ? "bellhop-dead" : "medic-dead" });
  if (specialist === 2) expect(f.manager.treat("s0", { requestId: crypto.randomUUID(), gameId: f.supplies().gameId, round: 3, targetParticipantId: f.id(2) }))
    .toEqual({ ok: false, error: "character-dead" });
});

test("transportados participan en humo, accidente y muerte acumulada; abandonados quedan excluidos", () => {
  const f = setup(3, [0, 0, 100, 100], "pipe-gallery");
  f.change(s => ({ ...s, characters: s.characters.map((c, i) => ({ ...c, health: i === 1 ? 35 : 100 })) }));
  f.random.mockReturnValue(0); f.open("s2"); f.vote("carry-one", [2, 3]); f.vote("person-1", [2, 3]);
  expect(f.state().characters[0]).toMatchObject({ health: 100, energy: 0, eliminated: true });
  expect(f.state().characters[1]).toMatchObject({ health: 0, energy: 0 });
  const resolution = f.state().roundThreeRoute!;
  if (resolution.status !== "completed") throw new Error("Missing outcome");
  expect(resolution.outcome.victimIds).toContain(f.state().characters[1]!.id);
  expect(resolution.outcome.deceasedIds).toEqual([f.state().characters[1]!.id]);
  expect(f.random).toHaveBeenCalledTimes(3);
});

test("packs reducen dos agotados a uno antes de fijar opciones y electorado", () => {
  const f = setup(3, [0, 20, 100, 100]);
  expect(f.manager.givePack("s2", { requestId: crypto.randomUUID(), windowId: f.view().preparationId, targetParticipantId: f.id(1) }).ok).toBe(true);
  f.open();
  expect(f.view().exhaustedIds).toEqual([f.id(0)]);
  expect(f.view().eligibleIds).toEqual([f.id(1), f.id(2), f.id(3)]);
  expect(f.view().options.map(o => o.id)).toEqual(["carry-all", "leave-all"]);
  f.vote("carry-all", [1, 2]);
  expect(f.supplies().characters[1]!.energy).toBe(0);
});

test("F5 durante selección de destinatario conserva intento, voto y ningún abandono provisional", () => {
  const f = setup(3, [0, 0, 100, 100]); f.open("s2"); f.vote("carry-one", [2, 3]);
  const current = f.view().vote!; f.vote("person-0", [2]);
  f.manager.disconnect("s2");
  expect(f.manager.resume("replacement", f.sessions[2]!.credential).ok).toBe(true);
  const recovered = f.manager.votingSession("replacement")!;
  expect(recovered.public).toMatchObject({ decisionId: current.decisionId, attemptId: current.attemptId, deadline: current.deadline });
  expect(recovered.own.optionId).toBe("person-0");
  expect(f.state().characters.every(c => !c.eliminated)).toBe(true);
  f.vote("person-0", [3]);
  expect(f.view()).toMatchObject({ phase: "completed", transportedIds: [f.id(0)], abandonedIds: [f.id(1)] });
});

test("ronda 1 no vuelve a pagar el rescate ya aprobado al resolver transporte", () => {
  const f = setup(1, [30, 100, 100, 100], "fire-door", [], "rescue");
  expect(f.supplies().characters.map(c => c.energy)).toEqual([5, 75, 75, 75]);
  f.open(); f.vote("carry-all", [1, 2]);
  expect(f.supplies().characters.map(c => c.energy)).toEqual([5, 35, 35, 35]);
  expect(f.manager.roundSummary(f.code)).toMatchObject({ npc: "rescued", costs: { rescueEnergy: 25, movementEnergy: 25, damage: 0 } });
});

test("historial terminado no cambia con los packs ni al avanzar de ronda", () => {
  const f = setup(2); f.open(); f.vote("carry-all", [1, 2]);
  const history = f.manager.transportView(f.code)!;
  expect(f.manager.givePack("s2", { requestId: crypto.randomUUID(), windowId: f.supplies().windowId!, targetParticipantId: f.id(0) }).ok).toBe(true);
  expect(f.manager.roundThreeAction("s0", "advance").ok).toBe(true);
  expect(f.manager.transportView(f.code)).toEqual(history);
  const modified = f.manager.transportView(f.code)!; modified.cases[0]!.abandonedIds.push(f.id(3));
  expect(f.manager.transportView(f.code)).toEqual(history);
});

test("fallo de resolución no permite volver a tirar, y los abandonos válidos siguen definitivos", () => {
  const f = setup(3, [0, 100, 100, 100]);
  f.random.mockReturnValue(Number.NaN); f.open(); f.vote("leave-all", [1, 2]);
  expect(f.view()).toMatchObject({ phase: "blocked", reason: "invalid-random", abandonedIds: [f.id(0)], charges: [] });
  expect(f.supplies().characters.map(c => c.energy)).toEqual([0, 100, 100, 100]);
  expect(f.supplies().characters[0]!.eliminated).toBe(true);
  expect(f.supplies().inventory).toEqual({ packs: 8, medicalUnits: 4 });
  const state = f.state(); f.random.mockReturnValue(0.99); f.open();
  expect(f.state()).toBe(state); expect(f.random).toHaveBeenCalledTimes(1);
});

test("8C: dos planes viables tienen permisos distintos; +15 no autoriza votar el plan de +30", () => {
  const f = setup(3, [0, 0, 45, 60]); f.open("s2");
  const current = f.view();
  expect(current.eligibleIds).toEqual([f.id(2), f.id(3)]);
  expect(current.vote!.requiredVotes).toBe(2);
  expect(current.options.find(o => o.id === "carry-all")).toMatchObject({ viable: true, carrierCost: 60, carrierIds: [f.id(3)], authorizedVoterIds: [f.id(3)] });
  expect(current.options.find(o => o.id === "carry-one")).toMatchObject({ viable: true, carrierCost: 45, authorizedVoterIds: [f.id(2), f.id(3)] });
  const before = f.state();
  expect(f.vote("carry-all", [2])[0]).toEqual({ ok: false, error: "not-authorized-for-plan" });
  expect(f.state()).toBe(before);
  expect(f.view().decisions[0]!.outcome).toBeNull();
  f.vote("carry-one", [2, 3]); f.vote("person-1", [2, 3]);
  expect(f.view().phase).toBe("completed");
  expect(f.supplies().characters.map(c => c.energy)).toEqual([0, 0, 0, 15]);
});

test("8C: solo poder pagar uno no permite votar ni ejecutar el transporte de dos", () => {
  const f = setup(3, [0, 0, 59, 45]); f.open("s2");
  expect(f.view().options.find(o => o.id === "carry-all")).toMatchObject({ viable: false, carrierCost: 60, authorizedVoterIds: [] });
  const before = f.state();
  for (const i of [2, 3]) expect(f.vote("carry-all", [i])[0]).toEqual({ ok: false, error: "transport-plan-infeasible" });
  expect(f.state()).toBe(before); expect(f.random).not.toHaveBeenCalled();
  f.vote("carry-one", [2, 3]); f.vote("person-0", [2, 3]);
  expect(f.supplies().characters.map(c => c.energy)).toEqual([0, 0, 14, 0]);
});

test("10A: changing an open transport vote preserves authorization for each alternative", () => {
  const f = setup(3, [0, 0, 60, 45]); f.open("s2");
  expect(f.vote("leave-all", [3])[0]!.ok).toBe(true);
  expect(f.vote("carry-all", [3])[0]).toEqual({ ok: false, error: "not-authorized-for-plan" });
  expect(f.manager.votingSession("s3")!.own.optionId).toBe("leave-all");
  expect(f.vote("carry-one", [3])[0]!.ok).toBe(true);
  expect(f.view().phase).toBe("voting");
  expect(f.manager.votingSession("s3")!.own.optionId).toBe("carry-one");
  expect(f.vote("carry-one", [2])[0]!.ok).toBe(true);
  expect(f.view().phase).toBe("selection");
  f.vote("person-0", [2, 3]);
  expect(f.view().transportedIds).toEqual([f.id(0)]);
});
