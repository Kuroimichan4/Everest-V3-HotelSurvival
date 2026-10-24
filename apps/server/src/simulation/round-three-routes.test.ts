import { expect, test, vi } from "vitest";
import { createInitialState, type SimulationState } from "./state.js";
import { administerTreatment, consumePack } from "./operations.js";
import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo, resolveRoundTwo } from "./round-two.js";
import { resolveRoundTwoMovement } from "./round-two-movement.js";
import { privateRoundThreeKnowledge, publicRoundThreeRouteViews, resolveRoundThreeRoute, roundThreeExplorationView } from "./round-three-routes.js";

const routes = [
  ["fire-door", 20, 0.2, 10, 0],
  ["pipe-gallery", 10, 0.5, 30, 20],
  ["metal-debris", 30, 0.2, 10, 0],
] as const;

test.each(routes)("%s: coste %i, umbral %f, accidente %i y ambiente %i", (route, cost, probability, damage, environment) => {
  for (const accident of [false, true]) {
    const state = createInitialState();
    const snapshot = structuredClone(state);
    const random = vi.fn().mockReturnValueOnce(accident ? probability - 0.000001 : probability).mockReturnValue(0);
    const result = resolveRoundThreeRoute(state, "r3", route, random);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.characters.map(c => c.energy)).toEqual(Array(4).fill(100 - cost));
    expect(result.state.characters.map(c => c.health)).toEqual([100 - environment - (accident ? damage : 0), 100 - environment - (accident ? damage : 0), 100 - environment, 100 - environment]);
    expect(result.outcome.accident).toBe(accident);
    expect(result.outcome.victimIds).toEqual(accident ? state.characters.slice(0, 2).map(c => c.id) : []);
    expect(new Set(result.outcome.victimIds).size).toBe(accident ? 2 : 0);
    expect(result.outcome.environmentalVictimIds).toEqual(environment ? state.characters.map(c => c.id) : []);
    expect(random).toHaveBeenCalledTimes((accident ? 3 : 1) + (route === "metal-debris" ? 1 : 0));
    expect(state).toEqual(snapshot);
    expect(result.state.currentRound).toBe(state.currentRound); // No hay transición de ronda en esta primitiva.
  }
});

test("puerta: pérdida garantizada y dos unidades, sin daño del temblor ni muestras adicionales", () => {
  for (const sample of [0, 0.99]) {
    const state = createInitialState();
    const random = vi.fn(() => sample);
    const result = resolveRoundThreeRoute(state, "r3", "fire-door", random);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.tools.crowbar).toBe("lost");
    expect(result.state.inventory).toEqual({ packs: 8, medicalUnits: 6 });
    expect(result.outcome).toMatchObject({ crowbarLost: true, returnBlocked: true,
      discovery: "medical-conference-room", environmentalDamage: 0, gained: { packs: 0, medicalUnits: 2 } });
    expect(result.state.characters.map(c => c.health)).toEqual(sample === 0 ? [90, 90, 100, 100] : [100, 100, 100, 100]);
    expect(random).toHaveBeenCalledTimes(sample === 0 ? 3 : 1);
  }
});

test.each([[0, 4], [0.699999999, 4], [0.7, 8], [0.999999999, 8]])("almacén: muestra %f concede únicamente %i packs", (sample, packs) => {
  const state = createInitialState();
  const random = vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(sample);
  const result = resolveRoundThreeRoute(state, "r3", "metal-debris", random);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.outcome.gained).toEqual({ packs, medicalUnits: 0 });
  expect(result.state.inventory).toEqual({ packs: 8 + packs, medicalUnits: 4 });
  expect(result.state.tools).toBe(state.tools);
  expect(result.outcome.discovery).toBe("supply-warehouse");
  expect(random).toHaveBeenCalledTimes(2);
});

test("accidente y recompensa del almacén usan muestras independientes", () => {
  const samples = [0.19999, 0.99, 0.99, 0.7];
  const random = vi.fn(() => samples.shift()!);
  const result = resolveRoundThreeRoute(createInitialState(), "r3", "metal-debris", random);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.outcome.victimIds).toEqual(["bellhop", "architect-engineer"]);
  expect(result.outcome.gained.packs).toBe(8);
  expect(random).toHaveBeenCalledTimes(4);
});

