// Contratos publicos. No colocar secretos ni catalogos internos del juego aqui.
export interface HealthResponse {
  status: "ok";
  service: "everest-server";
}

export interface ServerReadyPayload {
  service: "everest-server";
}

export interface PingResponse {
  ok: true;
}

export type RouteActionReply = { ok: true } | { ok: false; error: string };
export type RouteId = "unstable-corridor" | "ventilation" | "shoring";
export type RouteRiskCategory = "LOW" | "MODERATE" | "HIGH" | "EXTREME";
export interface ResourceEligibility { allowed: boolean; reason: string | null }
export interface RouteAvailability { status: "available" | "with-help" | "unavailable"; reason: string | null }
export interface RouteRecovery { decisionId: string; reason: string; forced: boolean }
export interface FailedRouteSelection { round: 2 | 3; decisionId: string; outcome: string; reason: string; vote: PublicVote }
export interface RouteChoiceView {
  phase: "preparation" | "voting" | "selected";
  privateRoute?: { id: RouteId; name: string; description: string; energyCost: number };
  ventilationRevealed: boolean;
  options: { id: RouteId; name: string; description?: string; danger?: RouteRiskCategory; energyCost: number; blocked: string | null; availability: RouteAvailability }[];
  vote: PublicVote | null;
  result: { decisionId: string; outcome: RouteId | "NO_AGREEMENT" } | null;
}

/** Contratos exclusivamente privados de la capacidad de Botones. */
export interface MedicalSabotageInput { requestId:string; gameId:string }
export interface PrivateMedicalSabotage { participantId:string; gameId:string; performed:boolean; objectiveFulfilled:boolean; canManipulate:boolean; reason:string|null }
export type MedicalSabotageReply = {ok:true;requestId:string;state:PrivateMedicalSabotage}|{ok:false;error:string};
export interface ClientToServerEvents {
  'room:restart': (input: { gameId: string; resultId: string }, ack: (reply: RoomReply<PublicRoom>) => void) => void;
  'chat:send': (input: ChatInput, ack: (reply: ChatReply) => void) => void;
  "medical:sabotage": (input:MedicalSabotageInput,ack:(reply:MedicalSabotageReply)=>void)=>void;
  "intermediate:action": (input: { round: 4 | 5; action: "advance" | "reveal" | "open" | "retry" }, ack: (reply: RouteActionReply) => void) => void;
  "round-six:advance": (ack: (reply: RouteActionReply) => void) => void;
  "round-six:open": (ack: (reply: RouteActionReply) => void) => void;
  "round-six:retry": (input: { preparationId: string }, ack: (reply: RouteActionReply) => void) => void;
  "round-four:advance": (ack: (reply: RouteActionReply) => void) => void;
  "round-four:open": (ack: (reply: RouteActionReply) => void) => void;
  "round-four:retry": (input: { preparationId: string }, ack: (reply: RouteActionReply) => void) => void;
  "route:retry": (input: { decisionId: string }, ack: (reply: RouteActionReply) => void) => void;
  "transport:open": (input: { preparationId: string }, ack: (reply: RouteActionReply) => void) => void;
  "round-three:advance": (ack: (reply: RouteActionReply) => void) => void;
  "round-three:open": (ack: (reply: RouteActionReply) => void) => void;
  "medical:treat": (input: TreatmentInput, ack: (reply: TreatmentReply) => void) => void;
  "pack:give": (input: PackInput, ack: (reply: PackReply) => void) => void;
  "route:reveal": (ack: (reply: RouteActionReply) => void) => void;
  "route:open": (ack: (reply: RouteActionReply) => void) => void;
  "round:advance": (ack: (reply: VoteReply) => void) => void;
  "vote:cast": (input: VoteInput, ack: (reply: VoteReply) => void) => void;
  "client:ping": (acknowledge: (response: PingResponse) => void) => void;
  "room:create": (input: { name: string }, ack: (result: RoomReply<RoomSession>) => void) => void;
  "room:join": (input: { name: string; code: string }, ack: (result: RoomReply<RoomSession>) => void) => void;
  "room:resume": (input: SessionCredential, ack: (result: RoomReply<RoomSession>) => void) => void;
  "room:start": (ack: (result: RoomReply<PublicRoom>) => void) => void;
}

