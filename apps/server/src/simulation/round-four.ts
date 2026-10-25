import { sectorWasEvacuated } from "./transport-crisis.js";
import { ACCIDENT_PROBABILITIES } from "./balance-probabilities.js";
import { IMMOBILE_NPC_RESCUE_ENERGY, EXIT_MOVEMENT_ENERGY, NPC_RESCUE_ENERGY } from "./energy-costs.js";
import { applyDamage, spendEnergy, type OperationError } from "./operations.js";
import { traverseRouteEffects, type RandomSource, type RouteError, type RouteEffectsResult } from "./routes.js";
import { routeEnergyAvailability, type TransportPlan } from "./transport.js";
import { isAlive, type SimulationState } from "./state.js";

export type ExitRouteId = "revolving-door" | "exterior-crack";
export type NpcEncounter = "none" | "walking-assisted" | "immobile";
export type NpcChoice = "abandon" | "assist" | "carry" | "medical-assist";
export const ROUND_FOUR_VOTE_SECONDS = Object.freeze([60, 30] as const);
export const NPC_WEAKENING_MESSAGE = "El superviviente parece debilitarse a cada segundo que pasa";

/** Catálogo interno: no serializar al cliente. */
export const ROUND_FOUR_ROUTES = Object.freeze({
  "revolving-door": Object.freeze({ name: "Puerta giratoria dañada del vestíbulo", energyCost: EXIT_MOVEMENT_ENERGY["revolving-door"],
    danger: "LOW", accidentProbability: ACCIDENT_PROBABILITIES.LOW, accidentDamage: 5 }),
  "exterior-crack": Object.freeze({ name: "Grieta en el muro exterior del acceso de carga y descarga", energyCost: EXIT_MOVEMENT_ENERGY["exterior-crack"],
    danger: "EXTREME", accidentProbability: ACCIDENT_PROBABILITIES.EXTREME, accidentDamage: 30 }),
});

interface NpcState {
  readonly encounter: NpcEncounter;
  readonly status: "absent" | "awaiting-decision" | "awaiting-effort" | "rescued" | "abandoned" | "dead";
  readonly decision?: { readonly id: string; readonly choice: NpcChoice };
  readonly failedAttempts: 0 | 1 | 2;
  readonly voteId?: string;
  readonly message?: string;
  readonly rescue?: { readonly energyPerHuman: number; readonly participantIds: readonly string[]; readonly medicalUnits: number };
}
type Traversal = Extract<RouteEffectsResult<RoundFourState>, { ok: true }>;
export interface ExitOutcome {
  readonly requestId: string;
  readonly routeId: ExitRouteId;
  readonly forced: boolean;
  readonly energyCost: number;
  readonly accident: boolean;
  readonly victimIds: Traversal["victimIds"];
  readonly deceasedIds: Traversal["deceasedIds"];
  readonly damage: Traversal["damage"];
  readonly charges: Traversal["charges"];
  readonly transportPlan?: TransportPlan;
  /** Hechos del motor, sin puntuación ni premios inventados. */
  readonly rescuedNpc: boolean;
  readonly escapedHumanIds: readonly string[];
}
export interface RoundFourState extends SimulationState<6> {
  readonly roundFour: {
    readonly npc: NpcState;
    readonly exitVote?: { readonly id: string; readonly failedAttempts: 1 | 2 };
    readonly collapse?: { readonly damage: 5; readonly affectedIds: readonly string[]; readonly deceasedIds: readonly string[] };
    readonly energySurcharge: 0 | 5;
    readonly revolvingDoorBlocked: boolean;
    readonly forcedRoute: "exterior-crack" | null;
    readonly exit?: ExitOutcome;
    /** Impide volver a tirar tras un fallo de la fuente aleatoria. */
    readonly blockedMovement?: { readonly requestId: string; readonly routeId: ExitRouteId; readonly error: "invalid-random" };
  };
}
export type RoundFourError = OperationError | RouteError | "round-four-not-ready" | "invalid-request"
  | "decision-conflict" | "npc-absent" | "npc-decision-closed" | "invalid-npc-choice" | "invalid-attempt"
  | "npc-decision-pending" | "crowbar-unavailable" | "door-collapsed" | "forced-route-required"
  | "exit-already-resolved" | "combined-effort-pending";
