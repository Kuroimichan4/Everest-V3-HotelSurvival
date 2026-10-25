import { expect, test } from "vitest";
import { createInitialState, type SimulationState } from "./state.js";
import type { GameFinalResult } from "@everest/shared";
import { collectObjectiveLedger, assessObjective, projectObjectiveEvidence, recordMaintenanceRevelation, type EvidenceContext } from "./objective-evidence.js";
import { buildFinalResult } from "./final-result.js";
import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo, resolveRoundTwo } from "./round-two.js";
import { resolveRoundTwoMovement } from "./round-two-movement.js";
import { resolveRoundThreeChoice } from "./round-three.js";
import { beginRoundFour, decideRoundFourNpc, resolveRoundFourExit, type RoundFourState } from "./round-four.js";

function setup() {
  const one = resolveRoundOne(createInitialState(), "one", "ABANDON_APPROVED"); if (!one.ok) throw new Error(one.error);
  const two = resolveRoundTwo(beginRoundTwo(one.state), "two", "ABANDON_APPROVED"); if (!two.ok) throw new Error(two.error);
  const moved = resolveRoundTwoMovement(two.state, { decisionId: "route2", outcome: "ventilation", ventilationRevealed: true }, () => 0.99); if (!moved.ok) throw new Error(moved.error);
  const three = resolveRoundThreeChoice({ ...moved.state, currentRound: 3, characters: moved.state.characters.map(c => ({ ...c, energy: 100 })) },
    { decisionId: "route3", outcome: "NO_AGREEMENT" }, () => 0.99); if (!three.ok) throw new Error(three.error);
  const four = beginRoundFour(three.state, () => 0); if (!four.ok) throw new Error(four.error);
  return four.state;
}
function exit(state: RoundFourState) { const r = resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.99); if (!r.ok) throw new Error(r.error); return r.state; }
function result(state: SimulationState) {
  const people = state.characters.map(c => ({ characterId: c.id, participantId: `p-${c.id}`, name: c.role }));
  const r = buildFinalResult(state, people, { id: "result", gameId: "game", closedAt: 1, ventilationRevealed: true });
  if (!r) throw new Error("not terminal"); return r;
}
function treatmentContext(): EvidenceContext { return { treatments: [
  { requestId: "t1", round: 1, patientId: "p-maintenance", administratorId: "p-medic" },
  { requestId: "t2", round: 2, patientId: "p-maintenance", administratorId: "p-medic" }], roundThreeForced: true }; }

test("10A: revelation records author, round, original privacy and server time without opening or traversing", () => {
  const state = { ...createInitialState(), currentRound: 2 as const };
  const route = { id: "ventilation", round: 2 as const, initiallyPrivate: true };
  const revealed = recordMaintenanceRevelation(state, route, "maintenance", 12345);
  expect(revealed.routeRevelations).toEqual([{ routeId: "ventilation", round: 2, characterId: "maintenance", initiallyUnknownToOthers: true, sharedAt: 12345 }]);
  expect(revealed.characters).toBe(state.characters); expect(revealed.inventory).toBe(state.inventory);
  expect(revealed.roundTwo).toBeUndefined();
  expect(recordMaintenanceRevelation(revealed, route, "maintenance", 99999)).toBe(revealed);
});

test.each(["public", "wrong-author", "wrong-round", "dead", "invalid-time"])("10A: %s revelation cannot count", invalid => {
  const initial = { ...createInitialState(), currentRound: 2 as const };
  const state = invalid === "dead" ? { ...initial, characters: initial.characters.map(c => c.id === "maintenance" ? { ...c, health: 0 } : c) } : initial;
  const route = { id: "test-route", round: invalid === "wrong-round" ? 3 as const : 2 as const, initiallyPrivate: invalid !== "public" };
  expect(recordMaintenanceRevelation(state, route, invalid === "wrong-author" ? "medic" : "maintenance", invalid === "invalid-time" ? NaN : 1000)).toBe(state);
});