export interface PersonalDeathMessage { gameId:string; participantId:string; eventId:string; round:1|2|3|4|5|6; kind:"accident"|"gas"|"explosion"|"unexpected"; message:string }
export interface ServerToClientEvents {
  'room:reset': (room: PublicRoom) => void;
  'chat:updated': (view: ChatView) => void;
  "game:personal-death": (message:PersonalDeathMessage)=>void;
  "medical:sabotage-private": (state:PrivateMedicalSabotage)=>void;
  "intermediate:updated": (state: IntermediateRoundView[]) => void;
  "game:finished": (result: GameFinalResult) => void;
  "game:objective": (evidence: PrivateObjectiveEvidence) => void;
  "round-six:updated": (state: RoundSixView) => void;
  "round-four:updated": (state: RoundFourView) => void;
  "game:activity": (state: GameActivityView) => void;
  "transport:updated": (state: TransportView) => void;
  "game:role-unavailable": () => void;
  "round-three:updated": (state: RoundThreeView) => void;
  "medical:updated": (state: MedicalView) => void;
  "supplies:updated": (state: SuppliesView) => void;
  "round-two:updated": (state: RoundTwoView) => void;
  "round:completed": (summary: RoundOneSummary) => void;
  "vote:updated": (vote: PublicVote) => void;
  "vote:own": (vote: OwnVote) => void;
  "server:ready": (payload: ServerReadyPayload) => void;
  "room:updated": (room: PublicRoom) => void;
  "game:role": (assignment: PrivateRole) => void;
}

export interface FinalHuman {
  participantId: string; name: string; role: AssignedRole;
  status: "evacuated" | "dead" | "abandoned" | "active";
  health?: number; energy?: number;
}
export interface FinalNpc {
  round: 1 | 2 | 6;
  status: "not-encountered" | "absent" | "pending" | "approved" | "rescued" | "abandoned" | "dead";
  /** null: el motor no registra su llegada a la calle. */
  evacuated: boolean | null;
}
export interface GameFinalResult {
  narrative?: { title: string; paragraphs: string[] };
  /** Added only by the authenticated recipient's server projection. */
  personalEpilogue?: { participantId: string; text: string };
  id: string; gameId: string; closedAt: number; round: 1 | 2 | 3 | 4 | 5 | 6;
  kind: "evacuation-completed" | "no-active-humans";
  humans: FinalHuman[]; npcs: FinalNpc[];
  counts: { evacuated: number; dead: number; abandoned: number; rescuedNpcs: number; evacuatedNpcs: number };
  inventory: { packs: number; medicalUnits: number }; crowbar: "available" | "lost";
  lastMovement: { routeName: string; completed: boolean; accident: boolean; victimIds: string[] } | null;
  decisions: string[];
}
/** Exclusivo del destinatario autorizado; nunca incluir en el resultado público. */
export interface PrivateObjectiveEvidence {
  narrative?: string;
  resultId: string; participantId: string; objective: string;
  gameId?: string;
  evaluation: "fulfilled" | "unfulfilled" | "pending-evaluation";
  evidenceState: "confirmed" | "insufficient";
  facts: string[]; missing: string[];
}

export interface GameActivityView {
  gameId: string;
  tools: { crowbar: "available" | "lost" };
  entries: { id: string; round: 1 | 2 | 3 | 4 | 5 | 6; kind: "pack" | "treatment"; targetParticipantId: string; restored?: number }[];
}

export interface TransportCaseView {
  preparationId: string;
  round: 1 | 2 | 3 | 4 | 5 | 6;
  routeId: string;
  routeName: string;
  routeCost: number;
  phase: "preparation" | "voting" | "selection" | "pending" | "completed" | "blocked" | "superseded" | "sector-evacuated";
  reason: string | null;
  crisis?: { gas?: TransportIncidentView; explosion?: TransportIncidentView };
  exhaustedIds: string[];
  eligibleIds: string[];
  people: { participantId: string; name: string; energy?: number }[];
  options: { id: string; label: string; viable: boolean; carrierIds: string[]; carrierCost: number; authorizedVoterIds: string[] }[];
  vote: PublicVote | null;
  decisions: { stage: "transport" | "recipient"; vote: PublicVote; outcome: string | null }[];
  transportedIds: string[];
  abandonedIds: string[];
  charges: { participantId: string; kind: "walking" | "carrier" | "transported"; routeEnergy?: number; transportEnergy?: number }[];
  transfers: { participantId: string; items: { id: string; kind: string }[] }[];
}
export interface TransportView { cases: TransportCaseView[] }

export type AssignedRole = "maintenance" | "medic" | "architect-engineer" | "bellhop";

export interface PublicParticipant {
  id: string;
  name: string;
  connected: boolean;
}

/** Proyección pública explícita: sin roles, credenciales ni estado del motor. */
export interface PublicRoom {
  code: string;
  creatorId: string;
  status: "waiting" | "started";
  participants: PublicParticipant[];
}

export interface SessionCredential {
  code: string;
  participantId: string;
  token: string;
}

/** Respuesta privada al socket que crea, entra o se autentica. */
export interface RoomSession {
  credential: SessionCredential;
  room: PublicRoom;
}

export interface PrivateRole {
  participantId: string;
  role: AssignedRole;
  sheet: CharacterSheet;
}

