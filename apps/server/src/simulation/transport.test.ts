import { expect, test, vi } from "vitest";
import { createInitialState, isAlive } from "./state.js";
import { carrierEnergyCost, classifyMovement, assessTransportPlan, payMovement } from "./transport.js";
import { resolveTransportMovement } from "./transport-movement.js";
import { consumePack } from "./operations.js";

function stateWithEnergy(energy: readonly number[]) {
  const state = createInitialState();
  return { ...state, characters: state.characters.map((c, i) => ({ ...c, energy: energy[i]! })) };
}
const effects = { energyCost: 20, accidentProbability: 0.2, accidentDamage: 10 };

test.each([[0, 20], [1, 35], [2, 50], [3, 65], [4, 80]])("presupuesto para %i transportados: %i por porteador", (count, energyCost) => {
  expect(carrierEnergyCost(20, count)).toEqual({ ok: true, energyCost });
});

test("clasificación de caminantes, agotados y excluidos sin mutación ni límite de dos", () => {
  const state = stateWithEnergy([20, 19, 0, 5]);
  const snapshot = structuredClone(state);
  expect(classifyMovement(state, 20)).toEqual({ ok: true, classification: {
    walkingIds: [state.characters[0]!.id], transportRequiredIds: state.characters.slice(1).map(c => c.id), excludedIds: [] } });
  expect(state).toEqual(snapshot);
  const excluded = { ...state, characters: state.characters.map((c, i) => i === 2 ? { ...c, health: 0 } : i === 3 ? { ...c, eliminated: true } : c) };
  const result = classifyMovement(excluded, 20);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.classification.excludedIds).toEqual(excluded.characters.slice(2).map(c => c.id));
  expect(excluded.characters.slice(2).every(c => !isAlive(c))).toBe(true);
});

test.each([1, 2, 3])("transportar %i agotados añade 15 por cada uno a cada porteador", count => {
  const state = stateWithEnergy(Array.from({ length: 4 }, (_, i) => i < 4 - count ? 100 : 0));
  const plan = { carrierIds: state.characters.slice(0, 4 - count).map(c => c.id), transportedIds: state.characters.slice(4 - count).map(c => c.id) };
  const snapshot = structuredClone(state);
  const assessment = assessTransportPlan(state, 20, plan);
  expect(assessment.ok).toBe(true);
  if (!assessment.ok) throw new Error(assessment.error);
  expect(assessment.carrierCost).toBe(20 + 15 * count);
  expect(assessment.charges.map(c => c.energyCost)).toEqual(Array.from({ length: 4 }, (_, i) => i < 4 - count ? 20 + 15 * count : 0));
  expect(state).toEqual(snapshot);
  const moved = payMovement(state, 20, plan);
  expect(moved.ok).toBe(true);
  expect(moved.state.characters.map(c => c.energy)).toEqual(Array.from({ length: 4 }, (_, i) => i < 4 - count ? 100 - 20 - 15 * count : 0));
  expect(moved.state.inventory).toBe(state.inventory);
  expect(moved.state.characters.every(isAlive)).toBe(true);
});

test("sin transporte se paga solo la ruta; un caminante no elegido como porteador no paga suplemento", () => {
  const state = stateWithEnergy([100, 20, 20, 0]);
  const plan = { carrierIds: [state.characters[0]!.id], transportedIds: [state.characters[3]!.id] };
  expect(payMovement(state, 20, plan).state.characters.map(c => c.energy)).toEqual([65, 0, 0, 0]);
  const walking = stateWithEnergy([20, 20, 20, 20]);
  expect(payMovement(walking, 20).state.characters.map(c => c.energy)).toEqual([0, 0, 0, 0]);
});

test("el coste completo del porteador puede terminar en cero, pero no negativo", () => {
  for (const energy of [34, 35]) {
    const state = stateWithEnergy([energy, energy, energy, 0]);
    const plan = { carrierIds: state.characters.slice(0, 3).map(c => c.id), transportedIds: [state.characters[3]!.id] };
    const result = payMovement(state, 20, plan);
    expect(result.ok).toBe(energy === 35);
    if (energy === 34) {
      expect(result).toEqual({ ok: false, state, error: "transport-plan-infeasible" });
      expect(result.state).toBe(state);
    } else expect(result.state.characters.every(c => c.energy === 0)).toBe(true);
  }
});

test("sin decisión explícita el avance espera transporte; todos agotados sigue sin eliminar a nadie", () => {
  const state = stateWithEnergy([0, 0, 0, 0]);
  expect(payMovement(state, 20)).toEqual({ ok: false, state, error: "transport-vote-pending" });
  expect(assessTransportPlan(state, 20, { carrierIds: [], transportedIds: state.characters.map(c => c.id) })).toMatchObject({ ok: false, error: "transport-plan-infeasible" });
  expect(state.characters.every(c => isAlive(c) && !c.eliminated)).toBe(true);
  expect(state.inventory).toEqual({ packs: 8, medicalUnits: 4 });
});

