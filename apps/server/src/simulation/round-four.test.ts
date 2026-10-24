import { describe, expect, it, vi } from "vitest";
import { createInitialState, isAlive, type SimulationState } from "./state.js";
import { resolveRoundThreeRoute } from "./round-three-routes.js";
import { administerTreatment, consumePack } from "./operations.js";
import { abandonCharacters } from "./abandonment.js";
import { beginRoundFour, decideRoundFourNpc, failRoundFourExitVote, failRoundFourNpcVote,
  generateRoundFourEncounter, NPC_WEAKENING_MESSAGE, resolveRoundFourExit, ROUND_FOUR_ROUTES,
  ROUND_FOUR_VOTE_SECONDS, roundFourRouteAvailability, type RoundFourResult, type RoundFourState } from "./round-four.js";

function unwrap(result: RoundFourResult): RoundFourState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function previous(): SimulationState {
  const result = resolveRoundThreeRoute({ ...createInitialState(), currentRound: 3 }, "r3", "metal-debris", () => 0.9);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function start(roll = 0): RoundFourState {
  const result = beginRoundFour(previous(), () => roll);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function withEnergy(state: RoundFourState, energy: number): RoundFourState {
  return { ...state, characters: state.characters.map(c => ({ ...c, energy })) };
}
const firstFailure = (state: RoundFourState) => unwrap(failRoundFourExitVote(state, "exit-vote", 1));
const bothFailures = (state: RoundFourState) => unwrap(failRoundFourExitVote(firstFailure(state), "exit-vote", 2));

describe("round four: encounter and state continuity", () => {
  it.each([[0, "none"], [0.499999, "none"], [0.5, "walking-assisted"], [0.749999, "walking-assisted"],
    [0.75, "immobile"], [0.999999, "immobile"]] as const)("boundary %s -> %s", (roll, encounter) => {
    expect(generateRoundFourEncounter(() => roll)).toBe(encounter);
  });
  it("partitions a deterministic uniform source into 50/25/25", () => {
    const counts = { none: 0, "walking-assisted": 0, immobile: 0 };
    for (let i = 0; i < 100; i++) counts[generateRoundFourEncounter(() => (i + 0.5) / 100)!]++;
    expect(counts).toEqual({ none: 50, "walking-assisted": 25, immobile: 25 });
  });
  it.each([-1, 1, NaN, Infinity])("rejects invalid encounter randomness %s", value => {
    const original = previous();
    expect(beginRoundFour(original, () => value)).toEqual({ ok: false, state: original, error: "invalid-random" });
  });
  it("generates once, including after serialized reconnection, and isolates games", () => {
    const state = start(0.8);
    const random = vi.fn(() => 0);
    const restored = JSON.parse(JSON.stringify(state)) as RoundFourState;
    expect(beginRoundFour(restored, random)).toEqual({ ok: true, state: restored });
    expect(random).not.toHaveBeenCalled();
    expect(start().roundFour.npc.encounter).toBe("none");
    expect(state.roundFour.npc.encounter).toBe("immobile");
  });
  it("requires round three completed and at least one active human", () => {
    const random = vi.fn(() => 0);
    expect(beginRoundFour(createInitialState(), random).ok).toBe(false);
    const state = previous();
    expect(beginRoundFour({ ...state, characters: state.characters.map(c => ({ ...c, health: 0 })) }, random)).toMatchObject({ ok: false, error: "no-living-characters" });
    expect(random).not.toHaveBeenCalled();
  });
  it("preserves inventory, individual items, past treatments and tools without duplication", () => {
    const original = previous();
    const before: SimulationState = { ...original, tools: { crowbar: "lost" }, sharedItems: [{ id: "s", kind: "key" }],
      medicalTreatments: [{ round: 3, characterId: "medic", healthRestored: 20 }],
      characters: original.characters.map(c => ({ ...c, personalItems: [{ id: c.id, kind: "phone" }] })) };
    const result = beginRoundFour(before, () => 0);
    expect(result.ok).toBe(true);
    expect(result.state.inventory).toBe(before.inventory);
    expect(result.state.characters).toBe(before.characters);
    expect(result.state.tools).toBe(before.tools);
    expect(result.state.medicalTreatments).toBe(before.medicalTreatments);
    expect(result.state.sharedItems).toBe(before.sharedItems);
  });
});

describe("exit catalogue, availability and accidents", () => {
  it("retains exact internal definitions and two vote durations", () => {
    expect(ROUND_FOUR_ROUTES["revolving-door"]).toMatchObject({ energyCost: 20, danger: "LOW", accidentProbability: 0.1, accidentDamage: 5 });
    expect(ROUND_FOUR_ROUTES["exterior-crack"]).toMatchObject({ energyCost: 10, danger: "EXTREME", accidentProbability: 0.5, accidentDamage: 30 });
    expect(ROUND_FOUR_VOTE_SECONDS).toEqual([60, 30]);
  });
  it("requires the existing crowbar only for the door and never recreates it", () => {
    const available = start();
    expect(roundFourRouteAvailability(available).map(r => r.availability.status)).toEqual(["available", "available"]);
    const lost: RoundFourState = { ...available, tools: { crowbar: "lost" } };
    expect(roundFourRouteAvailability(lost)[0]!.availability).toEqual({ status: "unavailable", reason: "crowbar-unavailable" });
    const random = vi.fn(() => 0.9);
    expect(resolveRoundFourExit(lost, "exit", "revolving-door", random)).toEqual({ ok: false, state: lost, error: "crowbar-unavailable" });
    expect(random).not.toHaveBeenCalled();
    expect(unwrap(resolveRoundFourExit(lost, "exit", "exterior-crack", random)).tools.crowbar).toBe("lost");
  });
  it.each([["revolving-door", 20], ["exterior-crack", 10]] as const)("charges exactly %s = %s", (id, cost) => {
    const state = withEnergy(start(), 100);
    const next = unwrap(resolveRoundFourExit(state, "exit", id, () => 0.99));
    expect(next.characters.map(c => c.energy)).toEqual([100 - cost, 100 - cost, 100 - cost, 100 - cost]);
    expect(next.tools).toBe(state.tools);
  });
  it.each([["revolving-door", 0.0999, 5], ["exterior-crack", 0.4999, 30]] as const)("%s accident damages two distinct living humans", (id, roll, damage) => {
    const state = start();
    const samples = [roll, 0, 0];
    const next = unwrap(resolveRoundFourExit(state, "exit", id, () => samples.shift()!));
    const outcome = next.roundFour.exit!;
    expect(new Set(outcome.victimIds).size).toBe(2);
    expect(next.characters.map(c => c.health)).toEqual([100 - damage, 100 - damage, 100, 100]);
    expect(outcome.damage.filter(d => d.total === damage)).toHaveLength(2);
  });
  it.each([["revolving-door", 0.1], ["exterior-crack", 0.5]] as const)("%s excludes its probability boundary", (id, roll) => {
    const random = vi.fn(() => roll);
    const state = unwrap(resolveRoundFourExit(start(), "exit", id, random));
    expect(state.roundFour.exit!.accident).toBe(false);
    expect(random).toHaveBeenCalledTimes(1);
  });
  it("damages a sole survivor once, excludes dead and eliminated humans", () => {
    const original = start();
    const state = { ...original, characters: original.characters.map((c, i) => ({ ...c, health: i === 1 ? 0 : 100, eliminated: i > 1 })) };
    const next = unwrap(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0));
    expect(next.roundFour.exit!.victimIds).toEqual(["maintenance"]);
    expect(next.characters.map(c => c.health)).toEqual([70, 0, 100, 100]);
    expect(next.roundFour.exit!.charges).toHaveLength(1);
  });
  it("records deaths after accumulated collapse and accident, health never below zero", () => {
    const initial = start();
    const state = firstFailure({ ...initial, characters: initial.characters.map(c => ({ ...c, health: 33 })) });
    const next = unwrap(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0));
    expect(next.characters.map(c => c.health)).toEqual([0, 0, 28, 28]);
    expect(next.roundFour.exit!.deceasedIds).toEqual(["maintenance", "medic"]);
    expect(next.roundFour.exit!.escapedHumanIds).toEqual(["architect-engineer", "bellhop"]);
  });
  it("projects no real probability or classification in availability", () => {
    const json = JSON.stringify(roundFourRouteAvailability(start()));
    expect(json).not.toMatch(/accident|Probability|LOW|EXTREME|danger/);
  });
});

