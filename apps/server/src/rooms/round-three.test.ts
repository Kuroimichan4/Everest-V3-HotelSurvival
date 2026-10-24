import { afterEach, expect, test, vi } from "vitest";
import type { RoomReply } from "@everest/shared";
import type { SimulationState } from "../simulation/state.js";
import { RoomManager } from "./manager.js";

const managers: RoomManager[] = [];
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose(); });
function value<T>(reply: RoomReply<T>): T { if (!reply.ok) throw new Error(reply.error); return reply.value; }
function setup() {
  const random = vi.fn(() => 0.99);
  const manager = new RoomManager(() => 0, { now: () => 1000, schedule: () => () => {} }, random);
  managers.push(manager);
  const session = value(manager.create("s0", "Host"));
  for (const i of [1, 2, 3]) value(manager.join(`s${i}`, `Player ${i}`, session.room.code));
  manager.start("s0");
  const code = session.room.code;
  const vote = (optionId: string, count = 3) => {
    const current = manager.publicVote(code)!;
    for (let i = 0; i < count; i++) expect(manager.vote(`s${i}`, { decisionId: current.decisionId, attemptId: current.attemptId, optionId }).ok).toBe(true);
  };
  vote("rescue"); manager.advanceRound("s0"); vote("rescue"); manager.routeAction("s0", "open"); vote("unstable-corridor");
  const setState = (change: (state: SimulationState) => SimulationState) => {
    const room = (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!;
    room.game.state = change(room.game.state);
  };
  random.mockClear();
  return { manager, code, vote, setState, random };
}

test.each([1, 2, 3, 4])("ronda 3: mayoría estricta de %i vivos, muertos excluidos", living => {
  const f = setup();
  f.setState(state => ({ ...state, characters: state.characters.map((c, i) => ({ ...c, health: i < living ? 100 : 0 })) }));
  expect(f.manager.roundThreeAction("s0", "advance").ok).toBe(true);
  expect(f.manager.roundThreeAction("s0", "open").ok).toBe(true);
  const vote = f.manager.publicVote(f.code)!;
  const required = Math.floor(living / 2) + 1;
  expect(vote.requiredVotes).toBe(required);
  if (living < 4) expect(f.manager.vote("s3", { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: "fire-door" })).toEqual({ ok: false, error: "dead" });
  f.vote("fire-door", required);
  const view = f.manager.roundThreeView(f.code)!;
  expect(view.phase).toBe("completed");
  expect(view.afterRoute!.characters.map(c => [c.health, c.energy])).toEqual(Array.from({ length: 4 }, (_, i) => [i < living ? 100 : 0, i < living ? 5 : 25]));
});

test.each(["insufficient-energy", "crowbar-unavailable-pending", "fatal-environment-order-pending", "fatal-accident-order-pending"])("bloqueo %s conserva efectos previos y no repite resolución", error => {
  const f = setup();
  const route = error === "fatal-environment-order-pending" ? "pipe-gallery" : "fire-door";
  f.setState(state => ({ ...state,
    tools: error === "crowbar-unavailable-pending" ? { crowbar: "lost" } : state.tools,
    characters: state.characters.map(c => ({ ...c,
      energy: error === "insufficient-energy" ? 0 : c.energy,
      health: error === "fatal-environment-order-pending" ? 50 : error === "fatal-accident-order-pending" ? 10 : c.health })) }));
  f.manager.roundThreeAction("s0", "advance");
  const before = f.manager.suppliesView(f.code)!;
  f.random.mockReturnValue(0);
  f.manager.roundThreeAction("s0", "open"); f.vote(route);
  const view = f.manager.roundThreeView(f.code)!;
  const fatal = error === "fatal-environment-order-pending" || error === "fatal-accident-order-pending";
  if (fatal) {
    expect(view.phase).toBe("completed");
    expect(view.afterRoute!.characters.slice(0, 2).every(c => c.health === 0)).toBe(true);
  } else {
    expect(view).toMatchObject({ phase: "blocked", blocked: error === "insufficient-energy" ? "transport-vote-pending" : error, movement: null, afterRoute: null });
    expect(f.manager.suppliesView(f.code)).toEqual({ ...before, windowId: null });
  }
  const calls = f.random.mock.calls.length;
  f.manager.roundThreeAction("s0", "open"); f.manager.roundThreeAction("s0", "advance");
  f.manager.votingSession("s0");
  expect(f.manager.roundThreeView(f.code)).toEqual(view);
  expect(f.random).toHaveBeenCalledTimes(calls);
});