export type RoundFourResult = { readonly ok: true; readonly state: RoundFourState }
  | { readonly ok: false; readonly state: RoundFourState; readonly error: RoundFourError };
const validId = (id: string) => typeof id === "string" && !!id.trim() && id.length <= 100;
const reject = (state: RoundFourState, error: RoundFourError): RoundFourResult => ({ ok: false, state, error });
const success = (state: RoundFourState): RoundFourResult => ({ ok: true, state });

/** Opciones y costes autorizados, sin probabilidades internas. */
export function roundFourNpcOptions(state: RoundFourState) {
  const option = (id: NpcChoice, label: string, energyPerHuman: number, medicalUnits = 0) =>
    ({ id, label, energyPerHuman, medicalUnits, available: state.inventory.medicalUnits >= medicalUnits });
  if (state.roundFour.npc.encounter === "none") return [];
  return [option("abandon", "Abandonar al superviviente", 0), ...(state.roundFour.npc.encounter === "walking-assisted"
    ? [option("assist", "Ayudarle a caminar", NPC_RESCUE_ENERGY)]
    : [option("carry", "Transportar al superviviente", IMMOBILE_NPC_RESCUE_ENERGY),
      option("medical-assist", "Usar una unidad médica y ayudarle", NPC_RESCUE_ENERGY, 1)])];
}

export function generateRoundFourEncounter(random: RandomSource): NpcEncounter | null {
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return null;
  return roll < 0.5 ? "none" : roll < 0.75 ? "walking-assisted" : "immobile";
}

/** El llamador conserva el estado devuelto. Ningún registro global ni temporizador. */
export function beginRoundFour(state: SimulationState | RoundFourState, random: RandomSource):
  { ok: true; state: RoundFourState } | { ok: false; state: SimulationState | RoundFourState; error: RoundFourError } {
  if (state.currentRound === 6) return success(state as RoundFourState);
  if (state.currentRound !== 5 || (!state.intermediateRounds?.some(r => r.round === 5 && r.status === "completed") && !sectorWasEvacuated(state, 5))) return { ok: false, state, error: "round-four-not-ready" };
  if (!state.characters.some(isAlive)) return { ok: false, state, error: "no-living-characters" };
  const encounter = generateRoundFourEncounter(random);
  if (encounter === null) return { ok: false, state, error: "invalid-random" };
  return success({ ...state, currentRound: 6, roundFour: {
    npc: { encounter, status: encounter === "none" ? "absent" : "awaiting-decision", failedAttempts: 0 },
    energySurcharge: 0, revolvingDoorBlocked: false, forcedRoute: null,
  } });
}

/** Recibe una decisión colectiva ya validada; no decide quién puede votar. */
export function decideRoundFourNpc(state: RoundFourState, decisionId: string, choice: NpcChoice): RoundFourResult {
  if (!validId(decisionId)) return reject(state, "invalid-request");
  const npc = state.roundFour.npc;
  if (npc.decision) return npc.decision.id === decisionId && npc.decision.choice === choice
    ? success(state) : reject(state, "decision-conflict");
  if (npc.status === "absent") return reject(state, "npc-absent");
  if (npc.status !== "awaiting-decision" || state.roundFour.exit) return reject(state, "npc-decision-closed");
  if (npc.voteId && npc.voteId !== decisionId) return reject(state, "decision-conflict");
  if (choice !== "abandon" && !(npc.encounter === "walking-assisted" && choice === "assist")
    && !(npc.encounter === "immobile" && (choice === "carry" || choice === "medical-assist"))) return reject(state, "invalid-npc-choice");
  if (choice === "medical-assist" && state.inventory.medicalUnits < 1) return reject(state, "no-medical-units");
  return success({ ...state, roundFour: { ...state.roundFour, npc: { ...npc,
    decision: { id: decisionId, choice }, status: choice === "abandon" ? "abandoned" : "awaiting-effort" } } });
}

