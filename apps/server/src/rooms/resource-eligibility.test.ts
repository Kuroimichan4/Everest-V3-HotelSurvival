import { expect, test } from "vitest";
import { RoomManager } from "./manager.js";
import type { SimulationState } from "../simulation/state.js";
function setup(){
 const manager=new RoomManager(()=>0,{now:()=>1000,schedule:()=>()=>{}},()=>.99);
 const created=manager.create("s0","P0");if(!created.ok)throw new Error(created.error);const sessions=[created.value];const code=created.value.room.code;
 for(let i=1;i<4;i++){const r=manager.join(`s${i}`,`P${i}`,code);if(!r.ok)throw new Error(r.error);sessions.push(r.value);}manager.start("s0");
 const game=(manager as unknown as{rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;
 const sockets=["s0","s1","s2","s3"];const role=(r:string)=>sockets.find(s=>manager.privateRole(s)?.role===r)!;
 const view=(socket:string)=>manager.sessionProjection(socket,manager.suppliesView(code)!);
 const complete=()=>{const v=manager.publicVote(code)!;for(const s of sockets.slice(0,3))manager.vote(s,{decisionId:v.decisionId,attemptId:v.attemptId,optionId:"abandon"});};
 return{manager,sessions,code,game,sockets,role,view,complete};
}
test.each(["maintenance","medic","architect-engineer","bellhop"])("resource eligibility for %s is authorized without private numeric data",r=>{
 const f=setup();try{f.complete();const socket=f.role(r);const view=f.view(socket);
 expect(view.characters.every(c=>!!c.role)).toBe(true);
 expect(view.resourceActions!==undefined).toBe(r==="medic"||r==="bellhop");
 for(const a of view.resourceActions??[]){expect(a.packEligibility!==undefined).toBe(r==="bellhop");expect(a.medicalEligibility!==undefined).toBe(r==="medic");}
 const self=f.sessions[f.sockets.indexOf(socket)]!.credential.participantId;
 for(const c of view.characters)if(c.participantId!==self){expect(c.energy).toBeUndefined();if(r!=="medic")expect(c.health).toBeUndefined();}
 }finally{f.manager.dispose();}
});
test("medical cards reject complete, dead and abandoned patients and enforce the round limit",()=>{
 const f=setup();try{f.complete();const medic=f.role("medic");
 f.game.state={...f.game.state,characters:f.game.state.characters.map(c=>c.role==="medic"?{...c,health:50}:c.role==="maintenance"?{...c,health:0}:c.role==="architect-engineer"?{...c,eliminated:true}:c)};
 const before=f.view(medic);const self=before.characters.find(c=>c.role==="medic")!.participantId;
 for(const c of before.characters){const eligible=before.resourceActions!.find(a=>a.participantId===c.participantId)!.medicalEligibility!;expect(eligible.allowed).toBe(c.role==="medic");}
 const input={requestId:"self-treatment",gameId:before.gameId,round:1 as const,targetParticipantId:self};expect(f.manager.treat(medic,input).ok).toBe(true);
 expect(f.view(medic).resourceActions!.find(a=>a.participantId===self)!.medicalEligibility).toEqual({allowed:false,reason:"treatment-used"});
 expect(f.manager.treat(medic,input).ok).toBe(true);expect(f.manager.medicalView(f.code)!.treatments).toHaveLength(1);
 expect(f.manager.treat(medic,{...input,requestId:"npc",targetParticipantId:"npc"}).ok).toBe(false);
 }finally{f.manager.dispose();}
});
test("packs show only authorized eligibility for full energy, depleted inventory and closed windows",()=>{
 const f=setup();try{const bellhop=f.role("bellhop");expect(f.view(bellhop).resourceActions!.every(a=>!a.packEligibility!.allowed)).toBe(true);
 f.complete();const target=f.game.state.characters.find(c=>c.role==="architect-engineer")!;
 f.game.state={...f.game.state,characters:f.game.state.characters.map(c=>c.id===target.id?{...c,energy:100}:c)};
 const view=f.view(bellhop);const person=view.characters.find(c=>c.role==="architect-engineer")!;
 expect(person.energy).toBeUndefined();expect(view.resourceActions!.find(a=>a.participantId===person.participantId)!.packEligibility).toEqual({allowed:false,reason:"energy-full"});
 const stock=f.manager.suppliesView(f.code)!.inventory.packs;
 expect(f.manager.givePack(bellhop,{requestId:"full",windowId:view.windowId!,targetParticipantId:person.participantId}).ok).toBe(false);expect(f.manager.suppliesView(f.code)!.inventory.packs).toBe(stock);
 f.game.state={...f.game.state,inventory:{packs:0,medicalUnits:0}};
 expect(f.view(bellhop).resourceActions!.every(a=>a.packEligibility!.reason==="no-packs")).toBe(true);
 expect(f.view(f.role("medic")).resourceActions!.every(a=>a.medicalEligibility!.reason==="no-medical-units")).toBe(true);
 }finally{f.manager.dispose();}
});
test("public exhausted and eliminated statuses do not expose an energy number",()=>{
 const f=setup();try{f.complete();f.game.state={...f.game.state,characters:f.game.state.characters.map(c=>c.role==="maintenance"?{...c,energy:0}:c.role==="architect-engineer"?{...c,eliminated:true}:c)};
 const view=f.view(f.role("bellhop"));expect(view.characters.find(c=>c.role==="maintenance")).toMatchObject({status:"exhausted"});expect(view.characters.find(c=>c.role==="maintenance")!.energy).toBeUndefined();
 expect(view.characters.find(c=>c.role==="architect-engineer")).toMatchObject({status:"abandoned"});
 }finally{f.manager.dispose();}
});
