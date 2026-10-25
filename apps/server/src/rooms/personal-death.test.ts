import {expect,test} from 'vitest';
import {personalDeathMessage,PERSONAL_DEATH_NARRATIVES} from './personal-death.js';
import {RoomManager} from './manager.js';
import {createInitialState,type SimulationState} from '../simulation/state.js';
import {resolveRoundOne} from '../simulation/round-one.js';
import {beginRoundTwo,resolveRoundTwo} from '../simulation/round-two.js';
import {resolveRoundTwoMovement} from '../simulation/round-two-movement.js';
import {resolveRoundThreeRoute} from '../simulation/round-three-routes.js';
import {applyTransportIncident} from '../simulation/transport-crisis.js';
import {manipulateMedication} from '../simulation/medical-sabotage.js';
import {administerTreatment} from '../simulation/operations.js';
import {beginRoundFour,failRoundFourExitVote} from '../simulation/round-four.js';
import {beforeFinalFixture} from '../../test-support/final-stage.js';
const message=(s:SimulationState)=>personalDeathMessage(s,'game','maintenance','p0');
const wound=(health:number)=>{const s=createInitialState();return {...s,characters:s.characters.map((c,i)=>({...c,health:i===0?health:100}))};};
test('actual round two accident produces a personal geological death, with no secret fields',()=>{
 const one=resolveRoundOne(createInitialState(),'one','ABANDON_APPROVED');const two=resolveRoundTwo(beginRoundTwo(one.state),'npc','ABANDON_APPROVED');const s={...two.state,characters:two.state.characters.map((c,i)=>({...c,health:i===0?10:100}))};const moved=resolveRoundTwoMovement(s,{decisionId:'move',outcome:'unstable-corridor',ventilationRevealed:false},()=>0);expect(moved.ok).toBe(true);const result=message(moved.state)!;expect(result).toMatchObject({kind:'accident',round:2,participantId:'p0'});expect(Object.keys(result).sort()).toEqual(['eventId','gameId','kind','message','participantId','round']);
});
test('smoke without accident in pipe gallery produces gas narrative',()=>{const result=resolveRoundThreeRoute({...wound(10),currentRound:3},'three','pipe-gallery',()=>.99);expect(result.ok).toBe(true);expect(message(result.state)).toMatchObject({kind:'gas',round:3});});
test('gas receipt identifies gas death without guessing from damage alone',()=>{const s=applyTransportIncident(wound(5),'incident',1,'gas',1).state;expect(message(s)).toMatchObject({kind:'gas',round:1});});
test('explosion receipt identifies explosion death and does not confuse earlier nonfatal gas',()=>{let s=applyTransportIncident(wound(10),'incident',1,'gas',1).state;s=applyTransportIncident(s,'incident',1,'explosion',2).state;expect(message(s)).toMatchObject({kind:'explosion',round:1});});
test('final collapse records accident/collapse narrative',()=>{const entered=beginRoundFour(beforeFinalFixture(wound(5)),()=>0);if(!entered.ok)throw new Error(entered.error);const result=failRoundFourExitVote(entered.state,'exit',1);expect(result.ok).toBe(true);expect(message(result.state)).toMatchObject({kind:'accident',round:6});});
test('medical poisoning is projected as unexplained death without exposing its hidden cause',()=>{
 const armed=manipulateMedication(wound(60),'bellhop','secret');if(!armed.ok)throw new Error(armed.error);const result=administerTreatment(armed.state,'maintenance',()=>0,()=>0);const dto=message(result.state)!;expect(dto.kind).toBe('unexpected');expect(JSON.stringify(dto)).not.toMatch(/medical|medicaci|botiqu|sabot|venen|bellhop|25|tirada|uses|actorId|victimId/i);expect(dto.message).toContain('voces');
});
test.each(['alive','abandoned','abandoned-zero'] as const)('state %s has no false death message',kind=>{const s=wound(kind==='alive'?100:kind==='abandoned-zero'?0:60);const state={...s,characters:s.characters.map((c,i)=>i===0&&kind!=='alive'?{...c,eliminated:true}:c)};expect(message(state)).toBeNull();});
test('same event uses stable variant across repeat and restored state and has multiple narrative variants',()=>{const s=applyTransportIncident(wound(5),'incident',1,'gas',1).state;expect(message(structuredClone(s))).toEqual(message(s));for(const variants of Object.values(PERSONAL_DEATH_NARRATIVES))expect(new Set(variants).size).toBeGreaterThan(1);});
test('combined environmental and accident damage avoids inventing a single cause',()=>{const result=resolveRoundThreeRoute({...wound(10),currentRound:3},'three','pipe-gallery',()=>0);expect(result.ok).toBe(true);expect(message(result.state)!.kind).toBe('unexpected');});
test('unknown death falls back to mysterious narration without fabricated accident',()=>{expect(message(wound(0))!.kind).toBe('unexpected');});
test('manager private projection caches death independently of later rounds and returns copies',()=>{
 const m=new RoomManager(()=>0,{now:()=>1000,schedule:()=>()=>{}});try{
 const first=m.create('s0','Host');if(!first.ok)throw new Error(first.error);const code=first.value.room.code;for(let i=1;i<4;i++)m.join('s'+i,'P'+i,code);m.start('s0');const game=(m as unknown as {rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;
 game.state={...game.state,characters:game.state.characters.map((c,i)=>({...c,health:i===0?5:100}))};game.state=applyTransportIncident(game.state,'gas',1,'gas',1).state;
 const original=m.personalDeathSession('s0')!;expect(original.kind).toBe('gas');expect(m.personalDeathSession('s1')).toBeNull();expect(m.personalDeathSession('outsider')).toBeNull();original.message='tampered';game.state={...game.state,currentRound:5,transportIncidents:[]};expect(m.personalDeathSession('s0')!.message).not.toBe('tampered');expect(m.personalDeathSession('s0')!.kind).toBe('gas');
 }finally{m.dispose();}
});
test('death while disconnected is cached at publication before later round transitions',()=>{
 const m=new RoomManager(()=>0,{now:()=>1000,schedule:()=>()=>{}});try{
 const first=m.create('s0','Host');if(!first.ok)throw new Error(first.error);const code=first.value.room.code;const sessions=[first.value];for(let i=1;i<4;i++){const r=m.join('s'+i,'P'+i,code);if(!r.ok)throw new Error(r.error);sessions.push(r.value);}m.start('s0');m.disconnect('s1');
 const game=(m as unknown as {rooms:Map<string,{game:{state:SimulationState}}>}).rooms.get(code)!.game;game.state={...game.state,characters:game.state.characters.map((c,i)=>({...c,health:i===1?5:100}))};game.state=applyTransportIncident(game.state,'gas',1,'gas',1).state;const v=m.publicVote(code)!;for(const i of [0,2,3])expect(m.vote('s'+i,{decisionId:v.decisionId,attemptId:v.attemptId,optionId:'abandon'}).ok).toBe(true);
 game.state={...game.state,transportIncidents:[]};expect(m.advanceRound('s0').ok).toBe(true);expect(m.resume('restored',sessions[1]!.credential).ok).toBe(true);expect(m.personalDeathSession('restored')).toMatchObject({kind:'gas',round:1,participantId:sessions[1]!.credential.participantId});
 }finally{m.dispose();}
});