import type { GameFinalResult, PrivateObjectiveEvidence } from "@everest/shared";
import { isAlive, type SimulationState, type EngineState, type RouteRevelation } from "./state.js";
import { internalRouteRisk, privateRouteViews } from "./routes.js";
import { internalRoundThreeRisk } from "./round-three-routes.js";
import { ROUND_FOUR_ROUTES, type RoundFourState } from "./round-four.js";
import { characterSheet } from "../rooms/character-sheets.js";
import { objectiveNarrative } from './final-narrative.js';

export interface EvidenceContext {
  /** Recibos autenticados existentes, no identidades enviadas por el navegador. */
  treatments?: readonly { requestId: string; round: number; patientId: string; administratorId: string }[];
  roundThreeForced?: boolean;
  ventilationRevealed?: boolean;
  ventilationRevealedBy?: string;
}
export interface RouteEvidence {
  round: 1 | 2 | 3 | 4 | 5 | 6; routeId: string; resolutionId: string; completed: true;
  realRisk: "LOW" | "MODERATE" | "HIGH" | "EXTREME" | null;
  forcedByNoAgreement: boolean | null;
}

/** Recibe metadatos de catálogo del servidor; no es una autorización de rutas nuevas. */
export function recordMaintenanceRevelation<S extends EngineState>(state: S, route: { id: string; round: RouteRevelation["round"]; initiallyPrivate: boolean }, characterId: string, sharedAt: number): S {
  const actor = state.characters.find(c => c.id === characterId);
  if (!actor || !isAlive(actor) || actor.role !== "maintenance" || !route.initiallyPrivate || route.round !== state.currentRound
    || !Number.isFinite(sharedAt) || sharedAt < 0 || state.routeRevelations?.some(r => r.routeId === route.id)) return state;
  return { ...state, routeRevelations: [...(state.routeRevelations ?? []), { routeId: route.id, round: route.round, characterId, initiallyUnknownToOthers: true, sharedAt }] };
}
export interface PatientEvidence {
  participantId: string; name: string;
  treatments: { round: number; restored: number; requestId: string | null; administratorId: string | null }[];
  diedAfterTreatment: boolean; abandoned: boolean; evacuated: boolean;
}
export interface NpcEvidence {
  id: "round-one-survivor" | "round-two-survivor" | "round-six-survivor";
  round: 1 | 2 | 6; appeared: boolean | null; found: boolean;
  rescueApproved: boolean; rescued: boolean; abandoned: boolean; deceased: boolean;
  evacuated: boolean | null;
  medicalUnitsUsed: number;
}
/** Registro interno derivado de resultados y recibos. No es un DTO para React. */
export interface ObjectiveLedger {
  gameId: string; resultId: string;
  routes: RouteEvidence[]; patients: PatientEvidence[]; npcs: NpcEvidence[];
  sabotage?: { actorParticipantId: string; manipulated: boolean; victimId: string | null };
  maintenance: {
    knownRoutes: string[];
    revelations: { routeId: string; characterId: string | null; round?: RouteRevelation["round"]; initiallyUnknownToOthers?: boolean; sharedAt?: number }[];
    /** Sin acción de apertura registrada, no se crean aperturas por inferencia. */
    openings: { routeId: string; administratorId: string; operationId: string }[];
    openingRecordsComplete: false;
  };
}

