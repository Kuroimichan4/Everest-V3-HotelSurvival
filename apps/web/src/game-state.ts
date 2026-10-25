import type { IntermediateRoundView, GameActivityView, MedicalView, OwnVote, PrivateRole, PublicRoom, PublicVote, RoundOneSummary, RoundTwoView, RoundThreeView, RoundFourView, SuppliesView, TransportView } from "@everest/shared";
import type { GameFinalResult, PrivateObjectiveEvidence } from "@everest/shared";

export interface GameState {
  final: GameFinalResult | null; objective: PrivateObjectiveEvidence | null;
  room: PublicRoom | null; role: PrivateRole | null; vote: PublicVote | null; ownVote: OwnVote | null;
  roundFour: RoundFourView | null;
  intermediates: IntermediateRoundView[];
  summary: RoundOneSummary | null; roundTwo: RoundTwoView | null; roundThree: RoundThreeView | null;
  supplies: SuppliesView | null; medical: MedicalView | null; transport: TransportView | null; activity: GameActivityView | null;
}
export const emptyGame: GameState = { intermediates: [], final: null, objective: null, room: null, role: null, vote: null, ownVote: null, roundFour: null, summary: null, roundTwo: null, roundThree: null, supplies: null, medical: null, transport: null, activity: null };
export type GameUpdate = { [K in keyof GameState]: { type: K; value: GameState[K] } }[keyof GameState] | { type: "disconnect" } | { type: "clear" };

export function activeHuman(c: { health?: number; status?: string; eliminated?: boolean }) {
  return !c.eliminated && c.status !== "dead" && c.status !== "abandoned" && c.health !== 0;
}

/** Cada evento sustituye su instantánea. Nunca acumular paneles ni resultados recibidos. */
export function gameReducer(state: GameState, action: GameUpdate): GameState {
  if (action.type === "clear") return emptyGame;
  if (action.type === "disconnect") return { ...emptyGame, room: state.room };
  if (JSON.stringify(state[action.type]) === JSON.stringify(action.value)) return state;
  return { ...state, [action.type]: action.value };
}

export function activeScene(state: GameState) {
  // La etapa autoritativa vigente prevalece sobre instantáneas auxiliares atrasadas.
  const round = Math.max(state.roundFour?.round ?? 1, state.intermediates.at(-1)?.round ?? 1, state.supplies?.round ?? 1, state.roundThree?.round ?? 1, state.roundTwo?.round ?? 1);
  const intermediate = state.intermediates.find(s => s.round === round);
  const transport = state.transport?.cases.findLast(c => c.round === round && c.phase !== "superseded");
  const recovery = round === 3 ? state.roundThree?.recovery : round === 2 ? state.roundTwo?.recovery : undefined;
  const completed = state.supplies?.sectorEvacuation?.round === round || intermediate?.phase === "sector-evacuated" || (round === 2 && state.roundTwo?.phase === "sector-evacuated") || (round === 3 && state.roundThree?.phase === "sector-evacuated") || (intermediate ? intermediate.phase === "completed" : round === 6 ? state.roundFour?.phase === "completed" : round === 3 ? state.roundThree?.phase === "completed" : round === 2 ? state.roundTwo?.phase === "completed" : !!state.summary);
  const transportActive = transport && transport.phase !== "completed" && transport.phase !== "sector-evacuated"
    && (round !== 6 || (state.roundFour?.phase === "transport" && transport.phase !== "blocked"));
  const kind = recovery ? "recovery" : completed ? "completed" : transportActive ? "transport"
    : intermediate ? "intermediate" : round === 6 ? "round-four" : round === 3 ? "route-three" : round === 2 && state.roundTwo?.phase !== "rescue-vote" ? "route-two"
    : state.vote?.status === "open" ? "rescue" : "waiting";
  const vote = kind === "intermediate" ? intermediate?.vote : kind === "round-four" ? state.roundFour?.phase === "npc-voting" ? state.roundFour.npc.vote : state.roundFour?.vote : kind === "transport" ? transport?.vote : kind === "route-three" ? state.roundThree?.vote
    : kind === "route-two" ? state.roundTwo?.routeChoice?.vote : kind === "rescue" ? state.vote : null;
  const phase = intermediate?.phase === "movement" ? "Preparar desplazamiento" : round === 6 && kind === "completed" ? "Evacuación completada" : kind === "round-four" ? state.roundFour?.phase === "npc-voting" ? "Rescate del superviviente" : state.roundFour?.phase === "blocked" ? "Salida pendiente" : vote?.status === "open" ? "Votación de salida" : "Preparar salida" : kind === "recovery" ? "Ruta pendiente" : kind === "completed" ? "Recorrido completado"
    : kind === "transport" ? transport?.phase === "selection" ? "Elegir compañero" : transport?.phase === "voting" ? transport.vote?.attemptNumber === 3 ? "Decisión extraordinaria de transporte" : "Votación de transporte" : transport?.phase === "preparation" ? "Preparar transporte" : "Transporte pendiente"
    : kind === "rescue" ? "Rescate de superviviente" : vote?.status === "open" ? "Votación de ruta"
    : kind === "intermediate" || kind === "route-three" || kind === "route-two" ? "Preparación de ruta" : "Esperando al servidor";
  return { round, kind, phase, transport, vote: vote?.status === "open" ? vote : null };
}

