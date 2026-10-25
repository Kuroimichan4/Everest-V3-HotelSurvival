import { ACCIDENT_PROBABILITIES } from "./balance-probabilities.js";
import { administerTreatment, consumePack, applyDamage } from "./operations.js";
import { INTERMEDIATE_ENERGY } from "./energy-costs.js";
import { isAlive, type EngineState } from "./state.js";
import { recordMaintenanceRevelation } from "./objective-evidence.js";
import { traverseRouteEffects, type RandomSource, type RouteEffectsResult } from "./routes.js";
import type { TransportPlan } from "./transport.js";
import { createDecision } from "../voting/engine.js";
import type { Decision } from "../voting/types.js";

export type IntermediateRound = 4 | 5;
export type IntermediateRouteId = keyof typeof INTERMEDIATE_ENERGY;
type Risk = "LOW" | "MODERATE" | "HIGH" | "EXTREME";
interface Definition {
  id: IntermediateRouteId; round: IntermediateRound; name: string; description: string;
  private: boolean; danger: Risk; accidentProbability: number; accidentDamage: number;
}
/** Servidor exclusivamente. No serializar el catálogo. */
const definitions: readonly Definition[] = [
  { id: "cracked-stairs", round: 4, name: "Escalera de emergencia agrietada", description: "Los peldaños y descansillos presentan grietas. El grupo debe descender entre fragmentos desprendidos.", private: false, danger: "HIGH", accidentProbability: ACCIDENT_PROBABILITIES.HIGH, accidentDamage: 20 },
  { id: "service-walkway", round: 4, name: "Pasarela de servicio reforzada", description: "Una pasarela metálica anclada a los pilares principales recorre el lateral de la planta.", private: false, danger: "MODERATE", accidentProbability: ACCIDENT_PROBABILITIES.MODERATE, accidentDamage: 10 },
  { id: "technical-stairs", round: 4, name: "Escalera técnica junto al montacargas", description: "Descansillos protegidos y amplios permiten transportar compañeros. El montacargas está averiado y no se utiliza.", private: true, danger: "LOW", accidentProbability: ACCIDENT_PROBABILITIES.LOW, accidentDamage: 5 },
  { id: "collapsed-kitchen", round: 5, name: "Cocina industrial derrumbada", description: "La maquinaria desplazada ocupa la cocina. Entre las piezas caídas quedan huecos por los que el grupo puede avanzar.", private: false, danger: "EXTREME", accidentProbability: ACCIDENT_PROBABILITIES.EXTREME, accidentDamage: 30 },
  { id: "restaurant-corridor", round: 5, name: "Pasillo del restaurante", description: "Un corredor más largo evita la maquinaria; el falso techo dañado puede desprenderse.", private: false, danger: "MODERATE", accidentProbability: ACCIDENT_PROBABILITIES.MODERATE, accidentDamage: 10 },
  { id: "extraction-gallery", round: 5, name: "Galería de extracción de cocinas", description: "Pasarela transitable junto a grandes conductos hasta el vestíbulo, suficientemente amplia para asistir y transportar humanos agotados.", private: true, danger: "LOW", accidentProbability: ACCIDENT_PROBABILITIES.LOW, accidentDamage: 5 },
];
export function internalIntermediateRoute(id: string) {
  const route = definitions.find(r => r.id === id);
  return route ? { ...route, energyCost: INTERMEDIATE_ENERGY[route.id] } : null;
}
export interface IntermediateNoAgreement {
  readonly round: IntermediateRound;
  readonly decisionId: string;
  readonly forcedRouteId: "cracked-stairs" | "collapsed-kitchen";
  readonly damage: readonly { characterId: string; healthLost: number }[];
  readonly deceasedIds: readonly string[];
}
type Traversal = Omit<Extract<RouteEffectsResult<EngineState>, { ok: true }>, "ok" | "state">;
export type IntermediateRecord = { round: IntermediateRound; requestId: string; routeId: IntermediateRouteId; forcedByNoAgreement?: boolean } & (
  { status: "completed"; realRisk: Risk; effects: Traversal } |
  { status: "blocked"; error: "invalid-random" });