export function collectObjectiveLedger(state: EngineState, result: GameFinalResult, context: EvidenceContext = {}): ObjectiveLedger {
  const publicPerson = (characterId: string) => {
    const character = state.characters.find(c => c.id === characterId)!;
    return result.humans.find(p => p.role === character.role)!;
  };
  const routes: RouteEvidence[] = [];
  if (state.roundOne?.completed) routes.push({ round: 1, routeId: "round-one-passage", resolutionId: state.roundOne.decisionId,
    completed: true, realRisk: null, forcedByNoAgreement: state.roundOne.result === "NO_AGREEMENT" });
  const second = state.roundTwo?.movement;
  if (second?.status === "completed") routes.push({ round: 2, routeId: second.routeId, resolutionId: second.decisionId,
    completed: true, realRisk: internalRouteRisk(second.routeId), forcedByNoAgreement: second.forced });
  const third = state.roundThreeRoute;
  if (third?.status === "completed") routes.push({ round: 3, routeId: third.outcome.routeId, resolutionId: third.outcome.requestId,
    completed: true, realRisk: internalRoundThreeRisk(third.outcome.routeId), forcedByNoAgreement: context.roundThreeForced ?? null });
  const fourth = state.currentRound === 6 && "roundFour" in state ? (state as RoundFourState).roundFour : undefined;
  const exit = fourth?.exit;
  if (exit) routes.push({ round: 6, routeId: exit.routeId, resolutionId: exit.requestId, completed: true,
    realRisk: ROUND_FOUR_ROUTES[exit.routeId].danger, forcedByNoAgreement: exit.forced });
  for (const record of state.intermediateRounds ?? []) {
    if (record.status === "completed") routes.push({ round: record.round, routeId: record.routeId, resolutionId: record.requestId, completed: true, realRisk: record.realRisk, forcedByNoAgreement: record.forcedByNoAgreement ?? false });
  }
  routes.sort((a, b) => a.round - b.round);
  const patients = new Map<string, PatientEvidence>();
  for (const t of state.medicalTreatments ?? []) {
    const person = publicPerson(t.characterId); const human = state.characters.find(c => c.id === t.characterId)!;
    let patient = patients.get(person.participantId);
    if (!patient) {
      patient = { participantId: person.participantId, name: person.name, treatments: [], diedAfterTreatment: human.health === 0,
        abandoned: human.eliminated === true, evacuated: person.status === "evacuated" };
      patients.set(person.participantId, patient);
    }
    // La regla existente permite un tratamiento por humano y ronda; los replays no crean otro.
    if (patient.treatments.some(previous => previous.round === t.round)) continue;
    const receipt = context.treatments?.find(r => r.round === t.round && r.patientId === person.participantId);
    patient.treatments.push({ round: t.round, restored: t.healthRestored, requestId: receipt?.requestId ?? null,
      administratorId: receipt?.administratorId ?? null });
  }
  const npcs: NpcEvidence[] = result.npcs.map(npc => {
    const first = state.roundOne; const second = state.roundTwo?.resolution;
    const decision = npc.round === 1 ? first?.result ?? state.roundOnePreparation?.result
      : npc.round === 2 ? second?.result : fourth?.npc.decision?.choice;
    return { id: npc.round === 1 ? "round-one-survivor" : npc.round === 2 ? "round-two-survivor" : "round-six-survivor",
      round: npc.round, appeared: npc.status === "not-encountered" ? null : npc.status !== "absent",
      found: npc.status !== "not-encountered" && npc.status !== "absent",
      rescueApproved: decision === "RESCUE_APPROVED" || decision === "assist" || decision === "carry" || decision === "medical-assist",
      rescued: npc.status === "rescued", abandoned: npc.status === "abandoned", deceased: npc.status === "dead", evacuated: npc.evacuated,
      medicalUnitsUsed: npc.round === 6 ? fourth?.npc.rescue?.medicalUnits ?? 0 : 0 };
  });
  const revelations = new Map<string, ObjectiveLedger["maintenance"]["revelations"][number]>();
  for (const r of state.routeRevelations ?? []) {
    if (r.initiallyUnknownToOthers && Number.isFinite(r.sharedAt) && r.sharedAt >= 0 && state.characters.some(c => c.id === r.characterId && c.role === "maintenance") && !revelations.has(r.routeId)) revelations.set(r.routeId, { ...r });
  }
  if ((context.ventilationRevealed || context.ventilationRevealedBy) && !revelations.has("ventilation")) revelations.set("ventilation", { routeId: "ventilation", characterId: context.ventilationRevealedBy ?? null });
  return { gameId: result.gameId, resultId: result.id, routes, patients: [...patients.values()], npcs,
    ...(state.medicalSabotage ? { sabotage: { actorParticipantId: publicPerson(state.medicalSabotage.actorId).participantId, manipulated: true, victimId: state.medicalSabotage.status === "consumed" && state.medicalSabotage.victimId ? publicPerson(state.medicalSabotage.victimId).participantId : null } } : {}),
    maintenance: { knownRoutes: privateRouteViews("maintenance").map(route => route.id), revelations: [...revelations.values()],
      openings: [], openingRecordsComplete: false } };
}

/** Evaluación lógica sin puntuaciones. Solo se resuelven hechos concluyentes. */
export function assessObjective(role: SimulationState["characters"][number]["role"], participantId: string, ledger: ObjectiveLedger): PrivateObjectiveEvidence["evaluation"] {
  if (role === "maintenance") return new Set(ledger.maintenance.revelations.filter(r => r.initiallyUnknownToOthers && r.characterId && r.round !== undefined && r.sharedAt !== undefined && Number.isFinite(r.sharedAt) && r.sharedAt >= 0).map(r => r.routeId)).size >= 2 ? "fulfilled" : "pending-evaluation";
  if (role === "medic") {
    const mine = ledger.patients.filter(p => p.treatments.some(t => t.administratorId === participantId));
    if (mine.some(p => p.diedAfterTreatment)) return "unfulfilled";
    const attributionMissing = ledger.patients.some(p => p.treatments.some(t => t.administratorId === null));
    if (mine.length && !attributionMissing && mine.every(p => p.evacuated)) return "fulfilled";
    return "pending-evaluation";
  }
  if (role === "architect-engineer") {
    if (ledger.routes.some(r => r.realRisk === "EXTREME")) return "unfulfilled";
    const completeTrajectory = [1, 2, 3, 4, 5, 6].every(round => ledger.routes.some(r => r.round === round));
    // Round one has no structural classification; do not invent one or require it.
    return completeTrajectory && ledger.routes.every(r => r.round === 1 || r.realRisk !== null) ? "fulfilled" : "pending-evaluation";
  }
  return ledger.sabotage?.actorParticipantId === participantId && ledger.sabotage.victimId ? "fulfilled" : "unfulfilled";
}

