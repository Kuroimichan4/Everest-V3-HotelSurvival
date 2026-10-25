import { resolveRoundOne } from "./round-one.js";
import { beginRoundTwo, resolveRoundTwo } from "./round-two.js";
import { resolveRoundTwoMovement } from "./round-two-movement.js";
import { beginRoundThree, resolveRoundThreeChoice } from "./round-three.js";
import { traverseRouteEffects } from "./routes.js";
import { ROUND_FOUR_ROUTES } from "./round-four.js";
import { describe, expect, it, vi } from "vitest";
import { createInitialState, type EngineState } from "./state.js";
import { intermediateMaintenanceStatus, administerIntermediateResource, internalIntermediateRoute, intermediateRouteViews, openIntermediateVote, prepareIntermediateRound, resolveIntermediateRoute, revealIntermediateRoute, revealIntermediateFromSession, settleIntermediateVote, type IntermediateState } from "./intermediate-rounds.js";
import { castVote, checkDeadline, openNextAttempt } from "../voting/engine.js";
import { assessObjective, collectObjectiveLedger } from "./objective-evidence.js";
import { ENERGY_SCENARIOS, evaluateSixRoundEnergy } from "./six-round-energy.js";
import { payMovement } from "./transport.js";
import type { GameFinalResult } from "@everest/shared";