export const rescueLabel = (result: string | null) => result === "RESCUE_APPROVED" ? "Rescate aprobado" : result === "ABANDON_APPROVED" ? "El equipo continúa sin rescatar al superviviente" : result === "NO_AGREEMENT" ? "No hubo acuerdo" : "Decisión pendiente";
export function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    "combined-effort-pending": "La energía no alcanza para el rescate aprobado, la salida y el transporte humano. No se ha gastado ningún recurso.",
    "crowbar-unavailable": "La palanca se perdió y la puerta giratoria no puede utilizarse.",
    "door-collapsed": "El derrumbe ha inutilizado la puerta giratoria.",
    "forced-route-required": "La grieta exterior es obligatoria. No se puede cambiar de salida.",
    "route-energy-insufficient": "Falta energía para realizar esta ruta, incluso con el transporte previsto.",
    "npc-decision-pending": "Primero debe resolverse la decisión sobre el superviviente.",
    "no-medical-units": "No quedan unidades médicas disponibles.",
    "supplies-not-open": "Los recursos no están disponibles durante esta decisión o después de la evacuación.",
    "transport-vote-pending": "Hay compañeros que necesitan transporte. Prepara el equipo antes de continuar.",
    "no-eligible-voters-after-gas": "Tras la fuga no quedan votantes autorizados para resolver el transporte. El servidor conserva el estado sin inventar una decisión.",
    "sector-evacuated-after-explosion": "El sector se ha evacuado tras la explosión.",
    "transport-no-agreement": "No hubo mayoría tras los dos intentos. El desplazamiento sigue pendiente.",
    "more-than-two-exhausted": "Hay más de dos compañeros agotados. Este caso sigue pendiente de definición.",
    "no-eligible-carriers": "No hay porteadores con energía suficiente.",
    "transport-plan-infeasible": "El plan no se puede pagar íntegramente.",
    "insufficient-energy": "Falta energía para continuar.",
    "invalid-random": "La resolución necesita revisión del servidor. No se repetirá el recorrido.",
    "crowbar-unavailable-pending": "La palanca no está disponible.",
    "specialist-availability-pending": "La ruta necesita especialistas cuya disponibilidad sigue pendiente.",
    "no-living-characters": "No quedan personajes activos. El desenlace sigue pendiente.",
    "forced-route-energy-pending": "La ruta obligatoria aún no es viable. Prepara al equipo antes de comprobarla de nuevo.",
    "no-available-routes": "No hay rutas disponibles. Revisa la energía y los packs del equipo.",
    "not-authorized-for-plan": "No tienes energía para participar en ese plan de transporte.",
    "not-authorized": "Tu personaje no está autorizado para esta acción.",
    "not-creator": "El anfitrión debe realizar esta acción.",
    "duplicate-vote": "Tu voto ya está registrado.",
  };
  return labels[reason] ?? "La acción no está disponible en esta fase. Comprueba el estado actual de la partida.";
}
