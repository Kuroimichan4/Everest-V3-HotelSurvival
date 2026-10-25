import { ACCIDENT_PROBABILITIES } from "./balance-probabilities.js";
import { SHORING_SPECIALIST_ENERGY, MOVEMENT_ENERGY } from "./energy-costs.js";
import { payMovement, type MovementCost, type MovementCharge, type TransportPlan } from "./transport.js";
import { applyDamage, type OperationError } from "./operations.js";
import { isAlive, type HumanRole, type SimulationState, type EngineState } from "./state.js";

export function roundTwoMovementCost(id: string): MovementCost {
 const base = MOVEMENT_ENERGY[id as "shoring" | "ventilation" | "unstable-corridor"];
 return id === "shoring" ? { base, extraByRole: { maintenance: SHORING_SPECIALIST_ENERGY, "architect-engineer": SHORING_SPECIALIST_ENERGY } } : base;
}
export type RouteId = "unstable-corridor" | "ventilation" | "shoring";
type Danger = "LOW" | "MODERATE" | "HIGH";
interface RouteDefinition {
  readonly id: RouteId;
  readonly name: string;
  readonly energyCost: number;
  readonly danger: Danger;
  readonly accidentProbability: number;
  readonly accidentDamage: number;
  readonly specialists: readonly HumanRole[];
}

/** Catálogo exclusivo del backend. No serializar estas definiciones. */
const routes: readonly RouteDefinition[] = [
  { id: "unstable-corridor", name: "Pasillo principal", energyCost: MOVEMENT_ENERGY["unstable-corridor"],
    danger: "HIGH", accidentProbability: ACCIDENT_PROBABILITIES.HIGH, accidentDamage: 20, specialists: [] },
  { id: "ventilation", name: "Conductos de ventilación", energyCost: MOVEMENT_ENERGY["ventilation"],
    danger: "LOW", accidentProbability: ACCIDENT_PROBABILITIES.LOW, accidentDamage: 5, specialists: [] },
  { id: "shoring", name: "Despeje y apuntalamiento", energyCost: MOVEMENT_ENERGY["shoring"],
    danger: "MODERATE", accidentProbability: ACCIDENT_PROBABILITIES.MODERATE, accidentDamage: 10,
    specialists: ["architect-engineer", "maintenance"] },
];

/** Solo para evidencias internas; nunca incluir en las vistas de rutas. */
export function internalRouteRisk(id: string) { return routes.find(route => route.id === id)?.danger ?? null; }

export type RouteError = OperationError | "unknown-route" | "no-living-characters"
  | "specialist-availability-pending" | "invalid-route-effects" | "invalid-random";
export type RouteResult =
  | { readonly ok: false; readonly state: SimulationState; readonly error: RouteError }
  | { readonly ok: true; readonly state: SimulationState; readonly routeId: RouteId;
      readonly accident: boolean; readonly victimIds: readonly string[]; readonly charges: readonly MovementCharge[] };

/** Fuente obligatoria e inyectada: cada muestra debe pertenecer a [0, 1). */
export type RandomSource = () => number;

export function checkRouteRequirements(state: SimulationState, routeId: string):
  { ok: true } | { ok: false; error: RouteError } {
  const route = routes.find((entry) => entry.id === routeId);
  if (!route) return { ok: false, error: "unknown-route" };
  const living = state.characters.filter(isAlive);
  if (!living.length) return { ok: false, error: "no-living-characters" };
  if (route.specialists.some((role) => !living.some((character) => character.role === role))) {
    return { ok: false, error: "specialist-availability-pending" };
  }
  return { ok: true };
}

/** Primitiva de ronda 2: conserva catálogo, requisitos y resultado existentes. */
export function traverseRoute(state: SimulationState, routeId: string, random: RandomSource, options?: { guaranteedDamage?: number; transportPlan?: TransportPlan }): RouteResult {
  const requirements = checkRouteRequirements(state, routeId);
  if (!requirements.ok) return { ok: false, state, error: requirements.error };
  const route = routes.find(entry => entry.id === routeId)!;
  const result = traverseRouteEffects(state, { ...route, movementCost: roundTwoMovementCost(route.id), guaranteedDamage: options?.guaranteedDamage ?? 0 }, random, options?.transportPlan);
  return result.ok ? { ...result, routeId: route.id } : result;
}

