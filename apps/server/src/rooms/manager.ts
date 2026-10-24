import { publicRouteViews, privateRouteViews, checkRouteRequirements } from "../simulation/routes.js";
import type { RouteId, RouteChoiceView, RouteActionReply } from "@everest/shared";
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
import { resolveRoundTwoMovement } from "../simulation/round-two-movement.js";
import type { RandomSource } from "../simulation/routes.js";
import { consumePack } from "../simulation/operations.js";
import type { PackInput, PackReply, SuppliesView } from "@everest/shared";

interface Game {
  packRequests: Map<string, PackInput & { actorId: string }>;
  roundTwoAfterRoute?: Pick<RoundTwoView, "characters" | "inventory">;
  route?: { revealed: boolean; voting?: RoomVoting; options?: RouteChoiceView["options"]; result: RouteChoiceView["result"] };
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
  onSuppliesChanged: (code: string) => void = () => {};
  constructor(private readonly randomIndex?: RandomIndex, private readonly clock: VotingClock = systemClock,
    private readonly routeRandom: RandomSource = Math.random) {}

  dispose(): void { for (const room of this.rooms.values()) { room.game?.voting.dispose(); room.game?.route?.voting?.dispose(); } }
  publicVote(code: string) { const game = this.rooms.get(code)?.game; return game ? (game.route?.voting ?? game.voting).publicView() : null; }
  votingSession(socketId: string) {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return null;
    const voting = connection.room.game.route?.voting ?? connection.room.game.voting;
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
    return (room.game!.route?.voting ?? room.game!.voting).vote(participant.id, input);
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
    room.game = { id: newId(), packRequests: new Map(), state: { ...initial, characters },
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
      if (resolved.ok) { game.state = resolved.state; game.route = { revealed: false, result: null }; }
      else if (resolved.error === "insufficient-energy") game.state = { ...game.state,
        roundTwo: { ...game.state.roundTwo!, blocked: "insufficient-energy" } };
      return;
    }
    if (game.state.roundOne) return;
    const vote = game.voting.publicView();
    if (!vote.result) return;
    const resolved = resolveRoundOne(game.state, vote.decisionId, vote.result);
    if (resolved.ok) {
      game.state = resolved.state;
      game.roundOneSummary = this.roundSummary(room.code)!;
    }
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

  private routeOptions(game: Game): RouteChoiceView["options"] {
    return [...publicRouteViews(), ...(game.route?.revealed ? privateRouteViews("maintenance") : [])].map(option => {
      const check = checkRouteRequirements(game.state, option.id);
      return { ...option, blocked: check.ok ? null : check.error };
    });
  }
  private routeView(game: Game): RouteChoiceView | null {
    const route = game.route;
    if (!route) return null;
    return { phase: route.result ? "selected" : route.voting ? "voting" : "preparation",
      ventilationRevealed: route.revealed, options: (route.options ?? this.routeOptions(game)).map(option => ({ ...option })),
      vote: route.voting?.publicView() ?? null, result: route.result ? { ...route.result } : null };
  }
  routeAction(socketId: string, action: "reveal" | "open"): RouteActionReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    const game = room.game!;
    const route = game.route;
    const character = game.state.characters.find(c => c.id === participant.characterId);
    if (!character || !isAlive(character)) return { ok: false, error: "not-authorized" };
    if (action === "reveal" && character.role !== "maintenance") return { ok: false, error: "not-authorized" };
    if (action === "open" && participant.id !== room.creatorId) return { ok: false, error: "not-creator" };
    if (!route) return { ok: false, error: "route-not-ready" };
    if (action === "reveal" && route.revealed) return { ok: true };
    if (action === "open" && route.voting) return { ok: true };
    if (route.voting) return { ok: false, error: "preparation-closed" };
    if (action === "reveal") route.revealed = true;
    else {
      const options = this.routeOptions(game);
      // El motor colectivo requiere dos opciones; no inventar una elección automática.
      if (options.filter(o => !o.blocked).length < 2) return { ok: false, error: "requirements-pending" };
      route.options = options;
      route.voting = new RoomVoting(room.participants.map(player => ({ participantId: player.id,
        alive: game.state.characters.some(c => c.id === player.characterId && isAlive(c)) })), this.clock, () => {
          const outcome = route.voting!.selectedOption();
          if (outcome && !route.result) route.result = { decisionId: route.voting!.publicView().decisionId, outcome: outcome as RouteId | "NO_AGREEMENT" };
          if (route.result && !game.state.roundTwo?.movement) {
            const movement = resolveRoundTwoMovement(game.state, { ...route.result, ventilationRevealed: route.revealed }, this.routeRandom);
            if (movement.ok) {
              game.state = movement.state;
              const snapshot = this.suppliesView(room.code)!;
              game.roundTwoAfterRoute = { characters: snapshot.characters, inventory: snapshot.inventory };
            }
            else game.state = { ...game.state, roundTwo: { ...game.state.roundTwo!,
              movement: { status: "blocked", decisionId: route.result.decisionId, error: movement.error } } };
          }
          this.onVotingChanged(room.code);
        }, 2, options.filter(o => !o.blocked).map(o => ({ id: o.id, label: o.name })));
    }
    this.onVotingChanged(room.code);
    return { ok: true };
  }

