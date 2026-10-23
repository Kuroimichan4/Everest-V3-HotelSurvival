import { describe, expect, test } from "vitest";
import { applyDamage, consumePack, spendEnergy } from "./operations.js";
import type { OperationResult } from "./operations.js";
import { createInitialState, isAlive } from "./state.js";
import type { SimulationState } from "./state.js";

const id = "maintenance";

function accepted(result: OperationResult): SimulationState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function rejected(result: OperationResult, state: SimulationState, error: string): void {
  expect(result).toEqual({ ok: false, error, state });
  expect(result.state).toBe(state);
}

describe("motor básico", () => {
  test("inicia cuatro roles únicos con salud y energía 100 e inventario 8/4", () => {
    const state = createInitialState();
    expect(state.characters).toHaveLength(4);
    expect(new Set(state.characters.map((character) => character.role)).size).toBe(4);
    expect(new Set(state.characters.map((character) => character.id)).size).toBe(4);
    for (const character of state.characters) {
      expect(character.health).toBe(100);
      expect(character.energy).toBe(100);
      expect(isAlive(character)).toBe(true);
    }
    expect(state.inventory).toEqual({ packs: 8, medicalUnits: 4 });
  });

  test("cada partida tiene su propio estado", () => {
    const first = createInitialState();
    const second = createInitialState();
    expect(first).toEqual(second);
    expect(first.characters[0]).not.toBe(second.characters[0]);
    expect(first.inventory).not.toBe(second.inventory);
  });

  test("20 de daño deja 80 sin modificar el original ni otros personajes", () => {
    const initial = createInitialState();
    const state = accepted(applyDamage(initial, id, 20));
    expect(state.characters[0]?.health).toBe(80);
    expect(initial.characters[0]?.health).toBe(100);
    expect(state.characters.slice(1)).toEqual(initial.characters.slice(1));
  });

  test.each([100, 150])("%s de daño deja salud 0 y provoca fallecimiento", (damage) => {
    const state = accepted(applyDamage(createInitialState(), id, damage));
    const character = state.characters[0]!;
    expect(character.health).toBe(0);
    expect(isAlive(character)).toBe(false);
    expect(accepted(applyDamage(state, id, 10)).characters[0]?.health).toBe(0);
    rejected(spendEnergy(state, id, 0), state, "character-dead");
    rejected(spendEnergy(state, id, 15), state, "character-dead");
    rejected(consumePack(state, id), state, "character-dead");
    expect(spendEnergy(state, "medic", 15).ok).toBe(true);
  });

  test("coste exacto se completa con 0; un pack permite actuar después", () => {
    const state = accepted(spendEnergy(createInitialState(), id, 85));
    const exhausted = accepted(spendEnergy(state, id, 15));
    expect(exhausted.characters[0]?.energy).toBe(0);
    rejected(spendEnergy(exhausted, id, 1), exhausted, "insufficient-energy");
    const recovered = accepted(consumePack(exhausted, id));
    expect(recovered.characters[0]?.energy).toBe(25);
    expect(accepted(spendEnergy(recovered, id, 20)).characters[0]?.energy).toBe(5);
  });

  test("coste 20 con 15 disponibles se rechaza sin cambios parciales", () => {
    const state = accepted(spendEnergy(createInitialState(), id, 85));
    const snapshot = structuredClone(state);
    rejected(spendEnergy(state, id, 20), state, "insufficient-energy");
    expect(state).toEqual(snapshot);
  });

  test.each([[50, 75], [10, 100]])("un pack tras gastar %s deja %s y descuenta solo un pack", (cost, energy) => {
    const initial = accepted(spendEnergy(createInitialState(), id, cost));
    const state = accepted(consumePack(initial, id));
    expect(state.characters[0]?.energy).toBe(energy);
    expect(state.inventory).toEqual({ packs: 7, medicalUnits: 4 });
    expect(state.characters.slice(1)).toEqual(initial.characters.slice(1));
    expect(initial.inventory.packs).toBe(8);
    expect(initial.characters[0]?.energy).toBe(100 - cost);
  });

  test("agotar los ocho packs no permite inventario negativo", () => {
    let state = createInitialState();
    for (let remaining = 7; remaining >= 0; remaining--) {
      state = accepted(spendEnergy(state, id, 25));
      state = accepted(consumePack(state, id));
      expect(state.inventory).toEqual({ packs: remaining, medicalUnits: 4 });
    }
    state = accepted(spendEnergy(state, id, 25));
    const snapshot = structuredClone(state);
    rejected(consumePack(state, id), state, "no-packs");
    expect(state).toEqual(snapshot);
  });

  test("con 100 de energía se rechaza el pack sin cambiar personajes ni inventario", () => {
    const state = createInitialState();
    const snapshot = structuredClone(state);
    rejected(consumePack(state, id), state, "energy-full");
    expect(state).toEqual(snapshot);
    expect(state.characters[0]?.energy).toBe(100);
    expect(state.inventory).toEqual({ packs: 8, medicalUnits: 4 });
  });

  test.each([-1, NaN, Infinity, -Infinity])("rechaza importe inválido %s sin mutar el estado", (amount) => {
    const state = createInitialState();
    rejected(applyDamage(state, id, amount), state, "invalid-amount");
    rejected(spendEnergy(state, id, amount), state, "invalid-amount");
    expect(state).toEqual(createInitialState());
  });

  test("identificador desconocido no modifica salud, energía ni inventario", () => {
    const state = createInitialState();
    rejected(applyDamage(state, "missing", 20), state, "character-not-found");
    rejected(spendEnergy(state, "missing", 20), state, "character-not-found");
    rejected(consumePack(state, "missing"), state, "character-not-found");
    expect(state).toEqual(createInitialState());
  });
});
