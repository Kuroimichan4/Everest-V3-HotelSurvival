import {afterEach,expect,test,vi} from 'vitest';
import {RoomManager} from './manager.js';
import type {RoomReply,RoomSession} from '@everest/shared';
import type {SimulationState} from '../simulation/state.js';
const managers:RoomManager[]=[];afterEach(()=>managers.splice(0).forEach(m=>m.dispose()));
const value=<T>(r:RoomReply<T>)=>{if(!r.ok)throw new Error(r.error);return r.value;};
function fixture(){
 const poison=vi.fn(()=>0);const narrative=vi.fn(()=>0);const route=vi.fn(()=>.99);const manager=new RoomManager(()=>0,{now:()=>1000,schedule:()=>()=>{}},route,poison,narrative);managers.push(manager);
 const sessions:RoomSession[]=[value(manager.create('s0','Host'))];const code=sessions[0]!.room.code;for(let i=1;i<4;i++)sessions.push(value(manager.join('s'+i,'P'+i,code)));manager.start('s0');
 const game=()=>(manager as unknown as {rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;
 game().state={...game().state,characters:game().state.characters.map(c=>({...c,health:60}))};const gameId=manager.suppliesView(code)!.gameId;
 const manipulate=(socket='s2',requestId='secret')=>manager.sabotageMedication(socket,{gameId,requestId});
 const tx=(i=1,requestId='tx')=>({gameId,requestId,round:game().state.currentRound,targetParticipantId:sessions[i]!.credential.participantId});
 return{manager,code,sessions,game,gameId,poison,narrative,route,manipulate,tx};
}
test('private manipulation authorizes only live bellhop, one request and unchanged public stock',()=>{
 const f=fixture();const before=f.manager.suppliesView(f.code)!;
 for(const id of ['s0','s1','s3','outside'])expect(f.manipulate(id).ok).toBe(false);
 expect(f.manipulate().ok).toBe(true);expect(f.manipulate().ok).toBe(true);expect(f.manipulate('s2','again')).toMatchObject({ok:false,error:'sabotage-already-used'});expect(f.manager.suppliesView(f.code)).toEqual(before);expect(f.poison).not.toHaveBeenCalled();
 for(const id of ['s0','s1','s3'])expect(f.manager.sabotageSession(id)).toBeNull();expect(f.manager.sabotageSession('s2')).toMatchObject({performed:true,objectiveFulfilled:false,canManipulate:false});
 f.manager.disconnect('s2');expect(f.manager.resume('new',f.sessions[2]!.credential).ok).toBe(true);expect(f.manager.sabotageSession('new')!.performed).toBe(true);expect(f.manipulate('new','new-id').ok).toBe(false);
});
test.each(['empty','dead','abandoned','finished'])('manipulation rejects %s without changing inventory',kind=>{
 const f=fixture();const s=f.game().state;f.game().state=kind==='empty'?{...s,inventory:{...s.inventory,medicalUnits:0}}:{...s,characters:s.characters.map(c=>kind==='finished'||c.role==='bellhop'?{...c,...(kind==='abandoned'?{eliminated:true}:{health:0})}:c)};
 if(kind==='finished')f.manager.finalResult(f.code);expect(f.manipulate().ok).toBe(false);expect(f.game().state.medicalSabotage).toBeUndefined();
});
test('all rejected treatments and repeated clicks consume no additional roll or unit',()=>{
 const f=fixture();f.manipulate();const request=f.tx();
 for(const socket of ['outside','s1','s2','s3'])expect(f.manager.treat(socket,request).ok).toBe(false);
 for(const bad of [{...request,gameId:'wrong'},{...request,round:6},{...request,targetParticipantId:'npc'},{...request,role:'medic'}])expect(f.manager.treat('s0',bad).ok).toBe(false);
 expect(f.poison).not.toHaveBeenCalled();expect(f.manager.treat('s0',request).ok).toBe(true);expect(f.manager.treat('s0',request).ok).toBe(true);expect(f.manager.treat('s0',{...request,requestId:'again'}).ok).toBe(false);
 expect(f.poison).toHaveBeenCalledTimes(1);expect(f.narrative).toHaveBeenCalledTimes(1);expect(f.game().state.inventory.medicalUnits).toBe(3);expect(f.game().state.suddenMedicalDeaths).toHaveLength(1);expect(f.manager.privateRole('s1')).toBeNull();
 const v=f.manager.publicVote(f.code)!;expect(v.requiredVotes).toBe(2);expect(f.manager.vote('s1',{decisionId:v.decisionId,attemptId:v.attemptId,optionId:'rescue'})).toMatchObject({ok:false,error:'dead'});
 expect(f.manager.givePack('s2',{requestId:'pack',windowId:'none',targetParticipantId:f.sessions[1]!.credential.participantId}).ok).toBe(false);
 expect(f.manager.treat('s0',f.tx(3,'next')).ok).toBe(true);expect(f.poison).toHaveBeenCalledTimes(1);expect(f.game().state.inventory.medicalUnits).toBe(2);
});
test('failed roll heals normally and remains pending, successful next treatment consumes it',()=>{
 const f=fixture();f.manipulate();f.poison.mockReturnValueOnce(.25).mockReturnValue(0);expect(f.manager.treat('s0',f.tx(1)).ok).toBe(true);expect(f.game().state.characters[1]!.health).toBe(80);expect(f.manager.sabotageSession('s2')!.objectiveFulfilled).toBe(false);
 expect(f.manager.treat('s0',f.tx(3,'next')).ok).toBe(true);expect(f.game().state.characters[3]!.health).toBe(0);expect(f.poison).toHaveBeenCalledTimes(2);expect(f.manager.sabotageSession('s2')!.objectiveFulfilled).toBe(true);
});
test('sudden death removes previous vote, recalculates strict majority and preserves deadline',()=>{
 const f=fixture();f.manipulate();const v=f.manager.publicVote(f.code)!;expect(f.manager.vote('s1',{decisionId:v.decisionId,attemptId:v.attemptId,optionId:'rescue'}).ok).toBe(true);
 f.manager.treat('s0',f.tx());expect(f.manager.publicVote(f.code)).toMatchObject({attemptId:v.attemptId,deadline:v.deadline,requiredVotes:2});expect(f.manager.votingSession('s1')!.own.optionId).toBeNull();
});
test('new majority after death closes immediately and uses normal movement',()=>{
 const f=fixture();f.manipulate();const v=f.manager.publicVote(f.code)!;for(const i of [0,2])f.manager.vote('s'+i,{decisionId:v.decisionId,attemptId:v.attemptId,optionId:'abandon'});
 expect(f.manager.roundSummary(f.code)).toBeNull();f.manager.treat('s0',f.tx());expect(f.manager.roundSummary(f.code)!.completed).toBe(true);expect(f.game().state.characters.map(c=>c.energy)).toEqual([75,100,75,75]);
});
test('public projections and final medic evidence contain no secret state or accusation',()=>{
 const f=fixture();f.manipulate();f.manager.treat('s0',f.tx());
 for(let i=0;i<4;i++)for(const data of [f.manager.medicalView(f.code),f.manager.suppliesView(f.code),f.manager.activityView(f.code),f.manager.transportView(f.code)])expect(JSON.stringify(f.manager.sessionProjection('s'+i,data))).not.toMatch(/medicalSabotage|poison|venen|sabot|actorId|victimId|uses|objectiveFulfilled/i);
 const s=f.game().state;f.game().state={...s,characters:s.characters.map(c=>({...c,health:0}))};const final=f.manager.finalResult(f.code)!;expect(JSON.stringify(final)).not.toMatch(/venen|sabot|poison|actorId|uses/i);
 expect(f.manager.objectiveSession('s2')!.evaluation).toBe('fulfilled');
});
test('bellhop can be the poisoned patient and still privately recover fulfilled objective',()=>{
 const f=fixture();f.manipulate();f.manager.treat('s0',f.tx(2));expect(f.manager.sabotageSession('s2')).toMatchObject({performed:true,objectiveFulfilled:true,canManipulate:false});expect(f.manager.privateRole('s2')).toBeNull();
 f.manager.disconnect('s2');expect(f.manager.resume('new',f.sessions[2]!.credential).ok).toBe(true);expect(f.manager.sabotageSession('new')!.objectiveFulfilled).toBe(true);
});
test.each(['carrier','only-exhausted','recipient'] as const)('poison during human transport reconciles %s without fictitious carriage',kind=>{
 const f=fixture();f.manipulate();const s=f.game().state;f.game().state={...s,characters:s.characters.map((c,i)=>({...c,energy:kind==='recipient'?(i===1||i===3?0:100):i===0?0:100}))};
 const cast=(id:string,indices:number[])=>{const v=f.manager.publicVote(f.code)!;for(const i of indices)expect(f.manager.vote('s'+i,{decisionId:v.decisionId,attemptId:v.attemptId,optionId:id}).ok).toBe(true);};
 cast('abandon',[0,1,2]);const prep=f.manager.transportView(f.code)!.cases.at(-1)!;expect(f.manager.openTransport('s2',{preparationId:prep.preparationId}).ok).toBe(true);
 if(kind==='recipient'){
  cast('carry-one',[0,2]);cast('person-0',[0]);expect(f.manager.treat('s0',f.tx(1)).ok).toBe(true);expect(f.manager.votingSession('s0')!.own.optionId).toBeNull();cast('person-1',[0,2]);
  expect(f.manager.transportView(f.code)!.cases.at(-1)).toMatchObject({phase:'completed',transportedIds:[f.sessions[3]!.credential.participantId],abandonedIds:[]});
 }else if(kind==='carrier'){
  expect(f.manager.treat('s0',f.tx(1)).ok).toBe(true);expect(f.manager.transportView(f.code)!.cases.at(-1)!.eligibleIds).toEqual([f.sessions[2]!.credential.participantId,f.sessions[3]!.credential.participantId]);cast('carry-all',[2,3]);expect(f.manager.roundSummary(f.code)!.completed).toBe(true);
 }else{
  expect(f.manager.treat('s0',f.tx(0)).ok).toBe(true);expect(f.manager.transportView(f.code)!.cases.at(-1)).toMatchObject({phase:'completed',transportedIds:[],abandonedIds:[]});expect(f.manager.roundSummary(f.code)!.completed).toBe(true);
 }
 expect(f.poison).toHaveBeenCalledTimes(1);expect(f.game().state.suddenMedicalDeaths).toHaveLength(1);
});