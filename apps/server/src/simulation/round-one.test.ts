import { expect, test } from "vitest";
import { createInitialState } from "./state.js";
import { resolveRoundOne } from "./round-one.js";

test.each([
  ["RESCUE_APPROVED", 100, 60, "rescued", 25, false],
  ["ABANDON_APPROVED", 100, 85, "abandoned", 0, false],
  ["NO_AGREEMENT", 90, 85, "abandoned", 0, true],
] as const)("resuelve %s una sola vez sin consumir inventario", (outcome, health, energy, npc, rescueEnergy, microearthquake) => {
  const initial = createInitialState();
  const resolved = resolveRoundOne(initial, "decision", outcome);
  expect(resolved.ok).toBe(true);
  expect(resolved.state.characters.map((character) => [character.health, character.energy]))
    .toEqual(Array.from({ length: 4 }, () => [health, energy]));
  expect(resolved.state.roundOne).toEqual({ decisionId: "decision", result: outcome, npc,
    consequencesApplied: true, completed: true, microearthquake,
    costs: { rescueEnergy, movementEnergy: 15, damage: microearthquake ? 10 : 0 } });
  expect(resolved.state.inventory).toEqual({ packs: 8, medicalUnits: 4 });
  expect(initial).toEqual(createInitialState());
  expect(resolveRoundOne(resolved.state, "decision", outcome).state).toBe(resolved.state);
  expect(resolveRoundOne(resolved.state, "other", "NO_AGREEMENT").state).toBe(resolved.state);
});

test.each(["RESCUE_APPROVED", "ABANDON_APPROVED", "NO_AGREEMENT"] as const)("%s revierte todos los efectos si falta energía al último personaje", (outcome) => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((character, index) => ({ ...character, energy: index === 3 ? 14 : 100 })) };
  const snapshot = structuredClone(state);
  const resolved = resolveRoundOne(state, "decision", outcome);
  expect(resolved).toEqual({ ok: false, error: outcome === "RESCUE_APPROVED" ? "insufficient-energy" : "transport-vote-pending", state });
  expect(resolved.state).toBe(state);
  expect(state).toEqual(snapshot);
});