test.each(routes)("%s: una resolución, sin repetir pagos, daños, tiradas o recompensas", route => {
  const random = vi.fn(() => 0);
  const result = resolveRoundThreeRoute(createInitialState(), "r3", route, random);
  expect(result.ok).toBe(true);
  const calls = random.mock.calls.length;
  const repeated = resolveRoundThreeRoute(result.state, "r3", route, random);
  expect(repeated).toEqual(result);
  expect(repeated.state).toBe(result.state);
  expect(resolveRoundThreeRoute(result.state, "other", route, random)).toEqual({ ok: false, state: result.state, error: "round-three-already-resolved" });
  expect(resolveRoundThreeRoute(result.state, "r3", route === "fire-door" ? "metal-debris" : "fire-door", random).ok).toBe(false);
  expect(random).toHaveBeenCalledTimes(calls);
});

function expectBlocked(state: SimulationState, route: string, error: string, random = vi.fn(() => 0)) {
  const snapshot = structuredClone(state);
  const result = resolveRoundThreeRoute(state, "r3", route, random);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected rejection");
  expect(result.error).toBe(error);
  expect(result.state).toEqual({ ...snapshot, roundThreeRoute: { status: "blocked", requestId: "r3", routeId: route, error } });
  expect(result.state.characters).toBe(state.characters);
  expect(result.state.inventory).toBe(state.inventory);
  expect(result.state.tools).toBe(state.tools);
  expect(state).toEqual(snapshot);
  const calls = random.mock.calls.length;
  expect(resolveRoundThreeRoute(result.state, "r3", route, random)).toEqual(result);
  expect(resolveRoundThreeRoute(result.state, "retry", route, random).ok).toBe(false);
  expect(random).toHaveBeenCalledTimes(calls);
  expect(roundThreeExplorationView(result.state)).toBeNull();
}

test.each(routes)("%s rechaza energía insuficiente del último humano sin pagos parciales ni azar", (route, cost) => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, energy: i === 3 ? cost - 1 : 100 })) };
  const random = vi.fn(() => 0);
  expectBlocked(state, route, "transport-vote-pending", random);
  expect(random).not.toHaveBeenCalled();
});

test.each(routes)("%s permite acabar con energía cero", (route, energy) => {
  const initial = createInitialState();
  const result = resolveRoundThreeRoute({ ...initial, characters: initial.characters.map(c => ({ ...c, energy })) }, "r3", route, () => 0.99);
  expect(result.ok).toBe(true);
  expect(result.state.characters.every(c => c.energy === 0)).toBe(true);
});

test("palanca ausente: pendiente sin efectos; las otras rutas no restauran herramientas perdidas", () => {
  const state: SimulationState = { ...createInitialState(), tools: { crowbar: "lost" } };
  const random = vi.fn(() => 0.99);
  expectBlocked(state, "fire-door", "crowbar-unavailable-pending", random);
  expect(random).not.toHaveBeenCalled();
  for (const route of ["pipe-gallery", "metal-debris"]) {
    const result = resolveRoundThreeRoute(state, "r3", route, random);
    expect(result.ok).toBe(true);
    expect(result.state.tools.crowbar).toBe("lost");
  }
});

test.each([0, 1])("con %i humanos vivos el caso queda bloqueado antes de pagar o tirar", living => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, health: i < living ? 100 : 0 })) };
  const random = vi.fn(() => 0.99);
  if (living === 1) {
    const result = resolveRoundThreeRoute(state, "r3", "pipe-gallery", random);
    expect(result.ok).toBe(true);
    expect(result.state.characters[0]).toMatchObject({ health: 80, energy: 90 });
    expect(random).toHaveBeenCalledTimes(1);
  } else {
    expectBlocked(state, "pipe-gallery", "no-living-characters", random);
    expect(random).not.toHaveBeenCalled();
  }
});

test.each([2, 3])("con %i humanos vivos se seleccionan dos distintos y solo pagan los vivos", living => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => ({ ...c, health: i < living ? 100 : 0 })) };
  const result = resolveRoundThreeRoute(state, "r3", "pipe-gallery", () => 0);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.outcome.victimIds).toEqual(initial.characters.slice(0, 2).map(c => c.id));
  expect(result.outcome.environmentalVictimIds).toHaveLength(living);
  expect(result.state.characters.map(c => [c.health, c.energy])).toEqual(initial.characters.map((_, i) => [i < 2 ? 50 : i < living ? 80 : 0, i < living ? 90 : 100]));
});

