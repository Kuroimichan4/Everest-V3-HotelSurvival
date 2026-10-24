import { afterEach, expect, test, vi } from "vitest";
import type { RoomReply } from "@everest/shared";
import type { SimulationState } from "../simulation/state.js";
import { RoomManager } from "./manager.js";
import type { VotingClock } from "./voting.js";

export class RoundFourTestClock implements VotingClock {
  time = 1000;
  tasks = new Map<number, { at: number; callback: () => void }>();
  serial = 0;
  now = () => this.time;
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.serial; this.tasks.set(id, { at: this.time + delay, callback });
    return () => { this.tasks.delete(id); };
  };
  advance(ms: number) {
    this.time += ms;
    for (const [id, task] of [...this.tasks]) if (task.at <= this.time) { this.tasks.delete(id); task.callback(); }
  }
}
const managers: RoomManager[] = [];
afterEach(() => { for (const m of managers.splice(0)) m.dispose(); });
function value<T>(r: RoomReply<T>): T { if (!r.ok) throw new Error(r.error); return r.value; }
function setup() {
  const clock = new RoundFourTestClock(); const random = vi.fn(() => 0.99);
  const manager = new RoomManager(() => 0, clock, random); managers.push(manager);
  const sessions = [value(manager.create("s0", "Host"))]; const code = sessions[0]!.room.code;
  for (let i = 1; i < 4; i++) sessions.push(value(manager.join(`s${i}`, `Persona ${i}`, code)));
  manager.start("s0");
  const cast = (i: number, optionId: string) => {
    const v = manager.publicVote(code)!;
    return manager.vote(`s${i}`, { decisionId: v.decisionId, attemptId: v.attemptId, optionId });
  };
  const vote = (id: string, voters = [0, 1, 2]) => { for (const i of voters) expect(cast(i, id).ok).toBe(true); };
  const game = () => (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game;
  const setState = (f: (s: SimulationState) => SimulationState) => { game().state = f(game().state); };
  const role = (name: string) => [0, 1, 2, 3].find(i => manager.privateRole(`s${i}`)?.role === name)!;
  const pack = (i: number) => manager.givePack(`s${role("bellhop")}`, { requestId: crypto.randomUUID(), windowId: manager.suppliesView(code)!.windowId!, targetParticipantId: sessions[i]!.credential.participantId });
  const roundThree = () => {
    vote("abandon"); manager.advanceRound("s0"); vote("abandon"); manager.routeAction("s0", "open"); vote("unstable-corridor");
    manager.roundThreeAction("s0", "advance"); manager.roundThreeAction("s0", "open"); vote("metal-debris");
    // Suministros reales de preparación: dos packs a cada humano (15 -> 65).
    for (let i = 0; i < 4; i++) { expect(pack(i).ok).toBe(true); expect(pack(i).ok).toBe(true); }
  };
  const begin = (roll = 0) => { random.mockReturnValue(roll); const r = manager.roundFourAction("s0", "advance"); random.mockReturnValue(0.99); expect(r.ok).toBe(true); };
  return { manager, clock, random, sessions, code, cast, vote, game, setState, role, pack, roundThree, begin };
}

test("host-only transition, prior completion required, identities and resources preserved, no reroll", () => {
  const f = setup();
  expect(f.manager.roundFourAction("s0", "advance")).toMatchObject({ ok: false, error: "round-four-not-ready" });
  f.roundThree(); const before = f.manager.suppliesView(f.code)!;
  const roles = [0, 1, 2, 3].map(i => f.manager.privateRole(`s${i}`));
  expect(f.manager.roundFourAction("s1", "advance")).toMatchObject({ ok: false, error: "not-creator" });
  f.begin();
  expect(f.manager.suppliesView(f.code)).toMatchObject({ round: 4, characters: before.characters, inventory: before.inventory });
  expect([0, 1, 2, 3].map(i => f.manager.privateRole(`s${i}`))).toEqual(roles);
  expect(f.manager.roundFourView(f.code)).toMatchObject({ phase: "preparation", npc: { encounter: "none", vote: null } });
  const calls = f.random.mock.calls.length;
  expect(f.manager.roundFourAction("s0", "advance").ok).toBe(true);
  expect(f.random).toHaveBeenCalledTimes(calls);
  expect(f.manager.roundThreeAction("s0", "open")).toMatchObject({ ok: false, error: "round-not-ready" });
});

test.each([[0.6, "assist", 25, 0], [0.9, "carry", 40, 0], [0.9, "medical-assist", 25, 1]] as const)("NPC %s/%s: authenticated majority, pending rescue, atomic costs", (roll, choice, cost, units) => {
  const f = setup(); f.roundThree(); f.begin(roll);
  const before = f.manager.suppliesView(f.code)!;
  expect(f.manager.roundFourView(f.code)!.phase).toBe("npc-voting");
  expect(f.manager.publicVote(f.code)).toMatchObject({ round: 4, requiredVotes: 3, attemptNumber: 1, deadline: f.clock.now() + 60000 });
  expect(f.manager.roundFourAction("s0", "open")).toMatchObject({ ok: false, error: "npc-decision-pending" });
  f.cast(0, choice); f.cast(1, choice);
  expect(f.manager.roundFourView(f.code)!.npc.status).toBe("awaiting-decision");
  expect(f.cast(2, choice).ok).toBe(true);
  expect(f.manager.roundFourView(f.code)!.npc.status).toBe("awaiting-effort");
  expect(f.manager.suppliesView(f.code)!.inventory).toEqual(before.inventory);
  expect(f.manager.suppliesView(f.code)!.characters).toEqual(before.characters);
  expect(f.manager.roundFourAction("s0", "open").ok).toBe(true); f.vote("exterior-crack");
  const done = f.manager.roundFourView(f.code)!;
  expect(done).toMatchObject({ phase: "completed", npc: { status: "rescued" }, movement: { rescuedNpc: true, accident: false } });
  expect(done.movement!.characters.map(c => c.energy)).toEqual([65 - cost - 10, 65 - cost - 10, 65 - cost - 10, 65 - cost - 10]);
  expect(done.movement!.inventory.medicalUnits).toBe(before.inventory.medicalUnits - units);
  const calls = f.random.mock.calls.length;
  f.manager.roundFourAction("s0", "advance"); f.manager.roundFourAction("s0", "open");
  expect(f.manager.roundFourAction("s0", "retry", { preparationId: done.preparationId }).ok).toBe(true);
  expect(f.manager.roundFourView(f.code)).toEqual(done);
  expect(f.random).toHaveBeenCalledTimes(calls);
});

test("NPC medical option requires stock, no extra medical voting; human specialists retain permissions", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, inventory: { ...s.inventory, medicalUnits: 0 } })); f.begin(0.9);
  expect(f.manager.roundFourView(f.code)!.npc.options.find(o => o.id === "medical-assist")!.available).toBe(false);
  expect(f.cast(0, "medical-assist")).toMatchObject({ ok: false, error: "invalid-option" });
  f.vote("abandon");
  const bellhop = f.role("bellhop"); const medic = f.role("medic");
  const supplies = f.manager.suppliesView(f.code)!;
  expect(f.manager.givePack(`s${medic}`, { requestId: "pack", windowId: supplies.windowId!, targetParticipantId: f.sessions[0]!.credential.participantId })).toMatchObject({ ok: false, error: "not-authorized" });
  const treatment = { requestId: "treat", gameId: supplies.gameId, round: 4 as const, targetParticipantId: f.sessions[0]!.credential.participantId };
  expect(f.manager.treat(`s${bellhop}`, treatment)).toMatchObject({ ok: false, error: "not-authorized" });
  f.setState(s => ({ ...s, inventory: { ...s.inventory, medicalUnits: 2 }, characters: s.characters.map(c => ({ ...c, health: 80 })) }));
  expect(f.manager.treat(`s${medic}`, treatment).ok).toBe(true);
  expect(f.manager.treat(`s${medic}`, treatment).ok).toBe(true);
  expect(f.manager.medicalView(f.code)!.treatments.filter(t => t.round === 4)).toHaveLength(1);
  expect(f.pack(0).ok).toBe(true);
  expect(f.manager.roundFourAction("s0", "open").ok).toBe(true);
  expect(f.manager.treat(`s${medic}`, { ...treatment, requestId: "during-vote" })).toMatchObject({ ok: false, error: "supplies-not-open" });
});

