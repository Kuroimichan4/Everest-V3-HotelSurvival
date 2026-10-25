import { expect, test, vi } from "vitest";
import { TransportDecision } from "./transport.js";
import { createInitialState, type SimulationState } from "../simulation/state.js";
import { traverseRouteEffects } from "../simulation/routes.js";
import type { VotingClock } from "./voting.js";
class Clock implements VotingClock {
 time=1000;tasks=new Set<{at:number;fn:()=>void}>();now=()=>this.time;
 schedule=(fn:()=>void,delay:number)=>{const t={at:this.time+delay,fn};this.tasks.add(t);return()=>{this.tasks.delete(t);};};
 advance(ms:number){this.time+=ms;for(const t of [...this.tasks])if(t.at<=this.time){this.tasks.delete(t);t.fn();}}
}
function fixture(energies=[0,100,100,100],health=[100,100,100,100],round:1|2|3|4|5|6=3){
 const initial=createInitialState();let state:SimulationState={...initial,currentRound:round,characters:initial.characters.map((c,i)=>({...c,energy:energies[i]!,health:health[i]!,personalItems:[{id:`item-${i}`,kind:"radio"}]}))};
 const clock=new Clock();const random=vi.fn(()=>.99);const evacuate=vi.fn();
 const execute=vi.fn((candidate:SimulationState,plan?:Parameters<typeof traverseRouteEffects>[3])=>{const result=traverseRouteEffects(candidate,{energyCost:20,accidentProbability:.55,accidentDamage:20},random,plan);if(result.ok)state=result.state;return result.ok?null:result.error;});
 const people=state.characters.map((c,i)=>({characterId:c.id,participantId:`p${i}`,name:`P${i}`}));
 const decision=new TransportDecision({round,id:"route",name:"Ruta",cost:20},()=>state,execute,clock,()=>{},people,{readActual:()=>state,commit:s=>{state=s;},evacuateSector:evacuate});
 const view=()=>decision.view();const vote=(participantId:string,optionId:string)=>{const v=view().vote!;return decision.vote(participantId,{decisionId:v.decisionId,attemptId:v.attemptId,optionId});};
 decision.open(decision.preparationId);
 return{decision,clock,random,execute,evacuate,view,vote,state:()=>state};
}
test("transport attempts last 60/30/10 and gas occurs only before the third",()=>{
 const f=fixture();expect(f.view().vote).toMatchObject({attemptNumber:1,deadline:61000});
 f.clock.advance(60000);expect(f.view().vote).toMatchObject({attemptNumber:2,deadline:91000});expect(f.state().characters.every(c=>c.health===100)).toBe(true);
 f.clock.advance(30000);expect(f.view().vote).toMatchObject({attemptNumber:3,deadline:101000});expect(f.state().characters.every(c=>c.health===95)).toBe(true);
 expect(f.view().crisis!.gas).toBeDefined();expect(f.view().crisis!.explosion).toBeUndefined();f.decision.dispose();
});
test.each([1,2,3])("vote changes and immediate majority remain valid during attempt %i",attempt=>{
 const f=fixture();if(attempt>=2)f.clock.advance(60000);if(attempt===3)f.clock.advance(30000);
 expect(f.vote("p1","carry-all").ok).toBe(true);expect(f.vote("p1","leave-all").ok).toBe(true);expect(f.vote("p1","carry-all").ok).toBe(true);
 expect(f.execute).not.toHaveBeenCalled();expect(f.vote("p2","carry-all").ok).toBe(true);
 expect(f.view().phase).toBe("completed");expect(f.execute).toHaveBeenCalledTimes(1);expect(f.state().characters.map(c=>c.energy)).toEqual([0,65,65,65]);
 expect(f.state().characters.every(c=>c.health===(attempt===3?95:100))).toBe(true);expect(f.clock.tasks.size).toBe(0);expect(f.vote("p3","carry-all").ok).toBe(false);
});
test("gas deaths recalculate the extraordinary electorate and strict majority",()=>{
 const f=fixture([0,100,100,20],[100,5,100,100]);f.clock.advance(60000);f.clock.advance(30000);
 expect(f.view().eligibleIds).toEqual(["p2"]);expect(f.view().vote!.requiredVotes).toBe(1);expect(f.state().characters[1]!.health).toBe(0);
 expect(f.vote("p1","carry-all").ok).toBe(false);expect(f.vote("p3","carry-all").ok).toBe(false);expect(f.vote("p2","carry-all").ok).toBe(true);expect(f.view().phase).toBe("completed");
});
test("death of the only exhausted human removes transport without an invented vote",()=>{
 const f=fixture([0,100,100,100],[5,100,100,100]);f.clock.advance(60000);f.clock.advance(30000);
 expect(f.view().phase).toBe("completed");expect(f.execute).toHaveBeenCalledTimes(1);expect(f.state().characters[0]!.health).toBe(0);expect(f.clock.tasks.size).toBe(0);
});
test("gas killing all humans stops the clock without explosion or movement",()=>{
 const f=fixture([0,100,100,100],[5,5,5,5]);f.clock.advance(60000);f.clock.advance(30000);
 expect(f.view().reason).toBe("no-living-characters");expect(f.view().crisis!.explosion).toBeUndefined();expect(f.execute).not.toHaveBeenCalled();expect(f.clock.tasks.size).toBe(0);
});
test("explosion abandons only exhausted humans, transfers items once and never charges a skipped route",()=>{
 const f=fixture([0,0,20,35]);f.clock.advance(60000);f.clock.advance(30000);f.clock.advance(10000);
 expect(f.view().phase).toBe("sector-evacuated");expect(f.state().characters.map(c=>!!c.eliminated)).toEqual([true,true,false,false]);
 expect(f.state().characters.map(c=>c.energy)).toEqual([0,0,20,35]);expect(f.state().characters.every(c=>c.health===90)).toBe(true);
 expect(f.state().sharedItems?.map(i=>i.id)).toEqual(["item-0","item-1"]);expect(f.execute).not.toHaveBeenCalled();expect(f.random).not.toHaveBeenCalled();
 expect(f.evacuate).toHaveBeenCalledTimes(1);const snapshot=JSON.stringify(f.state());f.clock.advance(90000);f.decision.open(f.decision.preparationId);expect(JSON.stringify(f.state())).toBe(snapshot);expect(f.clock.tasks.size).toBe(0);
});
test("explosion distinguishes deaths from abandonment and clamps health",()=>{
 const f=fixture([0,100,20,100],[10,100,10,100]);f.clock.advance(60000);f.clock.advance(30000);f.clock.advance(10000);
 expect(f.state().characters.map(c=>c.health)).toEqual([0,90,0,90]);expect(f.view().abandonedIds).toEqual([]);expect(f.view().crisis!.explosion!.deceasedIds).toEqual(["p0","p2"]);
});
test("recipient decision keeps a confirmed carry-one choice and can succeed during its third attempt",()=>{
 const f=fixture([0,0,100,100]);f.vote("p2","carry-one");f.vote("p3","carry-one");expect(f.view().phase).toBe("selection");
 f.clock.advance(60000);f.clock.advance(30000);expect(f.view().vote!.attemptNumber).toBe(3);expect(f.view().decisions[0]!.outcome).toBe("carry-one");
 f.vote("p2","person-0");f.vote("p3","person-0");expect(f.view().transportedIds).toEqual(["p0"]);expect(f.view().abandonedIds).toEqual(["p1"]);expect(f.view().phase).toBe("completed");expect(f.state().transportIncidents).toHaveLength(1);
});
test("two chained extraordinary decisions apply a single gas incident before the final explosion",()=>{
 const f=fixture([0,0,100,100]);f.clock.advance(60000);f.clock.advance(30000);f.vote("p2","carry-one");f.vote("p3","carry-one");
 f.clock.advance(60000);f.clock.advance(30000);f.clock.advance(10000);
 expect(f.state().transportIncidents?.map(r=>r.kind)).toEqual(["gas","explosion"]);expect(f.state().characters.every(c=>c.health===90)).toBe(true);
 expect(f.view().decisions[0]!.outcome).toBe("carry-one");expect(f.view().abandonedIds).toEqual(["p0","p1"]);expect(f.execute).not.toHaveBeenCalled();
});
test("no eligible voter after gas retains a safe explicit exception without inventing a majority",()=>{
 const f=fixture([0,100,100,20],[100,5,5,100]);f.clock.advance(60000);f.clock.advance(30000);
 expect(f.view().reason).toBe("no-eligible-voters-after-gas");expect(f.execute).not.toHaveBeenCalled();expect(f.evacuate).not.toHaveBeenCalled();expect(f.clock.tasks.size).toBe(0);
});
test("round six explosion pays the selected exit and uses its usual accident exactly once",()=>{
 const f=fixture([0,100,100,20],[100,100,100,100],6);f.clock.advance(60000);f.clock.advance(30000);f.random.mockReturnValue(0);f.clock.advance(10000);
 expect(f.view().phase).toBe("completed");expect(f.view().abandonedIds).toEqual(["p0"]);expect(f.state().characters.map(c=>c.energy)).toEqual([0,80,80,0]);
 expect(f.execute).toHaveBeenCalledTimes(1);expect(f.random).toHaveBeenCalledTimes(4);expect(f.state().characters.map(c=>c.health)).toEqual([90,70,70,70]);
});