export function projectObjectiveEvidence(state: SimulationState, result: GameFinalResult, characterId: string, ledger: ObjectiveLedger): PrivateObjectiveEvidence {
  const human = state.characters.find(c => c.id === characterId)!; const person = result.humans.find(p => p.role === human.role)!;
  const evaluation = assessObjective(human.role, person.participantId, ledger);
  const facts: string[] = []; const missing: string[] = []; let confirmed = false;
  if (human.role === "maintenance") {
    const shared = ledger.maintenance.revelations.filter(r => r.initiallyUnknownToOthers && r.characterId === characterId && r.round !== undefined && r.sharedAt !== undefined);
    confirmed = shared.length > 0;
    facts.push(`Rutas alternativas inicialmente desconocidas reveladas por tu personaje: ${shared.length}.`);
    for (const r of shared) facts.push(`${r.routeId}: compartida en ronda ${r.round}; registro de servidor ${r.sharedAt}.`);
    if (shared.length < 2) missing.push("Todavía no constan dos revelaciones verificadas. Se requieren dos rutas diferentes con autoría verificada.");
  } else if (human.role === "medic") {
    const mine = ledger.patients.filter(p => p.treatments.some(t => t.administratorId === person.participantId));
    // Sin recibos históricos se informa el tratamiento, dejando explícita la falta de autoría.
    const unknown = ledger.patients.filter(p => p.treatments.some(t => t.administratorId === null));
    for (const p of [...new Map([...mine, ...unknown].map(p => [p.participantId, p])).values()]) {
      const rounds = p.treatments.map(t => t.round).join(", ");
      facts.push(`${p.name}: tratamiento registrado en ronda(s) ${rounds}; ${p.diedAfterTreatment ? "fallecimiento posterior confirmado" : p.evacuated ? "evacuación confirmada" : p.abandoned ? "abandono registrado; supervivencia posterior no determinada" : "desenlace pendiente"}.${unknown.includes(p) ? " Falta atribución del administrador en parte del registro." : " Administrado por tu personaje."}`);
    }
    confirmed = ledger.patients.length > 0 && ledger.patients.every(p => !p.abandoned);
    if (!mine.length) missing.push("No constan pacientes atribuidos a tu personaje; no se acredita el objetivo sin pacientes.");
    if (unknown.length) missing.push("Faltan recibos que identifiquen al administrador de algunos tratamientos históricos.");
    if (mine.some(p => p.abandoned && !p.diedAfterTreatment)) missing.push("La supervivencia de pacientes abandonados no está confirmada.");
  } else if (human.role === "architect-engineer") {
    for (const r of ledger.routes) facts.push(`Ronda ${r.round}: recorrido completado por ${r.routeId === "exterior-crack" ? "grieta exterior" : r.routeId === "pipe-gallery" ? "galería de tuberías y calderas" : r.routeId}; ${r.forcedByNoAgreement === true ? "obligatorio por falta de acuerdo" : r.forcedByNoAgreement === false ? "sin imposición por falta de acuerdo" : "origen de la elección no registrado"}.${r.realRisk === "EXTREME" ? " Riesgo extremo confirmado." : ""}`);
    confirmed = evaluation !== "pending-evaluation";
    if (ledger.routes.some(r => r.round !== 1 && r.realRisk === null)) missing.push("Algún recorrido clasificado no tiene su categoría estructural registrada.");
    if (ledger.routes.length < 6) missing.push("No se completó el itinerario de las seis rondas.");
  } else {
    confirmed = evaluation === "fulfilled";
    facts.push(ledger.sabotage?.actorParticipantId === person.participantId ? "Manipulación de medicación realizada." : "No consta manipulación de medicación.");
    facts.push(confirmed ? "Una muerte humana causada por tu sabotaje está confirmada." : "No consta ninguna muerte humana causada por tu sabotaje.");
  }
  return { gameId: result.gameId, resultId: result.id, participantId: person.participantId, objective: characterSheet(human.role).objective,
    evaluation, evidenceState: confirmed ? "confirmed" : "insufficient", facts, missing,
    narrative: objectiveNarrative(result.gameId ?? result.id, person.participantId, human.role, evaluation) };
}