test("NPC attempts last 60/30, exact message, death; exit decision stays independent", () => {
  const f = setup(); f.roundThree(); f.begin(0.6); const before = f.manager.suppliesView(f.code)!;
  const id = f.manager.publicVote(f.code)!.decisionId;
  f.clock.advance(60000);
  expect(f.manager.publicVote(f.code)).toMatchObject({ decisionId: id, attemptNumber: 2, deadline: f.clock.now() + 30000 });
  expect(f.manager.roundFourView(f.code)!.npc.message).toBe("El superviviente parece debilitarse a cada segundo que pasa");
  f.clock.advance(30000);
  expect(f.manager.roundFourView(f.code)).toMatchObject({ phase: "preparation", npc: { status: "dead" }, surcharge: 0, collapse: null });
  expect(f.manager.suppliesView(f.code)!.characters).toEqual(before.characters);
  expect(f.manager.suppliesView(f.code)!.inventory).toEqual(before.inventory);
  f.manager.roundFourAction("s0", "open");
  expect(f.manager.publicVote(f.code)!.decisionId).not.toBe(id);
  f.vote("revolving-door");
  expect(f.manager.roundFourView(f.code)!.movement!.rescuedNpc).toBe(false);
});

test("pack and medical receipts can be recovered after evacuation without new expenses", () => {
  const f = setup(); f.roundThree(); f.begin();
  f.setState(s => ({ ...s, characters: s.characters.map(c => ({ ...c, health: 80 })) }));
  const supplies = f.manager.suppliesView(f.code)!;
  const treatment = { requestId: "pending-medical", gameId: supplies.gameId, round: 4 as const, targetParticipantId: f.sessions[0]!.credential.participantId };
  const pack = { requestId: "pending-pack", windowId: supplies.windowId!, targetParticipantId: f.sessions[0]!.credential.participantId };
  const medic = `s${f.role("medic")}`; const bellhop = `s${f.role("bellhop")}`;
  expect(f.manager.treat(medic, treatment).ok).toBe(true);
  expect(f.manager.givePack(bellhop, pack).ok).toBe(true);
  f.manager.roundFourAction("s0", "open"); f.vote("exterior-crack");
  const before = f.manager.suppliesView(f.code); const activity = f.manager.activityView(f.code);
  expect(f.manager.treat(medic, treatment).ok).toBe(true);
  expect(f.manager.givePack(bellhop, pack).ok).toBe(true);
  expect(f.manager.treat(medic, { ...treatment, requestId: "new-after-exit" })).toMatchObject({ ok: false, error: "supplies-not-open" });
  expect(f.manager.suppliesView(f.code)).toEqual(before);
  expect(f.manager.activityView(f.code)).toEqual(activity);
});

