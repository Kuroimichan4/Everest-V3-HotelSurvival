import type { RoundTwoView } from "@everest/shared";
import { beginRoundTwo, resolveRoundTwo } from "../simulation/round-two.js";
import type { PrivateRole, PublicRoom, RoomReply, RoomSession, SessionCredential } from "@everest/shared";
import { createInitialState, isAlive } from "../simulation/state.js";
import type { SimulationState } from "../simulation/state.js";
import { matchesToken, newId, newRoomCode, newToken, tokenHash } from "./identity.js";
import type { Participant } from "./identity.js";
import { shuffleRoles } from "./roles.js";
import { characterSheet } from "./character-sheets.js";
import type { RandomIndex } from "./roles.js";
import type { VoteReply } from "@everest/shared";
import { RoomVoting, systemClock, type VotingClock } from "./voting.js";
import type { RoundOneSummary } from "@everest/shared";
import { resolveRoundOne } from "../simulation/round-one.js";

interface Game {
  roundOneSummary?: RoundOneSummary;
  voting: RoomVoting;
  id: string;
  state: SimulationState;
}
interface Room {
  code: string;
  creatorId: string;
  participants: Participant[];
  game: Game | null;
}

const fail = (error: Extract<RoomReply<never>, { ok: false }>["error"]) => ({ ok: false as const, error });
function validName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 40;
}
function validCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Fa-f0-9]{12}$/.test(code.trim());
}

