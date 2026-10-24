import { expect, test } from "vitest";
import { createInitialState } from "./state.js";
import { routeEnergyAvailability, assessTransportAlternative } from "./transport.js";

test.each([
  [[30, 30, 30, 30], 30, "available"],
  [[5, 45, 45, 45], 30, "with-help"],
  [[5, 5, 60, 60], 30, "with-help"],
  [[5, 5, 45, 45], 30, "with-help"],
  [[5, 30, 30, 30], 30, "unavailable"],
  [[5, 5, 5, 100], 30, "unavailable"],
] as const)("energías %j coste %i: %s sin efectos", (energies, cost, status) => {
  const initial = createInitialState(); const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, energy: energies[i]! })) };
  const snapshot = structuredClone(state);
  expect(routeEnergyAvailability(state, cost).status).toBe(status);
  expect(state).toEqual(snapshot);
  expect(state.characters.some(c => c.eliminated)).toBe(false);
});

test("la misma energía permite galería, pero no puerta ni escombros", () => {
  const initial = createInitialState(); const state = { ...initial, characters: initial.characters.map(c => ({ ...c, energy: 20 })) };
  expect([20, 30, 40].map(cost => routeEnergyAvailability(state, cost).status)).toEqual(["available", "unavailable", "unavailable"]);
});

test("una alternativa parcial solo valida una hipótesis y nunca abandona al no transportado", () => {
  const initial = createInitialState(); const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, energy: i < 2 ? 5 : 45 })) };
  expect(assessTransportAlternative(state, 30, state.characters.slice(0, 2).map(c => c.id)).viable).toBe(false);
  expect(assessTransportAlternative(state, 30, [state.characters[0]!.id]).viable).toBe(true);
  expect(state.characters[1]).toMatchObject({ health: 100, energy: 5 });
  expect(state.characters.some(c => c.eliminated)).toBe(false);
});
