import { expect, test } from "vitest";
import { castVote, checkDeadline, createDecision, openNextAttempt, requiredMajority } from "./engine.js";
import type { Decision, VotingOperation } from "./types.js";

function initial(count = 4): Decision {
  const result = createDecision({ id: "rescue-r1", attemptId: "a1", now: 1000,
    options: [{ id: "rescue", label: "Rescatar al NPC" }, { id: "abandon", label: "Abandonar al NPC" }],
    electorate: Array.from({ length: 4 }, (_, i) => ({ participantId: `p${i}`, alive: i < count })),
  });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function success(result: VotingOperation): Decision {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function vote(state: Decision, participantId: string, optionId = "rescue", now = 2000, attemptId = "a1") {
  return castVote(state, { participantId, optionId, now, attemptId });
}
function rejected(result: VotingOperation, state: Decision, error: string) {
  expect(result).toEqual({ ok: false, error, state });
  expect(result.state).toBe(state);
}

test.each([[4, 3], [3, 2], [2, 2], [1, 1]])("%i vivos necesitan %i votos", (count, majority) => {
  expect(requiredMajority(count!)).toBe(majority);
  let state = initial(count);
  expect(state.attempts[0]!.requiredVotes).toBe(majority);
  for (let i = 0; i < majority!; i++) {
    state = success(vote(state, `p${i}`));
    expect(state.status).toBe(i + 1 === majority ? "closed" : "open");
  }
});

test.each(["rescue", "abandon"])("mayoría inmediata para %s sin esperar al cuarto votante", (optionId) => {
  const original = initial();
  let state = original;
  for (const participant of ["p0", "p1", "p2"]) state = success(vote(state, participant, optionId));
  expect(state).toMatchObject({ status: "closed", result: { kind: "approved", optionId } });
  expect(state.attempts[0]).toMatchObject({ status: "closed", closedAt: 2000 });
  expect(original.attempts[0]!.votes).toEqual([]);
  rejected(vote(state, "p3", optionId), state, "closed");
  expect(success(checkDeadline(state, "a1", 100000))).toBe(state);
});

test("no suma opciones distintas ni cuenta reenvíos; sustituye el voto vigente", () => {
  let state = success(vote(initial(), "p0"));
  expect(success(vote(state, "p0"))).toBe(state);
  state = success(vote(state, "p0", "abandon"));
  expect(state.attempts[0]!.votes).toHaveLength(1);
  state = success(vote(state, "p0", "rescue"));
  state = success(vote(state, "p1", "abandon"));
  state = success(vote(state, "p2"));
  state = success(vote(state, "p3", "abandon"));
  expect(state.status).toBe("open");
  expect(state.attempts[0]!.votes).toHaveLength(4);
});

test("rechaza no autorizados, muertos y opciones inexistentes sin mutar", () => {
  const state = initial(3);
  rejected(vote(state, "outsider"), state, "not-authorized");
  rejected(vote(state, "p3"), state, "dead");
  rejected(vote(state, "p0", "missing"), state, "invalid-option");
  rejected(vote(state, "p0", "rescue", 999), state, "invalid-time");
  rejected(vote(state, "p0", "rescue", NaN), state, "invalid-time");
});

test("10A: replacing an open vote moves its count and may immediately create the strict majority", () => {
  let state = success(vote(initial(), "p0", "rescue"));
  state = success(vote(state, "p1", "rescue"));
  state = success(vote(state, "p2", "abandon"));
  const deadline = state.attempts[0]!.deadline;
  state = success(vote(state, "p0", "abandon"));
  expect(state.status).toBe("open");
  expect(state.attempts[0]!.votes).toHaveLength(3);
  expect(state.attempts[0]!.votes.filter(v => v.optionId === "rescue")).toHaveLength(1);
  expect(state.attempts[0]!.votes.filter(v => v.optionId === "abandon")).toHaveLength(2);
  expect(state.attempts[0]!.deadline).toBe(deadline);
  state = success(vote(state, "p1", "abandon"));
  expect(state).toMatchObject({ status: "closed", result: { kind: "approved", optionId: "abandon" } });
  expect(state.attempts[0]!.votes).toHaveLength(3);
  rejected(vote(state, "p0", "rescue"), state, "closed");
});

test("60 segundos, segundo intento independiente de 30 segundos y falta definitiva de acuerdo", () => {
  const original = initial();
  let state = success(vote(original, "p0"));
  expect(success(checkDeadline(state, "a1", 60999))).toBe(state);
  rejected(vote(state, "p1", "rescue", 61000), state, "expired");
  rejected(vote(state, "p1", "rescue", 70000), state, "expired");
  state = success(checkDeadline(state, "a1", 65000));
  expect(state.status).toBe("awaiting-retry");
  expect(state.attempts[0]).toMatchObject({ deadline: 61000, closedAt: 61000, result: { kind: "no-majority" } });
  rejected(vote(state, "p1"), state, "closed");
  rejected(openNextAttempt(state, "a1", 65000), state, "duplicate-attempt");
  state = success(openNextAttempt(state, "a2", 65000));
  expect(state.attempts[1]).toMatchObject({ id: "a2", openedAt: 65000, deadline: 95000, votes: [], requiredVotes: 3 });
  rejected(vote(state, "p1", "rescue", 66000, "a1"), state, "wrong-attempt");
  rejected(checkDeadline(state, "a1", 96000), state, "wrong-attempt");
  state = success(vote(state, "p0", "abandon", 66000, "a2"));
  expect(state.attempts[0]!.votes).toHaveLength(1);
  state = success(checkDeadline(state, "a2", 95000));
  expect(state).toMatchObject({ status: "closed", result: { kind: "no-agreement" } });
  rejected(openNextAttempt(state, "a3", 96000), state, "retry-not-available");
  rejected(vote(state, "p2", "rescue", 96000, "a2"), state, "closed");
});

test("segundo intento permite aprobar una opción", () => {
  let state = success(openNextAttempt(success(checkDeadline(initial(), "a1", 61000)), "a2", 61000));
  for (const participant of ["p0", "p1", "p2"]) state = success(vote(state, participant, "abandon", 62000, "a2"));
  expect(state).toMatchObject({ status: "closed", result: { kind: "approved", optionId: "abandon" } });
});

test("valida configuración y copia entradas; cero vivos no inventa un desenlace", () => {
  expect(() => requiredMajority(0)).toThrow();
  const electorate = [{ participantId: "p0", alive: true }];
  const options = [{ id: "yes", label: "Sí" }, { id: "no", label: "No" }];
  const input = { id: "d", attemptId: "a", now: 0, options, electorate };
  const result = createDecision(input);
  expect(result.ok).toBe(true);
  electorate[0]!.alive = false;
  options[0]!.label = "alterado";
  if (result.ok) {
    expect(result.state.attempts[0]!.electorate[0]!.alive).toBe(true);
    expect(result.state.options[0]!.label).toBe("Sí");
  }
  expect(createDecision(input)).toEqual({ ok: false, error: "invalid-electorate" });
  expect(createDecision({ ...input, options: [options[0]!, options[0]!] })).toEqual({ ok: false, error: "invalid-definition" });
});