describe("independent NPC decisions and atomic rescue effort", () => {
  it("absent NPC creates no rescue decision", () => {
    const state = start();
    expect(state.roundFour.npc.status).toBe("absent");
    expect(decideRoundFourNpc(state, "npc", "abandon")).toMatchObject({ ok: false, error: "npc-absent" });
    expect(failRoundFourNpcVote(state, "npc", 1)).toMatchObject({ ok: false, error: "npc-absent" });
    expect(resolveRoundFourExit(state, "exit", "revolving-door", () => 0.9).ok).toBe(true);
  });
  it.each([[0.6, "assist", 25, 0], [0.9, "carry", 40, 0], [0.9, "medical-assist", 25, 1]] as const)("rescue %s/%s costs %s and %s units", (roll, choice, cost, units) => {
    const state = withEnergy(start(roll), 100);
    const decided = unwrap(decideRoundFourNpc(state, "npc", choice));
    expect(decided.characters).toBe(state.characters);
    expect(decided.inventory).toBe(state.inventory);
    expect(decided.roundFour.npc.status).toBe("awaiting-effort");
    const next = unwrap(resolveRoundFourExit(decided, "exit", "exterior-crack", () => 0.9));
    expect(next.characters.map(c => c.energy)).toEqual(Array(4).fill(100 - cost - 10));
    expect(next.inventory.medicalUnits).toBe(state.inventory.medicalUnits - units);
    expect(next.roundFour.npc.status).toBe("rescued");
    expect(next.roundFour.npc.rescue).toMatchObject({ energyPerHuman: cost, medicalUnits: units });
    expect(next.roundFour.exit!.rescuedNpc).toBe(true);
    expect(next.medicalTreatments).toBe(state.medicalTreatments);
  });
  it("abandoning costs no rescue energy and never counts as rescued", () => {
    const state = unwrap(decideRoundFourNpc(withEnergy(start(0.8), 100), "npc", "abandon"));
    const next = unwrap(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.9));
    expect(next.characters.map(c => c.energy)).toEqual([90, 90, 90, 90]);
    expect(next.roundFour.exit!.rescuedNpc).toBe(false);
  });
  it("rejects unavailable medicine at decision and again at commitment without partial costs", () => {
    const original = start(0.9);
    const empty = { ...original, inventory: { ...original.inventory, medicalUnits: 0 } };
    expect(decideRoundFourNpc(empty, "npc", "medical-assist")).toEqual({ ok: false, state: empty, error: "no-medical-units" });
    const decided = unwrap(decideRoundFourNpc(original, "npc", "medical-assist"));
    const noUnits = { ...decided, inventory: empty.inventory };
    expect(resolveRoundFourExit(noUnits, "exit", "exterior-crack", () => 0.9)).toEqual({ ok: false, state: noUnits, error: "no-medical-units" });
  });
  it.each([[0.6, "carry"], [0.6, "medical-assist"], [0.9, "assist"]] as const)("rejects invalid rescue method %s/%s", (roll, choice) => {
    expect(decideRoundFourNpc(start(roll), "npc", choice)).toMatchObject({ ok: false, error: "invalid-npc-choice" });
  });
  it("retains exact weakening message; second failure kills NPC with no third attempt or collapse", () => {
    const state = start(0.6);
    const first = unwrap(failRoundFourNpcVote(state, "npc", 1));
    expect(first.roundFour.npc.message).toBe("El superviviente parece debilitarse a cada segundo que pasa");
    expect(first.roundFour.npc.message).toBe(NPC_WEAKENING_MESSAGE);
    const second = unwrap(failRoundFourNpcVote(first, "npc", 2));
    expect(second.roundFour.npc.status).toBe("dead");
    expect(second.characters).toBe(state.characters);
    expect(second.roundFour.energySurcharge).toBe(0);
    expect(second.roundFour.revolvingDoorBlocked).toBe(false);
    expect(decideRoundFourNpc(second, "npc", "assist")).toMatchObject({ ok: false, error: "npc-decision-closed" });
    expect(failRoundFourNpcVote(second, "npc", 3 as 2)).toMatchObject({ ok: false });
    expect(resolveRoundFourExit(second, "exit", "revolving-door", () => 0.9).ok).toBe(true);
    expect(failRoundFourNpcVote(second, "npc", 2)).toEqual({ ok: true, state: second });
  });
  it("rejects exit until the NPC has a decision; exit failure leaves NPC decision intact", () => {
    const state = start(0.8);
    expect(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.9)).toMatchObject({ ok: false, error: "npc-decision-pending" });
    const chosen = unwrap(decideRoundFourNpc(state, "npc", "carry"));
    expect(firstFailure(chosen).roundFour.npc).toBe(chosen.roundFour.npc);
  });
  it("requires ordered attempts and binds NPC vote identity", () => {
    const state = start(0.6);
    expect(failRoundFourNpcVote(state, "npc", 2)).toMatchObject({ ok: false, error: "invalid-attempt" });
    const first = unwrap(failRoundFourNpcVote(state, "npc", 1));
    expect(failRoundFourNpcVote(first, "other", 2)).toMatchObject({ ok: false, error: "decision-conflict" });
    expect(decideRoundFourNpc(first, "other", "assist")).toMatchObject({ ok: false, error: "decision-conflict" });
    expect(decideRoundFourNpc(first, "npc", "assist").ok).toBe(true);
  });
});