export interface IntermediateState extends EngineState {
  readonly resourceReceipts?: readonly { requestId: string; actorId: string; patientId: string; kind: "pack" | "treatment"; round: IntermediateRound }[];
  readonly currentRound: IntermediateRound;
  readonly intermediate: { readonly round: IntermediateRound; readonly phase: "preparation" | "voting" | "movement" | "completed"; readonly decision?: Decision };
}
/** Preparación sin recursos nuevos; el gestor valida la transición desde la ronda anterior. */
export function prepareIntermediateRound(state: EngineState, round: IntermediateRound): IntermediateState {
  return { ...state, currentRound: round, intermediate: { round, phase: "preparation" } };
}
const revealed = (state: EngineState, id: string) => state.routeRevelations?.some(r => r.routeId === id && r.initiallyUnknownToOthers) ?? false;
/** characterId debe proceder de connections -> participant.characterId, nunca del payload. */
export function intermediateRouteViews(state: IntermediateState, authenticatedCharacterId: string) {
  const actor = state.characters.find(c => c.id === authenticatedCharacterId && isAlive(c));
  if (!actor) return [];
  return definitions.filter(r => r.round === state.currentRound && (!r.private || revealed(state, r.id) || actor.role === "maintenance"))
    .map(r => ({ id: r.id, name: r.name, description: r.description, energyCost: INTERMEDIATE_ENERGY[r.id] }));
}
export function revealIntermediateRoute(state: IntermediateState, authenticatedCharacterId: string, now: number) {
  const actor = state.characters.find(c => c.id === authenticatedCharacterId && isAlive(c) && c.role === "maintenance");
  if (!actor) return { ok: false as const, state, error: "not-authorized" };
  if (state.intermediate.phase !== "preparation") return { ok: false as const, state, error: "preparation-closed" };
  if (!Number.isFinite(now) || now < 0) return { ok: false as const, state, error: "invalid-time" };
  const route = definitions.find(r => r.round === state.currentRound && r.private)!;
  return { ok: true as const, state: recordMaintenanceRevelation(state, { id: route.id, round: route.round, initiallyPrivate: true }, actor.id, now) };
}
/** Opciones del servidor: jamás incluir conocimiento privado sin compartir. */
export function openIntermediateVote(state: IntermediateState, id: string, attemptId: string, now: number, electorate = state.characters.map(c => ({ participantId: c.id, alive: isAlive(c) }))) {
  if (state.intermediate.phase !== "preparation") return { ok: false as const, error: "preparation-closed", state };
  const created = createDecision({ id, attemptId, now,
    electorate,
    options: definitions.filter(r => r.round === state.currentRound && (!r.private || revealed(state, r.id))).map(r => ({ id: r.id, label: r.name })) });
  return created.ok ? { ok: true as const, state: { ...state, intermediate: { ...state.intermediate, phase: "voting" as const, decision: created.state } } } : { ...created, state };
}
/** Consume el resultado del motor existente; no añade consecuencias a no-agreement. */
export function settleIntermediateVote(state: IntermediateState): IntermediateState {
  const decision = state.intermediate.decision;
  if (state.intermediate.phase !== "voting" || decision?.status !== "closed") return state;
  let next = state;
  if (decision.result.kind === "no-agreement" && !state.intermediateConsequences?.some(r => r.round === state.currentRound)) {
    if (decision.attempts.length !== 2 || decision.attempts.some(a => a.status !== "closed" || a.result.kind !== "no-majority")) return state;
    const living = state.characters.filter(isAlive);
    for (const human of living) {
      const hit = applyDamage(next, human.id, 10);
      if (!hit.ok) return state;
      next = hit.state;
    }
    const consequence: IntermediateNoAgreement = { round: state.currentRound, decisionId: decision.id,
      forcedRouteId: state.currentRound === 4 ? "cracked-stairs" : "collapsed-kitchen",
      damage: living.map(c => ({ characterId: c.id, healthLost: Math.min(10, c.health) })),
      deceasedIds: living.filter(c => !isAlive(next.characters.find(n => n.id === c.id)!)).map(c => c.id) };
    next = { ...next, intermediateConsequences: [...(next.intermediateConsequences ?? []), consequence] };
  }
  return { ...next, intermediate: { ...next.intermediate, phase: "movement" } };
}
/** La ruta forzada requiere el recibo de servidor de los dos intentos fallidos. */
export function intermediateSelection(state: IntermediateState) {
  const decision = state.intermediate.decision;
  if (state.intermediate.phase !== "movement" || decision?.status !== "closed") return null;
  if (decision.result.kind === "approved") return { requestId: decision.id, routeId: decision.result.optionId, forced: false };
  const receipt = state.intermediateConsequences?.find(r => r.round === state.currentRound && r.decisionId === decision.id);
  return receipt ? { requestId: decision.id, routeId: receipt.forcedRouteId, forced: true } : null;
}
export function resolveIntermediateRoute(state: IntermediateState, requestId: string, routeId: string, random: RandomSource, plan?: TransportPlan) {
  const reject = (error: string) => ({ ok: false as const, state, error });
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 100) return reject("invalid-request");
  const previous = state.intermediateRounds?.find(r => r.round === state.currentRound);
  if (previous) return previous.requestId !== requestId || previous.routeId !== routeId ? reject("already-resolved")
    : previous.status === "blocked" ? reject(previous.error) : { ok: true as const, state, outcome: previous };
  const route = internalIntermediateRoute(routeId);
  if (!route || route.round !== state.currentRound) return reject("unknown-route");
  if (route.private && !revealed(state, route.id)) return reject("hidden-route");
  const selection = intermediateSelection(state);
  if (!selection || selection.routeId !== routeId) return reject("route-not-approved");
  const moved = traverseRouteEffects(state, route, random, plan);
  if (!moved.ok) {
    if (moved.error !== "invalid-random") return moved;
    const record: IntermediateRecord = { round: state.currentRound, requestId, routeId: route.id, status: "blocked", error: moved.error };
    return { ...moved, state: { ...state, intermediateRounds: [...(state.intermediateRounds ?? []), record] } };
  }
  const { ok: _ok, state: _state, ...effects } = moved;
  const outcome: IntermediateRecord = { round: state.currentRound, requestId, routeId: route.id, status: "completed", forcedByNoAgreement: selection.forced, realRisk: route.danger, effects };
  return { ok: true as const, outcome, state: { ...moved.state, intermediate: { ...state.intermediate, phase: "completed" as const }, intermediateRounds: [...(state.intermediateRounds ?? []), outcome] } };
}