test("route first failure applies collapse once before retry, updates costs, second forces crack", () => {
  const f = setup(); f.roundThree(); f.begin(); f.manager.roundFourAction("s0", "open");
  f.clock.advance(60000);
  expect(f.manager.publicVote(f.code)).toMatchObject({ attemptNumber: 2, deadline: f.clock.now() + 30000, requiredVotes: 3 });
  expect(f.manager.roundFourView(f.code)!.options.map(o => o.energyCost)).toEqual([25, 15]);
  expect(f.manager.suppliesView(f.code)!.characters.map(c => c.health)).toEqual([95, 95, 95, 95]);
  f.clock.advance(30000);
  const done = f.manager.roundFourView(f.code)!;
  expect(done).toMatchObject({ phase: "completed", forced: true, surcharge: 5, movement: { routeId: "exterior-crack", energyCost: 15 } });
  expect(done.movement!.characters.map(c => c.health)).toEqual([95, 95, 95, 95]);
  expect(done.movement!.characters.map(c => c.energy)).toEqual([50, 50, 50, 50]);
  f.manager.votingSession("s0"); f.clock.advance(90000);
  expect(f.manager.roundFourView(f.code)).toEqual({ ...done, vote: { ...done.vote!, serverNow: f.clock.now() } });
});

test("collapse deaths are excluded from new electorate and lost private sheets; strict majority recalculated", () => {
  const f = setup(); f.roundThree();
  f.setState(s => ({ ...s, characters: s.characters.map((c, i) => ({ ...c, health: i > 1 ? 5 : 100 })) }));
  f.begin(); f.manager.roundFourAction("s0", "open"); f.clock.advance(60000);
  expect(f.manager.publicVote(f.code)!.requiredVotes).toBe(2);
  expect(f.manager.privateRole("s2")).toBe(null);
  expect(f.cast(2, "exterior-crack")).toMatchObject({ ok: false, error: "dead" });
  f.vote("exterior-crack", [0, 1]);
  expect(f.manager.roundFourView(f.code)!.movement!.escapedHumanIds).toHaveLength(2);
});