describe("route non-consensus consequences", () => {
  it("first failure damages each active human once and adds five energy to each route", () => {
    const initial = start();
    const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, health: i === 1 ? 0 : 100, eliminated: i === 2 })) };
    const next = firstFailure(state);
    expect(next.characters.map(c => c.health)).toEqual([95, 0, 100, 95]);
    expect(next.roundFour.collapse!.affectedIds).toEqual(["maintenance", "bellhop"]);
    expect(roundFourRouteAvailability(next).map(r => r.energyCost)).toEqual([25, 15]);
    expect(next.roundFour.forcedRoute).toBe(null);
    expect(firstFailure(next)).toBe(next);
    expect(next.tools).toBe(state.tools);
  });
  it("second failure forces crack costing 15, keeps risk and never repeats damage", () => {
    const first = firstFailure(withEnergy(start(), 100));
    const second = unwrap(failRoundFourExitVote(first, "exit-vote", 2));
    expect(second.characters).toBe(first.characters);
    expect(second.roundFour.revolvingDoorBlocked).toBe(true);
    expect(second.roundFour.forcedRoute).toBe("exterior-crack");
    expect(resolveRoundFourExit(second, "exit", "revolving-door", () => 0.9)).toMatchObject({ ok: false, error: "forced-route-required" });
    const next = unwrap(resolveRoundFourExit(second, "exit", "exterior-crack", () => 0));
    expect(next.characters.map(c => c.energy)).toEqual([85, 85, 85, 85]);
    expect(next.characters.map(c => c.health)).toEqual([65, 65, 95, 95]);
    expect(next.roundFour.exit).toMatchObject({ energyCost: 15, forced: true, accident: true });
    expect(failRoundFourExitVote(next, "exit-vote", 2)).toEqual({ ok: true, state: next });
  });
  it("preserves first collapse deaths and blocks final exit when all died", () => {
    const initial = start();
    const state = firstFailure({ ...initial, characters: initial.characters.map(c => ({ ...c, health: 5 })) });
    expect(state.roundFour.collapse!.deceasedIds).toHaveLength(4);
    expect(state.characters.some(isAlive)).toBe(false);
    expect(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0)).toMatchObject({ ok: false, error: "no-living-characters" });
  });
  it("cannot skip first failure or change the route vote id", () => {
    const state = start();
    expect(failRoundFourExitVote(state, "exit", 2)).toMatchObject({ ok: false, error: "invalid-attempt" });
    expect(failRoundFourExitVote(firstFailure(state), "other", 2)).toMatchObject({ ok: false, error: "decision-conflict" });
  });
});