test.each([20, 30, 50])("8A: danos acumulados mortales con salud %i se confirman juntos", health => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map(c => ({ ...c, health })) };
  const result = resolveRoundThreeRoute(state, "r3", "pipe-gallery", () => 0);
  expect(result.ok).toBe(true);
  expect(result.state.characters.map(c => c.health)).toEqual([0, 0, Math.max(0, health - 20), Math.max(0, health - 20)]);
  expect(result.state.roundThreeRoute?.status).toBe("completed");
  expect(state.characters.every(c => c.health === health)).toBe(true);
});

test.each([NaN, Infinity, -0.1, 1])("muestra inválida %s: también revierte si falla el premio tras pagar y tirar", sample => {
  const state = createInitialState();
  for (const random of [vi.fn(() => sample), vi.fn().mockReturnValueOnce(0.99).mockReturnValue(sample),
    vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(sample)]) {
    expectBlocked(state, "metal-debris", "invalid-random", random);
  }
});

test("entradas inválidas no crean recorrido ni consumen muestras", () => {
  const state = createInitialState(); const random = vi.fn(() => 0);
  expect(resolveRoundThreeRoute(state, "r3", "invented", random)).toEqual({ ok: false, state, error: "unknown-route" });
  expect(resolveRoundThreeRoute(state, "", "fire-door", random)).toEqual({ ok: false, state, error: "invalid-request" });
  expect(random).not.toHaveBeenCalled();
});

test("vistas públicas sin destinos, premios, probabilidades ni conocimientos de otros roles", () => {
  const views = publicRoundThreeRouteViews();
  expect(views.map(route => route.id)).toEqual(["fire-door", "pipe-gallery", "metal-debris"]);
  expect(roundThreeExplorationView(createInitialState())).toBeNull();
  for (const route of views) expect(Object.keys(route).sort()).toEqual(["energyCost", "id", "name"]);
  expect(JSON.stringify(views)).not.toMatch(/conference|warehouse|almacén|conferencias|gained|reward|probability|danger|0\.2|0\.5|0\.7/i);
  for (const role of ["maintenance", "medic", "architect-engineer", "bellhop"] as const) {
    const privateView = privateRoundThreeKnowledge(role);
    expect(privateView.map(v => v.routeId)).toEqual(role === "medic" ? ["fire-door"] : role === "bellhop" ? ["metal-debris"] : []);
    expect(JSON.stringify(privateView)).not.toMatch(/\b[248]\b|70|30|probability|gained|reward/);
  }
  const completed = resolveRoundThreeRoute(createInitialState(), "r3", "fire-door", () => 0.99);
  const resultView = roundThreeExplorationView(completed.state)!;
  expect(resultView.discovery).toBe("medical-conference-room");
  expect(resultView.gained.medicalUnits).toBe(2);
  expect(JSON.stringify(resultView)).not.toMatch(/probability|danger|random|requestId|knowledge/);
  resultView.gained.medicalUnits = 999;
  views[0]!.energyCost = 999;
  expect(roundThreeExplorationView(completed.state)!.gained.medicalUnits).toBe(2);
  expect(publicRoundThreeRouteViews()[0]!.energyCost).toBe(20);
});

test("se conservan recursos, palanca e historial de rondas anteriores y tratamientos", () => {
  let state = resolveRoundOne(createInitialState(), "r1", "RESCUE_APPROVED").state;
  state = resolveRoundTwo(beginRoundTwo(state), "r2", "RESCUE_APPROVED").state;
  state = resolveRoundTwoMovement(state, { decisionId: "r2-route", outcome: "unstable-corridor", ventilationRevealed: false }, () => 0).state;
  state = administerTreatment(state, state.characters[0]!.id).state;
  for (const character of state.characters) state = consumePack(state, character.id).state;
  expect(state.inventory).toEqual({ packs: 4, medicalUnits: 3 });
  const snapshot = structuredClone(state);
  const result = resolveRoundThreeRoute(state, "r3", "metal-debris", () => 0.99);
  expect(result.ok).toBe(true);
  expect(result.state.inventory).toEqual({ packs: 12, medicalUnits: 3 });
  expect(result.state.roundOne).toBe(state.roundOne);
  expect(result.state.roundTwo).toBe(state.roundTwo);
  expect(result.state.medicalTreatments).toBe(state.medicalTreatments);
  expect(result.state.tools).toBe(state.tools);
  expect(result.state.characters.map(c => c.energy)).toEqual([20, 20, 20, 20]);
  expect(state).toEqual(snapshot);
});