const start = (round: 4 | 5 = 4, base: EngineState = createInitialState()) => prepareIntermediateRound(base, round);
function approved(state: IntermediateState, route: string): IntermediateState {
  const opened = openIntermediateVote(state, "vote", "attempt", 0);
  if (!opened.ok) throw new Error(opened.error);
  let decision = opened.state.intermediate.decision!;
  for (const c of state.characters.filter(c => c.health > 0 && !c.eliminated)) {
    const vote = castVote(decision, { attemptId: "attempt", participantId: c.id, optionId: route, now: 1 });
    if (!vote.ok) throw new Error(vote.error);
    decision = vote.state;
    if (decision.status === "closed") break;
  }
  return settleIntermediateVote({ ...opened.state, intermediate: { ...opened.state.intermediate, decision } });
}
const routes = [
  [4,"cracked-stairs",10,"HIGH",.55,20], [4,"service-walkway",20,"MODERATE",.35,10], [4,"technical-stairs",25,"LOW",.2,5],
  [5,"collapsed-kitchen",10,"EXTREME",.7,30], [5,"restaurant-corridor",20,"MODERATE",.35,10], [5,"extraction-gallery",25,"LOW",.2,5],
] as const;
describe("10B.1 isolated intermediate rounds", () => {
  it.each(routes)("catalogue %s %s", (round,id,energyCost,danger,accidentProbability,accidentDamage) => {
    expect(internalIntermediateRoute(id)).toMatchObject({round,energyCost,danger,accidentProbability,accidentDamage});
    expect(intermediateRouteViews(start(round),"maintenance")).toHaveLength(3);
  });
  it.each(routes)("reproducible movement %s %s", (round,id,cost,_risk,probability,damage) => {
    let state = start(round);
    state = revealIntermediateRoute(state,"maintenance",0).state;
    state = approved(state,id);
    const moved = resolveIntermediateRoute(state,"move",id,()=>0);
    expect(moved.ok).toBe(true);
    expect(moved.state.characters.map(c=>c.energy)).toEqual([100-cost,100-cost,100-cost,100-cost]);
    expect(moved.state.characters.map(c=>c.health)).toEqual([100-damage,100-damage,100-damage,100]);
    expect(resolveIntermediateRoute(state,"move",id,()=>0)).toEqual(moved);
    const boundary = resolveIntermediateRoute(state,"boundary",id,()=>probability);
    expect(boundary.state.characters.every(c=>c.health===100)).toBe(true);
    const random = vi.fn(()=>0);
    expect(resolveIntermediateRoute(moved.state,"move",id,random).state).toBe(moved.state);
    expect(random).not.toHaveBeenCalled();
    expect(resolveIntermediateRoute(moved.state,"other",id,random).ok).toBe(false);
  });
  it.each([4,5] as const)("protects and reveals round %s with authorship", round => {
    const state = start(round); const hidden = round===4 ? "technical-stairs":"extraction-gallery";
    expect(intermediateRouteViews(state,"medic")).toHaveLength(2);
    expect(JSON.stringify(intermediateRouteViews(state,"medic"))).not.toContain(hidden);
    expect(intermediateRouteViews(state,"unknown")).toEqual([]);
    expect(resolveIntermediateRoute(state,"move",hidden,()=>0).ok).toBe(false);
    expect(revealIntermediateRoute(state,"medic",0).ok).toBe(false);
    expect(revealIntermediateFromSession(state,"forged",()=>null,0).ok).toBe(false);
    const shared = revealIntermediateFromSession(state,"socket",id=>id==="socket"?"maintenance":null,12).state;
    expect(intermediateRouteViews(shared,"medic")).toHaveLength(3);
    expect(shared.routeRevelations).toEqual([{routeId:hidden,round,characterId:"maintenance",initiallyUnknownToOthers:true,sharedAt:12}]);
    expect(revealIntermediateRoute(shared,"maintenance",99).state).toBe(shared);
    expect(JSON.stringify(intermediateRouteViews(shared,"medic"))).not.toContain("accidentProbability");
    const dead = {...state,characters:state.characters.map(c=>({...c,eliminated:c.role==="maintenance"}))};
    expect(revealIntermediateRoute(dead,"maintenance",0).ok).toBe(false);
    expect(intermediateRouteViews(dead,"medic")).toHaveLength(2);
    expect(intermediateMaintenanceStatus(dead)).toBe("replacement-policy-pending");
  });
  it("records two revelations and only actually traversed extreme risk", () => {
    let state = revealIntermediateRoute(start(),"maintenance",1).state;
    state = revealIntermediateRoute(start(5,state),"maintenance",2).state;
    const result = {gameId:"g",id:"r",humans:[],npcs:[]} as unknown as GameFinalResult;
    let ledger = collectObjectiveLedger(state,result);
    expect(assessObjective("maintenance","maintenance",ledger)).toBe("fulfilled");
    expect(ledger.routes).toEqual([]);
    const moved = resolveIntermediateRoute(approved(state,"collapsed-kitchen"),"move","collapsed-kitchen",()=>.9);
    ledger = collectObjectiveLedger(moved.state,result);
    expect(ledger.routes).toMatchObject([{round:5,realRisk:"EXTREME",completed:true}]);
    expect(assessObjective("architect-engineer","architect-engineer",ledger)).toBe("unfulfilled");
  });
  it("uses existing vote engine, changes votes, excludes secrets, closes immediately", () => {
    const opened = openIntermediateVote(start(),"v","a",0);
    if(!opened.ok) throw new Error(opened.error);
    let vote=opened.state.intermediate.decision!;
    expect(vote.policy.durationsMs).toEqual([60000,30000]);
    expect(castVote(vote,{attemptId:"a",participantId:"medic",optionId:"technical-stairs",now:1}).ok).toBe(false);
    const a=castVote(vote,{attemptId:"a",participantId:"medic",optionId:"cracked-stairs",now:1});
    if(!a.ok) throw new Error(a.error);
    const b=castVote(a.state,{attemptId:"a",participantId:"medic",optionId:"service-walkway",now:2});
    if(!b.ok) throw new Error(b.error);
    expect(b.state.attempts[0]!.votes).toEqual([{participantId:"medic",optionId:"service-walkway"}]);
    const expired=checkDeadline(vote,"a",60000);
    if(!expired.ok) throw new Error(expired.error);
    const retry=openNextAttempt(expired.state,"b",60000);
    if(!retry.ok) throw new Error(retry.error);
    const end=checkDeadline(retry.state,"b",90000);
    if(!end.ok) throw new Error(end.error);
    const settled=settleIntermediateVote({...opened.state,intermediate:{...opened.state.intermediate,decision:end.state}});
    expect(settled.intermediate.phase).toBe("movement");
    expect(settled.characters.map(c=>c.health)).toEqual([90,90,90,90]);
    expect(resolveIntermediateRoute(settled,"move","cracked-stairs",()=>0).ok).toBe(true);
    expect(settleIntermediateVote(settled)).toBe(settled);
    vote=approved(start(),"cracked-stairs").intermediate.decision!;
    expect(vote.status).toBe("closed");
    expect(vote.attempts[0]!.votes).toHaveLength(3);
  });
  it("one eligible victim is hit once; eliminated characters excluded; damage clamped", () => {
    const state=start(5,{...createInitialState(),characters:createInitialState().characters.map((c,i)=>({...c,health:i===0?10:100,eliminated:i!==0}))});
    const moved=resolveIntermediateRoute(approved(state,"collapsed-kitchen"),"m","collapsed-kitchen",()=>0);
    expect(moved.state.characters.map(c=>c.health)).toEqual([0,100,100,100]);
    expect(moved.state.characters.map(c=>c.energy)).toEqual([90,100,100,100]);
    if(!moved.ok || moved.outcome.status!=="completed") throw new Error("failed");
    expect(moved.outcome.effects.victimIds).toEqual(["maintenance"]);
    expect(moved.outcome.effects.deceasedIds).toEqual(["maintenance"]);
  });
  it("transport is charged by existing rules; carried human pays zero", () => {
    const state=start(4,{...createInitialState(),characters:createInitialState().characters.map((c,i)=>({...c,energy:i===0?0:100}))});
    const moved=resolveIntermediateRoute(approved(state,"cracked-stairs"),"m","cracked-stairs",()=>.9,{carrierIds:["medic"],transportedIds:["maintenance"]});
    expect(moved.ok).toBe(true);
    expect(moved.state.characters.map(c=>c.energy)).toEqual([0,75,90,90]);
  });
  it("invalid randomness is atomic and cannot be rerolled", () => {
    const state=approved(start(),"cracked-stairs");
    const moved=resolveIntermediateRoute(state,"m","cracked-stairs",()=>NaN);
    expect(moved.ok).toBe(false); expect(moved.state.characters).toBe(state.characters);
    const random=vi.fn(()=>.9);
    expect(resolveIntermediateRoute(moved.state,"m","cracked-stairs",random).ok).toBe(false);
    expect(random).not.toHaveBeenCalled();
  });
  it.each([4,5] as const)("resources keep permissions, windows, receipts and treatment limit in round %s", round=>{
    let state=start(round,{...createInitialState(),characters:createInitialState().characters.map(c=>({...c,health:50,energy:50}))});
    expect(administerIntermediateResource(state,"maintenance","medic","pack","x").ok).toBe(false);
    state=administerIntermediateResource(state,"bellhop","medic","pack","p").state;
    expect(state.characters[1]!.energy).toBe(75);
    expect(administerIntermediateResource(state,"bellhop","medic","pack","p").state).toBe(state);
    state=administerIntermediateResource(state,"medic","maintenance","treatment","t").state;
    expect(state.characters[0]!.health).toBe(70);
    expect(administerIntermediateResource(state,"medic","maintenance","treatment","t2").ok).toBe(false);
    const next=start(round===4?5:4,state);
    expect(administerIntermediateResource(next,"medic","maintenance","treatment","new").ok).toBe(true);
    const opened=openIntermediateVote(state,"v","a",0);
    if(!opened.ok) throw new Error(opened.error);
    expect(administerIntermediateResource(opened.state,"bellhop","medic","pack","p2").ok).toBe(false);
  });
});
describe("six round energy",()=>{
  it.each(ENERGY_SCENARIOS)("$name", scenario=>{
    const result=evaluateSixRoundEnergy(scenario);
    expect(result.viableAll).toBe(["mínimo sin rescates","mínimo sin suministros","mínimo con dos rescates","almacén cuatro sin rescates","almacén ocho y último rescate asistido"].includes(scenario.name));
    expect(result.energies.every(e=>e>=0)).toBe(true);
  });
  it("transport permits two late movements with depleted supplies",()=>{
    let state:EngineState={...createInitialState(),inventory:{packs:0,medicalUnits:0},characters:createInitialState().characters.map((c,i)=>({...c,energy:i===0?0:50}))};
    for(let i=0;i<2;i++){
      const move=payMovement(state,10,{carrierIds:["medic"],transportedIds:["maintenance"]});
      expect(move.ok).toBe(true); if(!move.ok) throw new Error(move.error); state=move.state;
    }
    expect(state.characters.map(c=>c.energy)).toEqual([0,0,30,30]);
    expect(payMovement(state,20).ok).toBe(false);
  });
  it("at least one human can complete six minimum-cost stages without supplies",()=>{
    let state:EngineState={...createInitialState(),characters:[createInitialState().characters[0]!],inventory:{packs:0,medicalUnits:0}};
    for(const cost of [25,20,20,10,10,10]){
      const move=payMovement(state,cost); expect(move.ok).toBe(true); if(!move.ok) throw new Error(move.error);state=move.state;
    }
    expect(state.characters[0]!.energy).toBe(5);
  });
});