test("all die in collapse: no invalid new vote, no automatic defeat or forced movement", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, characters: s.characters.map(c => ({ ...c, health: 5 })) }));
  f.begin(); f.manager.roundFourAction("s0", "open"); f.clock.advance(60000);
  expect(f.manager.roundFourView(f.code)).toMatchObject({ phase: "blocked", blocked: "no-living-characters", movement: null });
  expect(f.manager.publicVote(f.code)!.status).toBe("closed");
  f.manager.votingSession("s0");
  expect(f.clock.tasks.size).toBe(0);
});

test("crowbar loss inherited from actual round three blocks door, crack remains valid", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, tools: { crowbar: "lost" } })); f.begin();
  expect(f.manager.roundFourView(f.code)!.options[0]!.availability).toMatchObject({ status: "unavailable", reason: "crowbar-unavailable" });
  f.manager.roundFourAction("s0", "open");
  expect(f.cast(0, "revolving-door")).toMatchObject({ ok: false, error: "invalid-option" });
  f.vote("exterior-crack"); expect(f.manager.activityView(f.code)!.tools.crowbar).toBe("lost");
});

test.each([["revolving-door", 5], ["exterior-crack", 30]] as const)("%s accident executes once and may kill humans", (route, damage) => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, characters: s.characters.map(c => ({ ...c, health: damage })) }));
  f.begin(); f.manager.roundFourAction("s0", "open"); f.random.mockReturnValue(0); f.vote(route);
  const result = f.manager.roundFourView(f.code)!;
  expect(result.movement!.victims).toHaveLength(2);
  expect(result.movement!.deceasedIds).toHaveLength(2);
  expect(new Set(result.movement!.victims.map(v => v.participantId)).size).toBe(2);
  const calls = f.random.mock.calls.length;
  f.manager.roundFourSession("s0"); f.manager.votingSession("s0");
  expect(f.random).toHaveBeenCalledTimes(calls);
});

