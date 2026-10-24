import { expect, test } from "vitest";
import { createInitialState, type SimulationState } from "./state.js";
import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo, resolveRoundTwo } from "./round-two.js";

function previous(result: "RESCUE_APPROVED" | "ABANDON_APPROVED" | "NO_AGREEMENT") {
  const resolved = resolveRoundOne(createInitialState(), "first", result);
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.state;
}

test.each(["RESCUE_APPROVED", "ABANDON_APPROVED", "NO_AGREEMENT"] as const)("transición conserva todo el estado de ronda 1: %s", result => {
  const first = previous(result);
  const second = beginRoundTwo(first);
  expect(second.currentRound).toBe(2);
  expect(second.characters).toBe(first.characters);
  expect(second.inventory).toBe(first.inventory);
  expect(second.roundOne).toBe(first.roundOne);
  expect(second.roundTwo).toEqual({ npcId: "round-two-survivor", resolution: null, blocked: null });
  expect(beginRoundTwo(second)).toBe(second);
  expect(beginRoundTwo(createInitialState()).currentRound).toBe(1);
});

test.each(["RESCUE_APPROVED", "ABANDON_APPROVED", "NO_AGREEMENT"] as const)("consecuencias atómicas y únicas: %s", result => {
  const state = beginRoundTwo(previous("RESCUE_APPROVED"));
  const resolved = resolveRoundTwo(state, "second", result);
  expect(resolved.ok).toBe(true);
  expect(resolved.state.characters.map(c => [c.health, c.energy])).toEqual(Array.from({ length: 4 }, () => [result === "NO_AGREEMENT" ? 90 : 100, result === "RESCUE_APPROVED" ? 35 : 60]));
  expect(resolved.state.roundTwo?.resolution).toMatchObject({ npc: result === "RESCUE_APPROVED" ? "rescued" : "abandoned", microearthquake: result === "NO_AGREEMENT", costs: { movementEnergy: 0 } });
  expect(resolved.state.roundOne).toBe(state.roundOne);
  expect(resolved.state.inventory).toBe(state.inventory);
  expect(resolveRoundTwo(resolved.state, "another", "NO_AGREEMENT").state).toBe(resolved.state);
});

test("energía insuficiente rechaza sin pagos parciales; fallecidos no participan", () => {
  const base = beginRoundTwo(previous("ABANDON_APPROVED"));
  const state: SimulationState = { ...base, characters: base.characters.map((c, i) => ({ ...c, energy: i === 3 ? 24 : 25 })) };
  expect(resolveRoundTwo(state, "second", "RESCUE_APPROVED")).toEqual({ ok: false, error: "insufficient-energy", state });
  const living: SimulationState = { ...state, characters: state.characters.map((c, i) => i === 3 ? { ...c, health: 0 } : c) };
  const rescued = resolveRoundTwo(living, "second", "RESCUE_APPROVED");
  expect(rescued.ok).toBe(true);
  expect(rescued.state.characters.map(c => c.energy)).toEqual([0, 0, 0, 24]);
  const damaged = resolveRoundTwo({ ...living, characters: living.characters.map(c => ({ ...c, health: c.health ? 5 : 0 })) }, "second", "NO_AGREEMENT");
  expect(damaged.state.characters.every(c => c.health === 0)).toBe(true);
});