it("six-stage minimum journey really preserves living humans, including guaranteed gallery damage", () => {
  const initial = { ...createInitialState(), inventory: { packs: 0, medicalUnits: 0 } };
  const one = resolveRoundOne(initial,"one","ABANDON_APPROVED");
  if (!one.ok) throw new Error(one.error);
  const rescue = resolveRoundTwo(beginRoundTwo(one.state),"two","ABANDON_APPROVED");
  if (!rescue.ok) throw new Error(rescue.error);
  const two = resolveRoundTwoMovement(rescue.state,{decisionId:"route2",outcome:"unstable-corridor",ventilationRevealed:false},()=>.99);
  if (!two.ok) throw new Error(two.error);
  const three = resolveRoundThreeChoice(beginRoundThree(two.state),{decisionId:"three",outcome:"pipe-gallery"},()=>.99);
  if (!three.ok) throw new Error(three.error);
  const four = resolveIntermediateRoute(approved(start(4,three.state),"cracked-stairs"),"four","cracked-stairs",()=>.99);
  if (!four.ok) throw new Error("four");
  const five = resolveIntermediateRoute(approved(start(5,four.state),"collapsed-kitchen"),"five","collapsed-kitchen",()=>.99);
  if (!five.ok) throw new Error("five");
  // Only the exit effects are assessed; no live game transition or second final result is created.
  const exit = traverseRouteEffects(five.state,ROUND_FOUR_ROUTES["exterior-crack"],()=>.99);
  expect(exit.ok).toBe(true);
  expect(exit.state.characters.every(c=>c.health===80 && c.energy===5)).toBe(true);
});