import { expect, test, vi } from "vitest";
import { prepareIntermediateRound, openIntermediateVote, settleIntermediateVote, resolveIntermediateRoute, intermediateSelection, type IntermediateState } from "./intermediate-rounds.js";
import { createInitialState } from "./state.js";
import { checkDeadline, openNextAttempt } from "../voting/engine.js";
import { finalizationStatus } from "./final-result.js";
import { consumePack } from "./operations.js";

function attempts(state: IntermediateState) {
  const opened = openIntermediateVote(state, "decision", "first", 0);
  if (!opened.ok) throw new Error(opened.error);
  const first = checkDeadline(opened.state.intermediate.decision!, "first", 60000);
  if (!first.ok) throw new Error(first.error);
  const second = openNextAttempt(first.state, "second", 60000);
  if (!second.ok) throw new Error(second.error);
  const retryState: IntermediateState = { ...opened.state, intermediate: { ...opened.state.intermediate, decision: second.state } };
  const ended = checkDeadline(second.state, "second", 90000);
  if (!ended.ok) throw new Error(ended.error);
  return { retryState, closed: { ...retryState, intermediate: { ...retryState.intermediate, decision: ended.state } } };
}
for (const round of [4, 5] as const) {
  const forced = round === 4 ? "cracked-stairs" : "collapsed-kitchen";
  test(`round ${round}: first failure has no damage; second applies ten once with a forced receipt`, () => {
    const state = prepareIntermediateRound(createInitialState(), round);
    const { retryState, closed } = attempts(state);
    expect(settleIntermediateVote(retryState).characters).toEqual(state.characters);
    expect(retryState.intermediate.decision!.attempts.at(-1)!.deadline).toBe(90000);
    const settled = settleIntermediateVote(closed);
    expect(settled.characters.map(c => c.health)).toEqual([90,90,90,90]);
    expect(settled.intermediateConsequences).toMatchObject([{ round, decisionId: "decision", forcedRouteId: forced, deceasedIds: [] }]);
    expect(intermediateSelection(settled)).toEqual({ requestId: "decision", routeId: forced, forced: true });
    expect(settleIntermediateVote(settled)).toBe(settled);
    const replay = settleIntermediateVote({ ...settled, intermediate: { ...settled.intermediate, phase: "voting" } });
    expect(replay.characters).toEqual(settled.characters); expect(replay.intermediateConsequences).toHaveLength(1);
  });
  test(`round ${round}: forced route still pays ten and uses its new accident boundary`, () => {
    const state = settleIntermediateVote(attempts(prepareIntermediateRound(createInitialState(), round)).closed);
    const probability = round === 4 ? .55 : .7;
    const random = vi.fn().mockReturnValueOnce(probability - Number.EPSILON).mockReturnValue(0);
    const moved = resolveIntermediateRoute(state, "move", forced, random);
    expect(moved.ok).toBe(true); expect(random).toHaveBeenCalledTimes(4);
    expect(moved.state.characters.map(c => c.energy)).toEqual([90,90,90,90]);
    expect(moved.state.characters.map(c => c.health)).toEqual(round === 4 ? [70,70,70,90] : [60,60,60,90]);
    if (!moved.ok || moved.outcome.status !== "completed") throw new Error("not moved");
    expect(moved.outcome.forcedByNoAgreement).toBe(true);
    expect(moved.outcome.effects.victimIds).toHaveLength(3);
    const replay = vi.fn(() => 0);
    expect(resolveIntermediateRoute(moved.state, "move", forced, replay).state).toBe(moved.state);
    expect(replay).not.toHaveBeenCalled();
    const boundary = vi.fn(() => probability);
    const safe = resolveIntermediateRoute(state, "boundary", forced, boundary);
    expect(safe.ok).toBe(true); expect(boundary).toHaveBeenCalledTimes(1);
    expect(safe.state.characters.map(c => c.health)).toEqual([90,90,90,90]);
    expect(resolveIntermediateRoute(state, "bad", round === 4 ? "service-walkway" : "restaurant-corridor", () => 0).ok).toBe(false);
  });
}
test("earthquake deaths are clamped and excluded from the next movement", () => {
  const base = createInitialState();
  const state = prepareIntermediateRound({ ...base, characters: base.characters.map((c,i) => ({ ...c, health: i === 0 ? 5 : i === 1 ? 10 : 100, eliminated: i === 3 })) }, 4);
  const settled = settleIntermediateVote(attempts(state).closed);
  expect(settled.characters.map(c=>c.health)).toEqual([0,0,90,100]);
  expect(settled.intermediateConsequences![0]!.deceasedIds).toEqual(["maintenance","medic"]);
  const moved = resolveIntermediateRoute(settled,"m","cracked-stairs",()=>0);
  expect(moved.ok).toBe(true);expect(moved.state.characters.map(c=>c.energy)).toEqual([100,100,90,100]);
  if (!moved.ok || moved.outcome.status !== "completed") throw new Error("not moved");
  expect(moved.outcome.effects.victimIds).toEqual(["architect-engineer"]);
});
test("all deaths stop before drawing movement randomness and retain a terminal result",()=>{
  const base=createInitialState();const state=prepareIntermediateRound({...base,characters:base.characters.map(c=>({...c,health:10}))},5);
  const settled=settleIntermediateVote(attempts(state).closed);
  expect(finalizationStatus(settled)).toBe("no-active-humans");
  const random=vi.fn(()=>0);expect(resolveIntermediateRoute(settled,"m","collapsed-kitchen",random).ok).toBe(false);expect(random).not.toHaveBeenCalled();
});
test("insufficient energy never bypasses costs; packs permit retry without repeating earthquake",()=>{
  const base=createInitialState();let state=settleIntermediateVote(attempts(prepareIntermediateRound({...base,characters:base.characters.map(c=>({...c,energy:0}))},4)).closed);
  const random=vi.fn(()=>.99);const blocked=resolveIntermediateRoute(state,"m","cracked-stairs",random);
  expect(blocked.ok).toBe(false);expect(blocked.state).toBe(state);expect(random).not.toHaveBeenCalled();
  for(const c of state.characters){const pack=consumePack(state,c.id);if(!pack.ok)throw new Error(pack.error);state=pack.state;}
  const moved=resolveIntermediateRoute(state,"m","cracked-stairs",random);
  expect(moved.ok).toBe(true);expect(moved.state.characters.map(c=>[c.health,c.energy])).toEqual([[90,15],[90,15],[90,15],[90,15]]);
  expect(moved.state.intermediateConsequences).toHaveLength(1);
});
test("forced movement reuses transport and charges zero base energy to a carried human",()=>{
  const base=createInitialState();const state=settleIntermediateVote(attempts(prepareIntermediateRound({...base,characters:base.characters.map((c,i)=>({...c,energy:i===0?0:100}))},5)).closed);
  const moved=resolveIntermediateRoute(state,"m","collapsed-kitchen",()=>.99,{carrierIds:["medic"],transportedIds:["maintenance"]});
  expect(moved.ok).toBe(true);expect(moved.state.characters.map(c=>c.energy)).toEqual([0,75,90,90]);
});