test("combined NPC effort and human transport use residual budget and charge atomically", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, characters: s.characters.map((c, i) => ({ ...c, energy: i === 0 ? 30 : 70 })) }));
  f.begin(0.6); f.vote("assist"); f.manager.roundFourAction("s0", "open"); f.vote("exterior-crack");
  expect(f.manager.roundFourView(f.code)!.npc.status).toBe("awaiting-effort");
  const transport = f.manager.transportView(f.code)!.cases.at(-1)!;
  expect(transport.round).toBe(4); expect(transport.exhaustedIds).toEqual([f.sessions[0]!.credential.participantId]);
  expect(f.manager.openTransport("s1", { preparationId: transport.preparationId }).ok).toBe(true);
  expect(f.cast(0, "carry-all")).toMatchObject({ ok: false, error: "not-authorized" });
  f.vote("carry-all", [1, 2]);
  const result = f.manager.roundFourView(f.code)!;
  expect(result).toMatchObject({ phase: "completed", npc: { status: "rescued" } });
  expect(result.movement!.characters.map(c => c.energy)).toEqual([5, 20, 20, 20]);
});

test("two exhausted humans retain per-alternative authorization and explicit recipient/abandonment", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, characters: s.characters.map((c, i) => ({ ...c, energy: [5, 5, 100, 25][i]! })) }));
  f.begin(); f.manager.roundFourAction("s0", "open"); f.vote("exterior-crack");
  const t = f.manager.transportView(f.code)!.cases.at(-1)!;
  f.manager.openTransport("s0", { preparationId: t.preparationId });
  expect(f.cast(3, "carry-all")).toMatchObject({ ok: false, error: "not-authorized-for-plan" });
  f.vote("carry-one", [2, 3]);
  expect(f.manager.transportView(f.code)!.cases.at(-1)!.phase).toBe("selection");
  f.vote("person-0", [2, 3]);
  const result = f.manager.roundFourView(f.code)!;
  expect(result.phase).toBe("completed");
  expect(result.movement!.characters.map(c => c.energy)).toEqual([5, 5, 75, 0]);
  expect(result.movement!.characters[1]!.eliminated).toBe(true);
  expect(result.movement!.escapedHumanIds).not.toContain(f.sessions[1]!.credential.participantId);
});

test("failed accident source cannot commit proposed human abandonment or reroll on reconnect", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, characters: s.characters.map((c, i) => ({ ...c, energy: i === 0 ? 5 : 100,
    personalItems: [{ id: `item-${i}`, kind: "key" }] })) }));
  f.begin(); f.manager.roundFourAction("s0", "open"); f.vote("exterior-crack");
  const t = f.manager.transportView(f.code)!.cases.at(-1)!;
  const before = JSON.stringify(f.game().state.characters);
  f.manager.openTransport("s0", { preparationId: t.preparationId }); f.random.mockReturnValue(NaN);
  f.vote("leave-all", [1, 2]);
  expect(f.manager.roundFourView(f.code)).toMatchObject({ phase: "blocked", blocked: "invalid-random", movement: null });
  expect(JSON.stringify(f.game().state.characters)).toBe(before);
  expect(f.game().state.sharedItems).toBeUndefined();
  expect(f.manager.transportView(f.code)!.cases.at(-1)!.abandonedIds).toEqual([]);
  const calls = f.random.mock.calls.length;
  f.manager.roundFourAction("s0", "retry", { preparationId: f.manager.roundFourView(f.code)!.preparationId });
  f.manager.roundFourSession("s0"); expect(f.random).toHaveBeenCalledTimes(calls);
  expect(f.manager.roundFourView(f.code)).toMatchObject({ phase: "blocked", blocked: "invalid-random" });
});

test("definitively eliminated humans cannot vote or act, active majority ignores them", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, characters: s.characters.map((c, i) => ({ ...c, eliminated: i === 3 })) }));
  f.begin(0.6);
  expect(f.manager.publicVote(f.code)!.requiredVotes).toBe(2);
  expect(f.cast(3, "assist")).toMatchObject({ ok: false, error: "dead" });
  expect(f.manager.roundFourAction("s3", "open")).toMatchObject({ ok: false, error: "not-authorized" });
  expect(f.manager.privateRole("s3")).toBe(null);
});

