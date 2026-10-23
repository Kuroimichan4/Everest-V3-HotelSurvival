/** Estado interno: no es una proyección pública ni un contrato Socket.IO. */
export interface VoteOption { readonly id: string; readonly label: string }
export interface Voter { readonly participantId: string; readonly alive: boolean }
export interface Vote { readonly participantId: string; readonly optionId: string }
export interface VotingPolicy {
  readonly durationsMs: readonly number[];
  readonly majority: "strict-living-majority";
}
export type AttemptResult =
  | { readonly kind: "approved"; readonly optionId: string }
  | { readonly kind: "no-majority" };
interface AttemptBase {
  readonly id: string;
  readonly electorate: readonly Voter[];
  readonly requiredVotes: number;
  readonly votes: readonly Vote[];
  readonly openedAt: number;
  readonly deadline: number;
}
export type VotingAttempt = AttemptBase & (
  | { readonly status: "open" }
  | { readonly status: "closed"; readonly closedAt: number; readonly result: AttemptResult }
);
export type DecisionResult =
  | { readonly kind: "approved"; readonly optionId: string }
  | { readonly kind: "no-agreement" };
interface DecisionBase {
  readonly id: string;
  readonly options: readonly VoteOption[];
  readonly policy: VotingPolicy;
  readonly attempts: readonly VotingAttempt[];
}
export type Decision = DecisionBase & (
  | { readonly status: "open" | "awaiting-retry" }
  | { readonly status: "closed"; readonly result: DecisionResult }
);
export type VotingError = "invalid-definition" | "invalid-time" | "invalid-electorate"
  | "wrong-attempt" | "closed" | "expired" | "not-authorized" | "dead"
  | "invalid-option" | "vote-change-pending" | "retry-not-available" | "duplicate-attempt";
export type VotingOperation =
  | { readonly ok: true; readonly state: Decision }
  | { readonly ok: false; readonly error: VotingError; readonly state: Decision };