test("10A: ledger counts distinct authenticated private revelations, never known public routes or traversal", () => {
  const state = exit(setup()); const final = result(state);
  const first = { routeId: "ventilation", round: 2 as const, characterId: "maintenance", initiallyUnknownToOthers: true, sharedAt: 1000 };
  const registered = { ...state, routeRevelations: [first, { ...first, sharedAt: 2000 },
    { ...first, routeId: "unstable-corridor", initiallyUnknownToOthers: false },
    { ...first, routeId: "forged-author", characterId: "medic" }] };
  const ledger = collectObjectiveLedger(registered, final);
  expect(ledger.maintenance.revelations).toEqual([first]);
  expect(assessObjective("maintenance", "p-maintenance", ledger)).toBe("pending-evaluation");
  const knownOnly = collectObjectiveLedger(state, final);
  expect(knownOnly.maintenance.revelations).toEqual([]);
  // A fixture record proves future evidence support without adding a playable route.
  const two = { ...registered, routeRevelations: [first, { ...first, routeId: "test-only-second-route", round: 4 as const, sharedAt: 3000 }] };
  const complete = collectObjectiveLedger(two, final);
  expect(complete.maintenance.openings).toEqual([]);
  expect(assessObjective("maintenance", "p-maintenance", complete)).toBe("fulfilled");
  expect(projectObjectiveEvidence(two, final, "maintenance", complete).facts.join(" ")).toContain("2");
  expect(assessObjective("maintenance", "p-maintenance", { ...ledger, maintenance: { ...ledger.maintenance, revelations: [first, first] } })).toBe("pending-evaluation");
});

test("patients are unique, treatments retain round, authenticated author and request; repeats do not duplicate", () => {
  const state = exit(setup());
  const t = { round: 1 as const, characterId: "maintenance", healthRestored: 20 };
  const treated = { ...state, medicalTreatments: [t, t, { ...t, round: 2 as const }] };
  const ledger = collectObjectiveLedger(treated, result(treated), treatmentContext());
  expect(ledger.gameId).toBe("game"); expect(ledger.patients).toHaveLength(1);
  expect(ledger.patients[0]!.treatments).toEqual([
    { round: 1, restored: 20, requestId: "t1", administratorId: "p-medic" },
    { round: 2, restored: 20, requestId: "t2", administratorId: "p-medic" }]);
  expect(ledger.patients[0]).toMatchObject({ evacuated: true, abandoned: false, diedAfterTreatment: false });
  expect(assessObjective("medic", "p-medic", ledger)).toBe("fulfilled");
});

test.each(["dead", "abandoned"] as const)("treated patient %s keeps its actual outcome", status => {
  const initial = setup();
  const state = exit({ ...initial, medicalTreatments: [{ round: 1, characterId: "maintenance", healthRestored: 20 }],
    characters: initial.characters.map(c => c.id === "maintenance" ? { ...c, health: status === "dead" ? 0 : c.health, eliminated: status === "abandoned" } : c) });
  const ledger = collectObjectiveLedger(state, result(state), treatmentContext());
  expect(ledger.patients[0]).toMatchObject({ diedAfterTreatment: status === "dead", abandoned: status === "abandoned", evacuated: false });
  expect(assessObjective("medic", "p-medic", ledger)).toBe(status === "dead" ? "unfulfilled" : "pending-evaluation");
});

test("absence of patients and missing historical attribution never award the medical objective", () => {
  const initial = exit(setup()); const noPatients = collectObjectiveLedger(initial, result(initial));
  expect(assessObjective("medic", "p-medic", noPatients)).toBe("pending-evaluation");
  const treated = { ...initial, medicalTreatments: [{ round: 1 as const, characterId: "maintenance", healthRestored: 20 }] };
  const unknown = collectObjectiveLedger(treated, result(treated));
  expect(unknown.patients[0]!.treatments[0]!.administratorId).toBe(null);
  expect(assessObjective("medic", "p-medic", unknown)).toBe("pending-evaluation");
  const context = { treatments: [{ requestId: "other", round: 1, patientId: "p-maintenance", administratorId: "other-doctor" }] };
  expect(assessObjective("medic", "p-medic", collectObjectiveLedger(treated, result(treated), context))).toBe("pending-evaluation");
});

test("known/revealed/traversed routes are never retroactively credited as openings", () => {
  const state = exit(setup()); const ledger = collectObjectiveLedger(state, result(state), { ventilationRevealedBy: "maintenance" });
  expect(ledger.maintenance.knownRoutes).toContain("ventilation");
  expect(ledger.maintenance.revelations).toEqual([{ routeId: "ventilation", characterId: "maintenance" }]);
  expect(ledger.routes.some(r => r.routeId === "ventilation")).toBe(true); expect(ledger.maintenance.openings).toEqual([]);
  expect(assessObjective("maintenance", "p-maintenance", ledger)).toBe("pending-evaluation");
  expect(collectObjectiveLedger(state, result(state), { ventilationRevealed: true }).maintenance.revelations[0]!.characterId).toBe(null);
});

