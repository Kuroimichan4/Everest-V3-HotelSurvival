import { RoundFourStage } from "./round-four.js";
import { beginRoundFour, prepareRescueEffort, resolveRoundFourExit, roundFourRouteAvailability, type RoundFourState } from "../simulation/round-four.js";
import type { RoundFourView } from "@everest/shared";
import type { RouteRecovery, FailedRouteSelection, GameActivityView } from "@everest/shared";
import { MOVEMENT_ENERGY } from "../simulation/energy-costs.js";
import { TransportDecision } from "./transport.js";
import { classifyMovement, routeEnergyAvailability, type TransportPlan } from "../simulation/transport.js";
import { prepareRoundOne } from "../simulation/round-one.js";
import type { TransportView, RouteActionReply as TransportActionReply } from "@everest/shared";
import { beginRoundThree, resolveRoundThreeChoice } from "../simulation/round-three.js";
import { publicRoundThreeRouteViews } from "../simulation/round-three-routes.js";
import type { RoundThreeView, RoundThreeRouteId } from "@everest/shared";
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
import { administerTreatment, consumePack } from "../simulation/operations.js";
import type { PackInput, PackReply, SuppliesView } from "@everest/shared";
import type { MedicalView, TreatmentInput, TreatmentReply } from "@everest/shared";

interface Game {
  roundFour?: RoundFourStage;
  roundThreeSummary?: RoundThreeView;
  activities?: GameActivityView["entries"];
  recovery?: RouteRecovery & { preparationId: string };
  failedSelections?: FailedRouteSelection[];
  transports?: TransportDecision[];
  resolvingMovement?: boolean;
  roundOneBlocked?: string;
  roundThree?: { preparationId: string; voting?: RoomVoting; selection: RoundThreeView["selection"]; earthquake: boolean;
    blockedRoutes: RoundThreeRouteId[]; options?: RoundThreeView["options"]; afterRoute?: NonNullable<RoundThreeView["afterRoute"]> };
  roundTwoSummary?: RoundTwoView;
  treatmentRequests: Map<string, TreatmentInput & { actorId: string }>;
  packRequests: Map<string, PackInput & { actorId: string }>;
  roundTwoAfterRoute?: Pick<RoundTwoView, "characters" | "inventory">;
  route?: { preparationId: string; revealed: boolean; voting?: RoomVoting; options?: RouteChoiceView["options"]; result: RouteChoiceView["result"] };
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