  roundTwoView(code: string): RoundTwoView | null {
    const room = this.rooms.get(code);
    const game = room?.game;
    const round = game?.state.roundTwo;
    if (!room || !game || !round) return null;
    const resolution = round.resolution;
    const movement = round.movement;
    const movementView: RoundTwoView["movement"] = !movement ? null : movement.status === "blocked"
      ? { status: "blocked", decisionId: movement.decisionId, reason: movement.error }
      : { status: "completed", decisionId: movement.decisionId, routeId: movement.routeId,
        routeName: [...publicRouteViews(), ...privateRouteViews("maintenance")].find(route => route.id === movement.routeId)!.name,
        forced: movement.forced, microearthquake: movement.microearthquake, accident: movement.accident,
        energyCost: movement.energyCost, victims: movement.victims.map(victim => {
          const participant = room.participants.find(player => player.characterId === victim.characterId)!;
          return { participantId: participant.id, name: participant.name, damage: victim.damage };
        }) };
    return { movement: movementView, routeChoice: this.routeView(game), round: 2, npcId: round.npcId, mobility: "walks-with-help",
      npc: resolution?.npc ?? "pending", previousNpc: game.state.roundOne!.npc,
      phase: movement?.status === "completed" ? "completed" : movement ? "movement-blocked"
        : resolution ? "route-pending" : round.blocked ? "resolution-blocked" : "rescue-vote",
      blocked: round.blocked, result: resolution?.result ?? game.voting.publicView().result,
      microearthquake: resolution?.microearthquake ?? false,
      inventory: { ...(game.roundTwoAfterRoute?.inventory ?? game.state.inventory) },
      characters: game.roundTwoAfterRoute ? structuredClone(game.roundTwoAfterRoute.characters) : room.participants.map((participant) => {
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

  suppliesView(code: string): SuppliesView | null {
    const room = this.rooms.get(code);
    const game = room?.game;
    if (!room || !game) return null;
    const movement = game.state.roundTwo?.movement;
    const windowId = game.state.currentRound === 1 ? game.state.roundOne?.decisionId ?? null
      : movement?.status === "completed" ? movement.decisionId : null;
    return { gameId: game.id, round: game.state.currentRound, windowId,
      inventory: { ...game.state.inventory }, characters: room.participants.map(participant => {
        const character = game.state.characters.find(c => c.id === participant.characterId)!;
        return { participantId: participant.id, name: participant.name, health: character.health, energy: character.energy };
      }) };
  }

  suppliesSession(socketId: string): SuppliesView | null {
    const connection = this.connections.get(socketId);
    return connection ? this.suppliesView(connection.room.code) : null;
  }

  givePack(socketId: string, input: unknown): PackReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    const game = room.game!;
    const actor = game.state.characters.find(c => c.id === participant.characterId);
    if (!actor || actor.role !== "bellhop") return { ok: false, error: "not-authorized" };
    if (!isAlive(actor)) return { ok: false, error: "bellhop-dead" };
    if (!input || typeof input !== "object" || Object.keys(input).sort().join(",") !== "requestId,targetParticipantId,windowId") return { ok: false, error: "invalid-input" };
    const candidate = input as PackInput;
    if ([candidate.requestId, candidate.windowId, candidate.targetParticipantId].some(value =>
      typeof value !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value))) return { ok: false, error: "invalid-input" };
    const previous = game.packRequests.get(candidate.requestId);
    if (previous) {
      if (previous.actorId !== participant.id || previous.windowId !== candidate.windowId
        || previous.targetParticipantId !== candidate.targetParticipantId) return { ok: false, error: "request-conflict" };
      return { ok: true, requestId: candidate.requestId };
    }
    if (this.suppliesView(room.code)?.windowId !== candidate.windowId) return { ok: false, error: "supplies-not-open" };
    const target = room.participants.find(player => player.id === candidate.targetParticipantId);
    if (!target?.characterId) return { ok: false, error: "target-not-found" };
    const consumed = consumePack(game.state, target.characterId);
    if (!consumed.ok) return { ok: false, error: consumed.error };
    // Sin await: validación, consumo y recibo se confirman juntos antes de publicar.
    game.state = consumed.state;
    game.packRequests.set(candidate.requestId, { ...candidate, actorId: participant.id });
    this.onSuppliesChanged(room.code);
    return { ok: true, requestId: candidate.requestId };
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