export function failRoundFourNpcVote(state: RoundFourState, decisionId: string, attempt: 1 | 2): RoundFourResult {
  if (!validId(decisionId)) return reject(state, "invalid-request");
  const npc = state.roundFour.npc;
  if (npc.voteId && npc.voteId !== decisionId) return reject(state, "decision-conflict");
  if ((attempt === 1 || attempt === 2) && npc.voteId === decisionId && npc.failedAttempts >= attempt) return success(state);
  if (npc.status === "absent") return reject(state, "npc-absent");
  if (npc.status !== "awaiting-decision") return reject(state, "npc-decision-closed");
  if (attempt !== npc.failedAttempts + 1 || (attempt !== 1 && attempt !== 2)) return reject(state, "invalid-attempt");
  return success({ ...state, roundFour: { ...state.roundFour, npc: { ...npc, voteId: decisionId,
    failedAttempts: attempt, message: NPC_WEAKENING_MESSAGE, status: attempt === 2 ? "dead" : "awaiting-decision" } } });
}

export function failRoundFourExitVote(state: RoundFourState, decisionId: string, attempt: 1 | 2): RoundFourResult {
  if (!validId(decisionId)) return reject(state, "invalid-request");
  const previous = state.roundFour.exitVote;
  if (previous && previous.id !== decisionId) return reject(state, "decision-conflict");
  if ((attempt === 1 || attempt === 2) && previous && previous.failedAttempts >= attempt) return success(state);
  if (state.roundFour.exit) return reject(state, "exit-already-resolved");
  if (state.roundFour.npc.status === "awaiting-decision") return reject(state, "npc-decision-pending");
  if (attempt !== (previous?.failedAttempts ?? 0) + 1 || (attempt !== 1 && attempt !== 2)) return reject(state, "invalid-attempt");
  const living = state.characters.filter(isAlive);
  if (!living.length) return reject(state, "no-living-characters");
  let next = state;
  if (attempt === 1) {
    for (const human of living) {
      const damage = applyDamage(next, human.id, 5);
      if (!damage.ok) return reject(state, damage.error);
      next = damage.state;
    }
  }
  return success({ ...next, roundFour: { ...next.roundFour, exitVote: { id: decisionId, failedAttempts: attempt },
    energySurcharge: 5, revolvingDoorBlocked: attempt === 2,
    forcedRoute: attempt === 2 ? "exterior-crack" : null,
    ...(attempt === 1 ? { collapse: { damage: 5 as const, affectedIds: living.map(c => c.id),
      deceasedIds: living.filter(c => !isAlive(next.characters.find(n => n.id === c.id)!)).map(c => c.id) } } : {}),
  } });
}

export function roundFourRouteRequirements(state: RoundFourState, routeId: string): RoundFourError | null {
  if (routeId !== "revolving-door" && routeId !== "exterior-crack") return "unknown-route";
  if (!state.characters.some(isAlive)) return "no-living-characters";
  if (state.roundFour.forcedRoute && routeId !== state.roundFour.forcedRoute) return "forced-route-required";
  if (routeId === "revolving-door" && state.roundFour.revolvingDoorBlocked) return "door-collapsed";
  if (routeId === "revolving-door" && state.tools.crowbar !== "available") return "crowbar-unavailable";
  return null;
}

/** Proyección local sin probabilidades. La energía definitiva se comprueba con el rescate. */
export function roundFourRouteAvailability(state: RoundFourState) {
  return (Object.keys(ROUND_FOUR_ROUTES) as ExitRouteId[]).map(id => {
    const route = ROUND_FOUR_ROUTES[id];
    const error = roundFourRouteRequirements(state, id);
    const cost = route.energyCost + state.roundFour.energySurcharge;
    const prepared = prepareRescueEffort(state);
    const availability = error ? { status: "unavailable" as const, reason: error }
      : !prepared.ok ? { status: "unavailable" as const, reason: prepared.error }
      : routeEnergyAvailability(prepared.state, cost);
    return { id, name: route.name, description: id === "revolving-door"
      ? "La estructura de la puerta giratoria está deformada. La palanca puede ayudar al grupo a abrir paso hacia la calle."
      : "Una abertura en el muro del acceso de carga y descarga deja ver la calle. El terreno y los escombros dificultan el paso.", energyCost: cost, availability };
  });
}

