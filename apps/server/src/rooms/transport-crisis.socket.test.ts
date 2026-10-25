
import { expect,test,vi } from 'vitest';
import { io,type Socket } from 'socket.io-client';
import type {ClientToServerEvents,ServerToClientEvents,RoomSession,TransportView,PublicRoom,SuppliesView} from '@everest/shared';
import {buildApp} from '../app.js';
import {RoomManager} from './manager.js';
import type {VotingClock} from './voting.js';
import type {SimulationState} from '../simulation/state.js';
type Client=Socket<ServerToClientEvents,ClientToServerEvents>;
class Clock implements VotingClock{
 time=1000;tasks=new Set<{at:number;run:()=>void}>();now=()=>this.time;
 schedule=(run:()=>void,delay:number)=>{const task={at:this.time+delay,run};this.tasks.add(task);return()=>{this.tasks.delete(task);};};
 advance(ms:number){this.time+=ms;for(const t of [...this.tasks])if(t.at<=this.time){this.tasks.delete(t);t.run();}}
}
test('four real sockets synchronize crisis, refresh all three attempts, protect privacy and transfer host',async()=>{
 const clock=new Clock();const random=vi.fn(()=>.99);const manager=new RoomManager(()=>0,clock,random);const app=buildApp({roomManager:manager});const all:Client[]=[];
 try{
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('port');
 const connect=async()=>{const c:Client=io('http://127.0.0.1:'+address.port,{autoConnect:false,reconnection:false});all.push(c);await new Promise<void>((resolve,reject)=>{c.once('connect',resolve);c.once('connect_error',reject);c.connect();});return c;};
 const clients=await Promise.all([connect(),connect(),connect(),connect()]);const sessions:RoomSession[]=[];
 const views:(TransportView|null)[]=clients.map(()=>null);const rooms:(PublicRoom|null)[]=clients.map(()=>null);const supplies:(SuppliesView|null)[]=clients.map(()=>null);
 const attach=(c:Client,i:number)=>{c.on('transport:updated',v=>{views[i]=v;});c.on('room:updated',v=>{rooms[i]=v;});c.on('supplies:updated',v=>{supplies[i]=v;});};clients.forEach(attach);
 const created=await clients[0]!.timeout(3000).emitWithAck('room:create',{name:'Host'});if(!created.ok)throw new Error(created.error);sessions.push(created.value);const code=created.value.room.code;
 for(let i=1;i<4;i++){const joined=await clients[i]!.timeout(3000).emitWithAck('room:join',{name:'Person '+i,code});if(!joined.ok)throw new Error(joined.error);sessions.push(joined.value);}
 await clients[0]!.timeout(3000).emitWithAck('room:start');
 const game=(manager as unknown as {rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;
 game.state={...game.state,characters:game.state.characters.map((c,i)=>({...c,energy:i===0?0:100}))};
 const v=manager.publicVote(code)!;for(const i of [0,1,2])expect((await clients[i]!.timeout(3000).emitWithAck('vote:cast',{decisionId:v.decisionId,attemptId:v.attemptId,optionId:'abandon'})).ok).toBe(true);
 const t=manager.transportView(code)!.cases.at(-1)!;expect((await clients[1]!.timeout(3000).emitWithAck('transport:open',{preparationId:t.preparationId})).ok).toBe(true);
 const waitAttempt=async(n:number)=>{await vi.waitFor(()=>expect(views.every(v=>v?.cases.at(-1)?.vote?.attemptNumber===n)).toBe(true));const ids=views.map(v=>v!.cases.at(-1)!.vote!.attemptId);expect(new Set(ids).size).toBe(1);};
 const refresh=async()=>{const old=clients[3]!.id!;clients[3]!.disconnect();await vi.waitFor(()=>expect(manager.privateRole(old)).toBeNull());clients[3]=await connect();attach(clients[3]!,3);views[3]=null;expect((await clients[3]!.timeout(3000).emitWithAck('room:resume',sessions[3]!.credential)).ok).toBe(true);};
 await waitAttempt(1);await refresh();await waitAttempt(1);clock.advance(60000);await waitAttempt(2);await refresh();await waitAttempt(2);clock.advance(30000);await waitAttempt(3);await refresh();await waitAttempt(3);
 for(let i=0;i<4;i++){const c=views[i]!.cases.at(-1)!;expect(c.crisis!.gas!.victims.filter(v=>v.damage!==undefined)).toEqual([{participantId:sessions[i]!.credential.participantId,damage:5}]);expect(c.people.filter(p=>p.energy!==undefined).map(p=>p.participantId)).toEqual([sessions[i]!.credential.participantId]);}
 for(let i=0;i<4;i++){const medic=manager.privateRole(clients[i]!.id!)!.role==='medic';for(let j=0;j<4;j++){expect(supplies[i]!.characters[j]!.energy!==undefined).toBe(i===j);expect(supplies[i]!.characters[j]!.health!==undefined).toBe(i===j||medic);}}
 const other=manager.create('other0','Other');if(!other.ok)throw new Error(other.error);const otherCode=other.value.room.code;for(let i=1;i<4;i++)manager.join('other'+i,'Other '+i,otherCode);manager.start('other0');
 const otherBefore=JSON.stringify(manager.suppliesView(otherCode));clock.advance(10000);
 await vi.waitFor(()=>expect(views.every(v=>v?.cases.at(-1)?.phase==='sector-evacuated')).toBe(true));await vi.waitFor(()=>expect(rooms.every(r=>r?.creatorId===sessions[1]!.credential.participantId)).toBe(true));
 expect(game.state.currentRound).toBe(2);expect(game.state.characters.map(c=>c.energy)).toEqual([0,100,100,100]);expect(game.state.characters.map(c=>c.health)).toEqual([90,90,90,90]);expect(game.state.transportIncidents).toHaveLength(2);expect(JSON.stringify(manager.suppliesView(otherCode))).toBe(otherBefore);
 expect((await clients[1]!.timeout(3000).emitWithAck('route:open')).ok).toBe(true);expect((await clients[0]!.timeout(3000).emitWithAck('route:open')).ok).toBe(false);
 const snapshot=JSON.stringify(game.state);await refresh();await vi.waitFor(()=>expect(views[3]!.cases.at(-1)!.phase).toBe('sector-evacuated'));expect(JSON.stringify(game.state)).toBe(snapshot);expect(clients[3]!.listeners('transport:updated')).toHaveLength(1);
 }finally{all.forEach(c=>c.disconnect());manager.dispose();await app.close();}
},15000);
