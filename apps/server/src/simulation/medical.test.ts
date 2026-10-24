import { expect, test } from "vitest";
import { administerTreatment, applyDamage } from "./operations.js";
import { createInitialState, type SimulationState } from "./state.js";
import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo } from "./round-two.js";

test.each([[50, 70], [85, 100], [99, 100]])("salud %i pasa a %i con una unidad y registro de recuperación real", (health, expected) => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => i === 0 ? { ...c, health } : c) };
  const snapshot = structuredClone(state);
  const result = administerTreatment(state, state.characters[0]!.id);
  expect(result.ok).toBe(true);
  expect(result.state.characters[0]!.health).toBe(expected);
  expect(result.state.characters[0]!.energy).toBe(100);
  expect(result.state.characters.slice(1)).toEqual(state.characters.slice(1));
  expect(result.state.inventory).toEqual({ packs: 8, medicalUnits: 3 });
  expect(result.state.medicalTreatments).toEqual([{ round: 1, characterId: state.characters[0]!.id, healthRestored: expected - health }]);
  expect(state).toEqual(snapshot);
  const woundedAgain = applyDamage(result.state, state.characters[0]!.id, 30).state;
  expect(administerTreatment(woundedAgain, state.characters[0]!.id)).toEqual({ ok: false, state: woundedAgain, error: "treatment-used" });
});

test("límite por destinatario y ronda, no global; historial conservado al avanzar", () => {
  const initial = createInitialState();
  let state: SimulationState = { ...initial, characters: initial.characters.map(c => ({ ...c, health: 50 })) };
  state = administerTreatment(state, state.characters[0]!.id).state;
  state = administerTreatment(state, state.characters[1]!.id).state;
  expect(state.inventory.medicalUnits).toBe(2);
  const first = resolveRoundOne(state, "first", "RESCUE_APPROVED");
  expect(first.ok).toBe(true);
  const second = beginRoundTwo(first.state);
  expect(second.medicalTreatments).toBe(state.medicalTreatments);
  expect(second.inventory.medicalUnits).toBe(2);
  const treated = administerTreatment(second, second.characters[0]!.id);
  expect(treated.ok).toBe(true);
  expect(treated.state.characters[0]!.health).toBe(90);
  expect(treated.state.medicalTreatments?.map(t => [t.round, t.characterId])).toEqual([[1, state.characters[0]!.id], [1, state.characters[1]!.id], [2, state.characters[0]!.id]]);
});

test.each(["character-not-found", "character-dead", "health-full-pending", "no-medical-units"])("rechazo %s conserva exactamente el estado original", error => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map(c => ({ ...c, health: error === "character-dead" ? 0 : error === "health-full-pending" ? 100 : 50 })),
    inventory: { ...initial.inventory, medicalUnits: error === "no-medical-units" ? 0 : 4 } };
  const snapshot = structuredClone(state);
  const result = administerTreatment(state, error === "character-not-found" ? "npc" : state.characters[0]!.id);
  expect(result).toEqual({ ok: false, state, error });
  expect(result.state).toBe(state);
  expect(state).toEqual(snapshot);
});
