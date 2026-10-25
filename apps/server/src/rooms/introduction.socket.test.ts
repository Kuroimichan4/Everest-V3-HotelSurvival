import {expect,test,vi} from 'vitest';
import {io,type Socket} from 'socket.io-client';
import type {ClientToServerEvents,ServerToClientEvents,RoomSession,PublicRoom} from '@everest/shared';
import {RoomManager} from './manager.js';
import {buildApp} from '../app.js';
import type {VotingClock} from './voting.js';
type Client=Socket<ServerToClientEvents,ClientToServerEvents>;
class Clock implements VotingClock {
 time=1000;tasks=new Set<{at:number;run:()=>void}>();now=()=>this.time;
 schedule=(run:()=>void,delay:number)=>{const t={at:this.time+delay,run};this.tasks.add(t);return()=>{this.tasks.delete(t);};};
 advance(ms:number){this.time+=ms;for(const t of [...this.tasks])if(t.at<=this.time){this.tasks.delete(t);t.run();}}
}
test('four sessions share untimed introduction, F5 preserves waiting, only host starts timed first round and private sheets',async()=>{
 const clock=new Clock();const manager=new RoomManager(()=>0,clock,()=>.99);const app=buildApp({roomManager:manager});const all:Client[]=[];
 try{
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('port');
 const connect=async()=>{const c:Client=io('http://127.0.0.1:'+address.port,{autoConnect:false,reconnection:false});all.push(c);await new Promise<void>((resolve,reject)=>{c.once('connect',resolve);c.once('connect_error',reject);c.connect();});return c;};
 const clients=await Promise.all([connect(),connect(),connect(),connect()]);const rooms:(PublicRoom|null)[]=clients.map(()=>null);const roles:(Parameters<ServerToClientEvents['game:role']>[0]|null)[]=clients.map(()=>null);const votes:Parameters<ServerToClientEvents['vote:updated']>[0][]=[];
 const attach=(c:Client,i:number)=>{c.on('room:updated',r=>{rooms[i]=r;});c.on('game:role',r=>{roles[i]=r;});c.on('vote:updated',v=>votes.push(v));};clients.forEach(attach);
 const sessions:RoomSession[]=[];const first=await clients[0]!.timeout(3000).emitWithAck('room:create',{name:'Host'});if(!first.ok)throw new Error(first.error);sessions.push(first.value);const code=first.value.room.code;
 for(let i=1;i<4;i++){const r=await clients[i]!.timeout(3000).emitWithAck('room:join',{name:'Person '+i,code});if(!r.ok)throw new Error(r.error);sessions.push(r.value);}
 await vi.waitFor(()=>expect(rooms.every(r=>r?.status==='waiting'&&r.participants.length===4)).toBe(true));expect(clock.tasks.size).toBe(0);clock.advance(300000);expect(votes).toEqual([]);expect(roles).toEqual([null,null,null,null]);expect(manager.publicVote(code)).toBeNull();
 expect((await clients[1]!.timeout(3000).emitWithAck('room:start'))).toMatchObject({ok:false,error:'not-creator'});
 const old=clients[3]!.id!;clients[3]!.disconnect();await vi.waitFor(()=>expect(manager.privateRole(old)).toBeNull());clients[3]=await connect();attach(clients[3]!,3);const resumed=await clients[3]!.timeout(3000).emitWithAck('room:resume',sessions[3]!.credential);expect(resumed).toMatchObject({ok:true,value:{room:{status:'waiting'}}});expect(votes).toEqual([]);expect(clock.tasks.size).toBe(0);
 expect((await clients[0]!.timeout(3000).emitWithAck('room:start')).ok).toBe(true);await vi.waitFor(()=>expect(roles.every(Boolean)&&rooms.every(r=>r?.status==='started')).toBe(true));
 const vote=manager.publicVote(code)!;expect(vote.deadline-clock.now()).toBe(60000);expect(clock.tasks.size).toBe(1);expect(votes).toHaveLength(4);
 for(let i=0;i<4;i++){expect(roles[i]!.participantId).toBe(sessions[i]!.credential.participantId);expect(JSON.stringify(rooms[i])).not.toMatch(/objective|knowledge|sheet/);const sheet=JSON.stringify(roles[i]!.sheet);expect(sheet.includes('conferencia médica')).toBe(roles[i]!.role==='medic');expect(sheet.includes('almacén de suministros')).toBe(roles[i]!.role==='bellhop');}
 }finally{all.forEach(c=>c.disconnect());manager.dispose();await app.close();}
},15000);