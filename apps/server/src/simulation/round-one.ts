import type { RescueOutcome } from "@everest/shared";
import { applyDamage, spendEnergy, type OperationResult } from "./operations.js";
import type { SimulationState } from "./state.js";

/** Transacción pura: el gestor publica únicamente el estado completo tras el éxito. */
export function resolveRoundOne(state: SimulationState, decisionId: string, result: RescueOutcome): OperationResult {
  if (state.roundOne) return { ok: true, state };
  const costs = { rescueEnergy: result === "RESCUE_APPROVED" ? 25 : 0,
    movementEnergy: 15, damage: result === "NO_AGREEMENT" ? 10 : 0 };
  let next = state;
  // Primero rescate o microterremoto; después ruta obligatoria sin azar.
  for (const character of state.characters) {
    const effect = costs.damage ? applyDamage(next, character.id, costs.damage)
      : spendEnergy(next, character.id, costs.rescueEnergy);
    if (!effect.ok) return { ...effect, state };
    next = effect.state;
  }
  for (const character of state.characters) {
    const movement = spendEnergy(next, character.id, costs.movementEnergy);
    if (!movement.ok) return { ...movement, state };
    next = movement.state;
  }
  return { ok: true, state: { ...next, roundOne: { decisionId, result,
    npc: result === "RESCUE_APPROVED" ? "rescued" : "abandoned",
    consequencesApplied: true, completed: true, microearthquake: costs.damage > 0, costs } } };
}
