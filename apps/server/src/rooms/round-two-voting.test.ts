import { expect, test, vi } from "vitest";
import { RoomVoting, type VotingClock } from "./voting.js";

test.each([1, 2, 3, 4])("segundo rescate calcula mayoría sobre %i humanos vivos", living => {
  vi.useFakeTimers();
  const clock: VotingClock = {
    now: () => Date.now(),
    schedule: (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
  };
  const changed = vi.fn();
  const voting = new RoomVoting(Array.from({ length: 4 }, (_, i) => ({ participantId: String(i), alive: i < living })), clock, changed, 2);
  try {
    const view = voting.publicView();
    const input = { decisionId: view.decisionId, attemptId: view.attemptId, optionId: "rescue" };
    expect(view.requiredVotes).toBe(Math.floor(living / 2) + 1);
    expect(voting.vote("outsider", input)).toEqual({ ok: false, error: "not-authorized" });
    if (living < 4) expect(voting.vote("3", input)).toEqual({ ok: false, error: "dead" });
    for (let i = 0; i < view.requiredVotes; i++) {
      expect(voting.publicView().status).toBe("open");
      expect(voting.vote(String(i), input).ok).toBe(true);
    }
    expect(voting.publicView()).toMatchObject({ round: 2, status: "closed", result: "RESCUE_APPROVED" });
    vi.advanceTimersByTime(90_000);
    expect(changed).toHaveBeenCalledTimes(view.requiredVotes);
  } finally { voting.dispose(); vi.useRealTimers(); }
});
