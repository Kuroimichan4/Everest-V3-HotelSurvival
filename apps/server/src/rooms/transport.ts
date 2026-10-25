import { applyTransportIncident } from "../simulation/transport-crisis.js";
import { isAlive } from "../simulation/state.js";
import type { TransportCaseView, RouteActionReply, VoteReply } from "@everest/shared";
import { type SimulationState } from "../simulation/state.js";
import { movementEnergyFor, type MovementCost, assessTransportPlan, assessTransportAlternative, classifyMovement, type TransportPlan, type MovementCharge } from "../simulation/transport.js";
import { abandonCharacters } from "../simulation/abandonment.js";
import { RoomVoting, type VotingClock } from "./voting.js";
import { newId } from "./identity.js";

// Valor técnico revisable, independiente de las reglas de desacuerdo de las rutas.
export const TRANSPORT_POLICY = { durationsMs: [60_000, 30_000, 10_000], majority: "strict-living-majority" } as const;
export interface TransportCrisisServices {
  readActual: () => SimulationState;
  commit: (state: SimulationState) => void;
  evacuateSector: (state: SimulationState, incidentId: string, routeId: string) => void;
}
interface Option { id: string; label: string; transported: string[]; viable: boolean; plan: TransportPlan; carrierCost: number }
export class TransportDecision {
  readonly preparationId = newId();
  phase: TransportCaseView["phase"] = "preparation";
  reason: string | null = null;
  voting?: RoomVoting;
  private exhausted: string[] = [];
  private eligible: string[] = [];
  private options: Option[] = [];
  private decisions: { stage: "transport" | "recipient"; voting: RoomVoting }[] = [];
  private transported: string[] = [];
  private abandoned: string[] = [];
  private charges: readonly MovementCharge[] = [];
  private transfers: ReturnType<typeof abandonCharacters>["transfers"] = [];
  private savedView?: TransportCaseView;
  constructor(readonly route: { round: 1 | 2 | 3 | 4 | 5 | 6; id: string; name: string; cost: number; effort?: MovementCost },
    private readonly read: () => SimulationState,
    private readonly execute: (state: SimulationState, plan?: TransportPlan) => string | null,
    private readonly clock: VotingClock, private readonly changed: () => void,
    private readonly people: readonly { characterId: string; participantId: string; name: string }[], private readonly crisis: TransportCrisisServices) { this.prepare(); }

  private prepare() {
    const state = this.read();
    const classified = classifyMovement(state, this.route.effort ?? this.route.cost);
    if (!classified.ok) { this.phase = "blocked"; this.reason = classified.error; return; }
    this.exhausted = [...classified.classification.transportRequiredIds];
    this.options = this.exhausted.length === 1
      ? [this.option("carry-all", "Transportarlo", this.exhausted), this.option("leave-all", "Abandonarlo", [])]
      : [this.option("carry-all", "Transportar a los dos", this.exhausted), this.option("carry-one", "Transportar solamente a uno", this.exhausted.slice(0, 1)), this.option("leave-all", "No transportar a ninguno", [])];
    if (!this.exhausted.length || this.exhausted.length > 2) this.options = [];
    if (this.exhausted.length === 2) this.options[1]!.viable = this.exhausted.some(id => this.option("", "", [id]).viable);
    const possible = new Set(this.options.filter(o => o.viable && o.transported.length > 0).flatMap(o => [...o.plan.carrierIds]));
    this.eligible = state.characters.filter(c => possible.has(c.id)).map(c => c.id);
  }
  private option(id: string, label: string, transported: string[]): Option {
    const assessment = assessTransportAlternative(this.read(), this.route.effort ?? this.route.cost, transported);
    return { id, label, transported: [...transported], ...assessment };
  }
  supersede() {
    this.dispose(); this.phase = "superseded"; this.reason = "route-selection-recovered";
    delete this.savedView; this.savedView = this.view();
  }

