import { applyDamage, spendEnergy, type OperationError } from "./operations.js";
import { isAlive, type HumanRole, type SimulationState } from "./state.js";

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
  { id: "unstable-corridor", name: "Pasillo principal inestable", energyCost: 10,
    danger: "HIGH", accidentProbability: 0.35, accidentDamage: 20, specialists: [] },
  { id: "ventilation", name: "Conductos de ventilación", energyCost: 20,
    danger: "LOW", accidentProbability: 0.10, accidentDamage: 5, specialists: [] },
  { id: "shoring", name: "Despeje y apuntalamiento", energyCost: 30,
    danger: "MODERATE", accidentProbability: 0.20, accidentDamage: 10,
    specialists: ["architect-engineer", "maintenance"] },
];

export type RouteError = OperationError | "unknown-route" | "no-living-characters"
  | "single-survivor-pending" | "specialist-availability-pending"
  | "fatal-accident-order-pending" | "invalid-random";
export type RouteResult =
  | { readonly ok: false; readonly state: SimulationState; readonly error: RouteError }
  | { readonly ok: true; readonly state: SimulationState; readonly routeId: RouteId;
      readonly accident: boolean; readonly victimIds: readonly string[] };

/** Fuente obligatoria e inyectada: cada muestra debe pertenecer a [0, 1). */
export type RandomSource = () => number;

export function checkRouteRequirements(state: SimulationState, routeId: string):
  { ok: true } | { ok: false; error: RouteError } {
  const route = routes.find((entry) => entry.id === routeId);
  if (!route) return { ok: false, error: "unknown-route" };
  const living = state.characters.filter(isAlive);
  if (!living.length) return { ok: false, error: "no-living-characters" };
  if (living.length === 1) return { ok: false, error: "single-survivor-pending" };
  if (route.specialists.some((role) => !living.some((character) => character.role === role))) {
    return { ok: false, error: "specialist-availability-pending" };
  }
  return { ok: true };
}

/** Primitiva de desplazamiento; no inicia rondas ni sustituye su futura transacción. */
export function traverseRoute(state: SimulationState, routeId: string, random: RandomSource): RouteResult {
  const reject = (error: RouteError): RouteResult => ({ ok: false, error, state });
  const requirements = checkRouteRequirements(state, routeId);
  if (!requirements.ok) return reject(requirements.error);
  const route = routes.find((entry) => entry.id === routeId)!;
  const living = state.characters.filter(isAlive);
  let next = state;
  // Estado provisional: un fallo posterior tampoco confirma estos costes.
  for (const character of living) {
    const payment = spendEnergy(next, character.id, route.energyCost);
    if (!payment.ok) return reject(payment.error);
    next = payment.state;
  }
  const roll = random();
  const valid = (sample: number) => Number.isFinite(sample) && sample >= 0 && sample < 1;
  if (!valid(roll)) return reject("invalid-random");
  const accident = roll < route.accidentProbability;
  const victimIds: string[] = [];
  if (accident) {
    const candidates = [...living];
    // Extraer del conjunto impide repetir víctima incluso con muestras iguales.
    for (let i = 0; i < 2; i++) {
      const sample = random();
      if (!valid(sample)) return reject("invalid-random");
      const [victim] = candidates.splice(Math.floor(sample * candidates.length), 1);
      victimIds.push(victim!.id);
    }
    if (living.some((character) => victimIds.includes(character.id) && character.health <= route.accidentDamage)) {
      return reject("fatal-accident-order-pending");
    }
    for (const id of victimIds) {
      const damage = applyDamage(next, id, route.accidentDamage);
      if (!damage.ok) return reject(damage.error);
      next = damage.state;
    }
  }
  return { ok: true, state: next, routeId: route.id, accident, victimIds };
}

/** DTOs locales de preparación; no se han añadido mensajes ni tipos al cliente. */
export interface RouteView { id: RouteId; name: string; energyCost: number }
const view = (route: RouteDefinition): RouteView => ({ id: route.id, name: route.name, energyCost: route.energyCost });

// No publica la existencia de la ruta técnica conocida por Mantenimiento.
export function publicRouteViews(): RouteView[] {
  return routes.filter((route) => route.id !== "ventilation").map(view);
}

export function privateRouteViews(role: HumanRole): RouteView[] {
  return role === "maintenance" ? routes.filter((route) => route.id === "ventilation").map(view) : [];
}
