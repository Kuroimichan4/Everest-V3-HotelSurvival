import {expect,test,vi} from 'vitest';
import {io,type Socket} from 'socket.io-client';
import type {ClientToServerEvents,ServerToClientEvents,RoomSession,PrivateMedicalSabotage} from '@everest/shared';
import {buildApp} from '../app.js';
import {RoomManager} from './manager.js';
import type {SimulationState} from '../simulation/state.js';
type Client=Socket<ServerToClientEvents,ClientToServerEvents>;
test('four real clients: secret manipulation, F5, one roll, public uncertain death and six-round evacuation',async()=>{
 const poison=vi.fn(()=>0);const route=vi.fn(()=>.99);const manager=new RoomManager(()=>0,undefined,route,poison,()=>0);const app=buildApp({roomManager:manager});const all:Client[]=[];
 try{
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('port');
 const connect=async()=>{const c:Client=io('http://127.0.0.1:'+address.port,{autoConnect:false,reconnection:false});all.push(c);await new Promise<void>((resolve,reject)=>{c.once('connect',resolve);c.once('connect_error',reject);c.connect();});return c;};
 const clients=await Promise.all([connect(),connect(),connect(),connect()]);const secrets:PrivateMedicalSabotage[][]=clients.map(()=>[]);const outgoing:unknown[][]=clients.map(()=>[]);
 const attach=(c:Client,i:number)=>{c.on('medical:sabotage-private',v=>secrets[i]!.push(v));c.onAny((event,...args)=>{if(event!=='medical:sabotage-private'&&i!==2)outgoing[i]!.push([event,args]);});};clients.forEach(attach);
 const sessions:RoomSession[]=[];const first=await clients[0]!.timeout(3000).emitWithAck('room:create',{name:'Host'});if(!first.ok)throw new Error(first.error);sessions.push(first.value);const code=first.value.room.code;
 for(let i=1;i<4;i++){const r=await clients[i]!.timeout(3000).emitWithAck('room:join',{name:'Person '+i,code});if(!r.ok)throw new Error(r.error);sessions.push(r.value);}await clients[0]!.timeout(3000).emitWithAck('room:start');
 const game=(manager as unknown as {rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;game.state={...game.state,characters:game.state.characters.map(c=>({...c,health:60}))};const gameId=manager.suppliesView(code)!.gameId;
 const input={gameId,requestId:'secret'};for(const i of [0,1,3])expect((await clients[i]!.timeout(3000).emitWithAck('medical:sabotage',input)).ok).toBe(false);
 const before=manager.suppliesView(code)!;expect((await clients[2]!.timeout(3000).emitWithAck('medical:sabotage',input)).ok).toBe(true);expect(manager.suppliesView(code)).toEqual(before);
 const old=clients[2]!.id!;clients[2]!.disconnect();await vi.waitFor(()=>expect(manager.privateRole(old)).toBeNull());clients[2]=await connect();attach(clients[2]!,2);expect((await clients[2]!.timeout(3000).emitWithAck('room:resume',sessions[2]!.credential)).ok).toBe(true);await vi.waitFor(()=>expect(secrets[2]!.at(-1)!.performed).toBe(true));expect((await clients[2]!.timeout(3000).emitWithAck('medical:sabotage',{...input,requestId:'again'})).ok).toBe(false);
 const other=manager.create('other0','Other');if(!other.ok)throw new Error(other.error);for(let i=1;i<4;i++)manager.join('other'+i,'Other '+i,other.value.room.code);manager.start('other0');const otherBefore=JSON.stringify(manager.medicalView(other.value.room.code));
 const tx={requestId:'tx',gameId,round:1 as const,targetParticipantId:sessions[1]!.credential.participantId};const replies=await Promise.all([clients[0]!.timeout(3000).emitWithAck('medical:treat',tx),clients[0]!.timeout(3000).emitWithAck('medical:treat',tx)]);expect(replies.every(r=>r.ok)).toBe(true);expect(poison).toHaveBeenCalledTimes(1);expect(game.state.inventory.medicalUnits).toBe(3);expect(game.state.characters[1]!.health).toBe(0);await vi.waitFor(()=>expect(secrets[2]!.at(-1)!.objectiveFulfilled).toBe(true));expect(JSON.stringify(manager.medicalView(other.value.room.code))).toBe(otherBefore);
 const vote=async(optionId:string)=>{const v=manager.publicVote(code)!;for(const i of [0,2])expect((await clients[i]!.timeout(3000).emitWithAck('vote:cast',{decisionId:v.decisionId,attemptId:v.attemptId,optionId})).ok).toBe(true);};
 await vote('abandon');expect((await clients[0]!.timeout(3000).emitWithAck('round:advance')).ok).toBe(true);expect(manager.roundTwoView(code)!.routeChoice!.options.find(r=>r.id==='shoring')!.availability.status).toBe('unavailable');
 await clients[0]!.timeout(3000).emitWithAck('route:open');await vote('unstable-corridor');await vote('abandon');await clients[0]!.timeout(3000).emitWithAck('transport:open',{preparationId:manager.transportView(code)!.cases.at(-1)!.preparationId});
 await clients[0]!.timeout(3000).emitWithAck('round-three:advance');await clients[0]!.timeout(3000).emitWithAck('round-three:open');await vote('pipe-gallery');
 for(const round of [4,5] as const){expect((await clients[0]!.timeout(3000).emitWithAck('intermediate:action',{round,action:'advance'})).ok).toBe(true);await clients[0]!.timeout(3000).emitWithAck('intermediate:action',{round,action:'open'});await vote(round===4?'cracked-stairs':'collapsed-kitchen');}
 expect((await clients[0]!.timeout(3000).emitWithAck('round-six:advance')).ok).toBe(true);await vote('abandon');await clients[0]!.timeout(3000).emitWithAck('round-six:open');await vote('exterior-crack');
 const final=manager.finalResult(code)!;expect(final.counts).toMatchObject({evacuated:3,dead:1});expect(manager.objectiveSession(clients[2]!.id!)!.evaluation).toBe('fulfilled');expect(manager.objectiveSession(clients[0]!.id!)!.evaluation).toBe('unfulfilled');expect(poison).toHaveBeenCalledTimes(1);
 for(const i of [0,1,3]){expect(secrets[i]).toEqual([]);expect(JSON.stringify(outgoing[i])).not.toMatch(/medicalSabotage|sabot|poison|venen|objectiveFulfilled|actorId|uses|"victimId"/i);}expect(JSON.stringify(final)).not.toMatch(/sabot|poison|venen/i);
 }finally{all.forEach(c=>c.disconnect());manager.dispose();await app.close();}
},15000);
test.each(['three-active','only-bellhop','last-human'] as const)('poisoned host succession %s: one draw, four synchronized clients and F5',async scenario=>{
 let handoff=false;const choose=vi.fn((max:number)=>handoff?max-1:0);const poison=vi.fn(()=>0);const manager=new RoomManager(choose,undefined,()=>.99,poison,()=>0);const app=buildApp({roomManager:manager});const all:Client[]=[];
 try{
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('port');
 const connect=async()=>{const c:Client=io('http://127.0.0.1:'+address.port,{autoConnect:false,reconnection:false});all.push(c);await new Promise<void>((resolve,reject)=>{c.once('connect',resolve);c.once('connect_error',reject);c.connect();});return c;};
 const clients=await Promise.all([connect(),connect(),connect(),connect()]);const latest:(Parameters<ServerToClientEvents['room:updated']>[0]|null)[]=clients.map(()=>null);const updates:Parameters<ServerToClientEvents['room:updated']>[0][][]=clients.map(()=>[]);const attach=(c:Client,i:number)=>c.on('room:updated',r=>{latest[i]=r;updates[i]!.push(r);});clients.forEach(attach);
 const sessions:RoomSession[]=[];const first=await clients[0]!.timeout(3000).emitWithAck('room:create',{name:'Host'});if(!first.ok)throw new Error(first.error);sessions.push(first.value);const code=first.value.room.code;
 for(let i=1;i<4;i++){const r=await clients[i]!.timeout(3000).emitWithAck('room:join',{name:'Person '+i,code});if(!r.ok)throw new Error(r.error);sessions.push(r.value);}await clients[0]!.timeout(3000).emitWithAck('room:start');
 const game=(manager as unknown as {rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;const roles=game.state.characters.map(c=>c.role);const gameId=manager.suppliesView(code)!.gameId;expect((await clients[2]!.timeout(3000).emitWithAck('medical:sabotage',{gameId,requestId:'s'})).ok).toBe(true);
 game.state={...game.state,characters:game.state.characters.map((c,i)=>({...c,health:scenario==='last-human'&&i!==0||scenario==='only-bellhop'&&i===1?0:60,...(scenario==='only-bellhop'&&i===3?{eliminated:true}:{})}))};
 handoff=true;choose.mockClear();const request={requestId:'self',gameId,round:1 as const,targetParticipantId:sessions[0]!.credential.participantId};expect((await clients[0]!.timeout(3000).emitWithAck('medical:treat',request)).ok).toBe(true);expect(game.state.characters[0]!.health).toBe(0);expect(poison).toHaveBeenCalledTimes(1);
 if(scenario==='last-human'){
  expect(choose).not.toHaveBeenCalled();expect(manager.finalResult(code)).toMatchObject({kind:'no-active-humans',counts:{dead:4,evacuated:0}});expect(manager.objectiveSession(clients[2]!.id!)!.evaluation).toBe('fulfilled');
 }else{
  const next=scenario==='three-active'?3:2;const newId=sessions[next]!.credential.participantId;
  await vi.waitFor(()=>expect(latest.every(r=>r?.creatorId===newId)).toBe(true));expect(choose).toHaveBeenCalledTimes(1);expect(choose).toHaveBeenCalledWith(scenario==='three-active'?3:1);for(const list of updates)expect(list.filter(r=>r.creatorId===newId)).toHaveLength(1);
  expect((await clients[0]!.timeout(3000).emitWithAck('round:advance')).ok).toBe(false);expect((await clients[0]!.timeout(3000).emitWithAck('medical:treat',request)).ok).toBe(false);expect(choose).toHaveBeenCalledTimes(1);expect(poison).toHaveBeenCalledTimes(1);
  const old=clients[next]!.id!;clients[next]!.disconnect();await vi.waitFor(()=>expect(manager.privateRole(old)).toBeNull());clients[next]=await connect();attach(clients[next]!,next);const resumed=await clients[next]!.timeout(3000).emitWithAck('room:resume',sessions[next]!.credential);expect(resumed).toMatchObject({ok:true,value:{room:{creatorId:newId}}});expect(game.state.characters.map(c=>c.role)).toEqual(roles);expect(manager.privateRole(clients[0]!.id!)).toBeNull();expect(choose).toHaveBeenCalledTimes(1);
  const v=manager.publicVote(code)!;const voters=scenario==='three-active'?[1,2]:[2];for(const i of voters)expect((await clients[i]!.timeout(3000).emitWithAck('vote:cast',{decisionId:v.decisionId,attemptId:v.attemptId,optionId:'abandon'})).ok).toBe(true);expect((await clients[next]!.timeout(3000).emitWithAck('round:advance')).ok).toBe(true);expect(choose).toHaveBeenCalledTimes(1);
 }
 }finally{all.forEach(c=>c.disconnect());manager.dispose();await app.close();}
},15000);