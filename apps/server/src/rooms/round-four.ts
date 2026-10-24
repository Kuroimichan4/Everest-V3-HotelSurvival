import type { RoundFourView, RouteActionReply, VoteReply } from "@everest/shared";
import { RoomVoting, type VotingClock } from "./voting.js";
import { newId } from "./identity.js";
import { isAlive } from "../simulation/state.js";
import { decideRoundFourNpc, failRoundFourNpcVote, failRoundFourExitVote, roundFourNpcOptions,
  roundFourRouteAvailability, type NpcChoice, type RoundFourState } from "../simulation/round-four.js";

/** Coordinación de decisiones; las consecuencias pertenecen exclusivamente al motor 9A. */
export class RoundFourStage {
  readonly preparationId = newId();
  npcVoting?: RoomVoting;
  exitVoting?: RoomVoting;
  selection: RoundFourView["selection"] = null;
  blocked: string | null = null;
  private options?: RoundFourView["options"];
  constructor(private readonly read: () => RoundFourState, private readonly write: (state: RoundFourState) => void,
    private readonly people: readonly { characterId: string; participantId: string; name: string }[],
    private readonly clock: VotingClock, private readonly changed: () => void, private readonly move: () => void) {
    if (read().roundFour.npc.status === "awaiting-decision") this.startNpc();
  }
  private electorate = () => this.people.map(p => ({ participantId: p.participantId,
    alive: this.read().characters.some(c => c.id === p.characterId && isAlive(c)) }));
  activeVoting() { return this.read().roundFour.npc.status === "awaiting-decision" ? this.npcVoting ?? null : this.exitVoting ?? null; }
  private record(result: ReturnType<typeof failRoundFourNpcVote>) {
    this.write(result.state);
    if (!result.ok) this.blocked = result.error;
  }
  private startNpc() {
    const options = roundFourNpcOptions(this.read());
    const voting = new RoomVoting(this.electorate(), this.clock, () => {
      const outcome = voting.selectedOption();
      if (outcome && this.read().roundFour.npc.status === "awaiting-decision") {
        if (outcome === "NO_AGREEMENT") this.record(failRoundFourNpcVote(this.read(), voting.publicView().decisionId, 2));
        else this.record(decideRoundFourNpc(this.read(), voting.publicView().decisionId, outcome as NpcChoice));
      }
      this.changed();
    }, 4, options.map(o => ({ id: o.id, label: o.label })), undefined, id => {
      this.record(failRoundFourNpcVote(this.read(), id, 1));
      return this.electorate();
    });
    this.npcVoting = voting;
  }
  open(): RouteActionReply {
    if (this.exitVoting) return { ok: true };
    if (this.read().roundFour.npc.status === "awaiting-decision") return { ok: false, error: "npc-decision-pending" };
    if (!this.electorate().some(p => p.alive)) return { ok: false, error: "no-living-characters" };
    const options = roundFourRouteAvailability(this.read());
    if (!options.some(o => o.availability.status !== "unavailable")) return { ok: false, error: "no-available-routes" };
    this.options = options;
    this.exitVoting = new RoomVoting(this.electorate(), this.clock, () => {
      const voting = this.exitVoting!;
      const outcome = voting.selectedOption();
      if (outcome && !this.selection) {
        if (outcome === "NO_AGREEMENT") this.record(failRoundFourExitVote(this.read(), voting.publicView().decisionId, 2));
        if (!this.blocked) {
          this.selection = { decisionId: voting.publicView().decisionId, outcome: outcome as NonNullable<RoundFourView["selection"]>["outcome"] };
          this.move();
        }
      }
      this.changed();
    }, 4, options.map(o => ({ id: o.id, label: o.name })), undefined, id => {
      this.record(failRoundFourExitVote(this.read(), id, 1));
      this.options = roundFourRouteAvailability(this.read());
      if (!this.electorate().some(p => p.alive)) this.blocked = "no-living-characters";
      return this.electorate();
    });
    this.changed();
    return { ok: true };
  }
  vote(participantId: string, input: unknown): VoteReply {
    const voting = this.activeVoting();
    if (!voting) return { ok: false, error: "route-not-open" };
    voting.refresh(); // Antes de validar opciones: el intento puede haber cambiado por el derrumbe.
    if (input && typeof input === "object") {
      const candidate = input as { decisionId?: string; attemptId?: string; optionId?: string };
      const current = voting.publicView();
      if (candidate.decisionId === current.decisionId && candidate.attemptId === current.attemptId) {
        if (this.read().roundFour.npc.status === "awaiting-decision") {
          if (!roundFourNpcOptions(this.read()).some(o => o.id === candidate.optionId && o.available)) return { ok: false, error: "invalid-option" };
        } else if (!this.options?.some(o => o.id === candidate.optionId && o.availability.status !== "unavailable")) return { ok: false, error: "invalid-option" };
      }
    }
    return voting.vote(participantId, input);
  }
  retry(preparationId: string): RouteActionReply {
    if (preparationId !== this.preparationId) return { ok: false, error: "wrong-preparation" };
    if (this.read().roundFour.exit) return { ok: true };
    if (!this.selection) return { ok: false, error: "route-not-ready" };
    this.blocked = null;
    this.move(); this.changed();
    return this.blocked ? { ok: false, error: this.blocked } : { ok: true };
  }
  view(transport: boolean): RoundFourView {
    const state = this.read(); const round = state.roundFour; const npc = round.npc;
    const options = roundFourNpcOptions(state); const choice = options.find(o => o.id === npc.decision?.choice);
    const publicId = (id: string) => this.people.find(p => p.characterId === id)!.participantId;
    const result = round.exit;
    return { round: 4, preparationId: this.preparationId,
      phase: result ? "completed" : npc.status === "awaiting-decision" ? "npc-voting"
        : transport ? "transport" : this.blocked ? "blocked" : this.exitVoting?.publicView().status === "open" ? "exit-voting" : "preparation",
      npc: { encounter: npc.encounter, status: npc.status, choice: npc.decision?.choice ?? null, message: npc.message ?? null,
        energyPerHuman: choice?.energyPerHuman ?? 0, medicalUnits: choice?.medicalUnits ?? 0, options, vote: this.npcVoting?.publicView() ?? null },
      options: structuredClone(this.selection || !this.exitVoting ? roundFourRouteAvailability(state) : this.options!),
      vote: this.exitVoting?.publicView() ?? null, selection: this.selection ? { ...this.selection } : null,
      forced: round.forcedRoute !== null, surcharge: round.energySurcharge, blocked: this.blocked,
      collapse: round.collapse ? { damage: round.collapse.damage, affectedIds: round.collapse.affectedIds.map(publicId), deceasedIds: round.collapse.deceasedIds.map(publicId) } : null,
      movement: result ? { requestId: result.requestId, routeId: result.routeId, energyCost: result.energyCost, accident: result.accident,
        victims: result.damage.filter(d => d.accidentDamage > 0).map(d => ({ participantId: publicId(d.characterId), damage: d.accidentDamage })),
        deceasedIds: result.deceasedIds.map(publicId), escapedHumanIds: result.escapedHumanIds.map(publicId), rescuedNpc: result.rescuedNpc,
        characters: this.people.map(p => { const c = state.characters.find(c => c.id === p.characterId)!;
          return { participantId: p.participantId, name: p.name, health: c.health, energy: c.energy, ...(c.eliminated ? { eliminated: true } : {}) }; }),
        inventory: { ...state.inventory }, crowbar: state.tools.crowbar } : null };
  }
  dispose() { this.npcVoting?.dispose(); this.exitVoting?.dispose(); }
}
