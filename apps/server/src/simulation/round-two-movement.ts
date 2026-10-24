import { applyDamage } from "./operations.js";
import { traverseRoute, type RandomSource, type RouteError, type RouteId } from "./routes.js";
import { isAlive, type SimulationState } from "./state.js";

export type MovementError = RouteError | "route-not-ready" | "ventilation-hidden"
  | "fatal-microearthquake-order-pending";
export type MovementResolution =
  | { readonly status: "blocked"; readonly decisionId: string; readonly error: MovementError }
  | { readonly status: "completed"; readonly decisionId: string; readonly routeId: RouteId;
      readonly forced: boolean; readonly microearthquake: boolean; readonly accident: boolean;
      readonly energyCost: number; readonly victims: readonly { readonly characterId: string; readonly damage: number }[] };

/** Una transacción: penalización de ruta + desplazamiento + accidente. Sin efectos externos salvo azar. */
export function resolveRoundTwoMovement(state: SimulationState,
  choice: { decisionId: string; outcome: RouteId | "NO_AGREEMENT"; ventilationRevealed: boolean },
  random: RandomSource): { ok: true; state: SimulationState } | { ok: false; state: SimulationState; error: MovementError } {
  const reject = (error: MovementError) => ({ ok: false as const, state, error });
  if (state.roundTwo?.movement) return { ok: true, state };
  if (state.currentRound !== 2 || !state.roundTwo?.resolution) return reject("route-not-ready");
  const forced = choice.outcome === "NO_AGREEMENT";
  const routeId = choice.outcome === "NO_AGREEMENT" ? "unstable-corridor" : choice.outcome;
  if (routeId === "ventilation" && !choice.ventilationRevealed) return reject("ventilation-hidden");
  let next = state;
  if (forced) {
    const living = state.characters.filter(isAlive);
    // No decidir aquí el orden excepcional si la penalización causa fallecimientos.
    if (living.some(character => character.health <= 10)) return reject("fatal-microearthquake-order-pending");
    for (const character of living) {
      const damage = applyDamage(next, character.id, 10);
      if (!damage.ok) return reject(damage.error);
      next = damage.state;
    }
  }
  const traversal = traverseRoute(next, routeId, random);
  if (!traversal.ok) return reject(traversal.error);
  const final = traversal.state;
  const living = next.characters.filter(isAlive);
  const energyCost = living[0]!.energy - final.characters.find(c => c.id === living[0]!.id)!.energy;
  const victims = traversal.victimIds.map(characterId => ({ characterId,
    damage: next.characters.find(c => c.id === characterId)!.health - final.characters.find(c => c.id === characterId)!.health }));
  return { ok: true, state: { ...final, roundTwo: { ...state.roundTwo,
    movement: { status: "completed", decisionId: choice.decisionId, routeId, forced,
      microearthquake: forced, accident: traversal.accident, energyCost, victims } } } };
}
