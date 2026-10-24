import { payMovement, type MovementCharge, type TransportPlan } from "./transport.js";
import { applyDamage, type OperationError } from "./operations.js";
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
  | "specialist-availability-pending" | "invalid-route-effects" | "invalid-random";
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
  const result = traverseRouteEffects(state, { ...route, guaranteedDamage: options?.guaranteedDamage ?? 0 }, random, options?.transportPlan);
  return result.ok ? { ...result, routeId: route.id } : result;
}

export interface RouteEffects {
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
export type RouteEffectsResult =
  | { readonly ok: false; readonly state: SimulationState; readonly error: RouteError }
  | { readonly ok: true; readonly state: SimulationState; readonly accident: boolean; readonly victimIds: readonly string[]; readonly damage: readonly MovementDamage[];
      readonly deceasedIds: readonly string[]; readonly charges: readonly MovementCharge[] };

/** Mismo pago y accidente para los catálogos de backend. No exponer las definiciones al cliente. */
export function traverseRouteEffects(state: SimulationState, route: RouteEffects, random: RandomSource, plan?: TransportPlan): RouteEffectsResult {
  const reject = (error: RouteError): RouteEffectsResult => ({ ok: false, error, state });
  if (!Number.isFinite(route.energyCost) || route.energyCost < 0
    || !Number.isFinite(route.accidentProbability) || route.accidentProbability < 0 || route.accidentProbability > 1
    || !Number.isFinite(route.accidentDamage) || route.accidentDamage < 0
    || !Number.isFinite(route.guaranteedDamage ?? 0) || (route.guaranteedDamage ?? 0) < 0) return reject("invalid-route-effects");
  const living = state.characters.filter(isAlive);
  if (!living.length) return reject("no-living-characters");
  const payment = payMovement(state, route.energyCost, plan);
  if (!payment.ok) return reject(payment.error);
  let next = payment.state;
  const roll = random();
  const valid = (sample: number) => Number.isFinite(sample) && sample >= 0 && sample < 1;
  if (!valid(roll)) return reject("invalid-random");
  const accident = roll < route.accidentProbability;
  const victimIds: string[] = [];
  if (accident) {
    const candidates = [...living];
    for (let i = 0; i < Math.min(2, living.length); i++) {
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
export interface RouteView { id: RouteId; name: string; energyCost: number }
const view = (route: RouteDefinition): RouteView => ({ id: route.id, name: route.name, energyCost: route.energyCost });

// No publica la existencia de la ruta técnica conocida por Mantenimiento.
export function publicRouteViews(): RouteView[] {
  return routes.filter((route) => route.id !== "ventilation").map(view);
}

export function privateRouteViews(role: HumanRole): RouteView[] {
  return role === "maintenance" ? routes.filter((route) => route.id === "ventilation").map(view) : [];
}
