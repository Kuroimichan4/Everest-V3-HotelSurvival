import { internalIntermediateRoute } from "./intermediate-rounds.js";
import { publicRouteViews, privateRouteViews } from "./routes.js";
import type { FinalNpc, GameFinalResult, PrivateObjectiveEvidence } from "@everest/shared";
import { isAlive, type SimulationState } from "./state.js";
import type { RoundFourState } from "./round-four.js";
import { collectObjectiveLedger, projectObjectiveEvidence, type EvidenceContext, type ObjectiveLedger } from "./objective-evidence.js";

function fourth(state: SimulationState) { return state.currentRound === 6 && "roundFour" in state ? (state as RoundFourState).roundFour : undefined; }
/** La ausencia de humanos activos prevalece incluso si el último accidente completó el movimiento. */
export function finalizationStatus(state: SimulationState): "pending" | GameFinalResult["kind"] {
  if (!state.characters.some(isAlive)) return "no-active-humans";
  return fourth(state)?.exit ? "evacuation-completed" : "pending";
}

export function npcResults(state: SimulationState): FinalNpc[] {
  const first = state.roundOne;
  const second = state.roundTwo?.resolution;
  const fourthNpc = fourth(state)?.npc;
  const completedExit = !!fourth(state)?.exit;
  return [
    { round: 1, status: first ? first.npc : state.roundOnePreparation?.result === "RESCUE_APPROVED" ? "approved" : "pending", evacuated: first?.npc === "rescued" && completedExit ? true : null },
    { round: 2, status: second ? second.npc : state.roundTwo ? "pending" : "not-encountered", evacuated: second?.npc === "rescued" && completedExit ? true : null },
    { round: 6, status: !fourthNpc ? "not-encountered" : fourthNpc.status === "awaiting-decision" ? "pending"
      : fourthNpc.status === "awaiting-effort" ? "approved" : fourthNpc.status,
      evacuated: fourthNpc?.status === "rescued" ? true : fourthNpc?.status === "awaiting-effort" || !fourthNpc ? null : false },
  ];
}