test("risk is read from real backend catalogues, including forced completed routes; never from a vote alone", () => {
  const state = exit(setup()); const ledger = collectObjectiveLedger(state, result(state), { roundThreeForced: true });
  expect(ledger.routes).toHaveLength(4);
  expect(ledger.routes[1]).toMatchObject({ routeId: "ventilation", realRisk: "LOW", completed: true, forcedByNoAgreement: false });
  expect(ledger.routes[2]).toMatchObject({ routeId: "pipe-gallery", realRisk: "EXTREME", forcedByNoAgreement: true });
  expect(assessObjective("architect-engineer", "p-architect-engineer", ledger)).toBe("unfulfilled");
  const blocked = { ...state, roundThreeRoute: { status: "blocked" as const, routeId: "pipe-gallery" as const, requestId: "never-completed", error: "insufficient-energy" as const } };
  const blockedLedger = collectObjectiveLedger(blocked, result(blocked), { roundThreeForced: true });
  expect(blockedLedger.routes.some(r => r.resolutionId === "never-completed")).toBe(false);
  const withoutExit = { ...state, roundFour: { ...state.roundFour, exit: undefined } };
  // Un voto/elección no se introduce como desplazamiento; la función solo lee registros completados.
  const { exit: _exit, ...rest } = withoutExit.roundFour;
  const pendingState = { ...state, roundFour: rest };
  expect(collectObjectiveLedger(pendingState, result(state)).routes.some(r => r.round === 4)).toBe(false);
});

test("round one has no declared category: no accident is not evidence of low risk", () => {
  const state = exit(setup()); const ledger = collectObjectiveLedger(state, result(state));
  expect(ledger.routes[0]!.realRisk).toBe(null);
  const noExtreme = { ...ledger, routes: ledger.routes.filter(r => r.realRisk !== "EXTREME") };
  expect(assessObjective("architect-engineer", "p-architect-engineer", noExtreme)).toBe("pending-evaluation");
});

test("NPC evidence is individual, unique and preserves approved, rescued and unconfirmed evacuation", () => {
  const initial = setup();
  const state: RoundFourState = { ...initial, roundOne: { ...initial.roundOne!, result: "RESCUE_APPROVED", npc: "rescued" },
    roundTwo: { ...initial.roundTwo!, resolution: { ...initial.roundTwo!.resolution!, result: "RESCUE_APPROVED", npc: "rescued" } },
    roundFour: { ...initial.roundFour, npc: { encounter: "immobile", status: "awaiting-effort", decision: { id: "npc4", choice: "medical-assist" }, failedAttempts: 0 } } };
  const dummy: GameFinalResult = { ...result(exit(setup())), npcs: [{ round: 1, status: "rescued", evacuated: null }, { round: 2, status: "rescued", evacuated: null }, { round: 4, status: "approved", evacuated: null }] };
  const ledger = collectObjectiveLedger(state, dummy);
  expect(ledger.npcs.map(n => n.id)).toEqual(["round-one-survivor", "round-two-survivor", "round-four-survivor"]);
  expect(ledger.npcs[0]).toMatchObject({ found: true, rescueApproved: true, rescued: true, evacuated: null });
  expect(ledger.npcs[2]).toMatchObject({ rescueApproved: true, rescued: false, medicalUnitsUsed: 0 });
  expect(assessObjective("bellhop", "p-bellhop", ledger)).toBe("pending-evaluation");
  expect(assessObjective("bellhop", "p-bellhop", { ...ledger, npcs: ledger.npcs.map(n => ({ ...n, rescueApproved: true, rescued: false })) })).toBe("pending-evaluation");
  expect(collectObjectiveLedger(state, dummy)).toEqual(ledger);
});

test("NPC medical effort remains separate from human treatments", () => {
  const state = setup(); const initial = { ...state, roundFour: { ...state.roundFour, npc: { encounter: "immobile" as const, status: "awaiting-decision" as const, failedAttempts: 0 as const } } };
  const chosen = decideRoundFourNpc(initial, "npc4", "medical-assist"); if (!chosen.ok) throw new Error(chosen.error);
  const final = exit(chosen.state); const ledger = collectObjectiveLedger(final, result(final));
  expect(ledger.patients).toEqual([]); expect(ledger.npcs[2]).toMatchObject({ rescued: true, evacuated: true, medicalUnitsUsed: 1 });
});

test("private projections never expose the internal ledger or ventilation risk", () => {
  const state = exit(setup()); const final = result(state); const ledger = collectObjectiveLedger(state, final, { roundThreeForced: true });
  for (const human of state.characters) {
    const own = projectObjectiveEvidence(state, final, human.id, ledger);
    expect(own.participantId).toBe(`p-${human.id}`); expect(own.gameId).toBe("game");
    expect(JSON.stringify(own)).not.toMatch(/realRisk|LOW|accidentProbability|administratorId|openingRecordsComplete/);
  }
  expect(JSON.stringify(final)).not.toMatch(/realRisk|LOW|objective|patients/);
});
