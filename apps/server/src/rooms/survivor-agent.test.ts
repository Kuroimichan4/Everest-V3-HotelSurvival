import { expect, test, vi } from 'vitest';
import { SurvivorAgent, demonstrationAdapter, validateSurvivorResponse, type SurvivorContext } from './survivor-agent.js';
import { RoomManager } from './manager.js';
import type { SimulationState } from '../simulation/state.js';
import { beforeFinalFixture } from '../../test-support/final-stage.js';
class Clock {
  time = 1000; tasks = new Set<{at:number;run:()=>void}>(); now=()=>this.time;
  schedule=(run:()=>void,ms:number)=>{const t={at:this.time+ms,run};this.tasks.add(t);return()=>{this.tasks.delete(t);};};
  advance(ms:number){this.time+=ms;for(const t of [...this.tasks])if(t.at<=this.time){this.tasks.delete(t);t.run();}}
}
const context = (clock:Clock, attempt:1|2=1):SurvivorContext=>({encounterId:'npc',round:1,situation:'trapped',vote:{decisionId:'decision',attemptId:'attempt-'+attempt,attempt,openedAt:clock.now(),deadline:clock.now()+(attempt===1?60000:30000)}});
test('server schedules 0/20/40 and second attempt 0/15; snapshots never repeat slots',()=>{
 const clock=new Clock();const respond=vi.fn(demonstrationAdapter.respond);const agent=new SurvivorAgent({mode:'test',respond},clock);let c:SurvivorContext|null=context(clock);const publish=vi.fn();
 agent.observe(()=>c,publish);expect(publish).toHaveBeenCalledTimes(1);agent.observe(()=>c,publish);clock.advance(19999);expect(publish).toHaveBeenCalledTimes(1);clock.advance(1);expect(publish).toHaveBeenCalledTimes(2);clock.advance(20000);expect(publish).toHaveBeenCalledTimes(3);
 clock.advance(20000);c=context(clock,2);agent.observe(()=>c,publish);expect(publish).toHaveBeenCalledTimes(4);clock.advance(15000);expect(publish).toHaveBeenCalledTimes(5);expect(respond.mock.calls.at(-1)![0].previousMessages).toHaveLength(4);
 c=null;agent.observe(()=>c,publish);expect(clock.tasks.size).toBe(0);
});
test.each(['rescued','abandoned','dead','no-encounter'] as const)('pending messages cancel when encounter becomes %s',()=>{
 const clock=new Clock();const agent=new SurvivorAgent(demonstrationAdapter,clock);let c:SurvivorContext|null=context(clock);const publish=vi.fn();agent.observe(()=>c,publish);c=null;agent.observe(()=>c,publish);clock.advance(60000);expect(publish).toHaveBeenCalledTimes(1);expect(clock.tasks.size).toBe(0);
});
test.each(['attempt','finished','disposed','late'] as const)('async arguments discarded after %s',async change=>{
 const clock=new Clock();let complete!:(v:unknown)=>void;const agent=new SurvivorAgent({mode:'slow',respond:()=>new Promise(resolve=>{complete=resolve;})},clock);let c:SurvivorContext|null=context(clock);const publish=vi.fn();agent.observe(()=>c,publish);
 if(change==='attempt')c=context(clock,2);if(change==='finished')c=null;if(change==='disposed')agent.dispose();if(change==='late')clock.advance(5001);
 complete({action:'advise',text:'Por favor, ayudadme.'});await Promise.resolve();expect(publish).not.toHaveBeenCalled();agent.dispose();
});
test.each([null,{}, {action:'vote',text:'no'}, {action:'none',text:'no'}, {action:'warn',text:''}, {action:'warn',text:'x'.repeat(401)}, {action:'warn',text:'<script>evil()</script>'}, {action:'advise',text:'Salud 20'}, {action:'advise',text:'hola',health:30}, {action:'warn',text:'Sabotaje confirmado'}])('rejects invalid or secret-bearing response %j',response=>{
 expect(validateSurvivorResponse(response)).toBeNull();const clock=new Clock();const agent=new SurvivorAgent({mode:'invalid',respond:()=>response},clock);const publish=vi.fn();agent.observe(()=>context(clock),publish);expect(publish).not.toHaveBeenCalled();agent.dispose();
});
test('none, exceptions and promise rejection never block voting',async()=>{
 for(const respond of [()=>({action:'none'}),()=>{throw new Error('offline');},()=>Promise.reject(new Error('offline'))]){
 const clock=new Clock();const agent=new SurvivorAgent({mode:'test',respond},clock);const publish=vi.fn();expect(()=>agent.observe(()=>context(clock),publish)).not.toThrow();await Promise.resolve();await Promise.resolve();expect(publish).not.toHaveBeenCalled();agent.dispose();}
});
function fixture(){
 const clock=new Clock();const random=vi.fn(()=>.99);const respond=vi.fn(demonstrationAdapter.respond);const m=new RoomManager(()=>0,clock,random,undefined,undefined,{mode:'recording-demo',respond});const first=m.create('s0','Host');if(!first.ok)throw new Error(first.error);const code=first.value.room.code;for(let i=1;i<4;i++)m.join('s'+i,'Person '+i,code);m.start('s0');
 const game=(m as unknown as {rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;
 const vote=(optionId:string)=>{const v=m.publicVote(code)!;for(const i of [0,1,2])expect(m.vote('s'+i,{decisionId:v.decisionId,attemptId:v.attemptId,optionId}).ok).toBe(true);};
 return {clock,random,respond,m,code,game,vote};
}
test('real NPCs in rounds one and two; no Central, route or transport interventions; privacy and state unchanged',()=>{
 const f=fixture();try{
 expect(f.respond.mock.calls[0]![0]).toMatchObject({round:1,situation:'trapped',slot:0});
 f.m.sendChat('s3',{requestId:1,text:'SECRET HUMAN CHAT'});const state=JSON.stringify(f.game.state);const deadline=f.m.publicVote(f.code)!.deadline;f.clock.advance(20000);expect(JSON.stringify(f.game.state)).toBe(state);expect(f.m.publicVote(f.code)!.deadline).toBe(deadline);
 f.vote('abandon');const count=f.respond.mock.calls.length;f.clock.advance(40000);expect(f.respond).toHaveBeenCalledTimes(count);f.m.advanceRound('s0');f.m.routeAction('s0','open');expect(f.respond).toHaveBeenCalledTimes(count);f.vote('unstable-corridor');expect(f.respond.mock.calls.at(-1)![0]).toMatchObject({round:2,slot:0});
 f.clock.advance(60000);expect(f.respond.mock.calls.at(-1)![0].vote.attempt).toBe(2);f.clock.advance(15000);expect(f.respond.mock.calls.at(-1)![0].slot).toBe(1);f.vote('abandon');const after=f.respond.mock.calls.length;f.clock.advance(20000);expect(f.respond).toHaveBeenCalledTimes(after);
 expect(JSON.stringify(f.respond.mock.calls)).not.toMatch(/SECRET HUMAN CHAT|health|energy|inventory|sabotage|objective|ventilation|realRisk|danger|token|medical/i);
 expect(JSON.stringify(f.m.chatSession('s0'))).not.toContain('Central de Emergencias');
 }finally{f.m.dispose();}
});
test.each([[0,'none'],[.6,'walking-assisted'],[.9,'immobile']] as const)('round six real appearance %s/%s controls speech', (roll,situation)=>{
 const f=fixture();try{
 f.vote('abandon');f.game.state={...beforeFinalFixture(f.game.state),characters:f.game.state.characters.map(c=>({...c,energy:100}))};f.random.mockReturnValue(roll);const count=f.respond.mock.calls.length;
 expect(f.m.roundFourAction('s0','advance').ok).toBe(true);
 if(situation==='none'){expect(f.respond).toHaveBeenCalledTimes(count);f.m.roundFourAction('s0','open');expect(f.respond).toHaveBeenCalledTimes(count);}else{
 expect(f.respond.mock.calls.at(-1)![0]).toMatchObject({round:6,situation,slot:0});f.vote('abandon');const done=f.respond.mock.calls.length;f.clock.advance(40000);expect(f.respond).toHaveBeenCalledTimes(done);}
 }finally{f.m.dispose();}
});
