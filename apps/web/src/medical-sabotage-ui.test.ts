import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
import type {AssignedRole,MedicalSabotageInput,MedicalSabotageReply,PrivateMedicalSabotage} from '@everest/shared';
import {BellhopSabotage} from './BellhopSabotage';
import {GameScreen,type GameActions} from './GameScreen';
import {gameHistory} from './game-history';
import {emptyGame,gameReducer,type GameState} from './game-state';
import {SabotageRequest} from './sabotage-request';
import {bindGameSocket,type GameSocket} from './game-socket';
import {SUDDEN_DEATH_NARRATIVES} from '../../server/src/simulation/medical-sabotage';
const roles:AssignedRole[]=['bellhop','medic','maintenance','architect-engineer'];
const actions:GameActions={onVote:()=>{},onRoute:()=>{},onOpenThree:()=>{},onAdvance:()=>{},onOpenTransport:()=>{},onRetry:()=>{},onGive:()=>{},onTreat:()=>{},onSabotage:()=>{}};
function fixture(role:AssignedRole='bellhop'):GameState{
 return {...emptyGame,room:{code:'ABCDEF123456',creatorId:'p0',status:'started',participants:roles.map((_,i)=>({id:'p'+i,name:'Persona '+i,connected:true}))},role:{participantId:'p0',role,sheet:{name:({bellhop:'Botones',medic:'Médico',maintenance:'Mantenimiento','architect-engineer':'Arquitecto / Ingeniero'})[role],responsibility:'Capacidad propia',objective:role==='bellhop'?'Conseguir que un jugador humano muera envenenado como consecuencia de su sabotaje.':'Objetivo propio',knowledge:[]}},vote:{decisionId:'vote',attemptId:'first',round:1,attemptNumber:1,deadline:61000,serverNow:1000,requiredVotes:3,status:'open',result:null},supplies:{gameId:'game',round:1,windowId:'prep',inventory:{packs:8,medicalUnits:4},characters:[role,...roles.filter(r=>r!==role)].map((r,i)=>({participantId:'p'+i,name:'Persona '+i,role:i===0?role:r,status:'active',...(i===0?{energy:80}:{}),...(i===0||role==='medic'?{health:60}:{})})),resourceActions:roles.map((_,i)=>({participantId:'p'+i,...(role==='bellhop'?{packEligibility:{allowed:true,reason:null}}:role==='medic'?{medicalEligibility:{allowed:true,reason:null}}:{})}))},medical:{gameId:'game',round:1,characters:[],inventory:{packs:8,medicalUnits:4},treatments:[]}};
}
const secret=(extra:Partial<PrivateMedicalSabotage>={}):PrivateMedicalSabotage=>({participantId:'p0',gameId:'game',performed:false,objectiveFulfilled:false,canManipulate:true,reason:null,...extra});
const render=(state:GameState,privateSabotage:PrivateMedicalSabotage|null=secret(),connected=true)=>renderToStaticMarkup(createElement(GameScreen,{state,privateSabotage,participantId:'p0',connected,busy:false,error:'',actions}));
test.each(roles)('role %s has only its authorized capacity and keeps resource cards',role=>{
 const html=render(fixture(role));expect(html.includes('Manipular medicación')).toBe(role==='bellhop');expect(html.includes('sabotaje')).toBe(role==='bellhop');expect(html.match(/data-player=/g)).toHaveLength(4);expect(html.match(/aria-label="Dar Pack a /g)??[]).toHaveLength(role==='bellhop'?4:0);expect(html.match(/aria-label="Dar Botiquín a /g)??[]).toHaveLength(role==='medic'?4:0);
 expect(html.match(/role="timer"/g)).toHaveLength(1);expect(html).not.toContain('25 %');expect(html).not.toContain('dos huéspedes');expect(html).not.toMatch(/<details class="private-details"/);
});
test.each(['available','pending','fulfilled','empty','closed','disconnected','missing'] as const)('private capacity state %s comes from server and never assumes success',kind=>{
 const value=kind==='missing'?null:secret(kind==='pending'?{performed:true,canManipulate:false,reason:'sabotage-already-used'}:kind==='fulfilled'?{performed:true,objectiveFulfilled:true,canManipulate:false,reason:'sabotage-already-used'}:kind==='empty'?{canManipulate:false,reason:'no-medical-units'}:kind==='closed'?{canManipulate:false,reason:'game-finished'}:{});
 const html=render(fixture(),value,kind!=='disconnected');expect(html.includes('<button>Manipular medicación</button>')).toBe(kind==='available');
 expect(html.includes('Ahora solo queda esperar')).toBe(kind==='pending');expect(html.includes('Has cumplido tu objetivo individual')).toBe(kind==='fulfilled');if(kind==='empty')expect(html).toContain('No quedan unidades médicas');if(kind==='closed')expect(html).toContain('La partida ha terminado');
});
test('foreign owner, other game and revoked role never expose someone else private result',()=>{
 expect(render(fixture(),secret({participantId:'other',performed:true,objectiveFulfilled:true}))).not.toContain('Has cumplido tu objetivo');expect(render(fixture(),secret({gameId:'other',performed:true}))).not.toContain('Ahora solo queda esperar');
 const s=fixture('bellhop');s.role=null;s.supplies!.characters[0]!.status='dead';s.supplies!.characters[0]!.health=0;expect(render(s,secret({performed:true,objectiveFulfilled:true,canManipulate:false}))).toContain('Objetivo: Cumplido');expect(render(s,secret({performed:true,objectiveFulfilled:true,canManipulate:false}))).not.toContain('<button>Manipular medicación</button>');
});
test.each(SUDDEN_DEATH_NARRATIVES)('recorded death variant is public, stable and contains no attribution: %s',message=>{
 const s=fixture('medic');s.medical!.deaths=[{participantId:'p1',round:1,message},{participantId:'p1',round:1,message}];const html=render(s,null);expect(html.match(/data-medical-death=/g)).toHaveLength(1);expect(gameHistory(s).filter(e=>e.id.startsWith('medical-death:'))).toHaveLength(1);expect(html).toContain('Persona 1 ha fallecido');expect(html).toContain(message);expect(html).not.toMatch(/venen|sabot|tirada|25 %|objectiveFulfilled/i);expect(render(structuredClone(s),null)).toBe(html);expect(gameReducer(s,{type:'medical',value:structuredClone(s.medical)})).toBe(s);
});
test('no death message is inferred from treatment or low health alone',()=>{const s=fixture('medic');s.medical!.treatments=[{participantId:'p1',round:1,healthRestored:0}];s.supplies!.characters[1]!.health=0;expect(render(s,null)).not.toContain('data-medical-death=');});
test('request controller prevents repeated clicks and blocks after confirmed receipt',()=>{
 const request=new SabotageRequest('game');let done:((r:MedicalSabotageReply|null)=>void)|undefined;const send=vi.fn((_input:MedicalSabotageInput,cb:(r:MedicalSabotageReply|null)=>void)=>{done=cb;});const changed=vi.fn();request.run(send,changed);request.run(send,changed);expect(send).toHaveBeenCalledTimes(1);const input=send.mock.calls[0]![0];done!({ok:true,requestId:input.requestId,state:secret({performed:true})});request.run(send,changed);expect(send).toHaveBeenCalledTimes(1);expect(request.confirmed).toBe(true);
});
test('timeout retries reuse id and late replies cannot replace a newer in-flight request',()=>{
 const request=new SabotageRequest('game');const callbacks:((r:MedicalSabotageReply|null)=>void)[]=[];const send=vi.fn((_i:MedicalSabotageInput,done:(r:MedicalSabotageReply|null)=>void)=>{callbacks.push(done);});request.run(send,()=>{});callbacks[0]!(null);expect(request.message).toContain('Sin confirmación');expect(request.confirmed).toBe(false);request.run(send,()=>{});expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);callbacks[0]!({ok:false,error:'no-medical-units'});expect(request.sending).toBe(true);callbacks[1]!({ok:false,error:'no-medical-units'});expect(request.message).toContain('No quedan unidades médicas');expect(request.confirmed).toBe(false);
});
test('private socket adapter authenticates owner, stays outside public reducer, cleans up and resets on disconnect',()=>{
 const listeners=new Map<string,Set<(...args:unknown[])=>void>>();const socket={on:(e:string,fn:(...a:unknown[])=>void)=>{const set=listeners.get(e)??new Set();set.add(fn);listeners.set(e,set);},off:(e:string,fn:(...a:unknown[])=>void)=>listeners.get(e)?.delete(fn)} as unknown as GameSocket;const dispatch=vi.fn();const privateState=vi.fn();const lifecycle={connect:()=>{},disconnect:()=>{},error:()=>{},participantId:()=> 'p0',sabotage:privateState};
 const unbind=bindGameSocket(socket,dispatch,lifecycle);const callback=[...listeners.get('medical:sabotage-private')!][0]!;callback(secret({participantId:'other'}));expect(privateState).not.toHaveBeenCalled();callback(secret());expect(privateState).toHaveBeenCalledWith(secret());expect(dispatch).not.toHaveBeenCalled();for(const fn of listeners.get('disconnect')!)fn();expect(privateState).toHaveBeenLastCalledWith(null);unbind();callback(secret());expect(privateState).toHaveBeenCalledTimes(2);const second=bindGameSocket(socket,dispatch,lifecycle);for(const set of listeners.values())expect(set.size).toBe(1);second();for(const set of listeners.values())expect(set.size).toBe(0);
});
test('new host label and advance controls follow authoritative room update and survive snapshot restore',()=>{
 const s=fixture();s.summary={gameId:'game',decisionId:'one',round:1,completed:true,result:'ABANDON_APPROVED',npc:'abandoned',microearthquake:false,costs:{rescueEnergy:0,movementEnergy:25,damage:0},characters:s.supplies!.characters,inventory:s.supplies!.inventory};s.room!.creatorId='p1';expect(render(s)).toContain('Anfitrión: Persona 1');expect(render(s)).not.toContain('>Avanzar a ronda 2</button>');s.room!.creatorId='p0';expect(render(s)).toContain('>Avanzar a ronda 2</button>');expect(render(structuredClone(s))).toBe(render(s));
});
test('real CSS browser fixtures include bellhop action, normal medic and uncertain death',()=>{
 const dir=new URL('../../../.cache/10f2/',import.meta.url);mkdirSync(dir,{recursive:true});const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');const death=fixture('medic');death.medical!.deaths=[{participantId:'p2',round:1,message:SUDDEN_DEATH_NARRATIVES[0]}];death.supplies!.characters[2]!.health=0;death.supplies!.characters[2]!.status='dead';death.supplies!.resourceActions![2]!.medicalEligibility={allowed:false,reason:'character-dead'};
 for(const [name,html] of [['bellhop',render(fixture())],['medic',render(fixture('medic'),null)],['death',render(death,null)]])writeFileSync(new URL(name+'.html',dir),'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><main class="shell">'+html+'</main></body></html>');
});
test('closed private capacity never asks bellhop to keep waiting and uses final authoritative state',()=>{
 const html=renderToStaticMarkup(createElement(BellhopSabotage,{state:secret({performed:true,objectiveFulfilled:false,canManipulate:false,reason:'game-finished'}),participantId:'p0',gameId:'game',authorized:false,connected:true,readOnly:true}));expect(html).toContain('Objetivo: Incumplido');expect(html).not.toContain('Ahora solo queda esperar');expect(html).not.toContain('<button');
});