import {expect,test,vi} from 'vitest';
import {createInitialState,isAlive} from './state.js';
import {traverseRouteEffects,simulateRouteEffectsForAnalysis,MAX_ACCIDENT_VICTIMS,traverseRoute} from './routes.js';
import {resolveRoundThreeRoute} from './round-three-routes.js';
import {ACCIDENT_PROBABILITIES} from './balance-probabilities.js';
import {seededRandom,analyzeAccidentVictims} from './balance-analysis.js';
import {resolveRoundOne} from './round-one.js';
test.each([0,1,2,3,4])('accident with %i living humans selects min(3,living) without duplicates',count=>{
 const initial=createInitialState();const state={...initial,characters:initial.characters.map((c,i)=>({...c,health:i<count?100:0}))};const rng=vi.fn(()=>0);const result=traverseRouteEffects(state,{energyCost:10,accidentProbability:.55,accidentDamage:20},rng);
 expect(MAX_ACCIDENT_VICTIMS).toBe(3);if(count===0){expect(result).toEqual({ok:false,state,error:'no-living-characters'});expect(rng).not.toHaveBeenCalled();return;}
 if(!result.ok)throw new Error(result.error);expect(result.victimIds).toHaveLength(Math.min(3,count));expect(new Set(result.victimIds).size).toBe(Math.min(3,count));expect(rng).toHaveBeenCalledTimes(1+Math.min(3,count));expect(result.state.characters.map(c=>c.health)).toEqual(initial.characters.map((_,i)=>i<Math.min(3,count)?80:i<count?100:0));
});
test('dead and abandoned are excluded while transported humans remain eligible for injury',()=>{
 const initial=createInitialState();const inactive={...initial,characters:initial.characters.map((c,i)=>i===0?{...c,health:0}:i===1?{...c,eliminated:true}:c)};const hit=traverseRouteEffects(inactive,{energyCost:10,accidentProbability:1,accidentDamage:20},()=>0);if(!hit.ok)throw new Error(hit.error);expect(hit.victimIds).toEqual(initial.characters.slice(2).map(c=>c.id));expect(hit.state.characters.slice(0,2)).toEqual(inactive.characters.slice(0,2));
 const carried={...initial,characters:initial.characters.map((c,i)=>({...c,energy:i===2?0:100}))};const moved=traverseRouteEffects(carried,{energyCost:10,accidentProbability:1,accidentDamage:20},()=>.999,{carrierIds:['maintenance','medic','bellhop'],transportedIds:['architect-engineer']});if(!moved.ok)throw new Error(moved.error);expect(moved.victimIds).toContain('architect-engineer');expect(moved.state.characters[2]).toMatchObject({health:80,energy:0});
});
test('selection is reproducible, reaches every human and uses no replacement',()=>{
 const picked=new Set<string>();const initial=createInitialState();const run=(seed:number)=>{const rng=seededRandom(seed);let first=true;const r=traverseRouteEffects(initial,{energyCost:0,accidentProbability:1,accidentDamage:5},()=>{if(first){first=false;return 0;}return rng();});if(!r.ok)throw new Error(r.error);return r.victimIds;};for(let seed=0;seed<50;seed++){expect(run(seed)).toEqual(run(seed));expect(new Set(run(seed)).size).toBe(3);run(seed).forEach(id=>picked.add(id));}expect(picked.size).toBe(4);
});
test('third victim invalid RNG rolls back payment and every damage effect',()=>{const initial=createInitialState();const samples=[0,0,0,NaN];expect(traverseRouteEffects(initial,{energyCost:25,accidentProbability:1,accidentDamage:20},()=>samples.shift()!)).toEqual({ok:false,state:initial,error:'invalid-random'});});
test('all four suffer environment while only three suffer accident, with accumulated fatalities clamped',()=>{
 const initial=createInitialState();const result=resolveRoundThreeRoute({...initial,currentRound:3},'three','pipe-gallery',()=>0);if(!result.ok)throw new Error(result.error);expect(result.outcome.victimIds).toHaveLength(3);expect(result.outcome.environmentalVictimIds).toHaveLength(4);expect(result.state.characters.map(c=>c.health)).toEqual([50,50,50,80]);
 const fragile={...initial,currentRound:3 as const,characters:initial.characters.map(c=>({...c,health:30}))};const fatal=resolveRoundThreeRoute(fragile,'fatal','pipe-gallery',()=>0);if(!fatal.ok)throw new Error(fatal.error);expect(fatal.outcome.deceasedIds).toHaveLength(3);expect(fatal.state.characters.map(c=>c.health)).toEqual([0,0,0,10]);
});
test('thresholds and per-person route damage stay unchanged; round one gains no accident',()=>{
 expect(ACCIDENT_PROBABILITIES).toEqual({LOW:.2,MODERATE:.35,HIGH:.55,EXTREME:.7});for(const [route,probability,damage] of [['ventilation',.2,5],['shoring',.35,10],['unstable-corridor',.55,20]] as const){const initial=createInitialState();const hit=traverseRoute(initial,route,()=>probability-.00001);if(!hit.ok)throw new Error(hit.error);expect(hit.state.characters.filter(c=>c.health===100-damage)).toHaveLength(3);const safe=traverseRoute(initial,route,()=>probability);expect(safe.ok&&safe.victimIds.length).toBe(0);}
 const first=resolveRoundOne(createInitialState(),'one','ABANDON_APPROVED');expect(first.ok).toBe(true);expect(first.state.characters.every(c=>c.health===100&&c.energy===75)).toBe(true);
});
test('analysis adapter at cap 3 agrees exactly with production and cap 2 remains analysis only',()=>{const initial=createInitialState();const route={energyCost:10,accidentProbability:1,accidentDamage:20};const current=traverseRouteEffects(initial,route,seededRandom(10));expect(simulateRouteEffectsForAnalysis(initial,route,seededRandom(10),3)).toEqual(current);const old=simulateRouteEffectsForAnalysis(initial,route,seededRandom(10),2);expect(old.ok&&old.victimIds.length).toBe(2);expect(current.ok&&current.victimIds.length).toBe(3);expect(initial.characters.every(isAlive)).toBe(true);});
test('paired seeded analysis covers policies and group sizes and isolates two-vs-three victim effects',()=>{
 const result=analyzeAccidentVictims(100,123);expect(result).toEqual(analyzeAccidentVictims(100,123));expect(result).toHaveLength(18);for(const row of result.filter(r=>r.initialHumans<=2)){const peer=result.find(p=>p.scenario===row.scenario&&p.victimLimit!==row.victimLimit)!;expect(row.meanDamage).toBe(peer.meanDamage);expect(row.meanEvacuated).toBe(peer.meanEvacuated);expect(row.meanDead).toBe(peer.meanDead);}
 const old=result.find(r=>r.scenario==='prudent-4'&&r.victimLimit===2)!;const current=result.find(r=>r.scenario==='prudent-4'&&r.victimLimit===3)!;expect(current.meanDamage).toBeCloseTo(1.5*old.meanDamage,10);expect(current.meanMedicalOpportunities).toBeGreaterThanOrEqual(old.meanMedicalOpportunities);
});