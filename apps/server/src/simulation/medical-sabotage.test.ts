import {expect,test,vi} from 'vitest';
import {createInitialState,type SimulationState} from './state.js';
import {administerTreatment} from './operations.js';
import {manipulateMedication,POISON_PROBABILITY,SUDDEN_DEATH_NARRATIVES} from './medical-sabotage.js';
import {buildFinalResult,objectiveEvidence} from './final-result.js';
import {beginRoundFour,decideRoundFourNpc,prepareRescueEffort} from './round-four.js';
import {beforeFinalFixture} from '../../test-support/final-stage.js';
function fixture(){const s=createInitialState();return {...s,characters:s.characters.map(c=>({...c,health:60}))};}
function armed(){const result=manipulateMedication(fixture(),'bellhop','secret');if(!result.ok)throw new Error(result.error);return result.state;}
const people=(state:SimulationState)=>state.characters.map(c=>({characterId:c.id,participantId:'p-'+c.id,name:c.role}));
test.each([0,.249999999999,.25,.999999999])('poison threshold exactly 25 percent, sample %f',roll=>{
 const s=armed();const rng=vi.fn(()=>roll);const narrative=vi.fn(()=>.9);const result=administerTreatment(s,'maintenance',rng,narrative);expect(result.ok).toBe(true);
 expect(POISON_PROBABILITY).toBe(.25);expect(rng).toHaveBeenCalledTimes(1);expect(result.state.characters[0]!.health).toBe(roll<.25?0:80);expect(result.state.inventory.medicalUnits).toBe(3);
 expect(result.state.medicalSabotage!.status).toBe(roll<.25?'consumed':'pending');expect(narrative).toHaveBeenCalledTimes(roll<.25?1:0);expect(s.characters[0]!.health).toBe(60);
});
test.each(['medic','maintenance','architect-engineer'])('only bellhop may manipulate, not %s',role=>{const s=fixture();expect(manipulateMedication(s,role,'id')).toMatchObject({ok:false,state:s,error:'not-authorized'});});
test('one substitution is idempotent, preserves units and cannot repeat with another id',()=>{
 const s=fixture();const a=manipulateMedication(s,'bellhop','a');expect(a.ok).toBe(true);expect(a.state.inventory).toBe(s.inventory);
 expect(manipulateMedication(a.state,'bellhop','a')).toEqual({ok:true,state:a.state});expect(manipulateMedication(a.state,'bellhop','b')).toMatchObject({ok:false,error:'sabotage-already-used'});
 expect(manipulateMedication({...s,inventory:{...s.inventory,medicalUnits:0}},'bellhop','id')).toMatchObject({ok:false,error:'no-medical-units'});
 expect(manipulateMedication({...s,characters:s.characters.map(c=>c.role==='bellhop'?{...c,health:0}:c)},'bellhop','id')).toMatchObject({ok:false,error:'bellhop-dead'});
});
test.each(['dead','abandoned','full','empty','treated','unknown'])('invalid patient %s never rolls, consumes or records',kind=>{
 let s:SimulationState=armed();const id='maintenance';
 if(kind==='dead'||kind==='abandoned'||kind==='full')s={...s,characters:s.characters.map(c=>c.id===id?{...c,health:kind==='dead'?0:kind==='full'?100:60,...(kind==='abandoned'?{eliminated:true}:{})}:c)};
 if(kind==='empty')s={...s,inventory:{...s.inventory,medicalUnits:0}};
 if(kind==='treated')s={...s,medicalTreatments:[{round:1,characterId:id,healthRestored:20}]};
 const rng=vi.fn(()=>0);const result=administerTreatment(s,kind==='unknown'?'npc':id,rng);expect(result.ok).toBe(false);expect(result.state).toBe(s);expect(rng).not.toHaveBeenCalled();
});
test.each([NaN,-.01,1,Infinity])('invalid RNG %s rejects atomically',roll=>{const s=armed();const r=administerTreatment(s,'maintenance',()=>roll);expect(r).toEqual({ok:false,state:s,error:'invalid-random'});});
test('independent failed uses keep sabotage pending at any stock count; empty stock gives no fulfillment',()=>{
 let s:SimulationState=armed();const rng=vi.fn(()=>.25);for(const c of s.characters){const result=administerTreatment(s,c.id,rng);expect(result.ok).toBe(true);s=result.state;}
 expect(rng).toHaveBeenCalledTimes(4);expect(s.inventory.medicalUnits).toBe(0);expect(s.medicalSabotage!.status).toBe('pending');expect(s.medicalSabotage!.uses).toHaveLength(4);
 s={...s,characters:s.characters.map(c=>({...c,health:0}))};const final=buildFinalResult(s,people(s),{id:'result',gameId:'game',closedAt:1,ventilationRevealed:false})!;expect(objectiveEvidence(s,final,'bellhop').evaluation).toBe('unfulfilled');
});
test.each(['maintenance','bellhop'])('one death only, including self-treated bellhop: %s',patient=>{
 let s:SimulationState=armed();const rng=vi.fn(()=>0);s=administerTreatment(s,patient,rng,()=>0).state;const repeated=administerTreatment(s,patient,rng);expect(repeated.ok).toBe(false);const other=patient==='bellhop'?'maintenance':'bellhop';s=administerTreatment(s,other,rng).state;
 expect(rng).toHaveBeenCalledTimes(1);expect(s.inventory.medicalUnits).toBe(2);expect(s.suddenMedicalDeaths).toHaveLength(1);expect(s.medicalSabotage!.victimId).toBe(patient);expect(s.medicalTreatments![0]!.healthRestored).toBe(0);expect(s.characters.find(c=>c.id===other)!.health).toBe(80);
});
test.each([0,.5,.999,NaN])('public narratives vary independently without revealing source: %s',sample=>{
 const s=administerTreatment(armed(),'maintenance',()=>0,()=>sample).state;expect(s.characters[0]!.health).toBe(0);expect(SUDDEN_DEATH_NARRATIVES).toContain(s.suddenMedicalDeaths![0]!.message);expect(s.suddenMedicalDeaths![0]!.message).not.toMatch(/venen|sabot|Botones|25|tirada/);
});
test('NPC medical effort spends one unit without rolling or consuming human sabotage',()=>{
 const first=beginRoundFour(beforeFinalFixture(armed()),()=>.9);if(!first.ok)throw new Error(first.error);const choice=decideRoundFourNpc(first.state,'npc','medical-assist');if(!choice.ok)throw new Error(choice.error);const result=prepareRescueEffort(choice.state);expect(result.ok).toBe(true);expect(result.state.inventory.medicalUnits).toBe(3);expect(result.state.medicalSabotage).toBe(first.state.medicalSabotage);expect(result.state.medicalTreatments).toBeUndefined();
});
test('only attributable poisoning fulfills bellhop; medic sees death without cause or author',()=>{
 let s:SimulationState=administerTreatment(armed(),'maintenance',()=>0,()=>0).state;s={...s,characters:s.characters.map(c=>({...c,health:0}))};const final=buildFinalResult(s,people(s),{id:'result',gameId:'game',closedAt:1,ventilationRevealed:false})!;
 const context={treatments:[{requestId:'tx',round:1,patientId:'p-maintenance',administratorId:'p-medic'}]};expect(objectiveEvidence(s,final,'bellhop',context).evaluation).toBe('fulfilled');const medic=objectiveEvidence(s,final,'medic',context);expect(medic.evaluation).toBe('unfulfilled');expect(JSON.stringify(medic)).not.toMatch(/sabot|venen|bellhop|actorId|victimId|uses|25/i);expect(JSON.stringify(final)).not.toMatch(/medicalSabotage|poison|sabot|venen|actorId|uses/i);
 const natural={...fixture(),characters:fixture().characters.map(c=>({...c,health:0}))};const n=buildFinalResult(natural,people(natural),{id:'r',gameId:'g',closedAt:1,ventilationRevealed:false})!;expect(objectiveEvidence(natural,n,'bellhop').evaluation).toBe('unfulfilled');
});