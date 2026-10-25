
const technicalExtra = (role: string, route: string) => route === "shoring" && (role === "maintenance" || role === "architect-engineer") ? 5 : 0;
import { expect, test, vi } from "vitest";
import { createInitialState, type SimulationState } from "./state.js";
import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo, resolveRoundTwo } from "./round-two.js";
import { resolveRoundTwoMovement } from "./round-two-movement.js";
import type { RouteId } from "./routes.js";

function ready(rescue: "RESCUE_APPROVED" | "ABANDON_APPROVED" | "NO_AGREEMENT" = "RESCUE_APPROVED") {
  const first = resolveRoundOne(createInitialState(), "r1", "RESCUE_APPROVED");
  if (!first.ok) throw new Error(first.error);
  const second = resolveRoundTwo(beginRoundTwo(first.state), "r2-rescue", rescue);
  if (!second.ok) throw new Error(second.error);
  // Energia preparada solo para aislar el motor de ruta, incluidos los costes nuevos de 40.
  return { ...second.state, characters: second.state.characters.map(c => ({ ...c, energy: 100 })) };
}
const choice = (outcome: RouteId | "NO_AGREEMENT", ventilationRevealed = true) => ({ decisionId: "r2-route", outcome, ventilationRevealed });
const routes = [["unstable-corridor", 20, 20], ["ventilation", 30, 5], ["shoring", 40, 10]] as const;

test.each(routes)("%s: coordinación sin accidente, coste %i y sin repetición", (routeId, cost) => {
  const state = ready();
  const random = vi.fn(() => 0.99);
  const result = resolveRoundTwoMovement(state, choice(routeId), random);
  expect(result.ok).toBe(true);
  expect(result.state.characters.map(c => [c.health, c.energy])).toEqual(state.characters.map(c => [100, 100 - cost - technicalExtra(c.role, routeId)]));
  expect(result.state.roundTwo?.movement).toMatchObject({ status: "completed", routeId, forced: false, accident: false, energyCost: cost, victims: [] });
  expect(random).toHaveBeenCalledTimes(1);
  expect(resolveRoundTwoMovement(result.state, choice("NO_AGREEMENT"), random).state).toBe(result.state);
  expect(random).toHaveBeenCalledTimes(1);
  expect(state.characters.every(c => c.energy === 100 && c.health === 100)).toBe(true);
  expect(result.state.roundOne).toBe(state.roundOne);
  expect(result.state.roundTwo?.resolution).toBe(state.roundTwo?.resolution);
});

test.each(routes)("%s: una tirada de accidente y tres extracciones sin repetición", (routeId, cost, damage) => {
  const state = ready();
  const random = vi.fn(() => 0);
  const result = resolveRoundTwoMovement(state, choice(routeId), random);
  expect(result.ok).toBe(true);
  expect(random).toHaveBeenCalledTimes(4);
  expect(result.state.characters.map(c => c.energy)).toEqual(state.characters.map(c => 100 - cost - technicalExtra(c.role, routeId)));
  expect(result.state.characters.map(c => c.health)).toEqual([100 - damage, 100 - damage, 100 - damage, 100]);
  expect(result.state.roundTwo?.movement).toMatchObject({ status: "completed", accident: true,
    victims: state.characters.slice(0, 3).map(c => ({ characterId: c.id, damage })) });
  resolveRoundTwoMovement(result.state, choice(routeId), random);
  expect(random).toHaveBeenCalledTimes(4);
});

