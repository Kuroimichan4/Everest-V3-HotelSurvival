import { sectorWasEvacuated } from "../simulation/transport-crisis.js";
import type { IntermediateRoundView, RouteActionReply } from "@everest/shared";
import { newId } from "./identity.js";
import { RoomVoting, type VotingClock } from "./voting.js";
import { INTERMEDIATE_CONTEXT, intermediateSelection, intermediateRouteViews, internalIntermediateRoute, openIntermediateVote, revealIntermediateRoute, settleIntermediateVote, type IntermediateRound, type IntermediateState } from "../simulation/intermediate-rounds.js";
import { routeEnergyAvailability } from "../simulation/transport.js";
import { isAlive } from "../simulation/state.js";

/** Un coordinador por ronda/sala; reutiliza el motor 10B.1 y RoomVoting. */
export class IntermediateStage {
  readonly preparationId = newId();
  voting?: RoomVoting;
  blocked: string | null = null;
  private archived?: IntermediateState;
  private movementSnapshot?: IntermediateState;
  constructor(readonly round: IntermediateRound, private readonly read: () => IntermediateState,
    private readonly write: (state: IntermediateState) => void,
    private readonly people: readonly { characterId: string; participantId: string; name: string }[],
    private readonly clock: VotingClock, private readonly changed: () => void, private readonly move: () => void) {}
  captureMovement() { this.movementSnapshot = this.read(); }
  archive() { this.archived = this.read(); this.dispose(); }
  reveal(characterId: string): RouteActionReply {
    const result = revealIntermediateRoute(this.read(), characterId, this.clock.now());
    if (!result.ok) return { ok: false, error: result.error };
    this.write(result.state); this.changed(); return { ok: true };
  }
  open(): RouteActionReply {
    if (this.voting) return { ok: true };
    const state = this.read();
    const electorate = this.people.map(p => ({ participantId: p.participantId, alive: state.characters.some(c => c.id === p.characterId && isAlive(c)) }));
    const opened = openIntermediateVote(state, newId(), newId(), this.clock.now(), electorate);
    if (!opened.ok) return { ok: false, error: opened.error };
    const decision = opened.state.intermediate.decision!;
    const shared = decision.options.map(o => internalIntermediateRoute(o.id)!);
    if (!shared.some(o => routeEnergyAvailability(state, o.energyCost).status !== "unavailable")) return { ok: false, error: "no-available-routes" };
    this.write(opened.state);
    this.voting = new RoomVoting(electorate, this.clock, () => {
      const next = settleIntermediateVote({ ...this.read(), intermediate: { ...this.read().intermediate, decision: this.voting!.snapshot() } });
      this.write(next);
      if (next.intermediate.phase === "movement") this.move();
      this.changed();
    }, this.round, decision.options, undefined, undefined, decision);
    this.changed(); return { ok: true };
  }
  selection() {
    return intermediateSelection(this.read());
  }
  view(characterId: string): IntermediateRoundView {
    const state = this.archived ?? this.read();
    const decision = state.intermediate.decision;
    const publicIds = new Set(decision?.options.map(o => o.id));
    const options = intermediateRouteViews(state, characterId).map(r => {
      const route = internalIntermediateRoute(r.id)!;
      const shared = !route.private || state.routeRevelations?.some(v => v.routeId === r.id) === true;
      return { ...r, danger: route.danger, selectable: decision ? publicIds.has(r.id) : shared, availability: routeEnergyAvailability(state, r.energyCost) };
    });
    const movementState = this.movementSnapshot ?? state;
    const result = state.intermediateRounds?.find(r => r.round === this.round && r.status === "completed");
    const actor = state.characters.find(c => c.id === characterId && isAlive(c));
    return { round: this.round, ...INTERMEDIATE_CONTEXT[this.round], preparationId: this.preparationId,
      phase: sectorWasEvacuated(state, this.round) ? "sector-evacuated" : state.intermediate.phase, options,
      canReveal: state.intermediate.phase === "preparation" && actor?.role === "maintenance" && options.some(o => !o.selectable),
      vote: this.voting?.publicView() ?? null, blocked: this.blocked,
      failedAttempts: decision?.attempts.flatMap((a, i) => a.status === "closed" && a.result.kind === "no-majority" ? [{ attemptNumber: i + 1, closedAt: a.closedAt }] : []) ?? [],
      ...(() => {
        const receipt = state.intermediateConsequences?.find(r => r.round === this.round);
        if (!receipt) return {};
        return { consequence: { decisionId: receipt.decisionId, forcedRouteId: receipt.forcedRouteId,
          routeName: internalIntermediateRoute(receipt.forcedRouteId)!.name,
          victims: receipt.damage.map(d => { const p = this.people.find(p => p.characterId === d.characterId)!; return { participantId: p.participantId, name: p.name, damage: d.healthLost }; }),
          deceasedIds: receipt.deceasedIds.map(id => this.people.find(p => p.characterId === id)!.participantId) } };
      })(),
      movement: result?.status === "completed" ? {
        requestId: result.requestId, routeId: result.routeId, routeName: internalIntermediateRoute(result.routeId)!.name,
        energyCost: internalIntermediateRoute(result.routeId)!.energyCost, accident: result.effects.accident,
        victims: result.effects.damage.filter(d => d.accidentDamage > 0).map(d => { const p = this.people.find(p => p.characterId === d.characterId)!; return { participantId: p.participantId, name: p.name, damage: d.accidentDamage }; }),
        deceasedIds: result.effects.deceasedIds.map(id => this.people.find(p => p.characterId === id)!.participantId),
        characters: this.people.map(p => { const c = movementState.characters.find(c => c.id === p.characterId)!; return { participantId: p.participantId, name: p.name, health: c.health, energy: c.energy, ...(c.eliminated ? { eliminated: true } : {}) }; }),
        inventory: { ...movementState.inventory },
      } : null };
  }
  dispose() { this.voting?.dispose(); }
}
