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

export interface ClientToServerEvents {
  "vote:cast": (input: VoteInput, ack: (reply: VoteReply) => void) => void;
  "client:ping": (acknowledge: (response: PingResponse) => void) => void;
  "room:create": (input: { name: string }, ack: (result: RoomReply<RoomSession>) => void) => void;
  "room:join": (input: { name: string; code: string }, ack: (result: RoomReply<RoomSession>) => void) => void;
  "room:resume": (input: SessionCredential, ack: (result: RoomReply<RoomSession>) => void) => void;
  "room:start": (ack: (result: RoomReply<PublicRoom>) => void) => void;
}

export interface ServerToClientEvents {
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
  round: 1;
  attemptNumber: number;
  deadline: number;
  serverNow: number;
  requiredVotes: number;
  status: "open" | "closed";
  result: "RESCUE_APPROVED" | "ABANDON_APPROVED" | "NO_AGREEMENT" | null;
}
export type VoteReply = { ok: true; own: OwnVote } | { ok: false; error: string };
