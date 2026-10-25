import { expect, test, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, RoomSession, IntermediateRoundView } from "@everest/shared";
import { buildApp } from "../app.js";
import { RoomManager } from "./manager.js";
import type { VotingClock } from "./voting.js";

class Clock implements VotingClock {
  time=1000; tasks=new Set<{at:number;fn:()=>void}>(); now=()=>this.time;
  schedule=(fn:()=>void,delay:number)=>{const t={at:this.time+delay,fn};this.tasks.add(t);return()=>{this.tasks.delete(t);};};
  advance(ms:number){this.time+=ms;for(const t of [...this.tasks])if(t.at<=this.time){this.tasks.delete(t);t.fn();}}
}
type Client=Socket<ServerToClientEvents,ClientToServerEvents>;
test.each([4,5] as const)("round %s: four sockets see one earthquake, usual accident and private damage, including F5",async round=>{
 const clock=new Clock();const random=vi.fn(()=>.99);const manager=new RoomManager(()=>0,clock,random);const app=buildApp({roomManager:manager});const all:Client[]=[];
 try{
  await app.listen({host:"127.0.0.1",port:0});const address=app.server.address();if(!address||typeof address==="string")throw new Error("port");
  const connect=async()=>{const c:Client=io(`http://127.0.0.1:${address.port}`,{autoConnect:false,reconnection:false});all.push(c);await new Promise<void>((resolve,reject)=>{c.once("connect",resolve);c.once("connect_error",reject);c.connect();});return c;};
  const clients=await Promise.all([connect(),connect(),connect(),connect()]);const sessions:RoomSession[]=[];
  const first=await clients[0]!.timeout(3000).emitWithAck("room:create",{name:"Host"});if(!first.ok)throw new Error(first.error);sessions.push(first.value);const code=first.value.room.code;
  for(let i=1;i<4;i++){const joined=await clients[i]!.timeout(3000).emitWithAck("room:join",{name:`Person ${i}`,code});if(!joined.ok)throw new Error(joined.error);sessions.push(joined.value);}
  expect((await clients[0]!.timeout(3000).emitWithAck("room:start")).ok).toBe(true);
  const vote=async(optionId:string)=>{const v=manager.publicVote(code)!;for(const i of [0,1,2])expect((await clients[i]!.timeout(3000).emitWithAck("vote:cast",{decisionId:v.decisionId,attemptId:v.attemptId,optionId})).ok).toBe(true);};
  await vote("abandon");await clients[0]!.timeout(3000).emitWithAck("round:advance");await clients[0]!.timeout(3000).emitWithAck("route:open");await vote("unstable-corridor");await vote("abandon");
  await clients[0]!.timeout(3000).emitWithAck("transport:open",{preparationId:manager.transportView(code)!.cases.at(-1)!.preparationId});
  await clients[0]!.timeout(3000).emitWithAck("round-three:advance");await clients[0]!.timeout(3000).emitWithAck("round-three:open");await vote("pipe-gallery");
  await clients[0]!.timeout(3000).emitWithAck("intermediate:action",{round:4,action:"advance"});
  if(round===5){await clients[0]!.timeout(3000).emitWithAck("intermediate:action",{round:4,action:"open"});await vote("cracked-stairs");await clients[0]!.timeout(3000).emitWithAck("intermediate:action",{round:5,action:"advance"});}
  const received:IntermediateRoundView[][]=clients.map(()=>[]);
  clients.forEach((c,i)=>c.on("intermediate:updated",stages=>{received[i]!.push(stages.at(-1)!);}));
  const before=manager.suppliesView(code)!;
  expect((await clients[0]!.timeout(3000).emitWithAck("intermediate:action",{round,action:"open"})).ok).toBe(true);
  clock.advance(60000);
  await vi.waitFor(()=>expect(received.every(a=>a.at(-1)?.vote?.attemptNumber===2)).toBe(true));
  expect(manager.suppliesView(code)!.characters).toEqual(before.characters);
  expect(received.every(a=>a.at(-1)!.failedAttempts?.length===1&&!a.at(-1)!.consequence)).toBe(true);
  const deadline=manager.publicVote(code)!.deadline;
  const old=clients[0]!.id!;clients[0]!.disconnect();await vi.waitFor(()=>expect(manager.privateRole(old)).toBe(null));
  const restored=await connect();clients[0]=restored;restored.on("intermediate:updated",stages=>received[0]!.push(stages.at(-1)!));
  expect((await restored.timeout(3000).emitWithAck("room:resume",sessions[0]!.credential)).ok).toBe(true);
  expect(manager.publicVote(code)!.deadline).toBe(deadline);
  random.mockReturnValue(0);const calls=random.mock.calls.length;clock.advance(30000);
  await vi.waitFor(()=>expect(received.every(a=>a.at(-1)?.phase==="completed")).toBe(true));
  expect(random).toHaveBeenCalledTimes(calls+4);
  const route=round===4?"cracked-stairs":"collapsed-kitchen";
  const after=manager.suppliesView(code)!;
  expect(after.characters.map(c=>c.energy)).toEqual(before.characters.map(c=>c.energy!-10));
  expect(after.characters.map(c=>c.health)).toEqual(round===4?[50,50,50,70]:[40,40,40,70]);
  for(let i=0;i<4;i++){
   const stage=received[i]!.at(-1)!;
   expect(stage.failedAttempts).toHaveLength(2);expect(stage.consequence!.forcedRouteId).toBe(route);expect(stage.movement!.routeId).toBe(route);
   for(const victim of stage.consequence!.victims)expect(victim.damage).toBe(victim.participantId===sessions[i]!.credential.participantId?10:undefined);
   stage.movement!.characters.forEach((c,j)=>{expect(c.energy!==undefined).toBe(i===j);expect(c.health!==undefined).toBe(i===j||manager.privateRole(clients[i]!.id!)?.role==="medic");});
   expect(JSON.stringify(stage)).not.toMatch(/accidentProbability/);
   if(manager.privateRole(clients[i]!.id!)?.role!=="maintenance")expect(JSON.stringify(stage)).not.toMatch(/technical-stairs|extraction-gallery/);
  }
  const snapshot=structuredClone(after);const randomCalls=random.mock.calls.length;
  clock.advance(90000);for(const c of clients)manager.votingSession(c.id!);
  expect(manager.suppliesView(code)).toEqual(snapshot);expect(random).toHaveBeenCalledTimes(randomCalls);
  const oldAgain=restored.id!;restored.disconnect();await vi.waitFor(()=>expect(manager.privateRole(oldAgain)).toBe(null));
  const final=await connect();const recovered=vi.fn();final.on("intermediate:updated",recovered);
  expect((await final.timeout(3000).emitWithAck("room:resume",sessions[0]!.credential)).ok).toBe(true);
  await vi.waitFor(()=>expect(recovered).toHaveBeenCalledTimes(1));
  expect(recovered.mock.lastCall![0].at(-1).consequence).toEqual(received[0]!.at(-1)!.consequence);
  expect(manager.suppliesView(code)).toEqual(snapshot);expect(random).toHaveBeenCalledTimes(randomCalls);
 }finally{all.forEach(c=>c.disconnect());manager.dispose();await app.close();}
},15000);
