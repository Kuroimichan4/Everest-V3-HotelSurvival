import { MOVEMENT_ENERGY, NPC_RESCUE_ENERGY } from "./energy-costs.js";
import { payMovement, type TransportPlan } from "./transport.js";
import { isAlive } from "./state.js";
import type { RescueOutcome } from "@everest/shared";
import { applyDamage, spendEnergy, type OperationResult } from "./operations.js";
import type { SimulationState } from "./state.js";

/** Transacción pura: el gestor publica únicamente el estado completo tras el éxito. */
export function prepareRoundOne(state: SimulationState, decisionId: string, result: RescueOutcome): OperationResult {
  if (state.roundOnePreparation) return state.roundOnePreparation.decisionId === decisionId && state.roundOnePreparation.result === result
    ? { ok: true, state } : { ok: false, state, error: "invalid-amount" };
  let next = state;
  for (const character of state.characters.filter(isAlive)) {
    const effect = result === "NO_AGREEMENT" ? applyDamage(next, character.id, 10)
      : spendEnergy(next, character.id, result === "RESCUE_APPROVED" ? NPC_RESCUE_ENERGY : 0);
    if (!effect.ok) return { ...effect, state };
    next = effect.state;
  }
  return { ok: true, state: { ...next, roundOnePreparation: { decisionId, result } } };
}

export function resolveRoundOne(state: SimulationState, decisionId: string, result: RescueOutcome, plan?: TransportPlan): OperationResult {
  if (state.roundOne) return { ok: true, state };
  const costs = { rescueEnergy: result === "RESCUE_APPROVED" ? NPC_RESCUE_ENERGY : 0,
    movementEnergy: MOVEMENT_ENERGY["round-one-passage"], damage: result === "NO_AGREEMENT" ? 10 : 0 };
  const prepared = prepareRoundOne(state, decisionId, result);
  if (!prepared.ok) return prepared;
  const movement = payMovement(prepared.state, costs.movementEnergy, plan);
  if (!movement.ok) return { ...movement, state };
  return { ok: true, state: { ...movement.state, roundOne: { decisionId, result,
    npc: result === "RESCUE_APPROVED" ? "rescued" : "abandoned",
    consequencesApplied: true, completed: true, microearthquake: costs.damage > 0, costs } } };
}