export interface RouteEffects {
  readonly movementCost?: MovementCost;
  readonly energyCost: number;
  readonly accidentProbability: number;
  readonly accidentDamage: number;
  readonly guaranteedDamage?: number;
}
export interface MovementDamage {
  readonly characterId: string;
  readonly accidentDamage: number;
  readonly guaranteedDamage: number;
  readonly total: number;
  readonly healthLost: number;
}
export type RouteEffectsResult<S extends EngineState = SimulationState> =
  | { readonly ok: false; readonly state: S; readonly error: RouteError }
  | { readonly ok: true; readonly state: S; readonly accident: boolean; readonly victimIds: readonly string[]; readonly damage: readonly MovementDamage[];
      readonly deceasedIds: readonly string[]; readonly charges: readonly MovementCharge[] };

/** Mismo pago y accidente para los catálogos de backend. No exponer las definiciones al cliente. */
export const MAX_ACCIDENT_VICTIMS = 3;
export function traverseRouteEffects<S extends EngineState>(state: S, route: RouteEffects, random: RandomSource, plan?: TransportPlan): RouteEffectsResult<S> {
  return traverseEffects(state, route, random, MAX_ACCIDENT_VICTIMS, plan);
}
/** Contrafactual estadístico del mismo motor. Ningún coordinador de partida usa este adaptador. */
export function simulateRouteEffectsForAnalysis<S extends EngineState>(state:S, route:RouteEffects, random:RandomSource, victimLimit:2|3):RouteEffectsResult<S> {
  return traverseEffects(state,route,random,victimLimit);
}
function traverseEffects<S extends EngineState>(state: S, route: RouteEffects, random: RandomSource, victimLimit:2|3, plan?: TransportPlan): RouteEffectsResult<S> {
  const reject = (error: RouteError): RouteEffectsResult<S> => ({ ok: false, error, state });
  if (!Number.isFinite(route.energyCost) || route.energyCost < 0
    || !Number.isFinite(route.accidentProbability) || route.accidentProbability < 0 || route.accidentProbability > 1
    || !Number.isFinite(route.accidentDamage) || route.accidentDamage < 0
    || !Number.isFinite(route.guaranteedDamage ?? 0) || (route.guaranteedDamage ?? 0) < 0) return reject("invalid-route-effects");
  const living = state.characters.filter(isAlive);
  if (!living.length) return reject("no-living-characters");
  const payment = payMovement(state, route.movementCost ?? route.energyCost, plan);
  if (!payment.ok) return reject(payment.error);
  let next = payment.state;
  const roll = random();
  const valid = (sample: number) => Number.isFinite(sample) && sample >= 0 && sample < 1;
  if (!valid(roll)) return reject("invalid-random");
  const accident = roll < route.accidentProbability;
  const victimIds: string[] = [];
  if (accident) {
    const candidates = [...living];
    for (let i = 0; i < Math.min(victimLimit, living.length); i++) {
      const sample = random();
      if (!valid(sample)) return reject("invalid-random");
      const [victim] = candidates.splice(Math.floor(sample * candidates.length), 1);
      victimIds.push(victim!.id);
    }
  }
  const damage: MovementDamage[] = living.map(character => {
    const accidentDamage = victimIds.includes(character.id) ? route.accidentDamage : 0;
    const guaranteedDamage = route.guaranteedDamage ?? 0;
    const total = accidentDamage + guaranteedDamage;
    return { characterId: character.id, accidentDamage, guaranteedDamage, total, healthLost: Math.min(character.health, total) };
  });
  for (const effect of damage) {
    if (effect.total === 0) continue;
    const applied = applyDamage(next, effect.characterId, effect.total);
    if (!applied.ok) return reject(applied.error);
    next = applied.state;
  }
  return { ok: true, state: next, accident, victimIds, damage, charges: payment.charges,
    deceasedIds: living.filter(c => next.characters.find(final => final.id === c.id)!.health === 0).map(c => c.id) };
}

/** DTOs locales de preparación; no se han añadido mensajes ni tipos al cliente. */
export interface RouteView { id: RouteId; name: string; description: string; energyCost: number }
const descriptions: Record<RouteId, string> = {
  "unstable-corridor": "El pasillo atraviesa la zona de habitaciones. El techo agrietado y los muebles desplazados dejan un paso entre los escombros.",
  ventilation: "Un acceso de servicio permite recorrer los conductos de ventilación hasta el otro lado del pasillo.",
  shoring: "El equipo puede retirar obstáculos y apuntalar el paso. Requiere la participación activa de Mantenimiento y Arquitecto / Ingeniero.",
};
const view = (route: RouteDefinition): RouteView => ({ id: route.id, name: route.name, description: descriptions[route.id], energyCost: route.energyCost });

// No publica la existencia de la ruta técnica conocida por Mantenimiento.
export function publicRouteViews(): RouteView[] {
  return routes.filter((route) => route.id !== "ventilation").map(view);
}

export function privateRouteViews(role: HumanRole): RouteView[] {
  return role === "maintenance" ? routes.filter((route) => route.id === "ventilation").map(view) : [];
}
