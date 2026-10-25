import { expect, test, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, RoomSession, IntermediateRoundView } from "@everest/shared";
import { buildApp } from "../app.js";
import { RoomManager } from "./manager.js";
import { bindGameSocket } from "../../../web/src/game-socket.js";
import { activeScene, emptyGame, gameReducer, type GameState } from "../../../web/src/game-state.js";
type Client=Socket<ServerToClientEvents,ClientToServerEvents>;

test.each(["minimum","prudent","two-rescues"] as const)("four real Socket.IO clients traverse six rounds: %s",async scenario=>{
 const random=vi.fn(()=>.99);const manager=new RoomManager(()=>0,undefined,random);const app=buildApp({roomManager:manager});
 const all:Client[]=[];const cleanups:(()=>void)[]=[];
 try{
  await app.listen({host:"127.0.0.1",port:0});const addr=app.server.address();if(!addr||typeof addr==="string")throw new Error("port");
  const connect=async()=>{const c:Client=io(`http://127.0.0.1:${addr.port}`,{autoConnect:false,reconnection:false});all.push(c);await new Promise<void>((resolve,reject)=>{c.once("connect",resolve);c.once("connect_error",reject);c.connect();});return c;};
  const clients=await Promise.all([connect(),connect(),connect(),connect()]);const sessions:RoomSession[]=[];
  const states:GameState[]=clients.map(()=>({...emptyGame}));const received:IntermediateRoundView[][][]=clients.map(()=>[]);
  const attach=(c:Client,i:number)=>{const off=bindGameSocket(c,event=>{states[i]=gameReducer(states[i]!,event);},{participantId:()=>sessions[i]?.credential.participantId,connect:()=>{},disconnect:()=>{},error:()=>{}});const listener=(v:IntermediateRoundView[])=>received[i]!.push(v);c.on("intermediate:updated",listener);const cleanup=()=>{off();c.off("intermediate:updated",listener);};cleanups.push(cleanup);return cleanup;};
  const unbind=clients.map(attach);
  const created=await clients[0]!.timeout(3000).emitWithAck("room:create",{name:"Host"});if(!created.ok)throw new Error(created.error);sessions.push(created.value);const code=created.value.room.code;
  for(let i=1;i<4;i++){const joined=await clients[i]!.timeout(3000).emitWithAck("room:join",{name:`Person ${i}`,code});if(!joined.ok)throw new Error(joined.error);sessions.push(joined.value);}
  expect((await clients[0]!.timeout(3000).emitWithAck("room:start")).ok).toBe(true);
  const outsider=await connect();const outsideUpdates=vi.fn();outsider.on("intermediate:updated",outsideUpdates);const other=await outsider.timeout(3000).emitWithAck("room:create",{name:"Other"});if(!other.ok)throw new Error(other.error);outsideUpdates.mockClear();
  const clientRole=(role:string)=>clients.find(c=>manager.privateRole(c.id!)?.role===role)!;
  const cast=async(i:number,id:string)=>{const v=manager.publicVote(code)!;return clients[i]!.timeout(3000).emitWithAck("vote:cast",{decisionId:v.decisionId,attemptId:v.attemptId,optionId:id});};
  const vote=async(id:string)=>{for(const i of [0,1,2])expect((await cast(i,id)).ok).toBe(true);};
  const packAll=async()=>{for(let i=0;i<4;i++)expect((await clientRole("bellhop").timeout(3000).emitWithAck("pack:give",{requestId:crypto.randomUUID(),windowId:manager.suppliesView(code)!.windowId!,targetParticipantId:sessions[i]!.credential.participantId})).ok).toBe(true);};
  const action=async(round:4|5,action:"advance"|"open"|"reveal"|"retry",client=clients[0]!)=>client.timeout(3000).emitWithAck("intermediate:action",{round,action});
  const rescue=scenario==="two-rescues";const prudent=scenario==="prudent";
  await vote(rescue?"rescue":"abandon");expect((await clients[0]!.timeout(3000).emitWithAck("round:advance")).ok).toBe(true);
  if(prudent)expect((await clientRole("maintenance").timeout(3000).emitWithAck("route:reveal")).ok).toBe(true);
  await clients[0]!.timeout(3000).emitWithAck("route:open");await vote(prudent?"ventilation":"unstable-corridor");await vote(rescue?"rescue":"abandon");
  await clients[0]!.timeout(3000).emitWithAck("transport:open",{preparationId:manager.transportView(code)!.cases.at(-1)!.preparationId});
  await clients[0]!.timeout(3000).emitWithAck("round-three:advance");if(rescue)await packAll();await clients[0]!.timeout(3000).emitWithAck("round-three:open");await vote(prudent?"metal-debris":"pipe-gallery");
  expect((await clients[0]!.timeout(3000).emitWithAck("round-six:advance")).ok).toBe(false);
  expect((await action(5,"advance")).ok).toBe(false);
  for(const round of [4,5] as const){
   expect((await action(round,"advance")).ok).toBe(true);
   const hidden=round===4?"technical-stairs":"extraction-gallery";
   await vi.waitFor(()=>expect(states.every(s=>activeScene(s).round===round)).toBe(true));
   for(let i=0;i<4;i++)expect(states[i]!.intermediates.at(-1)!.options.some(o=>o.id===hidden)).toBe(manager.privateRole(clients[i]!.id!)?.role==="maintenance");
   expect((await action(round,"reveal",clientRole("medic"))).ok).toBe(false);
   expect((await action(round,"reveal",clientRole("maintenance"))).ok).toBe(true);
   await vi.waitFor(()=>expect(states.every(s=>s.intermediates.at(-1)!.options.length===3)).toBe(true));
   if(prudent || (rescue&&round===5))await packAll();
   expect((await action(round,"open")).ok).toBe(true);
   const route=prudent?hidden:round===4?"cracked-stairs":"collapsed-kitchen";
   if(round===4){
    expect((await cast(0,route)).ok).toBe(true);const before=manager.publicVote(code)!;const resources=manager.suppliesView(code)!;
    const old=clients[0]!.id!;unbind[0]!();clients[0]!.disconnect();await vi.waitFor(()=>expect(manager.privateRole(old)).toBe(null));
    const c=await connect();clients[0]=c;states[0]={...emptyGame};unbind[0]=attach(c,0);
    expect((await c.timeout(3000).emitWithAck("room:resume",sessions[0]!.credential)).ok).toBe(true);
    await vi.waitFor(()=>expect(states[0]!.ownVote?.optionId).toBe(route));
    expect(activeScene(states[0]!).vote?.deadline).toBe(before.deadline);expect(states[0]!.intermediates.at(-1)!.options).toHaveLength(3);
    expect(manager.suppliesView(code)).toEqual(resources);
    expect((await cast(1,route)).ok).toBe(true);expect((await cast(2,route)).ok).toBe(true);
   }else await vote(route);
   await vi.waitFor(()=>expect(states.every(s=>s.intermediates.at(-1)!.phase==="completed")).toBe(true));
   expect(states.every(s=>s.final===null)).toBe(true);
   for(let i=0;i<4;i++){
    const chars=states[i]!.supplies!.characters;
    chars.forEach((c,j)=>{expect(c.energy!==undefined).toBe(i===j);expect(c.health!==undefined).toBe(i===j||manager.privateRole(clients[i]!.id!)?.role==="medic");});
    expect(JSON.stringify(received[i])).not.toMatch(/accidentProbability|tokenHash|initiallyUnknownToOthers/);
   }
  }
  if(prudent)await packAll();random.mockReturnValue(0);expect((await clients[0]!.timeout(3000).emitWithAck("round-six:advance")).ok).toBe(true);random.mockReturnValue(.99);
  expect(manager.roundFourView(code)!.round).toBe(6);await clients[0]!.timeout(3000).emitWithAck("round-six:open");await vote(prudent?"revolving-door":"exterior-crack");
  await vi.waitFor(()=>expect(states.every(s=>s.final?.kind==="evacuation-completed")).toBe(true));
  expect(new Set(states.map(s=>s.final!.id)).size).toBe(1);
  expect(states.every(s=>s.final!.round===6&&s.final!.counts.evacuated===4)).toBe(true);
  const final=manager.finalResult(code)!;expect(final.humans.every(h=>h.energy===(prudent?10:5))).toBe(true);
  if(rescue)expect(final.npcs.slice(0,2).every(n=>n.evacuated)).toBe(true);
  expect(states.every(s=>s.objective?.participantId===sessions[states.indexOf(s)]!.credential.participantId)).toBe(true);
  expect(manager.objectiveSession(clientRole("maintenance").id!)!.evaluation).toBe("fulfilled");
  expect(outsideUpdates).not.toHaveBeenCalled();expect(manager.suppliesView(other.value.room.code)).toBe(null);
  const calls=random.mock.calls.length;await clients[0]!.timeout(3000).emitWithAck("round-six:advance");expect(manager.finalResult(code)).toEqual(final);expect(random).toHaveBeenCalledTimes(calls);
 }finally{cleanups.forEach(f=>f());all.forEach(c=>c.disconnect());manager.dispose();await app.close();}
},20000);