  dispose(): void { for (const room of this.rooms.values()) { room.game?.transports?.forEach(t => t.dispose()); room.game?.roundFour?.dispose(); room.game?.voting.dispose(); room.game?.route?.voting?.dispose(); room.game?.roundThree?.voting?.dispose(); } }
  private activeVoting(game: Game): RoomVoting | null {
    const transport = game.transports?.findLast(t => t.route.round === game.state.currentRound && t.phase !== "superseded");
    if (transport?.route.round === game.state.currentRound && transport.phase !== "completed") return transport.voting ?? null;
    if (game.state.currentRound === 4) return game.roundFour?.activeVoting() ?? null;
    return game.state.currentRound === 3 ? game.roundThree?.voting ?? null : game.route?.voting ?? game.voting;
  }
  publicVote(code: string) { const game = this.rooms.get(code)?.game; return game ? this.activeVoting(game)?.publicView() ?? null : null; }
  votingSession(socketId: string) {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return null;
    const voting = this.activeVoting(connection.room.game);
    if (!voting) return null;
    voting.refresh();
    const current = this.activeVoting(connection.room.game);
    return current ? { public: current.publicView(), own: current.ownView(connection.participant.id) } : null;
  }
  vote(socketId: string, input: unknown): VoteReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    const character = room.game!.state.characters.find((entry) => entry.id === participant.characterId);
    if (!character) return { ok: false, error: "not-authorized" };
    if (!isAlive(character)) return { ok: false, error: "dead" };
    const transport = room.game!.transports?.findLast(t => t.route.round === room.game!.state.currentRound && t.phase !== "superseded");
    if (transport?.route.round === room.game!.state.currentRound && transport.phase !== "completed") return transport.vote(participant.id, input);
    if (room.game!.state.currentRound === 4) return room.game!.roundFour!.vote(participant.id, input);
    const voting = this.activeVoting(room.game!);
    if (voting && input && typeof input === "object") {
      const candidate = input as { decisionId?: string; optionId?: string };
      const options = room.game!.state.currentRound === 3 ? room.game!.roundThree?.options : room.game!.route?.options;
      if (candidate.decisionId === voting.publicView().decisionId && options?.some(o => o.id === candidate.optionId && o.availability.status === "unavailable")) return { ok: false, error: "invalid-option" };
    }
    if (voting && room.game!.state.currentRound === 3 && input && typeof input === "object"
      && Object.keys(input).sort().join(",") === "attemptId,decisionId,optionId") {
      const candidate = input as { decisionId: unknown; attemptId: unknown; optionId: unknown };
      const own = voting.ownView(participant.id);
      const current = voting.publicView();
      if (current.status === "open" && current.deadline > this.clock.now() && own.optionId
        && candidate.decisionId === own.decisionId && candidate.attemptId === own.attemptId
        && candidate.optionId === own.optionId) return { ok: false, error: "duplicate-vote" };
    }
    return voting ? voting.vote(participant.id, input) : { ok: false, error: "route-not-open" };
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
    room.game = { id: newId(), packRequests: new Map(), treatmentRequests: new Map(), state: { ...initial, characters },
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
      if (resolved.ok) { game.state = resolved.state; game.route = { preparationId: newId(), revealed: false, result: null }; }
      else if (resolved.error === "insufficient-energy") game.state = { ...game.state,
        roundTwo: { ...game.state.roundTwo!, blocked: "insufficient-energy" } };
      return;
    }
    if (game.state.roundOne) return;
    const vote = game.voting.publicView();
    if (!vote.result) return;
    if (game.transports?.some(t => t.route.round === 1)) return;
    const prepared = prepareRoundOne(game.state, vote.decisionId, vote.result);
    if (!prepared.ok) { game.roundOneBlocked = prepared.error; return; }
    game.state = prepared.state;
    this.moveOrPrepare(room);
  }

  advanceRound(socketId: string): VoteReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    if (participant.id !== room.creatorId) return { ok: false, error: "not-creator" };
    const game = room.game!;
    if (!game.state.characters.some(c => c.id === participant.characterId && isAlive(c))) return { ok: false, error: "not-authorized" };
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
      const availability = check.ok ? routeEnergyAvailability(game.state, option.energyCost) : { status: "unavailable" as const, reason: check.error };
      return { ...option, blocked: availability.reason, availability };
    });
  }
  private routeView(game: Game): RouteChoiceView | null {
    const route = game.route;
    if (!route) return null;
    return { phase: route.result ? "selected" : route.voting ? "voting" : "preparation",
      ventilationRevealed: route.revealed, options: structuredClone(route.options ?? this.routeOptions(game)),
      vote: route.voting?.publicView() ?? null, result: route.result ? { ...route.result } : null };
  }
  routeAction(socketId: string, action: "reveal" | "open"): RouteActionReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    const game = room.game!;
    if (game.state.currentRound >= 3) return { ok: false, error: "round-not-ready" };
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
      // Conservar la decisión colectiva incluso si solo queda una alternativa viable.
      if (!options.some(o => !o.blocked)) return { ok: false, error: "no-available-routes" };
      route.options = options;
      route.voting = new RoomVoting(room.participants.map(player => ({ participantId: player.id,
        alive: game.state.characters.some(c => c.id === player.characterId && isAlive(c)) })), this.clock, () => {
          const outcome = route.voting!.selectedOption();
          if (outcome && !route.result) route.result = { decisionId: route.voting!.publicView().decisionId, outcome: outcome as RouteId | "NO_AGREEMENT" };
          if (route.result && !game.state.roundTwo?.movement) this.moveOrPrepare(room);
          this.onVotingChanged(room.code);
        }, 2, options.map(o => ({ id: o.id, label: o.name })));
    }
    this.onVotingChanged(room.code);
    return { ok: true };
  }

  private moveOrPrepare(room: Room): void {
    const game = room.game!;
    if (game.state.currentRound === 4) { this.moveFourth(room); return; }
    if (game.transports?.some(t => t.route.round === game.state.currentRound && t.phase !== "superseded")) return;
    if (game.recovery) return;
    const round = game.state.currentRound;
    const id = round === 1 ? "round-one-passage" : round === 2
      ? game.route!.result!.outcome === "NO_AGREEMENT" ? "unstable-corridor" : game.route!.result!.outcome
      : game.roundThree!.selection!.outcome === "NO_AGREEMENT" ? "pipe-gallery" : game.roundThree!.selection!.outcome;
    const route = round === 1 ? { id, name: "Paso obligatorio de ronda 1", energyCost: MOVEMENT_ENERGY["round-one-passage"] }
      : round === 2 ? [...publicRouteViews(), ...privateRouteViews("maintenance")].find(r => r.id === id)!
      : this.roundThreeOptions(game).find(r => r.id === id)!;
    const availability = routeEnergyAvailability(game.state, route.energyCost);
    if (round !== 1 && availability.status === "unavailable") { this.markRecovery(room, availability.reason!); return; }
    const classification = classifyMovement(game.state, route.energyCost);
    if (classification.ok && classification.classification.transportRequiredIds.length) {
      const decision = new TransportDecision({ round, id, name: route.name, cost: route.energyCost }, () => game.state,
        (state, plan) => this.executeMovement(room, state, plan), this.clock, () => { this.noteTransportFailure(room); this.onVotingChanged(room.code); },
        room.participants.map(p => ({ characterId: p.characterId!, participantId: p.id, name: p.name })));
      (game.transports ??= []).push(decision);
    } else this.executeMovement(room, game.state);
  }

  private recoveryView(game: Game, round: 2 | 3) {
    return { ...(game.recovery ? { recovery: { decisionId: game.recovery.decisionId, reason: game.recovery.reason, forced: game.recovery.forced } } : {}),
      ...((game.failedSelections?.length ?? 0) ? { failedSelections: structuredClone(game.failedSelections!.filter(f => f.round === round)) } : {}) };
  }
  private markRecovery(room: Room, reason: string): void {
    const game = room.game!;
    if (game.recovery || game.state.currentRound === 1 || game.state.currentRound === 4) return;
    const choice = game.state.currentRound === 2 ? game.route?.result : game.roundThree?.selection;
    if (!choice) return;
    game.recovery = { decisionId: choice.decisionId, reason, forced: choice.outcome === "NO_AGREEMENT", preparationId: newId() };
  }
  private noteTransportFailure(room: Room) {
    const game = room.game!;
    const transport = game.transports?.findLast(t => t.route.round === game.state.currentRound && t.phase !== "superseded");
    const view = transport?.view();
    if (view && !view.abandonedIds.length && ["route-energy-insufficient", "insufficient-energy", "transport-plan-infeasible", "no-eligible-carriers", "more-than-two-exhausted"].includes(view.reason ?? "")) this.markRecovery(room, view.reason!);
  }
  private discoverRecovery(room: Room) {
    const game = room.game!;
    if (game.recovery || game.resolvingMovement || game.state.currentRound === 1 || game.state.currentRound === 4) return;
    const movement = game.state.currentRound === 2 ? game.state.roundTwo?.movement : game.state.roundThreeRoute;
    if (movement?.status === "blocked" && ["insufficient-energy", "transport-vote-pending", "transport-plan-infeasible"].includes(movement.error)) this.markRecovery(room, movement.error);
    else this.noteTransportFailure(room);
  }
  retryRoute(socketId: string, input: unknown): RouteActionReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection; const game = room.game!;
    if (!game.state.characters.some(c => c.id === participant.characterId && isAlive(c))) return { ok: false, error: "not-authorized" };
    if (!input || typeof input !== "object" || Object.keys(input).join(",") !== "decisionId" || typeof (input as { decisionId: unknown }).decisionId !== "string") return { ok: false, error: "invalid-input" };
    const decisionId = (input as { decisionId: string }).decisionId;
    this.discoverRecovery(room);
    if (game.failedSelections?.some(f => f.decisionId === decisionId)) return { ok: true };
    if (!game.recovery || game.recovery.decisionId !== decisionId || game.state.currentRound === 1 || game.state.currentRound === 4) return { ok: false, error: "route-not-recoverable" };
    const recovery = game.recovery;
    if (recovery.forced) {
      const cost = game.state.currentRound === 2 ? MOVEMENT_ENERGY["unstable-corridor"] : MOVEMENT_ENERGY["pipe-gallery"];
      if (routeEnergyAvailability(game.state, cost).status === "unavailable") return { ok: false, error: "forced-route-energy-pending" };
      delete game.recovery;
      game.transports?.filter(t => t.route.round === game.state.currentRound && t.phase !== "superseded").forEach(t => t.supersede());
      if (game.state.currentRound === 2 && game.state.roundTwo?.movement?.status === "blocked") {
        const { movement: _movement, ...rest } = game.state.roundTwo;
        game.state = { ...game.state, roundTwo: rest };
      } else if (game.state.currentRound === 3 && game.state.roundThreeRoute?.status === "blocked") {
        const { roundThreeRoute: _route, ...rest } = game.state;
        game.state = rest;
      }
      this.moveOrPrepare(room);
    } else {
      const round = game.state.currentRound;
      const stage = round === 2 ? game.route! : game.roundThree!;
      const selection = round === 2 ? game.route!.result! : game.roundThree!.selection!;
      (game.failedSelections ??= []).push({ round, decisionId, outcome: selection.outcome, reason: recovery.reason, vote: stage.voting!.publicView() });
      stage.voting!.dispose();
      game.transports?.filter(t => t.route.round === round && t.phase !== "superseded").forEach(t => t.supersede());
      if (round === 2) {
        const { movement: _movement, ...rest } = game.state.roundTwo!;
        game.state = { ...game.state, roundTwo: rest };
        game.route = { preparationId: newId(), revealed: game.route!.revealed, result: null };
      } else {
        const { roundThreeRoute: _route, ...rest } = game.state;
        game.state = rest;
        game.roundThree = { preparationId: newId(), selection: null, earthquake: false, blockedRoutes: [] };
      }
      delete game.recovery;
    }
    this.onVotingChanged(room.code); return { ok: true };
  }

  private executeMovement(room: Room, state: SimulationState, plan?: TransportPlan): string | null {
    const game = room.game!;
    game.resolvingMovement = true;
    game.state = state; // Los abandonos ya aprobados son definitivos incluso ante un bloqueo posterior.
    try {
      if (state.currentRound === 1) {
        const vote = game.voting.publicView();
        const result = resolveRoundOne(state, vote.decisionId, vote.result!, plan);
        if (!result.ok) { game.roundOneBlocked = result.error; return result.error; }
        game.state = result.state; delete game.roundOneBlocked;
        game.roundOneSummary = this.roundSummary(room.code)!;
      } else if (state.currentRound === 2) {
        const result = resolveRoundTwoMovement(state, { ...game.route!.result!, ventilationRevealed: game.route!.revealed }, this.routeRandom, plan);
        if (!result.ok) {
          game.state = { ...state, roundTwo: { ...state.roundTwo!, movement: { status: "blocked", decisionId: game.route!.result!.decisionId, error: result.error } } };
          return result.error;
        }
        game.state = result.state;
        const snapshot = this.suppliesView(room.code)!;
        game.roundTwoAfterRoute = { characters: snapshot.characters, inventory: snapshot.inventory };
      } else {
        const result = resolveRoundThreeChoice(state, game.roundThree!.selection!, this.routeRandom, plan);
        game.state = result.state;
        if (!result.ok) return result.error;
        const snapshot = this.suppliesView(room.code)!;
        game.roundThree!.afterRoute = { characters: snapshot.characters, inventory: snapshot.inventory, crowbar: game.state.tools.crowbar };
      }
      return null;
    } finally { game.resolvingMovement = false; }
  }

  transportView(code: string): TransportView | null {
    const game = this.rooms.get(code)?.game;
    return game ? { cases: (game.transports ?? []).map(t => t.view()) } : null;
  }

  roundFourAction(socketId: string, action: "advance" | "open" | "retry", input?: unknown): RouteActionReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection; const game = room.game!;
    if (!game.state.characters.some(c => c.id === participant.characterId && isAlive(c))) return { ok: false, error: "not-authorized" };
    if (action !== "retry" && participant.id !== room.creatorId) return { ok: false, error: "not-creator" };
    if (action === "advance") {
      if (game.roundFour) return { ok: true };
      const next = beginRoundFour(game.state, this.routeRandom);
      if (!next.ok) return { ok: false, error: next.error };
      game.roundThreeSummary = this.roundThreeView(room.code)!;
      game.voting.dispose(); game.route?.voting?.dispose(); game.roundThree?.voting?.dispose();
      game.state = next.state;
      game.roundFour = new RoundFourStage(() => game.state as RoundFourState, state => { game.state = state; },
        room.participants.map(p => ({ characterId: p.characterId!, participantId: p.id, name: p.name })),
        this.clock, () => this.onVotingChanged(room.code), () => this.moveFourth(room));
    } else {
      if (game.state.currentRound !== 4 || !game.roundFour) return { ok: false, error: "round-not-ready" };
      if (action === "open") return game.roundFour.open();
      if (!input || typeof input !== "object" || Object.keys(input).join(",") !== "preparationId"
        || typeof (input as { preparationId: unknown }).preparationId !== "string") return { ok: false, error: "invalid-input" };
      const transport = game.transports?.findLast(t => t.route.round === 4 && t.phase !== "superseded");
      if (transport && (transport.phase === "voting" || transport.phase === "selection" || transport.phase === "pending")) return { ok: false, error: "transport-vote-pending" };
      return game.roundFour.retry((input as { preparationId: string }).preparationId);
    }
    this.onVotingChanged(room.code);
    return { ok: true };
  }

  private moveFourth(room: Room) {
    const game = room.game!; const stage = game.roundFour!; const state = game.state as RoundFourState;
    if (!stage.selection || state.roundFour.exit) return;
    if (state.roundFour.blockedMovement) { stage.blocked = state.roundFour.blockedMovement.error; return; }
    const routeId = stage.selection.outcome === "NO_AGREEMENT" ? "exterior-crack" : stage.selection.outcome;
    const route = roundFourRouteAvailability(state).find(r => r.id === routeId)!;
    const preview = prepareRescueEffort(state);
    if (!preview.ok) { stage.blocked = preview.error; return; }
    if (route.availability.status === "unavailable") { stage.blocked = route.availability.reason; return; }
    const previous = game.transports?.findLast(t => t.route.round === 4 && t.phase !== "superseded");
    if (previous?.phase === "preparation" || previous?.phase === "voting" || previous?.phase === "selection" || previous?.phase === "pending") return;
    if (previous) previous.supersede();
    stage.blocked = null;
    const classified = classifyMovement(preview.state, route.energyCost);
    if (classified.ok && classified.classification.transportRequiredIds.length) {
      const transport = new TransportDecision({ round: 4, id: routeId, name: route.name, cost: route.energyCost },
        () => { const result = prepareRescueEffort(game.state as RoundFourState); return result.ok ? result.state : game.state; },
        (prospective, plan) => {
          // El transporte estudia energías residuales, pero 9A cobra desde el estado real.
          // Solo se trasladan aquí los abandonos explícitamente aprobados y sus objetos.
          const real = game.state as RoundFourState;
          const candidate: RoundFourState = { ...real, ...(prospective.sharedItems ? { sharedItems: prospective.sharedItems } : {}),
            characters: real.characters.map(c => {
              const after = prospective.characters.find(p => p.id === c.id)!;
              return after.eliminated && !c.eliminated ? { ...c, eliminated: true, personalItems: after.personalItems ?? [] } : c;
            }) };
          return this.executeFourth(room, candidate, routeId, plan);
        }, this.clock, () => this.onVotingChanged(room.code),
        room.participants.map(p => ({ characterId: p.characterId!, participantId: p.id, name: p.name })));
      (game.transports ??= []).push(transport);
    } else this.executeFourth(room, state, routeId);
  }

  private executeFourth(room: Room, state: RoundFourState, routeId: "revolving-door" | "exterior-crack", plan?: TransportPlan) {
    const game = room.game!;
    const result = resolveRoundFourExit(state, game.roundFour!.selection!.decisionId, routeId, this.routeRandom, plan);
    // Un rechazo no confirma abandonos ni gastos. Se conserva el bloqueo del azar, si existe.
    if (result.ok) game.state = result.state;
    else if (result.state.roundFour.blockedMovement) game.state = { ...game.state,
      roundFour: { ...(game.state as RoundFourState).roundFour, blockedMovement: result.state.roundFour.blockedMovement } } as RoundFourState;
    game.roundFour!.blocked = result.ok ? null : result.error;
    return result.ok ? null : result.error;
  }

  private fourthWindow(game: Game): string | null {
    const state = game.state as RoundFourState; const stage = game.roundFour;
    if (!stage || state.roundFour.exit || state.roundFour.blockedMovement || game.resolvingMovement) return null;
    if (stage.activeVoting()?.publicView().status === "open") return null;
    const transport = game.transports?.findLast(t => t.route.round === 4 && t.phase !== "superseded");
    if (transport) return transport.phase === "preparation" ? transport.preparationId : transport.phase === "blocked" ? stage.preparationId : null;
    return stage.preparationId;
  }

  roundFourView(code: string): RoundFourView | null {
    const game = this.rooms.get(code)?.game;
    if (!game?.roundFour) return null;
    const transport = game.transports?.findLast(t => t.route.round === 4 && t.phase !== "superseded");
    const view = game.roundFour.view(!!transport && transport.phase !== "completed" && transport.phase !== "blocked");
    if (!view.movement && transport?.phase === "blocked") {
      view.phase = "blocked"; view.blocked = view.blocked ?? transport.reason;
    }
    return view;
  }
  roundFourSession(socketId: string): RoundFourView | null {
    const connection = this.connections.get(socketId);
    return connection ? this.roundFourView(connection.room.code) : null;
  }
  transportSession(socketId: string): TransportView | null {
    const connection = this.connections.get(socketId);
    return connection ? this.transportView(connection.room.code) : null;
  }
  openTransport(socketId: string, input: unknown): TransportActionReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const game = connection.room.game;
    const actor = game.state.characters.find(c => c.id === connection.participant.characterId);
    if (!actor || !isAlive(actor)) return { ok: false, error: "not-authorized" };
    if (!input || typeof input !== "object" || Object.keys(input).join(",") !== "preparationId"
      || typeof (input as { preparationId: unknown }).preparationId !== "string") return { ok: false, error: "invalid-input" };
    const decision = game.transports?.findLast(t => t.route.round === game.state.currentRound && t.phase !== "superseded");
    if (!decision || decision.route.round !== game.state.currentRound) return { ok: false, error: "transport-not-ready" };
    return decision.open((input as { preparationId: string }).preparationId);
  }

  private roundThreeOptions(game: Game): RoundThreeView["options"] {
    return publicRoundThreeRouteViews().map(route => ({ ...route,
      availability: route.id === "fire-door" && game.state.tools.crowbar !== "available"
        ? { status: "unavailable", reason: "crowbar-unavailable-pending" } : routeEnergyAvailability(game.state, route.energyCost),
      name: route.id === "pipe-gallery" ? "Galería de tuberías y calderas" : route.id === "metal-debris" ? "Escombros metálicos y almacén" : route.name,
      description: route.id === "fire-door" ? "Paso por una puerta cortafuegos."
        : route.id === "pipe-gallery" ? "Paso por la zona de tuberías y calderas." : "Paso entre escombros metálicos hacia el almacén." }));
  }

  roundThreeAction(socketId: string, action: "advance" | "open"): RouteActionReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    const game = room.game!;
    if (game.state.currentRound === 4) return { ok: false, error: "round-not-ready" };
    if (participant.id !== room.creatorId) return { ok: false, error: "not-creator" };
    const actor = game.state.characters.find(c => c.id === participant.characterId);
    if (!actor || !isAlive(actor)) return { ok: false, error: "not-authorized" };
    if (action === "advance") {
      if (game.state.currentRound === 3 && game.roundThree) return { ok: true };
      const next = beginRoundThree(game.state);
      if (next === game.state) return { ok: false, error: "round-not-ready" };
      game.roundTwoSummary = this.roundTwoView(room.code)!;
      game.voting.dispose(); game.route?.voting?.dispose();
      game.state = next;
      game.roundThree = { preparationId: newId(), selection: null, earthquake: false, blockedRoutes: [] };
    } else {
      const stage = game.roundThree;
      if (game.state.currentRound !== 3 || !stage) return { ok: false, error: "round-not-ready" };
      if (stage.voting) return { ok: true };
      const options = this.roundThreeOptions(game);
      if (!options.some(o => o.availability.status !== "unavailable")) return { ok: false, error: "no-available-routes" };
      stage.options = options;
      stage.voting = new RoomVoting(room.participants.map(player => ({ participantId: player.id,
        alive: game.state.characters.some(c => c.id === player.characterId && isAlive(c)) })), this.clock, () => {
          const outcome = stage.voting!.selectedOption();
          if (outcome && !stage.selection) {
            stage.selection = { decisionId: stage.voting!.publicView().decisionId, outcome: outcome as RoundThreeRouteId | "NO_AGREEMENT" };
            if (outcome === "NO_AGREEMENT") {
              stage.earthquake = true;
              stage.blockedRoutes = ["fire-door", "metal-debris"];
            }
          }
          if (stage.selection && !game.state.roundThreeRoute) this.moveOrPrepare(room);
          this.onVotingChanged(room.code);
        }, 3, options.map(route => ({ id: route.id, label: route.name })));
    }
    this.onVotingChanged(room.code);
    return { ok: true };
  }

  roundThreeView(code: string): RoundThreeView | null {
    const room = this.rooms.get(code);
    const game = room?.game;
    const stage = game?.roundThree;
    if (!room || !game || !stage) return null;
    if (game.roundThreeSummary) return structuredClone(game.roundThreeSummary);
    this.discoverRecovery(room);
    const resolution = game.state.roundThreeRoute;
    const forced = stage.earthquake;
    const people = (ids: readonly string[], damage: number) => ids.map(id => {
      const player = room.participants.find(p => p.characterId === id)!;
      return { participantId: player.id, name: player.name, damage };
    });
    const result = resolution?.status === "completed" ? resolution.outcome : null;
    return { round: 3, phase: result ? "completed" : resolution ? "blocked" : stage.selection ? "transport" : stage.voting ? "voting" : "preparation",
      ...this.recoveryView(game, 3),
      options: structuredClone(stage.options ?? this.roundThreeOptions(game)).map(option => stage.blockedRoutes.includes(option.id)
        ? { ...option, availability: { status: "unavailable", reason: "earthquake-blocked-route" } } : option), vote: stage.voting?.publicView() ?? null,
      selection: stage.selection ? { ...stage.selection } : null, forced, earthquake: forced,
      blockedRoutes: [...stage.blockedRoutes],
      movement: result ? { routeId: result.routeId, energyCost: result.energyCost, accident: result.accident,
        victims: people(result.victimIds, result.accidentDamage), environment: people(result.environmentalVictimIds, result.environmentalDamage),
        gained: { ...result.gained }, crowbarLost: result.crowbarLost, returnBlocked: result.returnBlocked, discovery: result.discovery } : null,
      blocked: resolution?.status === "blocked" ? resolution.error : null,
      afterRoute: stage.afterRoute ? structuredClone(stage.afterRoute) : null,
      previousNpcs: [{ round: 1, status: game.state.roundOne!.npc }, { round: 2, status: game.state.roundTwo!.resolution!.npc }] };
  }

  roundThreeSession(socketId: string): RoundThreeView | null {
    const connection = this.connections.get(socketId);
    return connection ? this.roundThreeView(connection.room.code) : null;
  }

  roundTwoView(code: string): RoundTwoView | null {
    const room = this.rooms.get(code);
    const game = room?.game;
    const round = game?.state.roundTwo;
    if (game?.roundTwoSummary) return structuredClone(game.roundTwoSummary);
    if (!room || !game || !round) return null;
    this.discoverRecovery(room);
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
    return { ...this.recoveryView(game, 2), movement: movementView, routeChoice: this.routeView(game), round: 2, npcId: round.npcId, mobility: "walks-with-help",
      npc: resolution?.npc ?? "pending", previousNpc: game.state.roundOne!.npc,
      phase: movement?.status === "completed" ? "completed" : movement ? "movement-blocked"
        : game.transports?.some(t => t.route.round === 2 && t.phase !== "completed") ? "transport-pending" : resolution ? "route-pending" : round.blocked ? "resolution-blocked" : "rescue-vote",
      blocked: round.blocked, result: resolution?.result ?? game.voting.publicView().result,
      microearthquake: resolution?.microearthquake ?? false,
      inventory: { ...(game.roundTwoAfterRoute?.inventory ?? game.state.inventory) },
      characters: game.roundTwoAfterRoute ? structuredClone(game.roundTwoAfterRoute.characters) : room.participants.map((participant) => {
        const character = game.state.characters.find((entry) => entry.id === participant.characterId)!;
        return { participantId: participant.id, name: participant.name, health: character.health, energy: character.energy, ...(character.eliminated ? { eliminated: true } : {}) };
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
        return { participantId: participant.id, name: participant.name, health: character.health, energy: character.energy, ...(character.eliminated ? { eliminated: true } : {}) };
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
    this.discoverRecovery(room);
    const movement = game.state.roundTwo?.movement;
    const transport = game.transports?.findLast(t => t.route.round === game.state.currentRound && t.phase !== "superseded");
    const transportCurrent = transport?.route.round === game.state.currentRound && transport.phase !== "completed";
    const windowId = game.state.currentRound === 4 ? this.fourthWindow(game) : game.resolvingMovement ? null : game.recovery ? game.recovery.preparationId : transportCurrent ? (transport.phase === "preparation" ? transport.preparationId : null) : game.state.currentRound === 1 ? game.state.roundOne?.decisionId ?? null
      : game.state.currentRound === 2 ? movement?.status === "completed" ? movement.decisionId
        : game.route && !game.route.voting ? game.route.preparationId : null
      : game.state.roundThreeRoute?.status === "completed" ? game.state.roundThreeRoute.outcome.requestId
        : game.roundThree && !game.roundThree.voting ? game.roundThree.preparationId : null;
    return { gameId: game.id, round: game.state.currentRound, windowId,
      ...(game.state.currentRound === 1 && game.roundOneBlocked ? { movementBlocked: game.roundOneBlocked } : {}),
      inventory: { ...game.state.inventory }, characters: room.participants.map(participant => {
        const character = game.state.characters.find(c => c.id === participant.characterId)!;
        return { participantId: participant.id, name: participant.name, health: character.health, energy: character.energy, ...(character.eliminated ? { eliminated: true } : {}) };
      }) };
  }

  suppliesSession(socketId: string): SuppliesView | null {
    const connection = this.connections.get(socketId);
    return connection ? this.suppliesView(connection.room.code) : null;
  }

  medicalView(code: string): MedicalView | null {
    const room = this.rooms.get(code);
    const current = this.suppliesView(code);
    if (!room?.game || !current) return null;
    return { gameId: current.gameId, round: current.round, characters: current.characters, inventory: current.inventory,
      treatments: (room.game.state.medicalTreatments ?? []).map(treatment => ({ round: treatment.round,
        participantId: room.participants.find(player => player.characterId === treatment.characterId)!.id,
        healthRestored: treatment.healthRestored })) };
  }

  medicalSession(socketId: string): MedicalView | null {
    const connection = this.connections.get(socketId);
    return connection ? this.medicalView(connection.room.code) : null;
  }

  treat(socketId: string, input: unknown): TreatmentReply {
    const connection = this.connections.get(socketId);
    if (!connection?.room.game) return { ok: false, error: "invalid-session" };
    const { room, participant } = connection;
    const game = room.game!;
    const actor = game.state.characters.find(c => c.id === participant.characterId);
    if (!actor || actor.role !== "medic") return { ok: false, error: "not-authorized" };
    if (!isAlive(actor)) return { ok: false, error: "medic-dead" };
    if (!input || typeof input !== "object" || Object.keys(input).sort().join(",") !== "gameId,requestId,round,targetParticipantId") return { ok: false, error: "invalid-input" };
    const candidate = input as TreatmentInput;
    if ([candidate.requestId, candidate.gameId, candidate.targetParticipantId].some(value =>
      typeof value !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value))
      || (candidate.round !== 1 && candidate.round !== 2 && candidate.round !== 3 && candidate.round !== 4)) return { ok: false, error: "invalid-input" };
    if (candidate.gameId !== game.id) return { ok: false, error: "wrong-game" };
    const previous = game.treatmentRequests.get(candidate.requestId);
    if (previous) {
      if (previous.actorId !== participant.id || previous.targetParticipantId !== candidate.targetParticipantId
        || previous.round !== candidate.round) return { ok: false, error: "request-conflict" };
      return { ok: true, requestId: candidate.requestId };
    }
    // La ronda actual admite tratamiento antes y después de la ruta. Su resolución es síncrona.
    if (candidate.round !== game.state.currentRound) return { ok: false, error: "wrong-round" };
    if (game.state.currentRound === 4) {
      if (!this.fourthWindow(game)) return { ok: false, error: "supplies-not-open" };
    }
    const target = room.participants.find(player => player.id === candidate.targetParticipantId);
    if (!target?.characterId) return { ok: false, error: "target-not-found" };
    const treatment = administerTreatment(game.state, target.characterId);
    if (!treatment.ok) return { ok: false, error: treatment.error };
    const restored = treatment.state.characters.find(c => c.id === target.characterId)!.health - game.state.characters.find(c => c.id === target.characterId)!.health;
    // Una sola confirmación síncrona para salud, inventario, límite y recibo.
    game.state = treatment.state;
    game.treatmentRequests.set(candidate.requestId, { ...candidate, actorId: participant.id });
    (game.activities ??= []).push({ id: `treatment:${candidate.requestId}`, round: game.state.currentRound, kind: "treatment", targetParticipantId: target.id, restored });
    this.onSuppliesChanged(room.code);
    return { ok: true, requestId: candidate.requestId };
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
    const restored = consumed.state.characters.find(c => c.id === target.characterId)!.energy - game.state.characters.find(c => c.id === target.characterId)!.energy;
    // Sin await: validación, consumo y recibo se confirman juntos antes de publicar.
    game.state = consumed.state;
    game.packRequests.set(candidate.requestId, { ...candidate, actorId: participant.id });
    (game.activities ??= []).push({ id: `pack:${candidate.requestId}`, round: game.state.currentRound, kind: "pack", targetParticipantId: target.id, restored });
    this.onSuppliesChanged(room.code);
    return { ok: true, requestId: candidate.requestId };
  }

  activityView(code: string): GameActivityView | null {
    const game = this.rooms.get(code)?.game;
    return game ? { gameId: game.id, tools: { crowbar: game.state.tools.crowbar }, entries: structuredClone(game.activities ?? []) } : null;
  }
  activitySession(socketId: string): GameActivityView | null {
    const connection = this.connections.get(socketId);
    return connection ? this.activityView(connection.room.code) : null;
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