describe("atomicity, transport, resources and replay", () => {
  it("blocks combined rescue and movement without spending medicine, energy or randomness", () => {
    const state = unwrap(decideRoundFourNpc(withEnergy(start(0.9), 30), "npc", "medical-assist"));
    const random = vi.fn(() => 0.9);
    const before = JSON.stringify(state);
    expect(resolveRoundFourExit(state, "exit", "exterior-crack", random)).toEqual({ ok: false, state, error: "combined-effort-pending" });
    expect(JSON.stringify(state)).toBe(before);
    expect(random).not.toHaveBeenCalled();
  });
  it("rolls back rescue if even one participant cannot pay", () => {
    const chosen = unwrap(decideRoundFourNpc(withEnergy(start(0.9), 100), "npc", "carry"));
    const state = { ...chosen, characters: chosen.characters.map((c, i) => ({ ...c, energy: i === 3 ? 39 : 100 })) };
    expect(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.9)).toEqual({ ok: false, state, error: "insufficient-energy" });
  });
  it("reuses human transport: route plus 15 per carried human, no NPC cost confusion", () => {
    const initial = withEnergy(start(), 100);
    const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, energy: i === 0 ? 5 : 100 })) };
    const plan = { carrierIds: ["medic", "bellhop"], transportedIds: ["maintenance"] };
    const next = unwrap(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.9, plan));
    expect(next.characters.map(c => c.energy)).toEqual([5, 75, 90, 75]);
    expect(next.roundFour.exit!.charges.map(c => c.energyCost)).toEqual([0, 25, 10, 25]);
  });
  it("blocks NPC plus human transport if combined budget is not feasible", () => {
    const initial = unwrap(decideRoundFourNpc(withEnergy(start(0.6), 50), "npc", "assist"));
    const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, energy: i === 0 ? 30 : 50 })) };
    const plan = { carrierIds: ["medic"], transportedIds: ["maintenance"] };
    // Door: 25 rescue + 20 movement + 15 carrier effort > 50.
    expect(resolveRoundFourExit(state, "exit", "revolving-door", () => 0.9, plan)).toEqual({ ok: false, state, error: "combined-effort-pending" });
  });
  it("combines NPC and human transport only with an explicit feasible plan", () => {
    const initial = unwrap(decideRoundFourNpc(withEnergy(start(0.6), 70), "npc", "assist"));
    const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, energy: i === 0 ? 30 : 70 })) };
    const next = unwrap(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.9,
      { carrierIds: ["medic"], transportedIds: ["maintenance"] }));
    expect(next.characters.map(c => c.energy)).toEqual([5, 20, 35, 35]);
    expect(next.roundFour.npc.rescue!.energyPerHuman).toBe(25);
    expect(next.roundFour.exit!.charges.map(c => c.energyCost)).toEqual([0, 25, 10, 10]);
  });
  it("permits exactly zero energy after all confirmed efforts", () => {
    const state = unwrap(decideRoundFourNpc(withEnergy(start(0.6), 35), "npc", "assist"));
    const next = unwrap(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.9));
    expect(next.characters.every(c => c.energy === 0 && isAlive(c))).toBe(true);
  });
  it("records only one accident/rescue/medical consumption across serialized replay", () => {
    const initial = unwrap(decideRoundFourNpc(withEnergy(start(0.9), 100), "npc", "medical-assist"));
    const next = unwrap(resolveRoundFourExit(initial, "exit", "exterior-crack", () => 0));
    const restored = JSON.parse(JSON.stringify(next)) as RoundFourState;
    const random = vi.fn(() => 0.99);
    expect(resolveRoundFourExit(restored, "exit", "exterior-crack", random)).toEqual({ ok: true, state: restored });
    expect(random).not.toHaveBeenCalled();
    expect(decideRoundFourNpc(restored, "npc", "medical-assist")).toEqual({ ok: true, state: restored });
    expect(decideRoundFourNpc(restored, "npc", "carry")).toMatchObject({ ok: false, error: "decision-conflict" });
    expect(resolveRoundFourExit(restored, "other", "exterior-crack", random)).toMatchObject({ ok: false, error: "exit-already-resolved" });
    expect(resolveRoundFourExit(restored, "exit", "revolving-door", random)).toMatchObject({ ok: false, error: "exit-already-resolved" });
  });
  it("replay cannot change the transport plan", () => {
    const state = unwrap(resolveRoundFourExit(start(), "exit", "exterior-crack", () => 0.9));
    expect(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.9,
      { carrierIds: ["medic"], transportedIds: [] })).toMatchObject({ ok: false, error: "exit-already-resolved" });
  });
  it("invalid accident randomness rolls back all costs and locks further rolls", () => {
    const state = unwrap(decideRoundFourNpc(start(0.9), "npc", "medical-assist"));
    const sequence = [0, 0, NaN];
    const result = resolveRoundFourExit(state, "exit", "exterior-crack", () => sequence.shift()!);
    expect(result.ok).toBe(false);
    expect(result.state.characters).toBe(state.characters);
    expect(result.state.inventory).toBe(state.inventory);
    expect(result.state.roundFour.npc).toBe(state.roundFour.npc);
    const random = vi.fn(() => 0);
    expect(resolveRoundFourExit(result.state, "exit", "exterior-crack", random)).toMatchObject({ ok: false, error: "invalid-random" });
    expect(random).not.toHaveBeenCalled();
  });
  it("forced exit exhaustion blocks without automatic defeat or abandonment; packs permit retry", () => {
    const state = bothFailures(withEnergy(start(), 5));
    const random = vi.fn(() => 0.9);
    expect(resolveRoundFourExit(state, "exit", "exterior-crack", random)).toEqual({ ok: false, state, error: "transport-vote-pending" });
    expect(random).not.toHaveBeenCalled();
    let prepared = state;
    for (const c of state.characters) {
      const packed = consumePack(prepared, c.id);
      if (!packed.ok) throw new Error(packed.error);
      prepared = packed.state;
    }
    expect(resolveRoundFourExit(prepared, "exit", "exterior-crack", random).ok).toBe(true);
    expect(state.characters.every(c => !c.eliminated)).toBe(true);
  });
  it("human medical limit resets in round four; NPC medicine does not consume it", () => {
    const initial = start(0.9);
    const state = { ...initial, medicalTreatments: [{ round: 3 as const, characterId: "medic", healthRestored: 20 }],
      characters: initial.characters.map(c => ({ ...c, health: 75, energy: 100 })) };
    const treated = administerTreatment(state, "medic");
    if (!treated.ok) throw new Error(treated.error);
    expect(treated.state.characters[1]!.health).toBe(95);
    expect(administerTreatment(treated.state, "medic")).toMatchObject({ ok: false, error: "treatment-used" });
    const chosen = unwrap(decideRoundFourNpc(treated.state, "npc", "medical-assist"));
    const next = unwrap(resolveRoundFourExit(chosen, "exit", "exterior-crack", () => 0.9));
    expect(next.inventory.medicalUnits).toBe(state.inventory.medicalUnits - 2);
    expect(next.medicalTreatments).toEqual(treated.state.medicalTreatments);
    expect(administerTreatment(next, "maintenance").ok).toBe(true);
  });
  it("preserves elimination and item transfer without including abandoned characters in exit", () => {
    const state = abandonCharacters(start(), ["maintenance"]).state;
    const next = unwrap(resolveRoundFourExit(state, "exit", "exterior-crack", () => 0));
    expect(next.roundFour.exit!.charges.map(c => c.characterId)).not.toContain("maintenance");
    expect(next.roundFour.exit!.victimIds).not.toContain("maintenance");
    expect(next.characters[0]).toBe(state.characters[0]);
  });
  it("rejects blank identifiers without mutations", () => {
    const state = start(0.9);
    for (const result of [decideRoundFourNpc(state, " ", "carry"), failRoundFourNpcVote(state, "", 1),
      failRoundFourExitVote(state, "", 1), resolveRoundFourExit(state, "", "exterior-crack", () => 0)]) {
      expect(result).toEqual({ ok: false, state, error: "invalid-request" });
    }
  });
});
