import { expect, test, vi } from "vitest";
import { createInitialState, type SimulationState } from "./state.js";
import { checkRouteRequirements, privateRouteViews, publicRouteViews, traverseRoute } from "./routes.js";

const cases = [
  ["unstable-corridor", 10, 0.35, 20],
  ["ventilation", 20, 0.10, 5],
  ["shoring", 30, 0.20, 10],
] as const;

test.each(cases)("%s: coste %i, umbral %f y daño %i", (route, cost, probability, damage) => {
  const state = createInitialState();
  const snapshot = structuredClone(state);
  const noAccident = vi.fn(() => probability);
  const safe = traverseRoute(state, route, noAccident);
  expect(safe.ok).toBe(true);
  if (!safe.ok) throw new Error(safe.error);
  expect(safe.accident).toBe(false);
  expect(safe.victimIds).toEqual([]);
  expect(noAccident).toHaveBeenCalledTimes(1);
  expect(safe.state.characters.map((character) => [character.health, character.energy]))
    .toEqual(Array.from({ length: 4 }, () => [100, 100 - cost]));
  const random = vi.fn().mockReturnValueOnce(probability - 0.000001).mockReturnValue(0);
  const hit = traverseRoute(state, route, random);
  expect(hit.ok).toBe(true);
  if (!hit.ok) throw new Error(hit.error);
  expect(hit.accident).toBe(true);
  expect(random).toHaveBeenCalledTimes(3);
  expect(hit.victimIds).toEqual(state.characters.slice(0, 2).map((character) => character.id));
  expect(new Set(hit.victimIds).size).toBe(2);
  expect(hit.state.characters.map((character) => character.health)).toEqual([100 - damage, 100 - damage, 100, 100]);
  expect(hit.state.characters.every((character) => character.energy === 100 - cost)).toBe(true);
  expect(hit.state.inventory).toEqual(state.inventory);
  expect(state).toEqual(snapshot);
});

test.each(cases)("%s permite pagar exactamente toda la energía", (route, energy) => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((character) => ({ ...character, energy })) };
  const result = traverseRoute(state, route, () => 0.99);
  expect(result.ok).toBe(true);
  expect(result.state.characters.every((character) => character.energy === 0)).toBe(true);
});

test.each(cases)("%s rechaza sin costes parciales ni tiradas si el último no puede pagar", (route, cost) => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((character, i) => ({ ...character, energy: i === 3 ? cost - 1 : 100 })) };
  const random = vi.fn(() => 0);
  expect(traverseRoute(state, route, random)).toEqual({ ok: false, state, error: "insufficient-energy" });
  expect(random).not.toHaveBeenCalled();
  expect(state.characters[0]!.energy).toBe(100);
});

function survivors(indices: number[]): SimulationState {
  const state = createInitialState();
  return { ...state, characters: state.characters.map((character, i) => ({ ...character, health: indices.includes(i) ? 100 : 0 })) };
}

test("con dos vivos ambos son víctimas; los fallecidos no pagan ni reciben daño", () => {
  const state = survivors([1, 3]);
  const result = traverseRoute(state, "ventilation", () => 0);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.victimIds).toEqual([state.characters[1]!.id, state.characters[3]!.id]);
  expect(result.state.characters.map((character) => [character.health, character.energy]))
    .toEqual([[0, 100], [95, 80], [0, 100], [95, 80]]);
});

test("con tres vivos se eligen dos vivos distintos incluso usando el extremo superior", () => {
  const state = survivors([0, 2, 3]);
  const random = vi.fn().mockReturnValueOnce(0).mockReturnValue(0.999999);
  const result = traverseRoute(state, "unstable-corridor", random);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.victimIds).toEqual([state.characters[3]!.id, state.characters[2]!.id]);
});

test.each([[[], "no-living-characters"], [[0], "single-survivor-pending"]] as const)("supervivientes %j: %s", (indices, error) => {
  const state = survivors([...indices]);
  const random = vi.fn(() => 0.99);
  const result = traverseRoute(state, "ventilation", random);
  expect(result).toEqual({ ok: false, state, error });
  expect(result.state).toBe(state);
  expect(random).not.toHaveBeenCalled();
});

test.each([0, 2])("ruta C identifica especialista fallecido %i como pendiente", (dead) => {
  const state = survivors([0, 1, 2, 3].filter((index) => index !== dead));
  expect(checkRouteRequirements(state, "shoring")).toEqual({ ok: false, error: "specialist-availability-pending" });
  expect(traverseRoute(state, "shoring", () => 0).state).toBe(state);
});

test("ruta C con ambos especialistas vivos y los otros dos fallecidos", () => {
  expect(traverseRoute(survivors([0, 2]), "shoring", () => 0).ok).toBe(true);
});

test("ruta desconocida no consume azar ni estado", () => {
  const state = createInitialState();
  const random = vi.fn(() => 0);
  expect(traverseRoute(state, "inventada", random)).toEqual({ ok: false, state, error: "unknown-route" });
  expect(random).not.toHaveBeenCalled();
});

test.each([NaN, Infinity, -0.1, 1])("muestra inválida %s revierte incluso después del pago provisional", (sample) => {
  const state = createInitialState();
  const snapshot = structuredClone(state);
  for (const random of [() => sample, vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(sample)]) {
    const result = traverseRoute(state, "ventilation", random);
    expect(result).toEqual({ ok: false, state, error: "invalid-random" });
    expect(result.state).toBe(state);
  }
  expect(state).toEqual(snapshot);
});

test("muerte por accidente queda pendiente sin aplicar costes ni daños", () => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((character) => ({ ...character, health: 20 })) };
  const result = traverseRoute(state, "unstable-corridor", () => 0);
  expect(result).toEqual({ ok: false, state, error: "fatal-accident-order-pending" });
  expect(result.state).toBe(state);
});

test("la misma secuencia produce el mismo resultado con identificadores independientes del rol", () => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((character, i) => ({ ...character, id: `character-${i}` })) };
  const run = () => { const samples = [0.01, 0.6, 0.9]; return traverseRoute(state, "shoring", () => samples.shift()!); };
  expect(run()).toEqual(run());
  const result = run();
  if (result.ok) expect(result.victimIds).toEqual(["character-2", "character-3"]);
});

test("vistas autorizadas no contienen riesgos internos y solo Mantenimiento conoce ventilación", () => {
  const publicViews = publicRouteViews();
  expect(publicViews.map((route) => route.id)).toEqual(["unstable-corridor", "shoring"]);
  for (const role of ["maintenance", "medic", "architect-engineer", "bellhop"] as const) {
    const privateViews = privateRouteViews(role);
    expect(privateViews.map((route) => route.id)).toEqual(role === "maintenance" ? ["ventilation"] : []);
    for (const route of [...publicViews, ...privateViews]) {
      expect(Object.keys(route).sort()).toEqual(["energyCost", "id", "name"]);
      expect(JSON.stringify(route)).not.toMatch(/LOW|MODERATE|HIGH|probability|damage|danger|0\.1/i);
    }
  }
  publicViews[0]!.energyCost = 999;
  expect(publicRouteViews()[0]!.energyCost).toBe(10);
  expect(traverseRoute(createInitialState(), "unstable-corridor", () => 0.99).state.characters[0]!.energy).toBe(90);
});