  open(preparationId: string): RouteActionReply {
    if (preparationId !== this.preparationId) return { ok: false, error: "wrong-preparation" };
    if (this.phase !== "preparation") return { ok: true };
    this.prepare(); // Los packs pueden haber cambiado las energías; todavía no se ha votado.
    if (!this.exhausted.length) { this.finish([], undefined); this.changed(); return { ok: true }; }
    if (this.exhausted.length > 2) { this.phase = "pending"; this.reason = "more-than-two-exhausted"; }
    else if (!this.eligible.length) { this.phase = "pending"; this.reason = "no-eligible-carriers"; }
    else this.startVote("transport");
    this.changed(); return { ok: true };
  }
  private electorate() {
    return this.people.filter(p => this.eligible.includes(p.characterId) && this.read().characters.some(c => c.id === p.characterId && isAlive(c)))
      .map(p => ({ participantId: p.participantId, alive: true }));
  }
  private recordDamage(kind: "gas" | "explosion") {
    const result = applyTransportIncident(this.crisis.readActual(), this.preparationId, this.route.round, kind, this.clock.now());
    this.crisis.commit(result.state);
  }
  private refreshAfterGas(stage: "transport" | "recipient") {
    if (stage === "transport") this.prepare();
    else {
      const classified = classifyMovement(this.read(), this.route.effort ?? this.route.cost);
      this.exhausted = classified.ok ? [...classified.classification.transportRequiredIds] : [];
      this.options = this.options.map(o => this.option(o.id, o.label, o.transported));
      const carriers = new Set(this.options.filter(o => o.viable).flatMap(o => [...o.plan.carrierIds]));
      this.eligible = [...carriers];
    }
  }
  private startVote(stage: "transport" | "recipient") {
    this.phase = stage === "recipient" ? "selection" : "voting";
    const voting = new RoomVoting(this.electorate(), this.clock, () => {
      const outcome = voting.selectedOption();
      if (outcome && this.voting === voting && (this.phase === "voting" || this.phase === "selection")) {
        if (outcome === "NO_AGREEMENT") this.explode();
        else if (outcome === "carry-one" && stage === "transport") {
          this.options = this.exhausted.map((id, index) => this.option(`person-${index}`, `Transportar a ${this.people.find(p => p.characterId === id)!.name}`, [id]));
          this.startVote("recipient");
        } else {
          const option = this.options.find(o => o.id === outcome);
          if (option) this.finish(option.transported, option.plan);
        }
      }
      this.changed();
    }, this.route.round, this.options.map(o => ({ id: o.id, label: o.label })), TRANSPORT_POLICY, (_id, nextAttempt) => {
      if (nextAttempt === 3) {
        this.recordDamage("gas"); this.refreshAfterGas(stage);
        if (!this.read().characters.some(isAlive)) { this.phase = "blocked"; this.reason = "no-living-characters"; this.changed(); return null; }
        if (!this.exhausted.length) { this.finish([], undefined); this.changed(); return null; }
        if (!this.electorate().length) { this.phase = "blocked"; this.reason = "no-eligible-voters-after-gas"; this.changed(); return null; }
      }
      return this.electorate();
    });
    this.voting = voting; this.decisions.push({ stage, voting });
  }
  reconcileParticipants() {
    if(this.phase!=="voting"&&this.phase!=="selection")return;
    this.refreshAfterGas(this.phase==="selection"?"recipient":"transport");
    if(!this.read().characters.some(isAlive)){this.phase="blocked";this.reason="no-living-characters";this.voting?.stop();return;}
    if(!this.exhausted.length){this.voting?.stop();this.finish([],undefined);return;}
    if(!this.electorate().length){this.phase="blocked";this.reason="no-eligible-voters-after-death";this.voting?.stop();return;}
    this.voting?.reconcileElectorate(this.electorate(),this.options.filter(o=>o.viable).map(o=>o.id));
  }
  private explode() {
    this.recordDamage("explosion");
    const classified = classifyMovement(this.read(), this.route.effort ?? this.route.cost);
    const exhausted = classified.ok ? classified.classification.transportRequiredIds : [];
    const result = abandonCharacters(this.crisis.readActual(), exhausted);
    this.crisis.commit(result.state);
    this.abandoned = result.transfers.map(t => t.characterId); this.transfers = result.transfers; this.transported = [];
    if (this.route.round < 6) {
      this.phase = "sector-evacuated"; this.reason = "sector-evacuated-after-explosion";
      this.crisis.evacuateSector(result.state, this.preparationId, this.route.id);
    } else {
      this.phase = "blocked";
      if (!result.state.characters.some(isAlive)) this.reason = "no-living-characters";
      else {
        const assessment = assessTransportPlan(this.read(), this.route.effort ?? this.route.cost);
        this.reason = this.execute(this.read());
        if (!this.reason) { this.phase = "completed"; if (assessment.ok) this.charges = assessment.charges; }
      }
    }
    this.savedView = this.view();
  }
  private finish(transported: string[], plan?: TransportPlan) {
    const abandoned = this.exhausted.filter(id => !transported.includes(id));
    const prepared = abandonCharacters(this.read(), abandoned);
    const assessment = assessTransportPlan(prepared.state, this.route.effort ?? this.route.cost, plan);
    if (!assessment.ok) { this.phase = "blocked"; this.reason = assessment.error; return; }
    // Validar antes de confirmar abandonos. La ejecución es síncrona y no admite otro voto intercalado.
    this.transported = [...transported]; this.abandoned = abandoned; this.transfers = prepared.transfers;
    this.phase = "blocked";
    const error = this.execute(prepared.state, plan);
    this.reason = error;
    if (error && this.route.round === 6) {
      // 9A confirma el rescate NPC, movimiento y abandonos en una sola transacción.
      this.transported = []; this.abandoned = []; this.transfers = [];
    }
    if (!error) { this.charges = assessment.charges; this.phase = "completed"; }
    this.savedView = this.view();
  }
  vote(participantId: string, input: unknown): VoteReply {
    this.voting?.refresh();
    if (!this.people.some(p => p.participantId === participantId && this.eligible.includes(p.characterId))) return { ok: false, error: "not-authorized" };
    if (!this.voting || (this.phase !== "voting" && this.phase !== "selection")) return { ok: false, error: "closed" };
    if (input && typeof input === "object") {
      const candidate = input as { optionId?: string; decisionId?: string; attemptId?: string };
      const current = this.voting.publicView();
      if (candidate.decisionId === current.decisionId && candidate.attemptId === current.attemptId) {
        const option = this.options.find(o => o.id === candidate.optionId);
        if (!option) return { ok: false, error: "invalid-option" };
        if (option.viable === false) return { ok: false, error: "transport-plan-infeasible" };
        if (option && option.transported.length && !option.plan.carrierIds.some(id => this.people.some(p => p.characterId === id && p.participantId === participantId))) return { ok: false, error: "not-authorized-for-plan" };
      }
    }
    return this.voting.vote(participantId, input);
  }
  view(): TransportCaseView {
    if (this.savedView) return structuredClone(this.savedView);
    if (this.phase === "preparation") this.prepare();
    const publicId = (id: string) => this.people.find(p => p.characterId === id)!.participantId;
    return { preparationId: this.preparationId, round: this.route.round, routeId: this.route.id, routeName: this.route.name,
      routeCost: this.route.cost, phase: this.phase, reason: this.reason, exhaustedIds: this.exhausted.map(publicId), eligibleIds: this.eligible.map(publicId),
      people: this.people.map(p => ({ participantId: p.participantId, name: p.name, energy: this.read().characters.find(c => c.id === p.characterId)!.energy })),
      options: this.options.map(o => ({ id: o.id, label: o.label, viable: o.viable, carrierIds: o.plan.carrierIds.map(publicId), carrierCost: o.carrierCost,
        authorizedVoterIds: (o.transported.length ? o.plan.carrierIds : this.eligible).map(publicId) })),
      crisis: Object.fromEntries((this.crisis.readActual().transportIncidents ?? []).filter(r => r.incidentId === this.preparationId).map(r => [r.kind, {
        incidentId: r.incidentId, at: r.at, victims: r.victims.map(v => ({ participantId: publicId(v.characterId), damage: v.damage })), deceasedIds: r.deceasedIds.map(publicId) }])),
      vote: this.voting?.publicView() ?? null, decisions: this.decisions.map(d => ({ stage: d.stage, vote: d.voting.publicView(), outcome: d.voting.selectedOption() })),
      transportedIds: this.transported.map(publicId), abandonedIds: this.abandoned.map(publicId),
      charges: this.charges.map(c => ({ participantId: publicId(c.characterId), kind: c.kind,
        routeEnergy: c.kind === "transported" ? 0 : movementEnergyFor(this.read().characters.find(h => h.id === c.characterId)!, this.route.effort ?? this.route.cost), transportEnergy: c.kind === "carrier" ? c.energyCost - movementEnergyFor(this.read().characters.find(h => h.id === c.characterId)!, this.route.effort ?? this.route.cost) : 0 })),
      transfers: this.transfers.map(t => ({ participantId: publicId(t.characterId), items: t.items.map(i => ({ ...i })) })) };
  }
  dispose() { this.decisions.forEach(d => d.voting.dispose()); }
}
