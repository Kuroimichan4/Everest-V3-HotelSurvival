import { beforeFinalFixture } from "../../test-support/final-stage.js";
import { expect, test } from "vitest";
import { createInitialState, type SimulationState } from "./state.js";
import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo, resolveRoundTwo } from "./round-two.js";
import { resolveRoundThreeRoute } from "./round-three-routes.js";
import { beginRoundFour, decideRoundFourNpc, failRoundFourNpcVote, resolveRoundFourExit, type RoundFourState } from "./round-four.js";
import { buildFinalResult, finalizationStatus, npcResults, objectiveEvidence } from "./final-result.js";

const metadata = { id: "final", gameId: "game", closedAt: 1000, ventilationRevealed: false };
function people(state: SimulationState) { return state.characters.map(c => ({ characterId: c.id, participantId: `public-${c.id}`, name: `Persona ${c.role}` })); }
function result(state: SimulationState) { return buildFinalResult(state, people(state), metadata); }
function ready(roll = 0) {
  const first = resolveRoundOne(createInitialState(), "npc1", "RESCUE_APPROVED"); if (!first.ok) throw new Error(first.error);
  const second = resolveRoundTwo(beginRoundTwo(first.state), "npc2", "RESCUE_APPROVED"); if (!second.ok) throw new Error(second.error);
  const third = resolveRoundThreeRoute({ ...second.state, currentRound: 3, characters: second.state.characters.map(c => ({ ...c, energy: 100 })) }, "r3", "metal-debris", () => 0.99);
  if (!third.ok) throw new Error(third.error);
  const next = beginRoundFour(beforeFinalFixture(third.state), () => roll); if (!next.ok) throw new Error(next.error); return next.state;
}
function exit(state: RoundFourState) { const next = resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.99); if (!next.ok) throw new Error(next.error); return next.state; }

test("active, blocked and approved-but-incomplete games never get a final result", () => {
  expect(result(createInitialState())).toBe(null);
  const initial = ready(0.6); const decided = decideRoundFourNpc(initial, "npc4", "assist"); if (!decided.ok) throw new Error(decided.error);
  const state = { ...decided.state, characters: decided.state.characters.map(c => ({ ...c, energy: 0 })) };
  const moved = resolveRoundFourExit(state, "exit", "exterior-crack", () => 0.99);
  expect(moved.ok).toBe(false); expect(finalizationStatus(moved.state)).toBe("pending"); expect(result(moved.state)).toBe(null);
  expect(npcResults(moved.state)[2]).toMatchObject({ status: "approved", evacuated: null });
});

test("completed exit reports four evacuated humans without restoring resources", () => {
  const state = exit(ready()); const before = JSON.stringify(state); const final = result(state)!;
  expect(final.kind).toBe("evacuation-completed"); expect(final.counts).toMatchObject({ evacuated: 4, dead: 0, abandoned: 0 });
  expect(final.humans.every(p => p.status === "evacuated" && p.energy === 50)).toBe(true);
  expect(final.inventory).toEqual(state.inventory); expect(JSON.stringify(state)).toBe(before);
  expect(final.lastMovement).toMatchObject({ completed: true, accident: false });
});

test("death, abandonment and evacuation remain distinct", () => {
  const initial = ready();
  const state = exit({ ...initial, characters: initial.characters.map((c, i) => i === 0 ? { ...c, eliminated: true } : i === 1 ? { ...c, health: 0 } : c) });
  const final = result(state)!;
  expect(final.humans.map(p => p.status)).toEqual(["abandoned", "dead", "evacuated", "evacuated"]);
  expect(final.counts).toMatchObject({ evacuated: 2, dead: 1, abandoned: 1 });
});

