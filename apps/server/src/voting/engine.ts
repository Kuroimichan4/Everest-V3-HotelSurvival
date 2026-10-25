import type { Decision, VoteOption, Voter, VotingAttempt, VotingError, VotingOperation, VotingPolicy } from "./types.js";

export const GENERAL_POLICY: VotingPolicy = Object.freeze({
  durationsMs: Object.freeze([60_000, 30_000]), majority: "strict-living-majority",
});

export function requiredMajority(livingCount: number): number {
  if (!Number.isSafeInteger(livingCount) || livingCount < 1) throw new Error("Se requiere al menos un votante vivo");
  return Math.floor(livingCount / 2) + 1;
}
const validTime = (now: number) => Number.isSafeInteger(now) && now >= 0;
const validId = (id: string) => typeof id === "string" && id.trim().length > 0;
function validElectorate(voters: readonly Voter[]): boolean {
  return voters.some((voter) => voter.alive) && voters.every((voter) => validId(voter.participantId) && typeof voter.alive === "boolean")
    && new Set(voters.map((voter) => voter.participantId)).size === voters.length;
}
function attempt(id: string, voters: readonly Voter[], now: number, duration: number): VotingAttempt {
  return { id, electorate: voters.map((voter) => ({ ...voter })), requiredVotes: requiredMajority(voters.filter((voter) => voter.alive).length),
    votes: [], openedAt: now, deadline: now + duration, status: "open" };
}
const reject = (state: Decision, error: VotingError): VotingOperation => ({ ok: false, state, error });
const accept = (state: Decision): VotingOperation => ({ ok: true, state });
function replaceLast(state: Decision, updated: VotingAttempt): Decision {
  return { ...state, attempts: [...state.attempts.slice(0, -1), updated] };
}

/** Entradas de una capa de servidor de confianza; no aceptar identidad o reloj del navegador. */
export function createDecision(input: {
  id: string; options: readonly VoteOption[]; electorate: readonly Voter[];
  attemptId: string; now: number; policy?: VotingPolicy;
}): { ok: true; state: Decision } | { ok: false; error: VotingError } {
  const policy = input.policy ?? GENERAL_POLICY;
  if (!validId(input.id) || !validId(input.attemptId) || input.options.length < 2
    || input.options.some((option) => !validId(option.id) || !validId(option.label))
    || new Set(input.options.map((option) => option.id)).size !== input.options.length
    || policy.majority !== "strict-living-majority" || policy.durationsMs.length === 0
    || policy.durationsMs.some((duration) => !Number.isSafeInteger(duration) || duration <= 0)) {
    return { ok: false, error: "invalid-definition" };
  }
  if (!validTime(input.now) || policy.durationsMs.some((duration) => !Number.isSafeInteger(input.now + duration))) return { ok: false, error: "invalid-time" };
  if (!validElectorate(input.electorate)) return { ok: false, error: "invalid-electorate" };
  return { ok: true, state: { id: input.id, options: input.options.map((option) => ({ ...option })),
    policy: { ...policy, durationsMs: [...policy.durationsMs] }, status: "open",
    attempts: [attempt(input.attemptId, input.electorate, input.now, policy.durationsMs[0]!)] } };
}

export function castVote(state: Decision, input: { attemptId: string; participantId: string; optionId: string; now: number }): VotingOperation {
  const current = state.attempts.at(-1)!;
  if (input.attemptId !== current.id) return reject(state, "wrong-attempt");
  if (state.status !== "open" || current.status !== "open") return reject(state, "closed");
  if (!validTime(input.now) || input.now < current.openedAt) return reject(state, "invalid-time");
  if (input.now >= current.deadline) return reject(state, "expired");
  const voter = current.electorate.find((candidate) => candidate.participantId === input.participantId);
  if (!voter) return reject(state, "not-authorized");
  if (!voter.alive) return reject(state, "dead");
  if (!state.options.some((option) => option.id === input.optionId)) return reject(state, "invalid-option");
  const previous = current.votes.find((vote) => vote.participantId === input.participantId);
  if (previous?.optionId === input.optionId) return accept(state);
  const votes = [...current.votes.filter(vote => vote.participantId !== input.participantId), { participantId: input.participantId, optionId: input.optionId }];
  if (votes.filter((vote) => vote.optionId === input.optionId).length >= current.requiredVotes) {
    const result = { kind: "approved" as const, optionId: input.optionId };
    return accept({ ...replaceLast(state, { ...current, votes, status: "closed", closedAt: input.now, result }), status: "closed", result });
  }
  return accept(replaceLast(state, { ...current, votes }));
}

export function checkDeadline(state: Decision, attemptId: string, now: number): VotingOperation {
  const current = state.attempts.at(-1)!;
  if (attemptId !== current.id) return reject(state, "wrong-attempt");
  if (!validTime(now) || now < current.openedAt) return reject(state, "invalid-time");
  if (state.status !== "open" || current.status !== "open" || now < current.deadline) return accept(state);
  const updated = replaceLast(state, { ...current, status: "closed", closedAt: current.deadline, result: { kind: "no-majority" } });
  return accept(state.attempts.length < state.policy.durationsMs.length
    ? { ...updated, status: "awaiting-retry" }
    : { ...updated, status: "closed", result: { kind: "no-agreement" } });
}

export function openNextAttempt(state: Decision, attemptId: string, now: number, electorate?: readonly Voter[]): VotingOperation {
  if (state.status !== "awaiting-retry") return reject(state, "retry-not-available");
  if (!validId(attemptId)) return reject(state, "invalid-definition");
  if (state.attempts.some((entry) => entry.id === attemptId)) return reject(state, "duplicate-attempt");
  const previous = state.attempts.at(-1)!;
  if (electorate && !validElectorate(electorate)) return reject(state, "invalid-electorate");
  const duration = state.policy.durationsMs[state.attempts.length]!;
  if (!validTime(now) || now < previous.deadline || !Number.isSafeInteger(now + duration)) return reject(state, "invalid-time");
  return accept({ ...state, status: "open", attempts: [...state.attempts, attempt(attemptId, electorate ?? previous.electorate, now, duration)] });
}
