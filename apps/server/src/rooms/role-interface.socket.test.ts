import type { VotingClock } from "./voting.js";
class Clock implements VotingClock { time=1000;tasks=new Set<{at:number;fn:()=>void}>();now=()=>this.time;schedule=(fn:()=>void,ms:number)=>{const t={at:this.time+ms,fn};this.tasks.add(t);return()=>{this.tasks.delete(t);};};advance(ms:number){this.time+=ms;for(const t of [...this.tasks])if(t.at<=this.time){this.tasks.delete(t);t.fn();}} }
import { expect, test, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, RoomSession, SuppliesView, RoundTwoView, RoundThreeView, RoundFourView, IntermediateRoundView } from "@everest/shared";
import { buildApp } from "../app.js";
import { RoomManager } from "./manager.js";
type Client=Socket<ServerToClientEvents,ClientToServerEvents>;

test("10D four real sessions: public roles, direct resources, private risk in all route rounds and F5",async()=>{
 const clock=new Clock();const random=vi.fn(()=>.99);const manager=new RoomManager(()=>0,clock,random);const app=buildApp({roomManager:manager});const all:Client[]=[];
 try{
  await app.listen({host:"127.0.0.1",port:0});const address=app.server.address();if(!address||typeof address==="string")throw new Error("port");
  const connect=async()=>{const c:Client=io(`http://127.0.0.1:${address.port}`,{autoConnect:false,reconnection:false});all.push(c);await new Promise<void>((resolve,reject)=>{c.once("connect",resolve);c.once("connect_error",reject);c.connect();});return c;};
  const clients=await Promise.all([connect(),connect(),connect(),connect()]);const sessions:RoomSession[]=[];
  const supplies:(SuppliesView|null)[]=clients.map(()=>null);const two:(RoundTwoView|null)[]=clients.map(()=>null);const three:(RoundThreeView|null)[]=clients.map(()=>null);const six:(RoundFourView|null)[]=clients.map(()=>null);const middle:IntermediateRoundView[][]=clients.map(()=>[]);
  const attach=(c:Client,i:number)=>{c.on("supplies:updated",v=>{supplies[i]=v;});c.on("round-two:updated",v=>{two[i]=v;});c.on("round-three:updated",v=>{three[i]=v;});c.on("intermediate:updated",v=>{middle[i]=v;});c.on("round-six:updated",v=>{six[i]=v;});};clients.forEach(attach);
  const created=await clients[0]!.timeout(3000).emitWithAck("room:create",{name:"Host"});if(!created.ok)throw new Error(created.error);sessions.push(created.value);const code=created.value.room.code;
  for(let i=1;i<4;i++){const joined=await clients[i]!.timeout(3000).emitWithAck("room:join",{name:`Person ${i}`,code});if(!joined.ok)throw new Error(joined.error);sessions.push(joined.value);}
  await clients[0]!.timeout(3000).emitWithAck("room:start");await vi.waitFor(()=>expect(supplies.every(Boolean)).toBe(true));
  const role=(name:string)=>clients.find(c=>manager.privateRole(c.id!)?.role===name)!;
  const index=(name:string)=>clients.indexOf(role(name));
  const checkPrivacy=()=>{
   for(let i=0;i<4;i++){
    expect(new Set(supplies[i]!.characters.map(c=>c.role)).size).toBe(4);
    supplies[i]!.characters.forEach((c,j)=>{expect(c.energy!==undefined).toBe(i===j);expect(c.health!==undefined).toBe(i===j||clients[i]===role("medic"));});
    const actions=supplies[i]!.resourceActions;
    expect(actions!==undefined).toBe(clients[i]===role("medic")||clients[i]===role("bellhop"));
    expect(JSON.stringify(supplies[i])).not.toMatch(/objective|knowledge|sheet|accidentProbability|realRisk/);
   }
  };
  const vote=async(optionId:string)=>{const v=manager.publicVote(code)!;for(const i of [0,1,2])expect((await clients[i]!.timeout(3000).emitWithAck("vote:cast",{decisionId:v.decisionId,attemptId:v.attemptId,optionId})).ok).toBe(true);};
  checkPrivacy();await vote("abandon");
  const architectIndex=index("architect-engineer");const architectId=sessions[architectIndex]!.credential.participantId;
  const packRequest={requestId:"direct-card",windowId:manager.suppliesView(code)!.windowId!,targetParticipantId:architectId};
  const before=manager.suppliesView(code)!;
  expect((await role("medic").timeout(3000).emitWithAck("pack:give",packRequest)).ok).toBe(false);
  const replies=await Promise.all([role("bellhop").timeout(3000).emitWithAck("pack:give",packRequest),role("bellhop").timeout(3000).emitWithAck("pack:give",packRequest)]);expect(replies.every(r=>r.ok)).toBe(true);
  expect(manager.suppliesView(code)!.inventory.packs).toBe(7);expect(manager.suppliesView(code)!.characters[architectIndex]!.energy).toBe(100);
  expect(manager.suppliesView(code)!.characters.filter((_,i)=>i!==architectIndex)).toEqual(before.characters.filter((_,i)=>i!==architectIndex));
  await vi.waitFor(()=>expect(supplies.every(s=>s?.inventory.packs===7)).toBe(true));checkPrivacy();
  const bellhopState=supplies[index("bellhop")]!;expect(bellhopState.resourceActions!.find(a=>a.participantId===architectId)!.packEligibility).toEqual({allowed:false,reason:"energy-full"});
  expect(bellhopState.characters[architectIndex]!.energy).toBeUndefined();
  await clients[0]!.timeout(3000).emitWithAck("round:advance");await vi.waitFor(()=>expect(two.every(Boolean)).toBe(true));
  for(let i=0;i<4;i++){
   expect(two[i]!.routeChoice!.options).toHaveLength(2);if(clients[i]!==role("maintenance"))expect(JSON.stringify(two[i])).not.toContain('"id":"ventilation"');
   expect(two[i]!.routeChoice!.privateRoute!==undefined).toBe(clients[i]===role("maintenance"));
   expect(two[i]!.routeChoice!.options.every(o=>o.danger===undefined)).toBe(true);expect(JSON.stringify(two[i])).not.toMatch(/accidentProbability|0\.55|0\.35/);
  }
  await role("maintenance").timeout(3000).emitWithAck("route:reveal");await vi.waitFor(()=>expect(two.every(s=>s!.routeChoice!.options.length===3)).toBe(true));
  expect(two[architectIndex]!.routeChoice!.options.find(o=>o.id==="ventilation")!.danger).toBeUndefined();expect(two[index("maintenance")]!.routeChoice!.options.find(o=>o.id==="ventilation")!.danger).toBeUndefined();
  // Recover a non-host session before the route vote and retain public roles and private risk.
  const old=clients[architectIndex]!.id!;clients[architectIndex]!.disconnect();await vi.waitFor(()=>expect(manager.privateRole(old)).toBe(null));
  const restored=await connect();clients[architectIndex]=restored;attach(restored,architectIndex);
  expect((await restored.timeout(3000).emitWithAck("room:resume",sessions[architectIndex]!.credential)).ok).toBe(true);
  await vi.waitFor(()=>expect(two[architectIndex]!.routeChoice!.options.find(o=>o.id==="ventilation")!.danger).toBeUndefined());
  await clients[0]!.timeout(3000).emitWithAck("route:open");
  await vi.waitFor(()=>expect(two[architectIndex]!.routeChoice!.options.find(o=>o.id==="ventilation")!.danger).toBe("LOW"));
  for(let i=0;i<4;i++)if(i!==architectIndex)expect(two[i]!.routeChoice!.options.every(o=>o.danger===undefined)).toBe(true);
  clock.advance(60000);await vi.waitFor(()=>expect(two[architectIndex]!.routeChoice!.vote!.attemptNumber).toBe(2));
  expect(two[architectIndex]!.routeChoice!.options.find(o=>o.id==="ventilation")!.danger).toBe("LOW");
  const deadline=manager.publicVote(code)!.deadline;const oldVotingClient=clients[architectIndex]!.id!;clients[architectIndex]!.disconnect();await vi.waitFor(()=>expect(manager.privateRole(oldVotingClient)).toBeNull());
  clients[architectIndex]=await connect();attach(clients[architectIndex]!,architectIndex);expect((await clients[architectIndex]!.timeout(3000).emitWithAck("room:resume",sessions[architectIndex]!.credential)).ok).toBe(true);
  await vi.waitFor(()=>expect(two[architectIndex]!.routeChoice!.vote!.deadline).toBe(deadline));expect(two[architectIndex]!.routeChoice!.options.find(o=>o.id==="ventilation")!.danger).toBe("LOW");
  await vote("ventilation");await vote("abandon");
  random.mockReturnValue(0);await clients[0]!.timeout(3000).emitWithAck("transport:open",{preparationId:manager.transportView(code)!.cases.at(-1)!.preparationId});random.mockReturnValue(.99);
  const injured=manager.suppliesView(code)!.characters.find(c=>c.health!<100)!;
  const medical={requestId:"direct-patient",gameId:manager.suppliesView(code)!.gameId,round:2 as const,targetParticipantId:injured.participantId};
  const stock=manager.suppliesView(code)!.inventory.medicalUnits;
  expect((await role("bellhop").timeout(3000).emitWithAck("medical:treat",medical)).ok).toBe(false);
  for(let i=0;i<2;i++)expect((await role("medic").timeout(3000).emitWithAck("medical:treat",medical)).ok).toBe(true);
  expect(manager.suppliesView(code)!.inventory.medicalUnits).toBe(stock-1);
  expect(manager.suppliesView(code)!.characters.find(c=>c.participantId===injured.participantId)!.health).toBe(100);
  expect((await role("medic").timeout(3000).emitWithAck("medical:treat",{...medical,requestId:"another-treatment"})).ok).toBe(false);
  await clients[0]!.timeout(3000).emitWithAck("round-three:advance");await vi.waitFor(()=>expect(three.every(Boolean)).toBe(true));
  for(let i=0;i<4;i++){expect(three[i]!.options.every(o=>o.danger===undefined)).toBe(true);expect(JSON.stringify(three[i]!.options)).not.toMatch(/almacén|conference|medical-conference|gained|accidentProbability|reward/);}
  expect(manager.activityView(code)!.tools.crowbar).toBe("available");
  await clients[0]!.timeout(3000).emitWithAck("round-three:open");await vi.waitFor(()=>expect(three[architectIndex]!.options.every(o=>o.danger!==undefined)).toBe(true));expect(two[architectIndex]!.routeChoice!.options.find(o=>o.id==="ventilation")!.danger).toBe("LOW");expect(manager.activityView(code)!.tools.crowbar).toBe("available");await vote("fire-door");
  expect(manager.activityView(code)!.tools.crowbar).toBe("lost");expect(manager.suppliesView(code)!.inventory.medicalUnits).toBe(stock+1);
  for(const round of [4,5] as const){
   await clients[0]!.timeout(3000).emitWithAck("intermediate:action",{round,action:"advance"});await role("maintenance").timeout(3000).emitWithAck("intermediate:action",{round,action:"reveal"});
   await vi.waitFor(()=>expect(middle.every(s=>s.at(-1)?.round===round&&s.at(-1)!.options.length===3)).toBe(true));
   for(let i=0;i<4;i++)expect(middle[i]!.at(-1)!.options.every(o=>o.danger===undefined)).toBe(true);
   const recipients=round===4?sessions.filter((_,i)=>i!==architectIndex):sessions;
   for(const patient of recipients)expect((await role("bellhop").timeout(3000).emitWithAck("pack:give",{requestId:crypto.randomUUID(),windowId:manager.suppliesView(code)!.windowId!,targetParticipantId:patient.credential.participantId})).ok).toBe(true);
   await clients[0]!.timeout(3000).emitWithAck("intermediate:action",{round,action:"open"});await vi.waitFor(()=>expect(middle[architectIndex]!.at(-1)!.options.every(o=>o.danger!==undefined)).toBe(true));await vote(round===4?"technical-stairs":"extraction-gallery");
  }
  random.mockReturnValue(0);await clients[0]!.timeout(3000).emitWithAck("round-six:advance");random.mockReturnValue(.99);await vi.waitFor(()=>expect(six.every(Boolean)).toBe(true));
  for(let i=0;i<4;i++)expect(six[i]!.options.every(o=>o.danger===undefined)).toBe(true);
  expect(manager.roundFourView(code)!.npc.encounter).toBe("none");
  await clients[0]!.timeout(3000).emitWithAck("round-six:open");await vi.waitFor(()=>expect(six[architectIndex]!.options.every(o=>o.danger!==undefined)).toBe(true));await vote("exterior-crack");expect(manager.finalResult(code)!.counts.evacuated).toBe(4);
 }finally{all.forEach(c=>c.disconnect());manager.dispose();await app.close();}
},15000);
