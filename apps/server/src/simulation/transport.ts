import { spendEnergy, type OperationError } from "./operations.js";
import { isAlive, type SimulationState } from "./state.js";

export interface TransportPlan {
  readonly carrierIds: readonly string[];
  readonly transportedIds: readonly string[];
}
export interface MovementClassification {
  readonly walkingIds: readonly string[];
  readonly transportRequiredIds: readonly string[];
  readonly excludedIds: readonly string[];
}
export interface MovementCharge {
  readonly characterId: string;
  readonly kind: "walking" | "carrier" | "transported";
  readonly energyCost: number;
}
type ClassificationResult = { ok: true; classification: MovementClassification } | { ok: false; error: OperationError };

export function carrierEnergyCost(routeCost: number, transportedCount: number):
  { ok: true; energyCost: number } | { ok: false; error: OperationError } {
  if (!Number.isFinite(routeCost) || routeCost < 0 || !Number.isSafeInteger(transportedCount) || transportedCount < 0
    || !Number.isFinite(routeCost + 15 * transportedCount)) return { ok: false, error: "invalid-amount" };
  return { ok: true, energyCost: routeCost + 15 * transportedCount };
}

/** Cálculo puro: estar agotado no elimina ni mata a nadie. */
export function classifyMovement(state: SimulationState, routeCost: number): ClassificationResult {
  if (!Number.isFinite(routeCost) || routeCost < 0) return { ok: false, error: "invalid-amount" };
  return { ok: true, classification: {
    walkingIds: state.characters.filter(c => isAlive(c) && c.energy >= routeCost).map(c => c.id),
    transportRequiredIds: state.characters.filter(c => isAlive(c) && c.energy < routeCost).map(c => c.id),
    excludedIds: state.characters.filter(c => !isAlive(c)).map(c => c.id),
  } };
}

export function assessTransportPlan(state: SimulationState, routeCost: number, plan?: TransportPlan):
  { ok: true; classification: MovementClassification; carrierCost: number; charges: readonly MovementCharge[] }
  | { ok: false; error: OperationError; classification?: MovementClassification; carrierCost?: number; charges?: readonly MovementCharge[] } {
  const classified = classifyMovement(state, routeCost);
  if (!classified.ok) return classified;
  const classification = classified.classification;
  const reject = (error: OperationError) => ({ ok: false as const, error, classification });
  if (!classification.walkingIds.length && !classification.transportRequiredIds.length) return reject("no-living-characters");
  if (!plan && classification.transportRequiredIds.length) return reject("transport-vote-pending");
  const selected = plan ?? { carrierIds: [], transportedIds: [] };
  if (!Array.isArray(selected.carrierIds) || !Array.isArray(selected.transportedIds)) return reject("invalid-transport-plan");
  const carriers = new Set(selected.carrierIds);
  const carried = new Set(selected.transportedIds);
  if (carriers.size !== selected.carrierIds.length || carried.size !== selected.transportedIds.length
    || [...carriers].some(id => !classification.walkingIds.includes(id) || carried.has(id))
    || [...carried].some(id => !classification.transportRequiredIds.includes(id))
    || classification.transportRequiredIds.some(id => !carried.has(id))) return reject("invalid-transport-plan");
  // No se deja atrás a nadie implícitamente: los abandonos requieren la futura votación.
  if (carried.size && !carriers.size) return reject("transport-plan-infeasible");
  const budget = carrierEnergyCost(routeCost, carried.size);
  if (!budget.ok) return reject(budget.error);
  const carrierCost = budget.energyCost;
  const charges: MovementCharge[] = state.characters.filter(isAlive).map(c => ({ characterId: c.id,
    kind: carried.has(c.id) ? "transported" : carriers.has(c.id) ? "carrier" : "walking",
    energyCost: carried.has(c.id) ? 0 : carriers.has(c.id) ? carrierCost : routeCost }));
  if (charges.some(charge => state.characters.find(c => c.id === charge.characterId)!.energy < charge.energyCost)) return { ...reject("transport-plan-infeasible"), carrierCost, charges };
  return { ok: true, classification, carrierCost, charges };
}

/** Pago provisional reutilizable; un rechazo devuelve el estado original. */
export function payMovement(state: SimulationState, routeCost: number, plan?: TransportPlan):
  { ok: true; state: SimulationState; charges: readonly MovementCharge[] }
  | { ok: false; state: SimulationState; error: OperationError } {
  const assessment = assessTransportPlan(state, routeCost, plan);
  if (!assessment.ok) return { ok: false, state, error: assessment.error };
  let next = state;
  for (const charge of assessment.charges) {
    if (charge.energyCost === 0) continue;
    const payment = spendEnergy(next, charge.characterId, charge.energyCost);
    if (!payment.ok) return { ok: false, state, error: payment.error };
    next = payment.state;
  }
  return { ok: true, state: next, charges: assessment.charges };
}