/** Solo la ficha autorizada; el catálogo de contenidos pertenece al servidor. */
export interface CharacterSheet {
  name: string;
  responsibility: string;
  objective: string;
  knowledge: { id: string; text: string }[];
}

export type RoomError = "invalid-input" | "room-not-found" | "room-full" | "already-started"
  | 'game-not-finished' | 'wrong-game'
  | "not-creator" | "not-four-connected" | "invalid-credentials" | "session-in-use"
  | "already-in-room";

export type RoomReply<T> = { ok: true; value: T } | { ok: false; error: RoomError };

export interface VoteInput { decisionId: string; attemptId: string; optionId: string }
export interface OwnVote { decisionId: string; attemptId: string; optionId: string | null }
export interface PublicVote {
  decisionId: string;
  attemptId: string;
  round: 1 | 2 | 3 | 4 | 5 | 6;
  attemptNumber: number;
  deadline: number;
  serverNow: number;
  requiredVotes: number;
  status: "open" | "closed";
  result: "RESCUE_APPROVED" | "ABANDON_APPROVED" | "NO_AGREEMENT" | null;
}
export type VoteReply = { ok: true; own: OwnVote } | { ok: false; error: string };

export interface PackInput { requestId: string; windowId: string; targetParticipantId: string }
export interface TreatmentInput { requestId: string; gameId: string; round: 1 | 2 | 3 | 4 | 5 | 6; targetParticipantId: string }
export type TreatmentReply = { ok: true; requestId: string } | { ok: false; error: string };
export interface MedicalView {
  deaths?: {participantId:string;round:1|2|3|4|5|6;message:string}[];
  gameId: string;
  round: 1 | 2 | 3 | 4 | 5 | 6;
  characters: RoundOneSummary["characters"];
  inventory: RoundOneSummary["inventory"];
  treatments: { round: 1 | 2 | 3 | 4 | 5 | 6; participantId: string; healthRestored?: number }[];
}
export type PackReply = { ok: true; requestId: string } | { ok: false; error: string };
/** Estado actual público, separado de las instantáneas históricas al terminar rutas. */
export interface SuppliesView {
  gameId: string;
  round: 1 | 2 | 3 | 4 | 5 | 6;
  windowId: string | null;
  sectorEvacuation?: { incidentId: string; round: 1|2|3|4|5; routeId: string };
  resourceActions?: { participantId: string; packEligibility?: ResourceEligibility; medicalEligibility?: ResourceEligibility }[];
  movementBlocked?: string;
  characters: RoundOneSummary["characters"];
  inventory: RoundOneSummary["inventory"];
}

export type RescueOutcome = NonNullable<PublicVote["result"]>;
/** Vista común sin roles, conocimientos ni identificadores internos. */
export interface RoundOneSummary {
  gameId: string;
  decisionId: string;
  round: 1;
  completed: true;
  result: RescueOutcome;
  npc: "rescued" | "abandoned";
  microearthquake: boolean;
  costs: { rescueEnergy: number; movementEnergy: number; damage: number };
  characters: { participantId: string; name: string; role?: AssignedRole; health?: number; energy?: number; status?: "active" | "dead" | "abandoned" | "exhausted" | "transported"; eliminated?: boolean }[];
  inventory: { packs: number; medicalUnits: number };
}

export interface RoundTwoView {
  recovery?: RouteRecovery;
  failedSelections?: FailedRouteSelection[];
  movement: {
    status: "completed"; decisionId: string; routeId: RouteId; routeName: string;
    forced: boolean; microearthquake: boolean; accident: boolean; energyCost: number;
    charges?: { participantId: string; energy: number; kind: "walking" | "carrier" | "transported" }[];
    victims: { participantId: string; name: string; damage?: number }[];
  } | { status: "blocked"; decisionId: string; reason: string } | null;
  routeChoice: RouteChoiceView | null;
  round: 2;
  npcId: "round-two-survivor";
  mobility: "walks-with-help";
  npc: "pending" | "rescued" | "abandoned";
  phase: "rescue-vote" | "resolution-blocked" | "route-pending" | "movement-blocked" | "transport-pending" | "completed" | "sector-evacuated";
  blocked: "insufficient-energy" | null;
  result: RescueOutcome | null;
  microearthquake: boolean;
  characters: RoundOneSummary["characters"];
  inventory: RoundOneSummary["inventory"];
  previousNpc: "rescued" | "abandoned" | "pending";
}

