import type { TransportPlan } from "./transport.js";
import type { SimulationState } from "./state.js";
import { resolveRoundThreeRoute, type RoundThreeRouteId } from "./round-three-routes.js";
import type { RandomSource } from "./routes.js";

export function beginRoundThree(state: SimulationState): SimulationState {
  if (state.currentRound !== 2 || state.roundTwo?.movement?.status !== "completed" || state.roundThreeRoute) return state;
  return { ...state, currentRound: 3 };
}

/** El terremoto bloquea alternativas, sin daño directo. La galería mantiene sus efectos normales. */
export function resolveRoundThreeChoice(state: SimulationState,
  selection: { decisionId: string; outcome: RoundThreeRouteId | "NO_AGREEMENT" }, random: RandomSource, plan?: TransportPlan) {
  return resolveRoundThreeRoute(state, selection.decisionId,
    selection.outcome === "NO_AGREEMENT" ? "pipe-gallery" : selection.outcome, random, plan);
}
