import { afterEach, expect, test, vi } from "vitest";
import type { RoomReply } from "@everest/shared";
import { RoomManager } from "./manager.js";
import type { VotingClock } from "./voting.js";
import type { SimulationState } from "../simulation/state.js";
import { activeScene, emptyGame } from "../../../web/src/game-state.js";

class Clock implements VotingClock {
  time=1000; tasks=new Set<{at:number;fn:()=>void}>(); now=()=>this.time;
  schedule=(fn:()=>void,delay:number)=>{const t={at:this.time+delay,fn};this.tasks.add(t);return()=>{this.tasks.delete(t);};};
  advance(ms:number){this.time+=ms;for(const t of [...this.tasks])if(t.at<=this.time){this.tasks.delete(t);t.fn();}}
}
const managers:RoomManager[]=[];
afterEach(()=>{for(const m of managers.splice(0))m.dispose();});
function value<T>(r:RoomReply<T>):T{if(!r.ok)throw new Error(r.error);return r.value;}
function setup(){
  const clock=new Clock();const random=vi.fn(()=>.99);const manager=new RoomManager(()=>0,clock,random);managers.push(manager);
  const sessions=[value(manager.create("s0","Host"))];const code=sessions[0]!.room.code;
  for(let i=1;i<4;i++)sessions.push(value(manager.join(`s${i}`,`Person ${i}`,code)));
  expect(manager.start("s0").ok).toBe(true);
  const sockets=["s0","s1","s2","s3"];
  const cast=(i:number,id:string)=>{const v=manager.publicVote(code)!;return manager.vote(sockets[i]!,{decisionId:v.decisionId,attemptId:v.attemptId,optionId:id});};
  const vote=(id:string,ids=[0,1,2])=>{for(const i of ids)expect(cast(i,id).ok).toBe(true);};
  const role=(role:string)=>sockets.find(s=>manager.privateRole(s)?.role===role)!;
  const game=()=>(manager as unknown as {rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;
  const pack=(i:number,requestId=crypto.randomUUID())=>manager.givePack(role("bellhop"),{requestId,windowId:manager.suppliesView(code)!.windowId!,targetParticipantId:sessions[i]!.credential.participantId});
  const action=(round:4|5,action:"advance"|"reveal"|"open"|"retry",socket="s0")=>manager.intermediateAction(socket,{round,action});
  const view=(i=0)=>manager.intermediateSession(sockets[i]!)!.at(-1)!;
  const toThree=(rescue=false,route2="unstable-corridor",route3="pipe-gallery")=>{
    vote(rescue?"rescue":"abandon");expect(manager.advanceRound("s0").ok).toBe(true);
    if(route2==="ventilation")expect(manager.routeAction(role("maintenance"),"reveal").ok).toBe(true);
    expect(manager.routeAction("s0","open").ok).toBe(true);vote(route2);vote(rescue?"rescue":"abandon");
    expect(manager.openTransport("s0",{preparationId:manager.transportView(code)!.cases.at(-1)!.preparationId}).ok).toBe(true);
    expect(manager.roundThreeAction("s0","advance").ok).toBe(true);
    if(rescue)for(let i=0;i<4;i++)expect(pack(i).ok).toBe(true);
    expect(manager.roundThreeAction("s0","open").ok).toBe(true);vote(route3);
    expect(manager.roundThreeView(code)!.phase).toBe("completed");
  };
  const middle=(round:4|5,route:string)=>{expect(action(round,"advance").ok).toBe(true);expect(action(round,"open").ok).toBe(true);vote(route);expect(view().phase).toBe("completed");};
  const exit=()=>{random.mockReturnValue(0);expect(manager.roundFourAction("s0","advance").ok).toBe(true);random.mockReturnValue(.99);expect(manager.roundFourAction("s0","open").ok).toBe(true);vote("exterior-crack");};
  return{manager,clock,random,sessions,sockets,code,cast,vote,role,game,pack,action,view,toThree,middle,exit};
}

test("six consecutive rounds, minimum path, real costs, single final result and unique history",()=>{
  const f=setup();f.toThree();
  expect(f.manager.roundFourAction("s0","advance").ok).toBe(false);
  expect(f.action(5,"advance").ok).toBe(false);
  expect(f.action(4,"advance","s1").ok).toBe(false);
  for(const [round,route] of [[4,"cracked-stairs"],[5,"collapsed-kitchen"]] as const){
    f.middle(round,route);
    expect(f.manager.finalResult(f.code)).toBe(null);
    const calls=f.random.mock.calls.length;
    expect(f.action(round,"advance").ok).toBe(true);
    expect(f.action(round,"open").ok).toBe(true);
    expect(f.random).toHaveBeenCalledTimes(calls);
  }
  f.exit();const result=f.manager.finalResult(f.code)!;
  expect(result).toMatchObject({round:6,kind:"evacuation-completed",counts:{evacuated:4},inventory:{packs:8,medicalUnits:4}});
  expect(result.humans.every(p=>p.energy===5&&p.health===80)).toBe(true);
  const stages=f.manager.intermediateSession("s0")!;
  const state={...emptyGame,intermediates:stages,roundFour:f.manager.roundFourView(f.code)};
  expect(new Set(stages.map(s=>s.movement!.requestId)).size).toBe(2);
  expect(activeScene(state).round).toBe(6);
  const calls=f.random.mock.calls.length;f.manager.roundFourAction("s0","advance");
  expect(f.manager.finalResult(f.code)).toEqual(result);expect(f.random).toHaveBeenCalledTimes(calls);
  expect(f.action(4,"open").ok).toBe(false);
});

test("two rescues reach the final exit with approved packs and evacuate earlier NPCs",()=>{
  const f=setup();f.toThree(true);
  f.middle(4,"cracked-stairs");
  for(let i=0;i<4;i++)expect(f.pack(i).ok).toBe(true);
  f.middle(5,"collapsed-kitchen");
  f.exit();
  expect(f.manager.finalResult(f.code)).toMatchObject({round:6,counts:{evacuated:4,evacuatedNpcs:2},inventory:{packs:0}});
  expect(f.manager.finalResult(f.code)!.npcs.slice(0,2)).toEqual([{round:1,status:"rescued",evacuated:true},{round:2,status:"rescued",evacuated:true}]);
});

test("prudente with warehouse supplies, both secret revelations and doctor treatment in rounds 4 and 5",()=>{
  const f=setup();f.toThree(false,"ventilation","metal-debris");
  expect(f.action(4,"advance").ok).toBe(true);
  expect(f.view().options).toHaveLength(f.role("maintenance")==="s0"?3:2);
  expect(f.action(4,"reveal",f.role("medic")).ok).toBe(false);
  expect(f.action(4,"reveal",f.role("maintenance")).ok).toBe(true);
  const saved=f.game().state.routeRevelations;
  expect(f.action(4,"reveal",f.role("maintenance")).ok).toBe(true);expect(f.game().state.routeRevelations).toBe(saved);
  for(let i=0;i<4;i++)expect(f.pack(i).ok).toBe(true);
  expect(f.action(4,"open").ok).toBe(true);f.random.mockReturnValue(0);f.vote("technical-stairs");f.random.mockReturnValue(.99);
  const patient=f.sessions[0]!.credential.participantId;
  const treatment=(round:4|5,id:string)=>f.manager.treat(f.role("medic"),{requestId:id,gameId:f.manager.suppliesView(f.code)!.gameId,round,targetParticipantId:patient});
  expect(treatment(4,"t4").ok).toBe(true);expect(treatment(4,"t4-repeat").ok).toBe(false);
  expect(f.action(5,"advance").ok).toBe(true);
  expect(f.action(5,"reveal",f.role("maintenance")).ok).toBe(true);
  for(let i=0;i<4;i++)expect(f.pack(i).ok).toBe(true);
  expect(f.action(5,"open").ok).toBe(true);f.random.mockReturnValue(0);f.vote("extraction-gallery");f.random.mockReturnValue(.99);
  expect(treatment(5,"t5").ok).toBe(true);
  for(let i=0;i<4;i++)expect(f.pack(i).ok).toBe(true);
  f.random.mockReturnValue(0);expect(f.manager.roundFourAction("s0","advance").ok).toBe(true);f.random.mockReturnValue(.99);
  expect(f.manager.roundFourView(f.code)!.options.find(o=>o.id==="revolving-door")!.availability.status).toBe("available");
  expect(f.manager.roundFourAction("s0","open").ok).toBe(true);f.vote("revolving-door");
  expect(f.manager.finalResult(f.code)!.humans.every(p=>p.energy===10)).toBe(true);
  expect(f.manager.objectiveSession(f.role("maintenance"))!.evaluation).toBe("fulfilled");
  expect(f.manager.medicalView(f.code)!.treatments.map(t=>t.round)).toEqual([4,5]);
  expect(f.manager.finalResult(f.code)!.inventory.packs).toBe(4);
});

test.each([4,5] as const)("round %s secret route never appears or can be voted by other sessions until revealed",round=>{
  const f=setup();f.toThree();if(round===5)f.middle(4,"cracked-stairs");expect(f.action(round,"advance").ok).toBe(true);
  const secret=round===4?"technical-stairs":"extraction-gallery";
  for(const s of f.sockets){const v=f.manager.intermediateSession(s)!.at(-1)!;expect(v.options.some(o=>o.id===secret)).toBe(f.manager.privateRole(s)?.role==="maintenance");}
  expect(f.action(round,"open").ok).toBe(true);expect(f.cast(0,secret)).toMatchObject({ok:false,error:"invalid-option"});
  expect(f.action(round,"reveal",f.role("maintenance")).ok).toBe(false);
});

test.each([4,5] as const)("round %s two failed attempts apply one earthquake and force the approved public route",round=>{
  const f=setup();f.toThree();if(round===5)f.middle(4,"cracked-stairs");f.action(round,"advance");const before=f.manager.suppliesView(f.code)!;
  f.action(round,"open");expect(f.manager.publicVote(f.code)!.deadline).toBe(f.clock.now()+60000);
  f.clock.advance(60000);expect(f.manager.publicVote(f.code)).toMatchObject({attemptNumber:2,deadline:f.clock.now()+30000});
  f.clock.advance(30000);
  expect(f.sockets.every(s=>f.manager.intermediateSession(s)!.at(-1)!.phase==="completed")).toBe(true);
  expect(f.manager.suppliesView(f.code)!.characters.map(c=>c.health)).toEqual(before.characters.map(c=>c.health!-10));
  expect(f.view().consequence!.forcedRouteId).toBe(round===4?"cracked-stairs":"collapsed-kitchen");
  expect(f.manager.suppliesView(f.code)!.inventory).toEqual(before.inventory);
  expect(f.view().movement!.routeId).toBe(round===4?"cracked-stairs":"collapsed-kitchen");
  expect(f.game().state.intermediateConsequences).toHaveLength(1);
  expect(f.manager.finalResult(f.code)).toBe(null);
});

test("public route votes change before majority and F5 preserves deadline, authorship, supplies and phases",()=>{
  const f=setup();f.toThree();f.action(4,"advance");f.action(4,"reveal",f.role("maintenance"));f.action(4,"open");
  expect(f.cast(0,"cracked-stairs").ok).toBe(true);expect(f.cast(0,"technical-stairs").ok).toBe(true);
  const vote=f.manager.publicVote(f.code)!;const before=f.manager.suppliesView(f.code)!;
  f.manager.disconnect("s0");value(f.manager.resume("new",f.sessions[0]!.credential));f.sockets[0]="new";
  expect(f.manager.votingSession("new")!.own.optionId).toBe("technical-stairs");
  expect(f.manager.publicVote(f.code)!.deadline).toBe(vote.deadline);expect(f.manager.suppliesView(f.code)).toEqual(before);
  expect(f.view().options).toHaveLength(3);expect(f.manager.intermediateAction("s0",{round:4,action:"open"}).ok).toBe(false);
  f.cast(1,"technical-stairs");f.cast(2,"technical-stairs");expect(f.view().phase).toBe("completed");
});

test.each([4,5] as const)("round %s privacy filters accidents, snapshots, resources and exact values per session",round=>{
  const f=setup();f.toThree();if(round===5)f.middle(4,"cracked-stairs");f.action(round,"advance");f.action(round,"open");f.random.mockReturnValue(0);f.vote(round===4?"cracked-stairs":"collapsed-kitchen");
  expect(f.view().movement!.victims).toHaveLength(3);
  for(let i=0;i<4;i++){
    const payload=f.manager.sessionProjection(f.sockets[i]!,f.manager.intermediateSession(f.sockets[i]!)!);const m=payload.at(-1)!.movement!;
    m.characters.forEach((c,j)=>{expect(c.energy!==undefined).toBe(i===j);expect(c.health!==undefined).toBe(i===j||f.manager.privateRole(f.sockets[i]!)?.role==="medic");});
    expect(JSON.stringify(payload)).not.toMatch(/accidentProbability|tokenHash|personalItems/);
    for(const v of m.victims)expect(v.damage!==undefined).toBe(v.participantId===f.sessions[i]!.credential.participantId);
  }
});

test("real exhaustion in round 5 uses authorized existing transport and carried human pays zero",()=>{
  const f=setup();f.toThree(false,"unstable-corridor","metal-debris");
  for(let i=1;i<4;i++)expect(f.pack(i).ok).toBe(true);
  f.middle(4,"cracked-stairs");f.action(5,"advance");f.action(5,"open");f.vote("collapsed-kitchen");
  const before=f.manager.suppliesView(f.code)!;const transport=f.manager.transportView(f.code)!.cases.at(-1)!;
  expect(transport.round).toBe(5);expect(transport.exhaustedIds).toEqual([f.sessions[0]!.credential.participantId]);
  expect(f.manager.openTransport("s1",{preparationId:transport.preparationId}).ok).toBe(true);
  expect(f.cast(0,"carry-all").ok).toBe(false);f.vote("carry-all",[1,2]);
  expect(f.view().phase).toBe("completed");
  const after=f.manager.suppliesView(f.code)!;expect(after.characters[0]!.energy).toBe(before.characters[0]!.energy);
  expect(after.characters.slice(1).map(c=>c.energy)).toEqual(before.characters.slice(1).map(c=>c.energy!-25));
});

test("lost crowbar in actual route 3 blocks revolving door at round 6",()=>{
  const f=setup();f.toThree(false,"unstable-corridor","fire-door");
  f.middle(4,"cracked-stairs");f.middle(5,"collapsed-kitchen");
  for(let i=0;i<4;i++)expect(f.pack(i).ok).toBe(true);
  f.random.mockReturnValue(0);f.manager.roundFourAction("s0","advance");f.random.mockReturnValue(.99);
  expect(f.manager.roundFourView(f.code)!.options.find(o=>o.id==="revolving-door")!.availability).toMatchObject({status:"unavailable",reason:"crowbar-unavailable"});
  f.manager.roundFourAction("s0","open");expect(f.cast(0,"revolving-door").ok).toBe(false);f.vote("exterior-crack");expect(f.manager.finalResult(f.code)!.round).toBe(6);
});

test("insufficient prudent budget blocks safely without negative or partial costs; packs reopen viable options",()=>{
  const f=setup();f.toThree(false,"ventilation","fire-door");f.action(4,"advance");f.action(4,"reveal",f.role("maintenance"));
  const before=f.manager.suppliesView(f.code)!;expect(f.view().options.find(o=>o.id==="technical-stairs")!.availability.status).toBe("unavailable");
  f.action(4,"open");expect(f.cast(0,"technical-stairs").ok).toBe(false);
  expect(f.manager.suppliesView(f.code)!.characters).toEqual(before.characters);
  f.vote("cracked-stairs");expect(f.manager.finalResult(f.code)).toBe(null);
});

test("all humans eliminated before round six produces a single terminal result",()=>{
  const f=setup();f.toThree();f.action(4,"advance");
  f.game().state={...f.game().state,characters:f.game().state.characters.map(c=>({...c,health:0}))};
  const final=f.manager.finalResult(f.code)!;expect(final).toMatchObject({kind:"no-active-humans",round:4,counts:{dead:4}});
  expect(f.manager.finalResult(f.code)).toEqual(final);expect(f.action(5,"advance").ok).toBe(false);
});


test.each(["dead","abandoned"] as const)("eliminated Maintenance (%s) cannot reveal and no successor is created",status=>{
 const f=setup();f.toThree();f.action(4,"advance");const socket=f.role("maintenance");const actor=f.manager.privateRole(socket)!.role;
 f.game().state={...f.game().state,characters:f.game().state.characters.map(c=>c.role===actor?{...c,...(status==="dead"?{health:0}:{eliminated:true})}:c)};
 expect(f.action(4,"reveal",socket).ok).toBe(false);
 for(const s of f.sockets.filter(s=>s!==socket))expect(f.manager.intermediateSession(s)!.at(-1)!.options).toHaveLength(2);
 expect(f.game().state.routeRevelations??[]).toEqual([]);
});

test("round 5 transport crisis opens extraordinary vote and evacuates into round six",()=>{
 const f=setup();f.toThree(false,"unstable-corridor","metal-debris");for(let i=1;i<4;i++)f.pack(i);
 f.middle(4,"cracked-stairs");f.action(5,"advance");f.action(5,"open");f.vote("collapsed-kitchen");
 const t=f.manager.transportView(f.code)!.cases.at(-1)!;f.manager.openTransport("s1",{preparationId:t.preparationId});
 const before=f.manager.suppliesView(f.code)!;f.clock.advance(60000);f.clock.advance(30000);
 expect(f.manager.transportView(f.code)!.cases.at(-1)!.vote).toMatchObject({attemptNumber:3,status:"open"});
 expect(f.manager.suppliesView(f.code)!.characters.map(c=>c.health)).toEqual(before.characters.map(c=>c.health!-5));
 f.clock.advance(10000);expect(f.game().state.currentRound).toBe(6);expect(f.view().movement).toBe(null);
 expect(f.manager.transportView(f.code)!.cases.at(-1)!.phase).toBe("sector-evacuated");
});

test("live intermediate movement with invalid randomness is atomic and permanently blocks rerolls",()=>{
 const f=setup();f.toThree();f.action(4,"advance");f.action(4,"open");const before=f.manager.suppliesView(f.code)!;
 f.random.mockReturnValue(NaN);f.vote("cracked-stairs");
 expect(f.view()).toMatchObject({phase:"movement",blocked:"invalid-random",movement:null});
 expect(f.manager.suppliesView(f.code)!.characters).toEqual(before.characters);
 const calls=f.random.mock.calls.length;f.random.mockReturnValue(.99);expect(f.action(4,"retry").ok).toBe(false);expect(f.random).toHaveBeenCalledTimes(calls);
});

test("new rounds reject treatments and packs outside authorized preparation windows",()=>{
 const f=setup();f.toThree();f.action(4,"advance");const supplies=f.manager.suppliesView(f.code)!;
 const treatment={requestId:"closed",gameId:supplies.gameId,round:4 as const,targetParticipantId:f.sessions[0]!.credential.participantId};
 f.action(4,"open");
 expect(f.manager.treat(f.role("medic"),treatment)).toMatchObject({ok:false,error:"supplies-not-open"});
 expect(f.manager.givePack(f.role("bellhop"),{requestId:"closed-pack",windowId:supplies.windowId!,targetParticipantId:f.sessions[0]!.credential.participantId})).toMatchObject({ok:false,error:"supplies-not-open"});
 expect(f.manager.suppliesView(f.code)!.inventory).toEqual(supplies.inventory);
});

test("intermediate result snapshots stay stable after later packs and treatment",()=>{
 const f=setup();f.toThree();f.middle(4,"cracked-stairs");const snapshot=structuredClone(f.view().movement);
 f.pack(0);f.manager.treat(f.role("medic"),{requestId:"after-move",gameId:f.manager.suppliesView(f.code)!.gameId,round:4,targetParticipantId:f.sessions[0]!.credential.participantId});
 expect(f.view().movement).toEqual(snapshot);expect(f.manager.suppliesView(f.code)!.characters).not.toEqual(snapshot!.characters);
});

test("earthquake killing every active human terminates without a forced movement or RNG roll",()=>{
 const f=setup();f.toThree();f.action(4,"advance");f.action(4,"open");
 f.game().state={...f.game().state,characters:f.game().state.characters.map(c=>({...c,health:10}))};
 const calls=f.random.mock.calls.length;f.clock.advance(60000);expect(f.manager.finalResult(f.code)).toBe(null);f.clock.advance(30000);
 expect(f.manager.finalResult(f.code)).toMatchObject({kind:"no-active-humans",round:4,counts:{dead:4}});
 expect(f.view().movement).toBe(null);expect(f.random).toHaveBeenCalledTimes(calls);expect(f.game().state.intermediateConsequences).toHaveLength(1);
});

test("earthquake recalculates dead carriers and safely blocks the mandatory route until packs are given",()=>{
 const f=setup();f.toThree();f.action(4,"advance");
 f.game().state={...f.game().state,characters:f.game().state.characters.map(c=>c.role==="maintenance"||c.role==="architect-engineer"?{...c,health:10,energy:100}:{...c,health:100,energy:5})};
 expect(f.action(4,"open").ok).toBe(true);const calls=f.random.mock.calls.length;f.clock.advance(60000);f.clock.advance(30000);
 expect(f.view()).toMatchObject({phase:"movement",blocked:"route-energy-insufficient",movement:null});
 expect(f.random).toHaveBeenCalledTimes(calls);
 const medic=f.role("medic");const bellhop=f.role("bellhop");
 for(const socket of [medic,bellhop])expect(f.pack(f.sockets.indexOf(socket)).ok).toBe(true);
 expect(f.action(4,"retry",medic).ok).toBe(true);expect(f.view().phase).toBe("completed");
 expect(f.game().state.characters.filter(c=>c.health>0).map(c=>[c.health,c.energy])).toEqual([[90,20],[90,20]]);
 expect(f.game().state.intermediateConsequences).toHaveLength(1);
});

test.each([4,5] as const)("explosion in round %i continues with no movement charges or rewards",round=>{
 const f=setup();f.toThree();if(round===5)f.middle(4,'cracked-stairs');f.action(round,'advance');
 f.game().state={...f.game().state,characters:f.game().state.characters.map((c,i)=>({...c,energy:i===0?0:i===3?10:100}))};
 f.action(round,'open');f.vote(round===4?'cracked-stairs':'collapsed-kitchen');
 const before=f.game().state;const t=f.manager.transportView(f.code)!.cases.at(-1)!;f.manager.openTransport('s1',{preparationId:t.preparationId});
 f.clock.advance(60000);f.clock.advance(30000);f.clock.advance(10000);
 expect(f.game().state.currentRound).toBe(round+1);expect(f.game().state.characters.map(c=>c.energy)).toEqual(before.characters.map(c=>c.energy));
 expect(f.game().state.characters.map(c=>c.health)).toEqual(before.characters.map(c=>c.health-10));expect(f.game().state.characters[0]!.eliminated).toBe(true);expect(f.game().state.characters[3]!.eliminated).not.toBe(true);
 expect(f.game().state.inventory).toEqual(before.inventory);expect(f.game().state.tools).toEqual(before.tools);expect(f.manager.intermediateSession('s1')!.find(v=>v.round===round)!.phase).toBe('sector-evacuated');
 if(round===5){const v=f.manager.publicVote(f.code)!;for(const i of [1,2])expect(f.manager.vote('s'+i,{decisionId:v.decisionId,attemptId:v.attemptId,optionId:'abandon'}).ok).toBe(true);}
 expect((round===4?f.action(5,'open','s1'):f.manager.roundFourAction('s1','open')).ok).toBe(true);
});
test.each([false,true])("final explosion attempts the same exit with pending NPC effort, invalid randomness=%s",invalid=>{
 const f=setup();f.toThree();f.middle(4,'cracked-stairs');f.middle(5,'collapsed-kitchen');
 f.random.mockReturnValue(.6);expect(f.manager.roundFourAction('s0','advance').ok).toBe(true);f.vote('assist');
 f.game().state={...f.game().state,characters:f.game().state.characters.map((c,i)=>({...c,health:100,energy:[30,70,70,45][i]!}))};
 expect(f.manager.roundFourAction('s0','open').ok).toBe(true);f.vote('revolving-door');const t=f.manager.transportView(f.code)!.cases.at(-1)!;
 expect(t.exhaustedIds).toEqual([f.sessions[0]!.credential.participantId]);f.manager.openTransport('s1',{preparationId:t.preparationId});
 f.random.mockReturnValue(invalid?NaN:0);f.clock.advance(60000);f.clock.advance(30000);f.clock.advance(10000);
 const view=f.manager.roundFourView(f.code)!;expect(view.selection!.outcome).toBe('revolving-door');expect(f.game().state.characters[0]!.eliminated).toBe(true);
 if(invalid){expect(view.npc.status).toBe('awaiting-effort');expect(view.movement).toBeNull();expect(f.game().state.characters.map(c=>c.energy)).toEqual([30,70,70,45]);expect(f.manager.finalResult(f.code)).toBeNull();}
 else{expect(view.npc.status).toBe('rescued');expect(view.movement).toMatchObject({routeId:'revolving-door',accident:true,energyCost:20,rescuedNpc:true});expect(f.game().state.characters.map(c=>c.energy)).toEqual([30,25,25,0]);expect(f.game().state.characters.map(c=>c.health)).toEqual([90,85,85,85]);expect(f.manager.finalResult(f.code)!.counts.evacuated).toBe(3);}
 const snapshot=JSON.stringify(f.game().state);f.clock.advance(100000);expect(JSON.stringify(f.game().state)).toBe(snapshot);
});
