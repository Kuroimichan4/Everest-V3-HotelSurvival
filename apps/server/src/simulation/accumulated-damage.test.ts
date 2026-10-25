import { expect, test, vi } from "vitest";
import { createInitialState, isAlive } from "./state.js";
import { traverseRouteEffects } from "./routes.js";
import { resolveRoundThreeRoute } from "./round-three-routes.js";

test.each([20, 35])("8A.1: galería con salud inicial %i registra una sola muerte sin eliminación", health => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, health: i === 0 ? health : 100 })) };
  // A: solo daño ambiental. B: ambiental más accidente que selecciona al primero.
  const random = vi.fn(() => health === 20 ? 0.99 : 0);
  const result = resolveRoundThreeRoute(state, "fatal-gallery", "pipe-gallery", random);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.outcome.accident).toBe(health === 35);
  expect(result.state.characters[0]!.health).toBe(0);
  expect(isAlive(result.state.characters[0]!)).toBe(false);
  expect(result.state.characters[0]!.eliminated).not.toBe(true);
  expect(result.outcome.deceasedIds).toEqual([state.characters[0]!.id]);
  expect(resolveRoundThreeRoute(result.state, "fatal-gallery", "pipe-gallery", random).state).toBe(result.state);
  expect(random).toHaveBeenCalledTimes(health === 20 ? 1 : 4);
  const future = traverseRouteEffects(result.state, { energyCost: 10, accidentProbability: 0.5, accidentDamage: 30 }, () => 0);
  expect(future.ok).toBe(true);
  if (!future.ok) throw new Error(future.error);
  expect(future.victimIds).not.toContain(state.characters[0]!.id);
  expect(future.state.characters[0]).toEqual(result.state.characters[0]);
});

test.each([1, 2, 3, 4])("accidente con %i vivos: min(3, vivos) víctimas distintas y daño único", living => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, health: i < living ? 100 : 0 })) };
  const random = vi.fn(() => 0);
  const result = traverseRouteEffects(state, { energyCost: 10, accidentProbability: 0.35, accidentDamage: 20 }, random);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  const count = Math.min(3, living);
  expect(result.victimIds).toHaveLength(count);
  expect(new Set(result.victimIds).size).toBe(count);
  expect(result.state.characters.map(c => c.health)).toEqual(Array.from({ length: 4 }, (_, i) => i < count ? 80 : i < living ? 100 : 0));
  expect(random).toHaveBeenCalledTimes(1 + count);
});

test("muertos y eliminados no son candidatos, no pagan ni reciben daños", () => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => i === 0 ? { ...c, health: 0 } : i === 1 ? { ...c, eliminated: true } : c) };
  const result = resolveRoundThreeRoute(state, "r3", "pipe-gallery", () => 0);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.outcome.victimIds).toEqual(state.characters.slice(2).map(c => c.id));
  expect(result.state.characters.slice(0, 2)).toEqual(state.characters.slice(0, 2));
  expect(result.state.characters.slice(2).map(c => [c.health, c.energy])).toEqual([[50, 80], [50, 80]]);
});

test("las víctimas se eligen al inicio, aunque humo por sí solo ya fuera mortal", () => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, health: i === 0 ? 15 : 35 })) };
  const random = vi.fn(() => 0);
  const result = resolveRoundThreeRoute(state, "r3", "pipe-gallery", random);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.outcome.victimIds).toEqual(state.characters.slice(0, 3).map(c => c.id));
  expect(result.outcome.environmentalVictimIds).toEqual(state.characters.map(c => c.id));
  expect(result.state.characters.map(c => c.health)).toEqual([0, 0, 0, 15]);
  expect(result.outcome.deceasedIds).toEqual(state.characters.slice(0, 3).map(c => c.id));
  expect(result.state.characters.slice(0, 2).every(c => !isAlive(c))).toBe(true);
  expect(resolveRoundThreeRoute(result.state, "r3", "pipe-gallery", random).state).toBe(result.state);
  expect(random).toHaveBeenCalledTimes(4);
});

test("un superviviente puede fallecer por la acumulación, con una sola aplicación del total", () => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, health: i === 0 ? 35 : 0 })) };
  const result = traverseRouteEffects(state, { energyCost: 10, accidentProbability: 0.5, accidentDamage: 30, guaranteedDamage: 20 }, () => 0);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.damage).toEqual([{ characterId: state.characters[0]!.id, accidentDamage: 30, guaranteedDamage: 20, total: 50, healthLost: 35 }]);
  expect(result.deceasedIds).toEqual([state.characters[0]!.id]);
  expect(result.state.characters[0]).toMatchObject({ health: 0, energy: 90 });
});