/** Ventanas internas: preparación y movimiento aprobado (incluye bloqueo por agotamiento). */
export function intermediateResourceWindow(state: IntermediateState) {
  return state.intermediate.phase === "preparation" || state.intermediate.phase === "movement";
}

/** Identidad obtenida por el adaptador de servidor desde la conexión autenticada existente. */
export function administerIntermediateResource(state: IntermediateState, actorId: string, patientId: string, kind: "pack" | "treatment", requestId: string) {
  const reject = (error: string) => ({ ok: false as const, error, state });
  const actor = state.characters.find(c => c.id === actorId && isAlive(c));
  if (!actor || actor.role !== (kind === "pack" ? "bellhop" : "medic")) return reject("not-authorized");
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 100) return reject("invalid-request");
  const previous = state.resourceReceipts?.find(r => r.requestId === requestId);
  if (previous) return previous.actorId === actorId && previous.patientId === patientId && previous.kind === kind && previous.round === state.currentRound
    ? { ok: true as const, state } : reject("request-conflict");
  if (!intermediateResourceWindow(state)) return reject("supplies-not-open");
  const applied = kind === "pack" ? consumePack(state, patientId) : administerTreatment(state, patientId);
  if (!applied.ok) return applied;
  return { ok: true as const, state: { ...applied.state, resourceReceipts: [...(state.resourceReceipts ?? []), { requestId, actorId, patientId, kind, round: state.currentRound }] } };
}

/** Adaptador sin eventos nuevos: la futura integración pasa su búsqueda connections.get(socketId).
 * El navegador no puede elegir characterId. Misma resolución de identidad que routeAction. */
export function revealIntermediateFromSession(state: IntermediateState, socketId: string,
  resolveCharacter: (socketId: string) => string | null, now: number) {
  const characterId = resolveCharacter(socketId);
  return characterId === null ? { ok: false as const, state, error: "invalid-session" } : revealIntermediateRoute(state, characterId, now);
}

/** Diagnóstico interno para integración: jamás revela la ruta ni nombra un sucesor. */
export function intermediateMaintenanceStatus(state: IntermediateState) {
  const route = definitions.find(r => r.round === state.currentRound && r.private)!;
  return !revealed(state, route.id) && !state.characters.some(c => c.role === "maintenance" && isAlive(c))
    ? "replacement-policy-pending" : "available-or-already-revealed";
}
export const INTERMEDIATE_CONTEXT = Object.freeze({
  4: { title: "Descenso entre las ruinas", narrative: "Tras abandonar la planta de servicios, una nueva réplica ha dañado las escaleras. El grupo debe descender hasta los niveles inferiores antes de que los accesos queden sepultados." },
  5: { title: "El último corredor", narrative: "El grupo llega a las dependencias de personal, cocinas y accesos del restaurante. El vestíbulo está cerca, pero las réplicas han desprendido techos, desplazado maquinaria y deteriorado las instalaciones." },
});