/** Proyección pura: no modifica la simulación ni vuelve a resolver una consecuencia. */
export function buildFinalResult(state: SimulationState, people: readonly { characterId: string; participantId: string; name: string }[],
  metadata: { id: string; gameId: string; closedAt: number; ventilationRevealed: boolean }): GameFinalResult | null {
  const kind = finalizationStatus(state); if (kind === "pending") return null;
  const round = fourth(state); const exit = round?.exit;
  const publicId = (id: string) => people.find(p => p.characterId === id)!.participantId;
  const humans = people.map(p => { const c = state.characters.find(c => c.id === p.characterId)!;
    return { participantId: p.participantId, name: p.name, role: c.role, health: c.health, energy: c.energy,
      status: c.eliminated ? "abandoned" as const : c.health === 0 ? "dead" as const : exit?.escapedHumanIds.includes(c.id) ? "evacuated" as const : "active" as const }; });
  const npcs = npcResults(state);
  const decisions: string[] = (state.suddenMedicalDeaths ?? []).map(d => `${people.find(p => p.characterId === d.characterId)!.name}: ${d.message}`);
  const secondMovement = state.roundTwo?.movement;
  const secondName = secondMovement?.status === "completed"
    ? [...publicRouteViews(), ...privateRouteViews("maintenance")].find(r => r.id === secondMovement.routeId)!.name : null;
  for (const npc of npcs) if (npc.status !== "not-encountered") decisions.push(`Ronda ${npc.round}: ${npcDescription(npc)}.`);
  if (metadata.ventilationRevealed) decisions.push("Mantenimiento reveló al equipo los conductos de ventilación.");
  if (state.tools.crowbar === "lost") decisions.push("La palanca se perdió; la puerta giratoria quedó sin herramienta disponible.");
  if (round?.collapse) decisions.push("La falta de acuerdo de salida causó un derrumbe parcial y un recargo energético.");
  if (round?.forcedRoute) decisions.push("Tras el segundo intento sin acuerdo, la grieta exterior fue obligatoria.");
  if (secondName) decisions.push(`Ruta de ronda 2: ${secondName}.`);
  if (state.roundThreeRoute?.status === "completed") decisions.push(`Ruta de ronda 3: ${state.roundThreeRoute.outcome.routeId === "fire-door" ? "puerta cortafuegos" : state.roundThreeRoute.outcome.routeId === "pipe-gallery" ? "galería de tuberías y calderas" : "escombros metálicos y almacén"}.`);
  for (const record of state.intermediateRounds ?? []) if (record.status === "completed") {
    decisions.push(`Ruta de ronda ${record.round}: ${internalIntermediateRoute(record.routeId)!.name}.`);
  }
  for (const receipt of state.intermediateConsequences ?? []) decisions.push(`Ronda ${receipt.round}: falta de consenso, réplica y ruta obligatoria.`);
  for (const incident of state.transportIncidents ?? []) decisions.push(`Ronda ${incident.round}: ${incident.kind === "gas" ? "fuga de gas" : "explosión"} durante la decisión de transporte.`);
  for (const sector of state.sectorEvacuations ?? []) decisions.push(`Ronda ${sector.round}: evacuación precipitada del sector, sin ejecutar el recorrido ordinario.`);
  const latest = state.intermediateRounds?.filter(r => r.status === "completed").sort((a, b) => b.round - a.round)[0];
  const thirdMovement = state.roundThreeRoute;
  const lastMovement: GameFinalResult["lastMovement"] = exit ? { routeName: exit.routeId === "revolving-door" ? "Puerta giratoria del vestíbulo" : "Grieta en el muro exterior del acceso de carga y descarga",
    completed: true, accident: exit.accident, victimIds: exit.victimIds.map(publicId) }
    : latest?.status === "completed" ? { routeName: internalIntermediateRoute(latest.routeId)!.name, completed: true, accident: latest.effects.accident, victimIds: latest.effects.victimIds.map(publicId) }
    : thirdMovement?.status === "completed" ? { routeName: thirdMovement.outcome.routeId === "fire-door" ? "Puerta cortafuegos" : thirdMovement.outcome.routeId === "pipe-gallery" ? "Galería de tuberías" : "Escombros metálicos",
      completed: true, accident: thirdMovement.outcome.accident, victimIds: thirdMovement.outcome.victimIds.map(publicId) }
    : secondMovement?.status === "completed" ? { routeName: secondName!, completed: true, accident: secondMovement.accident, victimIds: secondMovement.victims.map(v => publicId(v.characterId)) }
    : state.roundOne?.completed ? { routeName: "Paso obligatorio de ronda 1", completed: true, accident: false, victimIds: [] } : null;
  return { id: metadata.id, gameId: metadata.gameId, closedAt: metadata.closedAt, round: state.currentRound, kind, humans, npcs,
    counts: { evacuated: humans.filter(c => c.status === "evacuated").length, dead: humans.filter(c => c.status === "dead").length,
      abandoned: humans.filter(c => c.status === "abandoned").length, rescuedNpcs: npcs.filter(n => n.status === "rescued").length,
      evacuatedNpcs: npcs.filter(n => n.evacuated === true).length }, inventory: { ...state.inventory }, crowbar: state.tools.crowbar,
    lastMovement, decisions };
}

function npcDescription(npc: FinalNpc): string {
  return { "not-encountered": "encuentro no alcanzado", absent: "no apareció NPC", pending: "decisión NPC pendiente", approved: "rescate aprobado sin completar",
    rescued: npc.evacuated ? "NPC rescatado y evacuado" : "rescate NPC completado; evacuación no determinada", abandoned: "NPC abandonado", dead: "NPC fallecido" }[npc.status];
}

/** Proyeccion privada compatible con el resultado existente, sin puntuaciones. */
export function objectiveEvidence(state: SimulationState, result: GameFinalResult, characterId: string,
  context: EvidenceContext = {}, ledger?: ObjectiveLedger): PrivateObjectiveEvidence {
  return projectObjectiveEvidence(state, result, characterId, ledger ?? collectObjectiveLedger(state, result, context));
}