test.each(["duplicate", "overlap", "missing", "unknown", "healthy-carried", "exhausted-carrier"])("plan inválido %s no supone abandono ni pagos parciales", kind => {
  const state = stateWithEnergy([100, 100, 0, 0]);
  const ids = state.characters.map(c => c.id);
  const plan = { carrierIds: [ids[0]!], transportedIds: [ids[2]!, ids[3]!] };
  if (kind === "duplicate") plan.carrierIds.push(ids[0]!);
  if (kind === "overlap") plan.carrierIds.push(ids[2]!);
  if (kind === "missing") plan.transportedIds.pop();
  if (kind === "unknown") plan.transportedIds.push("unknown");
  if (kind === "healthy-carried") plan.transportedIds.push(ids[1]!);
  if (kind === "exhausted-carrier") plan.carrierIds = [ids[2]!];
  const random = vi.fn(() => 0);
  expect(resolveTransportMovement(state, "movement", effects, plan, random)).toEqual({ ok: false, state, error: "invalid-transport-plan" });
  expect(random).not.toHaveBeenCalled();
  expect(state.characters.every(isAlive)).toBe(true);
});

test("los transportados sufren humo y accidente; se registran fallecimientos sin tocar su energía", () => {
  const initial = stateWithEnergy([100, 100, 0, 0]);
  const state = { ...initial, characters: initial.characters.map(c => ({ ...c, health: 35 })) };
  const plan = { carrierIds: state.characters.slice(0, 2).map(c => c.id), transportedIds: state.characters.slice(2).map(c => c.id) };
  const random = vi.fn().mockReturnValueOnce(0).mockReturnValue(0.999);
  const result = resolveTransportMovement(state, "movement", { energyCost: 10, accidentProbability: 0.5, accidentDamage: 30, guaranteedDamage: 20 }, plan, random);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.state.characters.map(c => [c.health, c.energy])).toEqual([[15, 60], [0, 60], [0, 0], [0, 0]]);
  expect(result.outcome.victimIds).toEqual([state.characters[3]!.id, state.characters[2]!.id, state.characters[1]!.id]);
  expect(result.outcome.deceasedIds).toEqual(state.characters.slice(1).map(c => c.id));
  expect(result.outcome.damage.slice(2).map(d => [d.total, d.healthLost])).toEqual([[50, 35], [50, 35]]);
  expect(result.state.tools).toBe(state.tools);
  expect(result.state.inventory).toBe(state.inventory);
});

test("la resolución de transporte se recupera tras serialización o packs sin repetir tiradas", () => {
  const state = stateWithEnergy([100, 100, 100, 0]);
  const plan = { carrierIds: state.characters.slice(0, 3).map(c => c.id), transportedIds: [state.characters[3]!.id] };
  const random = vi.fn(() => 0);
  const moved = resolveTransportMovement(state, "movement", effects, plan, random);
  expect(moved.ok).toBe(true);
  if (!moved.ok) throw new Error(moved.error);
  expect(random).toHaveBeenCalledTimes(4);
  const restored = JSON.parse(JSON.stringify(moved.state)) as typeof state;
  const current = consumePack(restored, state.characters[0]!.id).state;
  const repeated = resolveTransportMovement(current, "movement", effects, plan, random);
  expect(repeated.ok).toBe(true);
  expect(repeated.state).toBe(current);
  expect(repeated.state.characters[0]!.energy).toBe(90);
  expect(random).toHaveBeenCalledTimes(4);
  expect(resolveTransportMovement(current, "movement", { ...effects, energyCost: 21 }, plan, random)).toEqual({ ok: false, state: current, error: "movement-request-conflict" });
});

test("planes inviables y definiciones inválidas no gastan recursos ni consumen azar", () => {
  const state = stateWithEnergy([30, 30, 30, 0]);
  const plan = { carrierIds: state.characters.slice(0, 3).map(c => c.id), transportedIds: [state.characters[3]!.id] };
  const random = vi.fn(() => 0);
  expect(resolveTransportMovement(state, "movement", effects, plan, random)).toEqual({ ok: false, state, error: "transport-plan-infeasible" });
  expect(resolveTransportMovement(state, "movement", { ...effects, guaranteedDamage: -1 }, plan, random)).toEqual({ ok: false, state, error: "invalid-route-effects" });
  expect(classifyMovement(state, NaN)).toEqual({ ok: false, error: "invalid-amount" });
  expect(random).not.toHaveBeenCalled();
});
