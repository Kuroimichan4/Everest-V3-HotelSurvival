import { sectorWasEvacuated } from "./transport-crisis.js";
import { NPC_RESCUE_ENERGY } from "./energy-costs.js";
import type { RescueOutcome } from "@everest/shared";
import { applyDamage, spendEnergy, type OperationResult } from "./operations.js";
import { isAlive, type SimulationState } from "./state.js";

export function beginRoundTwo(state: SimulationState): SimulationState {
  if (state.currentRound !== 1 || (!state.roundOne && !sectorWasEvacuated(state, 1)) || state.roundTwo) return state;
  return { ...state, currentRound: 2,
    roundTwo: { npcId: "round-two-survivor", resolution: null, blocked: null } };
}

/** Todos los humanos vivos participan, como en ronda 1. Transacción atómica. */
export function resolveRoundTwo(state: SimulationState, decisionId: string, result: RescueOutcome): OperationResult {
  if (!state.roundTwo || state.roundTwo.resolution) return { ok: true, state };
  const costs = { rescueEnergy: result === "RESCUE_APPROVED" ? NPC_RESCUE_ENERGY : 0,
    movementEnergy: 0, damage: result === "NO_AGREEMENT" ? 10 : 0 };
  let next = state;
  for (const character of state.characters.filter(isAlive)) {
    if (!costs.rescueEnergy && !costs.damage) continue;
    const effect = costs.damage ? applyDamage(next, character.id, costs.damage)
      : spendEnergy(next, character.id, costs.rescueEnergy);
    if (!effect.ok) return { ...effect, state };
    next = effect.state;
  }
  return { ok: true, state: { ...next, roundTwo: { ...state.roundTwo, blocked: null,
    resolution: { decisionId, result, npc: result === "RESCUE_APPROVED" ? "rescued" : "abandoned",
      consequencesApplied: true, completed: true, microearthquake: costs.damage > 0, costs } } } };
}