export type RoundThreeRouteId = "fire-door" | "pipe-gallery" | "metal-debris";
export type ExitRouteId = "revolving-door" | "exterior-crack";
export type RoundFourNpcChoice = "abandon" | "assist" | "carry" | "medical-assist";
/** Proyección pública explícita. Sin catálogo de riesgos, roles ni credenciales. */
export interface RoundFourView {
  round: 6;
  preparationId: string;
  phase: "npc-voting" | "preparation" | "exit-voting" | "transport" | "blocked" | "completed";
  npc: {
    encounter: "none" | "walking-assisted" | "immobile";
    status: "absent" | "awaiting-decision" | "awaiting-effort" | "rescued" | "abandoned" | "dead";
    choice: RoundFourNpcChoice | null;
    message: string | null;
    energyPerHuman: number;
    medicalUnits: number;
    options: { id: RoundFourNpcChoice; label: string; energyPerHuman: number; medicalUnits: number; available: boolean }[];
    vote: PublicVote | null;
  };
  options: { id: ExitRouteId; name: string; description?: string; danger?: RouteRiskCategory; energyCost: number; availability: RouteAvailability }[];
  vote: PublicVote | null;
  selection: { decisionId: string; outcome: ExitRouteId | "NO_AGREEMENT" } | null;
  forced: boolean;
  surcharge: number;
  collapse: { affectedIds: string[]; deceasedIds: string[]; damage: number } | null;
  blocked: string | null;
  movement: {
    requestId: string; routeId: ExitRouteId; energyCost: number; accident: boolean;
    victims: { participantId: string; damage?: number }[];
    deceasedIds: string[]; escapedHumanIds: string[]; rescuedNpc: boolean;
    characters: RoundOneSummary["characters"]; inventory: RoundOneSummary["inventory"];
    crowbar: "available" | "lost";
  } | null;
}
export interface RoundThreeView {
  recovery?: RouteRecovery;
  failedSelections?: FailedRouteSelection[];
  round: 3;
  phase: "preparation" | "voting" | "transport" | "completed" | "blocked" | "sector-evacuated";
  options: { id: RoundThreeRouteId; name: string; description: string; danger?: RouteRiskCategory; energyCost: number; availability: RouteAvailability }[];
  vote: PublicVote | null;
  selection: { decisionId: string; outcome: RoundThreeRouteId | "NO_AGREEMENT" } | null;
  forced: boolean;
  earthquake: boolean;
  blockedRoutes: RoundThreeRouteId[];
  movement: {
    routeId: RoundThreeRouteId; energyCost: number; accident: boolean;
    victims: { participantId: string; name: string; damage?: number }[];
    environment: { participantId: string; name: string; damage?: number }[];
    gained: RoundOneSummary["inventory"];
    crowbarLost: boolean; returnBlocked: boolean;
    discovery: "medical-conference-room" | "supply-warehouse" | null;
  } | null;
  blocked: string | null;
  afterRoute: { characters: RoundOneSummary["characters"]; inventory: RoundOneSummary["inventory"]; crowbar: "available" | "lost" } | null;
  previousNpcs: { round: 1 | 2; status: "rescued" | "abandoned" | "pending" }[];
}

/** El nombre RoundFourView se conserva como alias técnico del protocolo anterior: ahora es ronda 6. */
export type RoundSixView = RoundFourView;
export interface IntermediateRoundView {
  round: 4 | 5; title: string; narrative: string; preparationId: string;
  phase: "preparation" | "voting" | "movement" | "completed" | "sector-evacuated";
  options: { id: string; name: string; description: string; energyCost: number; danger?: RouteRiskCategory; selectable: boolean; availability: RouteAvailability }[];
  failedAttempts?: { attemptNumber: number; closedAt: number }[];
  consequence?: { decisionId: string; forcedRouteId: string; routeName: string; victims: { participantId: string; name: string; damage?: number }[]; deceasedIds: string[] };
  canReveal: boolean; vote: PublicVote | null; blocked: string | null;
  movement: { requestId: string; routeId: string; routeName: string; energyCost: number; accident: boolean;
    victims: { participantId: string; name: string; damage?: number }[]; deceasedIds: string[];
    characters: RoundOneSummary["characters"]; inventory: RoundOneSummary["inventory"] } | null;
}

export interface TransportIncidentView { incidentId: string; at: number; victims: { participantId: string; damage?: number }[]; deceasedIds: string[] }

export interface ChatInput { requestId: number; text: string }
export interface ChatMessage {
  id: string; sequence: number; requestId: number; sentAt: number; text: string;
  sender: { kind: 'human'; participantId: string; name: string; role?: AssignedRole }
    | { kind: 'server'; name: string; npcId?: string };
}
export interface ChatView { code: string; sequence: number; messages: ChatMessage[]; canWrite: boolean; nextRequestId: number }
export type ChatReply = { ok: true; messageId: string } | { ok: false; error: 'invalid-session' | 'invalid-input' | 'invalid-text' | 'read-only' | 'stale-request' | 'rate-limited' };