test("infeasible approved rescue stays pending; packs restore viability, no partial medical spending", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, characters: s.characters.map(c => ({ ...c, energy: 30 })) }));
  f.begin(0.9); f.vote("medical-assist"); const before = f.manager.suppliesView(f.code)!;
  expect(f.manager.roundFourAction("s0", "open")).toMatchObject({ ok: false, error: "no-available-routes" });
  expect(f.manager.roundFourView(f.code)!.npc.status).toBe("awaiting-effort");
  expect(f.manager.suppliesView(f.code)!.inventory).toEqual(before.inventory);
  for (let i = 0; i < 4; i++) expect(f.pack(i).ok).toBe(true);
  f.manager.roundFourAction("s0", "open"); f.vote("exterior-crack");
  expect(f.manager.roundFourView(f.code)!.phase).toBe("completed");
  expect(f.manager.suppliesView(f.code)!.inventory.medicalUnits).toBe(before.inventory.medicalUnits - 1);
});

test("forced infeasible crack remains pending, retry preserves selection and collapse", () => {
  const f = setup(); f.roundThree(); f.setState(s => ({ ...s, characters: s.characters.map(c => ({ ...c, energy: 10 })) }));
  f.begin(); f.manager.roundFourAction("s0", "open"); f.clock.advance(60000); f.clock.advance(30000);
  const blocked = f.manager.roundFourView(f.code)!;
  expect(blocked).toMatchObject({ phase: "blocked", forced: true, movement: null });
  expect(blocked.selection!.outcome).toBe("NO_AGREEMENT");
  for (let i = 0; i < 4; i++) expect(f.pack(i).ok).toBe(true);
  expect(f.manager.roundFourAction("s0", "retry", { preparationId: blocked.preparationId }).ok).toBe(true);
  expect(f.manager.roundFourView(f.code)).toMatchObject({ phase: "completed", forced: true, movement: { routeId: "exterior-crack", energyCost: 15 } });
  expect(f.manager.suppliesView(f.code)!.characters.map(c => c.health)).toEqual([95, 95, 95, 95]);
});

test("reconnect preserves encounter, votes, deadline, decision and result; no private or hidden payload fields", () => {
  const f = setup(); f.roundThree(); f.begin(0.9); f.cast(0, "carry");
  const vote = f.manager.publicVote(f.code)!; const before = f.manager.roundFourView(f.code)!;
  f.manager.disconnect("s0"); value(f.manager.resume("new", f.sessions[0]!.credential));
  expect(f.manager.votingSession("new")!.own.optionId).toBe("carry");
  expect(f.manager.publicVote(f.code)!.deadline).toBe(vote.deadline);
  expect(f.manager.roundFourSession("new")).toEqual(before);
  expect(f.manager.vote("s0", { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: "carry" })).toMatchObject({ ok: false, error: "invalid-session" });
  f.cast(1, "carry"); f.cast(2, "carry");
  expect(f.manager.roundFourAction("new", "open").ok).toBe(true);
  const v = f.manager.publicVote(f.code)!;
  expect(f.manager.vote("new", { decisionId: v.decisionId, attemptId: v.attemptId, optionId: "exterior-crack", participantId: f.sessions[1]!.credential.participantId })).toMatchObject({ ok: false, error: "invalid-input" });
  for (const socket of ["new", "s1", "s2"]) expect(f.manager.vote(socket, { decisionId: v.decisionId, attemptId: v.attemptId, optionId: "exterior-crack" }).ok).toBe(true);
  const done = f.manager.roundFourView(f.code)!; const calls = f.random.mock.calls.length;
  f.manager.disconnect("new"); value(f.manager.resume("again", f.sessions[0]!.credential));
  expect(f.manager.roundFourSession("again")).toEqual(done);
  expect(f.random).toHaveBeenCalledTimes(calls);
  const json = JSON.stringify(done);
  expect(json).not.toMatch(/token|role|sheet|knowledge|personalItems|accidentProbability|danger|EXTREME|LOW/);
});
