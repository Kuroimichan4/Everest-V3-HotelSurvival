import { traverseRouteEffects, type RouteEffects, type RouteEffectsResult, type RandomSource, type RouteError } from "./routes.js";
import type { SimulationState } from "./state.js";
import type { TransportPlan } from "./transport.js";

export interface TransportMovementRecord {
  readonly requestId: string;
  readonly round: SimulationState["currentRound"];
  readonly signature: string;
  readonly plan: TransportPlan;
  readonly charges: Extract<RouteEffectsResult, { ok: true }>["charges"];
  readonly damage: Extract<RouteEffectsResult, { ok: true }>["damage"];
  readonly victimIds: readonly string[];
  readonly deceasedIds: readonly string[];
  readonly accident: boolean;
}
export type TransportMovementResult =
  | { readonly ok: true; readonly state: SimulationState; readonly outcome: TransportMovementRecord }
  | { readonly ok: false; readonly state: SimulationState; readonly error: RouteError | "invalid-request" | "movement-request-conflict" };

/** Operación interna preparada para 8B. No se invoca desde ningún evento o votación actual. */
export function resolveTransportMovement(state: SimulationState, requestId: string, effects: RouteEffects,
  plan: TransportPlan, random: RandomSource): TransportMovementResult {
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 100) return { ok: false, state, error: "invalid-request" };
  if (!plan || !Array.isArray(plan.carrierIds) || !Array.isArray(plan.transportedIds)) return { ok: false, state, error: "invalid-transport-plan" };
  const signature = JSON.stringify([state.currentRound, effects.energyCost, effects.accidentProbability,
    effects.accidentDamage, effects.guaranteedDamage ?? 0, [...plan.carrierIds].sort(), [...plan.transportedIds].sort()]);
  const previous = state.transportMovements?.find(record => record.requestId === requestId);
  if (previous) return previous.signature === signature ? { ok: true, state, outcome: previous }
    : { ok: false, state, error: "movement-request-conflict" };
  const moved = traverseRouteEffects(state, effects, random, plan);
  if (!moved.ok) return moved;
  const outcome: TransportMovementRecord = { requestId, round: state.currentRound, signature,
    plan: { carrierIds: [...plan.carrierIds], transportedIds: [...plan.transportedIds] },
    charges: moved.charges, damage: moved.damage, victimIds: moved.victimIds, deceasedIds: moved.deceasedIds, accident: moved.accident };
  return { ok: true, state: { ...moved.state, transportMovements: [...(state.transportMovements ?? []), outcome] }, outcome };
}