test("no active humans is terminal at any round; final accident death takes precedence over evacuation", () => {
  const initial = createInitialState();
  const dead = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, health: i < 2 ? 0 : 100, eliminated: i >= 2 })) };
  expect(result(dead)).toMatchObject({ kind: "no-active-humans", counts: { evacuated: 0, dead: 2, abandoned: 2 } });
  const next = ready(); const single = { ...next, characters: next.characters.map((c, i) => ({ ...c, health: i === 0 ? 20 : 0 })) };
  const moved = resolveRoundFourExit(single, "exit", "exterior-crack", () => 0); if (!moved.ok) throw new Error(moved.error);
  const final = result(moved.state)!;
  expect(final).toMatchObject({ kind: "no-active-humans", counts: { evacuated: 0, dead: 4 }, lastMovement: { completed: true, accident: true } });
});

test.each([[0, "absent"], [0.6, "abandoned"], [0.9, "dead"]] as const)("NPC outcome %s/%s does not imply a rescue", (roll, status) => {
  let state = ready(roll);
  if (status === "abandoned") { const n = decideRoundFourNpc(state, "npc", "abandon"); if (!n.ok) throw new Error(n.error); state = n.state; }
  if (status === "dead") for (const attempt of [1, 2] as const) { const n = failRoundFourNpcVote(state, "npc", attempt); if (!n.ok) throw new Error(n.error); state = n.state; }
  const final = result(exit(state))!;
  expect(final.npcs[2]).toMatchObject({ status, evacuated: false });
  expect(final.counts.rescuedNpcs).toBe(2); expect(final.counts.evacuatedNpcs).toBe(2);
});

test("NPC rescues are unique by encounter; previous rescued companions evacuate with the group", () => {
  const initial = ready(0.9); const selected = decideRoundFourNpc(initial, "npc", "medical-assist"); if (!selected.ok) throw new Error(selected.error);
  const final = result(exit(selected.state))!;
  expect(final.npcs).toEqual([{ round: 1, status: "rescued", evacuated: true }, { round: 2, status: "rescued", evacuated: true }, { round: 6, status: "rescued", evacuated: true }]);
  expect(final.counts.rescuedNpcs).toBe(3); expect(final.counts.evacuatedNpcs).toBe(3);
  expect(new Set(final.npcs.map(n => n.round)).size).toBe(3);
});

test("objectives collect evidence without awarding success, points or exposing hidden ventilation risks", () => {
  const state = exit(ready()); const final = result(state)!;
  const maintenance = objectiveEvidence(state, final, "maintenance");
  expect(maintenance).toMatchObject({ evaluation: "pending-evaluation", evidenceState: "insufficient" });
  const medic = objectiveEvidence(state, final, "medic"); expect(medic.evidenceState).toBe("insufficient"); expect(medic.missing.join()).toContain("No constan pacientes");
  const architect = objectiveEvidence(state, final, "architect-engineer"); expect(architect.evidenceState).toBe("confirmed"); expect(architect.facts.join()).toContain("grieta exterior");
  expect(JSON.stringify(final)).not.toMatch(/objective|knowledge|sheet|accidentProbability|LOW|EXTREME|score|points/);
});

test("medical evidence deduplicates patients and distinguishes evacuation, death and unknown abandoned survival", () => {
  const state = exit(ready()); const final = result(state)!;
  const treated = { ...state, medicalTreatments: [{ round: 1 as const, characterId: "maintenance", healthRestored: 10 },
    { round: 2 as const, characterId: "maintenance", healthRestored: 20 }] };
  const evidence = objectiveEvidence(treated, final, "medic"); expect(evidence.facts).toHaveLength(1);
  expect(evidence).toMatchObject({ evidenceState: "confirmed", evaluation: "pending-evaluation" });
  expect(evidence.facts[0]).toContain("evacuación confirmada");
  const abandoned = { ...treated, characters: treated.characters.map(c => c.id === "maintenance" ? { ...c, eliminated: true } : c) };
  const abandonedFinal = result(abandoned)!;
  expect(objectiveEvidence(abandoned, abandonedFinal, "medic").evidenceState).toBe("insufficient");
});
