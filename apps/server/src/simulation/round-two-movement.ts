import type { TransportPlan } from "./transport.js";
import { publicRouteViews, privateRouteViews } from "./routes.js";
import { traverseRoute, type RandomSource, type RouteError, type RouteId } from "./routes.js";
import { type SimulationState } from "./state.js";

export type MovementError = RouteError | "route-not-ready" | "ventilation-hidden";
export type MovementResolution =
  | { readonly status: "blocked"; readonly decisionId: string; readonly error: MovementError }
  | { readonly status: "completed"; readonly decisionId: string; readonly routeId: RouteId;
      readonly forced: boolean; readonly microearthquake: boolean; readonly accident: boolean;
      readonly energyCost: number; readonly victims: readonly { readonly characterId: string; readonly damage: number }[] };

/** Una transacción: penalización de ruta + desplazamiento + accidente. Sin efectos externos salvo azar. */
export function resolveRoundTwoMovement(state: SimulationState,
  choice: { decisionId: string; outcome: RouteId | "NO_AGREEMENT"; ventilationRevealed: boolean },
  random: RandomSource, plan?: TransportPlan): { ok: true; state: SimulationState } | { ok: false; state: SimulationState; error: MovementError } {
  const reject = (error: MovementError) => ({ ok: false as const, state, error });
  if (state.roundTwo?.movement) return { ok: true, state };
  if (state.currentRound !== 2 || !state.roundTwo?.resolution) return reject("route-not-ready");
  const forced = choice.outcome === "NO_AGREEMENT";
  const routeId = choice.outcome === "NO_AGREEMENT" ? "unstable-corridor" : choice.outcome;
  if (routeId === "ventilation" && !choice.ventilationRevealed) return reject("ventilation-hidden");
  const traversal = traverseRoute(state, routeId, random, { guaranteedDamage: forced ? 10 : 0, ...(plan ? { transportPlan: plan } : {}) });
  if (!traversal.ok) return reject(traversal.error);
  const final = traversal.state;
  const energyCost = [...publicRouteViews(), ...privateRouteViews("maintenance")].find(r => r.id === routeId)!.energyCost;
  const victims = traversal.victimIds.map(characterId => ({ characterId,
    damage: Math.max(0, state.characters.find(c => c.id === characterId)!.health - (forced ? 10 : 0))
      - final.characters.find(c => c.id === characterId)!.health }));
  return { ok: true, state: { ...final, roundTwo: { ...state.roundTwo,
    movement: { status: "completed", decisionId: choice.decisionId, routeId, forced,
      microearthquake: forced, accident: traversal.accident, energyCost, victims } } } };
}