/** Provisional, nunca se publica un pago parcial. Todos los humanos activos participan,
 * como en el rescate ya existente. No se eligen porteadores de NPC automáticamente. */
export function prepareRescueEffort(state: RoundFourState): RoundFourResult {
  const npc = state.roundFour.npc;
  if (npc.status === "awaiting-decision") return reject(state, "npc-decision-pending");
  if (npc.status !== "awaiting-effort") return success(state);
  const choice = npc.decision!.choice;
  const energyPerHuman = choice === "carry" ? IMMOBILE_NPC_RESCUE_ENERGY : NPC_RESCUE_ENERGY;
  const medicalUnits = choice === "medical-assist" ? 1 : 0;
  if (state.inventory.medicalUnits < medicalUnits) return reject(state, "no-medical-units");
  const living = state.characters.filter(isAlive);
  if (!living.length) return reject(state, "no-living-characters");
  let next = state;
  for (const human of living) {
    const paid = spendEnergy(next, human.id, energyPerHuman);
    if (!paid.ok) return reject(state, paid.error);
    next = paid.state;
  }
  return success({ ...next, inventory: { ...next.inventory, medicalUnits: next.inventory.medicalUnits - medicalUnits },
    roundFour: { ...next.roundFour, npc: { ...npc, status: "rescued",
      rescue: { energyPerHuman, medicalUnits, participantIds: living.map(c => c.id) } } } });
}

/** Una transacción: esfuerzo NPC pendiente + pago de salida/transporte + accidente.
 * Sin energía suficiente se bloquea todo: no reparte esfuerzos, no abandona a nadie.
 * El rescate se confirma al completar el esfuerzo; la decisión sola no rescata al NPC. */
export function resolveRoundFourExit(state: RoundFourState, requestId: string, routeId: ExitRouteId,
  random: RandomSource, plan?: TransportPlan): RoundFourResult {
  if (!validId(requestId)) return reject(state, "invalid-request");
  const previous = state.roundFour.exit;
  if (previous) return previous.requestId === requestId && previous.routeId === routeId
    && samePlan(previous.transportPlan, plan) ? success(state) : reject(state, "exit-already-resolved");
  if (state.roundFour.blockedMovement) return reject(state, state.roundFour.blockedMovement.error);
  const error = roundFourRouteRequirements(state, routeId);
  if (error) return reject(state, error);
  const prepared = prepareRescueEffort(state);
  if (!prepared.ok) return prepared;
  const route = ROUND_FOUR_ROUTES[routeId];
  const energyCost = route.energyCost + state.roundFour.energySurcharge;
  const moved = traverseRouteEffects(prepared.state, { ...route, energyCost }, random, plan);
  if (!moved.ok) {
    if (moved.error === "invalid-random") return { ok: false, error: moved.error,
      state: { ...state, roundFour: { ...state.roundFour, blockedMovement: { requestId, routeId, error: moved.error } } } };
    return reject(state, prepared.state !== state ? "combined-effort-pending" : moved.error);
  }
  const outcome: ExitOutcome = { requestId, routeId, energyCost, forced: state.roundFour.forcedRoute !== null,
    accident: moved.accident, victimIds: moved.victimIds, deceasedIds: moved.deceasedIds,
    damage: moved.damage, charges: moved.charges,
    ...(plan ? { transportPlan: { carrierIds: [...plan.carrierIds], transportedIds: [...plan.transportedIds] } } : {}),
    rescuedNpc: moved.state.roundFour.npc.status === "rescued",
    escapedHumanIds: moved.state.characters.filter(isAlive).map(c => c.id) };
  return success({ ...moved.state, roundFour: { ...moved.state.roundFour, exit: outcome } });
}

function samePlan(a?: TransportPlan, b?: TransportPlan): boolean {
  const key = (p?: TransportPlan) => JSON.stringify([...(p?.carrierIds ?? [])].sort()) + JSON.stringify([...(p?.transportedIds ?? [])].sort());
  return key(a) === key(b);
}
