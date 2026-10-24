import type { OwnVote, PublicVote, VoteInput, VoteReply } from "@everest/shared";
import { castVote, checkDeadline, createDecision, openNextAttempt } from "../voting/engine.js";
import type { Decision, Voter, VoteOption } from "../voting/types.js";
import { newId } from "./identity.js";

export interface VotingClock {
  now(): number;
  schedule(callback: () => void, delay: number): () => void;
}
export const systemClock: VotingClock = {
  now: () => Date.now(),
  schedule: (callback, delay) => { const timer = setTimeout(callback, delay); timer.unref(); return () => clearTimeout(timer); },
};

/** Una instancia por partida; el motor puro sigue siendo la única autoridad de reglas. */
export class RoomVoting {
  private decision: Decision;
  private cancel: (() => void) | undefined;
  constructor(electorate: readonly Voter[], private readonly clock: VotingClock, private readonly changed: () => void, private readonly round: 1 | 2 | 3 = 1, options: readonly VoteOption[] = [{ id: "rescue", label: "RESCATAR" }, { id: "abandon", label: "ABANDONAR" }]) {
    const created = createDecision({ id: newId(), attemptId: newId(), now: clock.now(), electorate,
      options });
    if (!created.ok) throw new Error(created.error);
    this.decision = created.state;
    this.schedule();
  }
  dispose(): void { this.cancel?.(); this.cancel = undefined; }
  private schedule(): void {
    this.dispose();
    if (this.decision.status !== "open") return;
    const deadline = this.decision.attempts.at(-1)!.deadline;
    this.cancel = this.clock.schedule(() => {
      this.cancel = undefined;
      this.refresh();
      if (!this.cancel && this.decision.status === "open") this.schedule();
    }, Math.max(0, deadline - this.clock.now()));
  }
  refresh(): void {
    const before = this.decision;
    const checked = checkDeadline(before, before.attempts.at(-1)!.id, this.clock.now());
    if (checked.ok) this.decision = checked.state;
    if (this.decision.status === "awaiting-retry") {
      const next = openNextAttempt(this.decision, newId(), this.clock.now());
      if (next.ok) this.decision = next.state;
    }
    if (before !== this.decision) { this.schedule(); this.changed(); }
  }
  publicView(): PublicVote {
    const decision = this.decision;
    const current = decision.attempts.at(-1)!;
    return { decisionId: decision.id, attemptId: current.id, round: this.round, attemptNumber: decision.attempts.length,
      deadline: current.deadline, serverNow: this.clock.now(), requiredVotes: current.requiredVotes,
      status: decision.status === "closed" ? "closed" : "open",
      result: decision.status !== "closed" ? null : decision.result.kind === "no-agreement" ? "NO_AGREEMENT"
        : decision.result.optionId === "rescue" ? "RESCUE_APPROVED" : decision.result.optionId === "abandon" ? "ABANDON_APPROVED" : null };
  }
  selectedOption(): string | "NO_AGREEMENT" | null {
    return this.decision.status !== "closed" ? null : this.decision.result.kind === "no-agreement" ? "NO_AGREEMENT" : this.decision.result.optionId;
  }
  ownView(participantId: string): OwnVote {
    const current = this.decision.attempts.at(-1)!;
    return { decisionId: this.decision.id, attemptId: current.id,
      optionId: current.votes.find((vote) => vote.participantId === participantId)?.optionId ?? null };
  }
  vote(participantId: string, input: unknown): VoteReply {
    if (!input || typeof input !== "object" || Object.keys(input).sort().join(",") !== "attemptId,decisionId,optionId") return { ok: false, error: "invalid-input" };
    const candidate = input as VoteInput;
    if ([candidate.decisionId, candidate.attemptId, candidate.optionId].some((value) => typeof value !== "string")) return { ok: false, error: "invalid-input" };
    if (candidate.decisionId !== this.decision.id) return { ok: false, error: "wrong-decision" };
    const result = castVote(this.decision, { ...candidate, participantId, now: this.clock.now() });
    if (!result.ok) { this.refresh(); return { ok: false, error: result.error }; }
    this.decision = result.state;
    this.schedule();
    this.changed();
    return { ok: true, own: this.ownView(participantId) };
  }
}