/** Provisional de desarrollo: una instancia por servidor, sin persistencia ni estado global. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Map<string, { room: Room; participant: Participant }>();

  onVotingChanged: (code: string) => void = () => {};
  constructor(private readonly randomIndex?: RandomIndex, private readonly clock: VotingClock = systemClock) {}

  dispose(): void { for (const room of this.rooms.values()) room.game?.voting.dispose(); }
  publicVote(code: string) { return this.rooms.get(code)?.game?.voting.publicView() ?? null; }
  votingSession(socketId: string) {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return null;
    const voting = connection.room.game.voting;
    voting.refresh();
    return { public: voting.publicView(), own: voting.ownView(connection.participant.id) };
  }
  vote(socketId: string, input: unknown): VoteReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    const character = room.game!.state.characters.find((entry) => entry.id === participant.characterId);
    if (!character) return { ok: false, error: "not-authorized" };
    if (!isAlive(character)) return { ok: false, error: "dead" };
    return room.game!.voting.vote(participant.id, input);
  }

  private publicRoom(room: Room): PublicRoom {
    return {
      code: room.code,
      creatorId: room.creatorId,
      status: room.game ? "started" : "waiting",
      participants: room.participants.map(({ id, name, socketId }) => ({ id, name, connected: socketId !== null })),
    };
  }

  private addParticipant(room: Room, socketId: string, name: string): RoomSession {
    const token = newToken();
    const participant: Participant = {
      id: newId(), name: name.trim(), tokenHash: tokenHash(token), socketId, characterId: null,
    };
    room.participants.push(participant);
    this.connections.set(socketId, { room, participant });
    return {
      credential: { code: room.code, participantId: participant.id, token },
      room: this.publicRoom(room),
    };
  }

  create(socketId: string, name: unknown): RoomReply<RoomSession> {
    if (this.connections.has(socketId)) return fail("already-in-room");
    if (!validName(name)) return fail("invalid-input");
    let code: string;
    do { code = newRoomCode(); } while (this.rooms.has(code));
    const room: Room = { code, creatorId: "", participants: [], game: null };
    const session = this.addParticipant(room, socketId, name);
    room.creatorId = session.credential.participantId;
    this.rooms.set(code, room);
    return { ok: true, value: { ...session, room: this.publicRoom(room) } };
  }

  join(socketId: string, name: unknown, code: unknown): RoomReply<RoomSession> {
    if (this.connections.has(socketId)) return fail("already-in-room");
    if (!validName(name) || !validCode(code)) return fail("invalid-input");
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room) return fail("room-not-found");
    if (room.game) return fail("already-started");
    if (room.participants.length >= 4) return fail("room-full");
    return { ok: true, value: this.addParticipant(room, socketId, name) };
  }

  resume(socketId: string, input: unknown): RoomReply<RoomSession> {
    if (!input || typeof input !== "object") return fail("invalid-credentials");
    const { code, participantId, token } = input as Partial<SessionCredential>;
    if (!validCode(code) || typeof participantId !== "string" || typeof token !== "string" || token.length !== 64) {
      return fail("invalid-credentials");
    }
    const room = this.rooms.get(code.trim().toUpperCase());
    const participant = room?.participants.find((candidate) => candidate.id === participantId);
    if (!room || !participant || !matchesToken(token, participant.tokenHash)) return fail("invalid-credentials");
    const existing = this.connections.get(socketId);
    if (existing && existing.participant !== participant) return fail("already-in-room");
    if (participant.socketId !== null && participant.socketId !== socketId) return fail("session-in-use");
    participant.socketId = socketId;
    this.connections.set(socketId, { room, participant });
    return {
      ok: true,
      value: { credential: { code: room.code, participantId, token }, room: this.publicRoom(room) },
    };
  }

  start(socketId: string): RoomReply<PublicRoom> {
    const connection = this.connections.get(socketId);
    if (!connection) return fail("invalid-credentials");
    const { room, participant } = connection;
    if (participant.id !== room.creatorId) return fail("not-creator");
    if (room.game) return fail("already-started");
    if (room.participants.length !== 4 || room.participants.some((player) => player.socketId === null)) {
      return fail("not-four-connected");
    }
    const roles = shuffleRoles(this.randomIndex);
    const initial = createInitialState();
    const characters = room.participants.map((_, index) => ({
      ...initial.characters[index]!, id: newId(), role: roles[index]!,
    }));
    // Sin await entre validación y escritura: dos peticiones no pueden iniciar dos veces.
    room.game = { id: newId(), state: { ...initial, characters },
      voting: new RoomVoting(room.participants.map((player, index) => ({ participantId: player.id, alive: isAlive(characters[index]!) })),
        this.clock, () => { this.resolveRound(room); this.onVotingChanged(room.code); }) };
    room.participants.forEach((player, index) => { player.characterId = characters[index]!.id; });
    return { ok: true, value: this.publicRoom(room) };
  }

  private resolveRound(room: Room): void {
    const game = room.game;
    if (!game) return;
    if (game.state.currentRound === 2) {
      const vote = game.voting.publicView();
      if (!vote.result || game.state.roundTwo?.resolution) return;
      const resolved = resolveRoundTwo(game.state, vote.decisionId, vote.result);
      if (resolved.ok) game.state = resolved.state;
      else if (resolved.error === "insufficient-energy") game.state = { ...game.state,
        roundTwo: { ...game.state.roundTwo!, blocked: "insufficient-energy" } };
      return;
    }
    if (game.state.roundOne) return;
    const vote = game.voting.publicView();
    if (!vote.result) return;
    const resolved = resolveRoundOne(game.state, vote.decisionId, vote.result);
    if (resolved.ok) game.state = resolved.state;
  }

  advanceRound(socketId: string): VoteReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    if (participant.id !== room.creatorId) return { ok: false, error: "not-creator" };
    const game = room.game!;
    const next = beginRoundTwo(game.state);
    if (next === game.state) return { ok: false, error: "round-not-ready" };
    if (!next.characters.some(isAlive)) return { ok: false, error: "no-living-characters-pending" };
    const voting = new RoomVoting(room.participants.map((player) => ({ participantId: player.id,
      alive: next.characters.some((character) => character.id === player.characterId && isAlive(character)) })),
      this.clock, () => { this.resolveRound(room); this.onVotingChanged(room.code); }, 2);
    game.roundOneSummary = this.roundSummary(room.code)!;
    game.voting.dispose();
    game.state = next;
    game.voting = voting;
    this.onVotingChanged(room.code);
    return { ok: true, own: voting.ownView(participant.id) };
  }

  roundTwoView(code: string): RoundTwoView | null {
    const room = this.rooms.get(code);
    const game = room?.game;
    const round = game?.state.roundTwo;
    if (!room || !game || !round) return null;
    const resolution = round.resolution;
    return { round: 2, npcId: round.npcId, mobility: "walks-with-help",
      npc: resolution?.npc ?? "pending", previousNpc: game.state.roundOne!.npc,
      phase: resolution ? "route-pending" : round.blocked ? "resolution-blocked" : "rescue-vote",
      blocked: round.blocked, result: resolution?.result ?? game.voting.publicView().result,
      microearthquake: resolution?.microearthquake ?? false,
      inventory: { ...game.state.inventory },
      characters: room.participants.map((participant) => {
        const character = game.state.characters.find((entry) => entry.id === participant.characterId)!;
        return { participantId: participant.id, name: participant.name, health: character.health, energy: character.energy };
      }) };
  }

  roundTwoSession(socketId: string): RoundTwoView | null {
    const connection = this.connections.get(socketId);
    return connection ? this.roundTwoView(connection.room.code) : null;
  }

  roundSummary(code: string): RoundOneSummary | null {
    const room = this.rooms.get(code);
    const game = room?.game;
    if (game?.roundOneSummary) return structuredClone(game.roundOneSummary);
    const resolution = game?.state.roundOne;
    if (!room || !game || !resolution) return null;
    return { gameId: game.id, decisionId: resolution.decisionId, round: 1,
      completed: resolution.completed, result: resolution.result, npc: resolution.npc,
      microearthquake: resolution.microearthquake, costs: { ...resolution.costs },
      inventory: { ...game.state.inventory },
      characters: room.participants.map((participant) => {
        const character = game.state.characters.find((entry) => entry.id === participant.characterId)!;
        return { participantId: participant.id, name: participant.name, health: character.health, energy: character.energy };
      }) };
  }

  summarySession(socketId: string): RoundOneSummary | null {
    const connection = this.connections.get(socketId);
    return connection ? this.roundSummary(connection.room.code) : null;
  }

  privateRole(socketId: string): PrivateRole | null {
    const connection = this.connections.get(socketId);
    if (!connection) return null;
    const { room, participant } = connection;
    const character = room.game?.state.characters.find((candidate) => candidate.id === participant.characterId);
    return character && isAlive(character)
      ? { participantId: participant.id, role: character.role, sheet: characterSheet(character.role) } : null;
  }

  disconnect(socketId: string): PublicRoom | null {
    const connection = this.connections.get(socketId);
    if (!connection) return null;
    connection.participant.socketId = null;
    this.connections.delete(socketId);
    return this.publicRoom(connection.room);
  }
}