test.each(["RESCUE_APPROVED", "ABANDON_APPROVED", "NO_AGREEMENT"] as const)("desacuerdo de ruta independiente del rescate %s, también con accidente", rescue => {
  for (const accident of [false, true]) {
    const state = ready(rescue);
    const random = vi.fn(() => accident ? 0 : 0.99);
    const result = resolveRoundTwoMovement(state, choice("NO_AGREEMENT"), random);
    expect(result.ok).toBe(true);
    const initialHealth = rescue === "NO_AGREEMENT" ? 90 : 100;
    expect(result.state.characters.map(c => c.health)).toEqual([initialHealth - 10 - (accident ? 20 : 0), initialHealth - 10 - (accident ? 20 : 0), initialHealth - 10 - (accident ? 20 : 0), initialHealth - 10]);
    expect(result.state.characters.map(c => c.energy)).toEqual(Array(4).fill(100 - 20));
    expect(result.state.roundTwo?.movement).toMatchObject({ status: "completed", forced: true, routeId: "unstable-corridor", microearthquake: true, energyCost: 20, accident });
    expect(result.state.roundTwo?.resolution).toBe(state.roundTwo?.resolution);
    expect(random).toHaveBeenCalledTimes(accident ? 4 : 1);
  }
});

test("sin revelar ventilación no se atraviesa ni se consume azar", () => {
  const state = ready();
  const random = vi.fn(() => 0);
  expect(resolveRoundTwoMovement(state, choice("ventilation", false), random)).toEqual({ ok: false, state, error: "ventilation-hidden" });
  expect(random).not.toHaveBeenCalled();
});

test("no inicia antes del rescate ni completa una ronda bloqueada", () => {
  const random = vi.fn(() => 0);
  const state = createInitialState();
  expect(resolveRoundTwoMovement(state, choice("shoring"), random)).toEqual({ ok: false, state, error: "route-not-ready" });
  expect(random).not.toHaveBeenCalled();
});

test.each(["insufficient-energy", "single-survivor-pending", "no-living-characters", "specialist-availability-pending", "fatal-microearthquake-order-pending", "fatal-accident-order-pending", "invalid-random"])("rechazo %s sin confirmar ningún efecto parcial", error => {
  const base = ready();
  let state: SimulationState = base;
  let route: RouteId | "NO_AGREEMENT" = "NO_AGREEMENT";
  const random = vi.fn(() => 0);
  if (error === "insufficient-energy") state = { ...base, characters: base.characters.map((c, i) => ({ ...c, energy: i === 3 ? 9 : 35 })) };
  if (error === "single-survivor-pending" || error === "no-living-characters") state = { ...base, characters: base.characters.map((c, i) => ({ ...c, health: error === "single-survivor-pending" && i === 0 ? 100 : 0 })) };
  if (error === "specialist-availability-pending") { route = "shoring"; state = { ...base, characters: base.characters.map((c, i) => ({ ...c, health: i === 0 ? 0 : 100 })) }; }
  if (error === "fatal-microearthquake-order-pending") state = { ...base, characters: base.characters.map(c => ({ ...c, health: 10 })) };
  if (error === "fatal-accident-order-pending") state = { ...base, characters: base.characters.map(c => ({ ...c, health: 30 })) };
  if (error === "invalid-random") random.mockReturnValue(NaN);
  const snapshot = structuredClone(state);
  const result = resolveRoundTwoMovement(state, choice(route), random);
  if (["single-survivor-pending", "fatal-microearthquake-order-pending", "fatal-accident-order-pending"].includes(error)) {
    expect(result.ok).toBe(true);
    const expectedHealth = error === "single-survivor-pending" ? [70, 0, 0, 0]
      : error === "fatal-microearthquake-order-pending" ? [0, 0, 0, 0] : [0, 0, 0, 20];
    expect(result.state.characters.map(c => c.health)).toEqual(expectedHealth);
    expect(result.state.roundTwo?.movement?.status).toBe("completed");
    expect(state).toEqual(snapshot);
    const calls = random.mock.calls.length;
    resolveRoundTwoMovement(result.state, choice(route), random);
    expect(random).toHaveBeenCalledTimes(calls);
    return;
  }
  expect(result).toEqual({ ok: false, state, error: error === "insufficient-energy" ? "transport-vote-pending" : error });
  expect(result.state).toBe(state);
  expect(state).toEqual(snapshot);
  expect(state.roundTwo?.movement).toBeUndefined();
  if (!["invalid-random", "fatal-accident-order-pending"].includes(error)) expect(random).not.toHaveBeenCalled();
});
