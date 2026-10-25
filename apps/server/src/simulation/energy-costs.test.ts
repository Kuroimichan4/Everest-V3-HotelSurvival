
const technicalExtra = (role: string, route: string) => route === "shoring" && (role === "maintenance" || role === "architect-engineer") ? 5 : 0;
import { expect, test, vi } from "vitest";
import { MOVEMENT_ENERGY } from "./energy-costs.js";
import { createInitialState } from "./state.js";
import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo, resolveRoundTwo } from "./round-two.js";
import { resolveRoundTwoMovement } from "./round-two-movement.js";
import { publicRouteViews, privateRouteViews } from "./routes.js";
import { publicRoundThreeRouteViews, resolveRoundThreeRoute } from "./round-three-routes.js";
import { assessTransportPlan, carrierEnergyCost, payMovement } from "./transport.js";
import { resolveTransportMovement } from "./transport-movement.js";

test("8C: siete costes aprobados, sin cambiar las condiciones iniciales", () => {
  expect(MOVEMENT_ENERGY).toEqual({ "round-one-passage": 25, "unstable-corridor": 20, ventilation: 30,
    shoring: 40, "fire-door": 30, "pipe-gallery": 20, "metal-debris": 40 });
  expect(createInitialState().characters.every(c => c.energy === 100)).toBe(true);
  expect(createInitialState().inventory).toEqual({ packs: 8, medicalUnits: 4 });
});

test("ronda 1 cobra 25 de ruta y mantiene los 25 independientes del rescate NPC", () => {
  expect(resolveRoundOne(createInitialState(), "abandon", "ABANDON_APPROVED").state.characters.map(c => c.energy)).toEqual([75, 75, 75, 75]);
  const first = resolveRoundOne(createInitialState(), "rescue", "RESCUE_APPROVED").state;
  expect(first.characters.map(c => c.energy)).toEqual([50, 50, 50, 50]);
  expect(first.roundOne!.costs).toEqual({ rescueEnergy: 25, movementEnergy: 25, damage: 0 });
  expect(resolveRoundTwo(beginRoundTwo(first), "second-rescue", "RESCUE_APPROVED").state.characters.map(c => c.energy)).toEqual([25, 25, 25, 25]);
});

test.each([["unstable-corridor", 20], ["ventilation", 30], ["shoring", 40]] as const)("ronda 2 %s conserva energía y publica coste %i", (route, cost) => {
  const first = resolveRoundOne(createInitialState(), "first", "ABANDON_APPROVED").state;
  const ready = resolveRoundTwo(beginRoundTwo(first), "npc", "ABANDON_APPROVED").state;
  const result = resolveRoundTwoMovement(ready, { decisionId: "move", outcome: route, ventilationRevealed: true }, () => 0.99);
  expect(result.ok).toBe(true);
  expect(result.state.characters.map(c => c.energy)).toEqual(ready.characters.map(c => 75 - cost - technicalExtra(c.role, route)));
  expect([...publicRouteViews(), ...privateRouteViews("maintenance")].find(r => r.id === route)!.energyCost).toBe(cost);
});

test.each([["fire-door", 30], ["pipe-gallery", 20], ["metal-debris", 40]] as const)("ronda 3 %s conserva energía y publica coste %i", (route, cost) => {
  const result = resolveRoundThreeRoute({ ...createInitialState(), currentRound: 3 }, "move", route, () => 0.99);
  expect(result.ok).toBe(true);
  expect(result.state.characters.map(c => c.energy)).toEqual([100 - cost, 100 - cost, 100 - cost, 100 - cost]);
  expect(publicRoundThreeRouteViews().find(r => r.id === route)!.energyCost).toBe(cost);
});

test.each([[0, 30], [1, 45], [2, 60], [3, 75]])("puerta con %i transportados calcula %i, incluso tres sin inventar votación", (count, cost) => {
  expect(carrierEnergyCost(MOVEMENT_ENERGY["fire-door"], count)).toEqual({ ok: true, energyCost: cost });
});

test.each([1, 2])("%i agotados: coste exacto termina en cero, un punto menos rechaza toda la operación", count => {
  const initial = createInitialState(); const total = 30 + 15 * count;
  for (const shortage of [0, 1]) {
    const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, energy: i < count ? 0 : total - shortage })) };
    const plan = { transportedIds: state.characters.slice(0, count).map(c => c.id), carrierIds: state.characters.slice(count).map(c => c.id) };
    expect(assessTransportPlan(state, 30, plan).ok).toBe(shortage === 0);
    const random = vi.fn(() => 0.99);
    const result = resolveTransportMovement(state, "budget", { energyCost: 30, accidentProbability: 0.2, accidentDamage: 10 }, plan, random);
    if (shortage) {
      expect(result).toEqual({ ok: false, state, error: "transport-plan-infeasible" });
      expect(result.state).toBe(state); expect(random).not.toHaveBeenCalled();
    } else {
      expect(result.ok).toBe(true);
      expect(result.state.characters.every(c => c.energy === 0)).toBe(true);
      expect(payMovement(state, 30, plan).state.characters.every(c => c.energy === 0)).toBe(true);
      expect(random).toHaveBeenCalledTimes(1);
    }
  }
});
