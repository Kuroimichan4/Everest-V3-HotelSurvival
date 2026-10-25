import {expect,test,vi} from 'vitest';
import {createInitialState} from './state.js';
import {roundTwoMovementCost,traverseRoute} from './routes.js';
import {assessTransportAlternative,classifyMovement,movementEnergyFor,routeEnergyAvailability} from './transport.js';
import {resolveRoundTwoMovement} from './round-two-movement.js';
import {beginRoundTwo,resolveRoundTwo} from './round-two.js';
import {resolveRoundOne} from './round-one.js';
const technical=(role:string)=>role==='maintenance'||role==='architect-engineer';
test('shoring charges 45 only to walking technical specialists and 40 to the other roles',()=>{
 const s=createInitialState();const result=traverseRoute(s,'shoring',()=>.99);if(!result.ok)throw new Error(result.error);
 expect(result.charges.map(c=>c.energyCost)).toEqual([45,40,45,40]);expect(result.state.characters.map(c=>c.energy)).toEqual([55,60,55,60]);expect(s.characters.every(c=>c.energy===100)).toBe(true);
});
test.each(['unstable-corridor','ventilation'])('no surcharge on %s',route=>{const s=createInitialState();const result=traverseRoute(s,route,()=>.99);if(!result.ok)throw new Error(result.error);expect(new Set(result.charges.map(c=>c.energyCost)).size).toBe(1);});
test('technical energy 44 needs help despite being able to pay the common base 40',()=>{
 const s=createInitialState();const state={...s,characters:s.characters.map(c=>({...c,energy:c.role==='maintenance'?44:100}))};const cost=roundTwoMovementCost('shoring');
 expect(classifyMovement(state,cost)).toMatchObject({ok:true,classification:{transportRequiredIds:['maintenance']}});expect(routeEnergyAvailability(state,cost).status).toBe('with-help');const rng=vi.fn(()=>.99);expect(traverseRoute(state,'shoring',rng)).toMatchObject({ok:false,state,error:'transport-vote-pending'});expect(rng).not.toHaveBeenCalled();
});
test('technical carriers pay 45 plus 15, other carriers pay 40 plus 15, walkers pay only effective base',()=>{
 const s=createInitialState();const state={...s,characters:s.characters.map(c=>({...c,energy:c.role==='medic'?0:100}))};const cost=roundTwoMovementCost('shoring');const alternative=assessTransportAlternative(state,cost,['medic']);expect(alternative.viable).toBe(true);
 const result=traverseRoute(state,'shoring',()=>.99,{transportPlan:alternative.plan});if(!result.ok)throw new Error(result.error);expect(result.charges.map(c=>c.energyCost)).toEqual([60,0,60,55]);
 const exact={...state,characters:state.characters.map(c=>({...c,energy:c.role==='medic'?0:technical(c.role)?59:55}))};expect(assessTransportAlternative(exact,cost,['medic']).plan.carrierIds).toEqual(['bellhop']);
 const moved=traverseRoute(exact,'shoring',()=>.99,{transportPlan:assessTransportAlternative(exact,cost,['medic']).plan});expect(moved.ok).toBe(true);expect(moved.state.characters.map(c=>c.energy)).toEqual([14,0,14,0]);
});
test('transported specialist pays zero under existing active-specialist rule, no automatic replacement',()=>{
 const s=createInitialState();const state={...s,characters:s.characters.map(c=>({...c,energy:c.role==='maintenance'?40:100}))};const a=assessTransportAlternative(state,roundTwoMovementCost('shoring'),['maintenance']);const moved=traverseRoute(state,'shoring',()=>.99,{transportPlan:a.plan});expect(moved.ok).toBe(true);expect(moved.state.characters[0]!.energy).toBe(40);
 const dead={...state,characters:state.characters.map(c=>c.role==='maintenance'?{...c,health:0}:c)};expect(traverseRoute(dead,'shoring',()=>.99)).toMatchObject({ok:false,error:'specialist-availability-pending'});
});
test('NPC rescue and effective movement costs compose and movement replay never charges twice',()=>{
 const first=resolveRoundOne(createInitialState(),'one','ABANDON_APPROVED');if(!first.ok)throw new Error(first.error);const rescued=resolveRoundTwo(beginRoundTwo(first.state),'npc','RESCUE_APPROVED');if(!rescued.ok)throw new Error(rescued.error);
 const rng=vi.fn(()=>.99);const choice={decisionId:'route',outcome:'shoring' as const,ventilationRevealed:false};const moved=resolveRoundTwoMovement(rescued.state,choice,rng);expect(moved.ok).toBe(true);expect(moved.state.characters.map(c=>c.energy)).toEqual([5,10,5,10]);expect(moved.state.roundTwo!.movement).toMatchObject({charges:[{characterId:'maintenance',energyCost:45},{characterId:'medic',energyCost:40},{characterId:'architect-engineer',energyCost:45},{characterId:'bellhop',energyCost:40}]});expect(resolveRoundTwoMovement(moved.state,choice,rng).state).toBe(moved.state);expect(rng).toHaveBeenCalledTimes(1);
});
test('invalid random rejects the whole surcharge, movement and accident payment',()=>{const s=createInitialState();const result=traverseRoute(s,'shoring',()=>NaN);expect(result).toEqual({ok:false,state:s,error:'invalid-random'});});
test('effective cost helper is the same for availability, classification and actual execution',()=>{const s=createInitialState();const cost=roundTwoMovementCost('shoring');expect(s.characters.map(c=>movementEnergyFor(c,cost))).toEqual([45,40,45,40]);const exact={...s,characters:s.characters.map(c=>({...c,energy:movementEnergyFor(c,cost)}))};expect(routeEnergyAvailability(exact,cost).status).toBe('available');expect(traverseRoute(exact,'shoring',()=>.99).state.characters.every(c=>c.energy===0)).toBe(true);});