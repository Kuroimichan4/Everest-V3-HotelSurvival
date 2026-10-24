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
export interface RouteChoiceView {
  phase: "preparation" | "voting" | "selected";
  ventilationRevealed: boolean;
  options: { id: RouteId; name: string; energyCost: number; blocked: string | null }[];
  vote: PublicVote | null;
  result: { decisionId: string; outcome: RouteId | "NO_AGREEMENT" } | null;
}

export interface ClientToServerEvents {
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

export interface ServerToClientEvents {
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
  | "not-creator" | "not-four-connected" | "invalid-credentials" | "session-in-use"
  | "already-in-room";

export type RoomReply<T> = { ok: true; value: T } | { ok: false; error: RoomError };

export interface VoteInput { decisionId: string; attemptId: string; optionId: string }
export interface OwnVote { decisionId: string; attemptId: string; optionId: string | null }
export interface PublicVote {
  decisionId: string;
  attemptId: string;
  round: 1 | 2 | 3;
  attemptNumber: number;
  deadline: number;
  serverNow: number;
  requiredVotes: number;
  status: "open" | "closed";
  result: "RESCUE_APPROVED" | "ABANDON_APPROVED" | "NO_AGREEMENT" | null;
}
export type VoteReply = { ok: true; own: OwnVote } | { ok: false; error: string };

export interface PackInput { requestId: string; windowId: string; targetParticipantId: string }
export interface TreatmentInput { requestId: string; gameId: string; round: 1 | 2 | 3; targetParticipantId: string }
export type TreatmentReply = { ok: true; requestId: string } | { ok: false; error: string };
export interface MedicalView {
  gameId: string;
  round: 1 | 2 | 3;
  characters: RoundOneSummary["characters"];
  inventory: RoundOneSummary["inventory"];
  treatments: { round: 1 | 2 | 3; participantId: string; healthRestored: number }[];
}
export type PackReply = { ok: true; requestId: string } | { ok: false; error: string };
/** Estado actual público, separado de las instantáneas históricas al terminar rutas. */
export interface SuppliesView {
  gameId: string;
  round: 1 | 2 | 3;
  windowId: string | null;
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
  characters: { participantId: string; name: string; health: number; energy: number; eliminated?: boolean }[];
  inventory: { packs: number; medicalUnits: number };
}

export interface RoundTwoView {
  movement: {
    status: "completed"; decisionId: string; routeId: RouteId; routeName: string;
    forced: boolean; microearthquake: boolean; accident: boolean; energyCost: number;
    victims: { participantId: string; name: string; damage: number }[];
  } | { status: "blocked"; decisionId: string; reason: string } | null;
  routeChoice: RouteChoiceView | null;
  round: 2;
  npcId: "round-two-survivor";
  mobility: "walks-with-help";
  npc: "pending" | "rescued" | "abandoned";
  phase: "rescue-vote" | "resolution-blocked" | "route-pending" | "movement-blocked" | "completed";
  blocked: "insufficient-energy" | null;
  result: RescueOutcome | null;
  microearthquake: boolean;
  characters: RoundOneSummary["characters"];
  inventory: RoundOneSummary["inventory"];
  previousNpc: RoundOneSummary["npc"];
}

export type RoundThreeRouteId = "fire-door" | "pipe-gallery" | "metal-debris";
export interface RoundThreeView {
  round: 3;
  phase: "preparation" | "voting" | "completed" | "blocked";
  options: { id: RoundThreeRouteId; name: string; description: string; energyCost: number }[];
  vote: PublicVote | null;
  selection: { decisionId: string; outcome: RoundThreeRouteId | "NO_AGREEMENT" } | null;
  forced: boolean;
  earthquake: boolean;
  blockedRoutes: RoundThreeRouteId[];
  movement: {
    routeId: RoundThreeRouteId; energyCost: number; accident: boolean;
    victims: { participantId: string; name: string; damage: number }[];
    environment: { participantId: string; name: string; damage: number }[];
    gained: RoundOneSummary["inventory"];
    crowbarLost: boolean; returnBlocked: boolean;
    discovery: "medical-conference-room" | "supply-warehouse" | null;
  } | null;
  blocked: string | null;
  afterRoute: { characters: RoundOneSummary["characters"]; inventory: RoundOneSummary["inventory"]; crowbar: "available" | "lost" } | null;
  previousNpcs: { round: 1 | 2; status: "rescued" | "abandoned" }[];
}
