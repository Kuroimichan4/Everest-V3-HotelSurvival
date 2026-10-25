import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {GameIntroduction} from './GameIntroduction';
import {GameScreen,type GameActions} from './GameScreen';
import {TransportNotices} from './Transport';

import {emptyGame,gameReducer,type GameState} from './game-state';
import type {TransportCaseView} from '@everest/shared';
const actions:GameActions={onVote:()=>{},onRoute:()=>{},onOpenThree:()=>{},onAdvance:()=>{},onOpenTransport:()=>{},onRetry:()=>{},onGive:()=>{},onTreat:()=>{}};
function fixture():GameState{
 const vote={decisionId:'transport',attemptId:'first',round:3 as const,attemptNumber:1,deadline:61000,serverNow:1000,requiredVotes:2,status:'open' as const,result:null};
 const c:TransportCaseView={preparationId:'prep',round:3,routeId:'fire-door',routeName:'Puerta cortafuegos',routeCost:30,phase:'voting',reason:null,exhaustedIds:['p1'],eligibleIds:['p0','p2','p3'],people:[0,1,2,3].map(i=>({participantId:'p'+i,name:'Persona '+i,...(i===0?{energy:80}:{})})),options:[{id:'carry-all',label:'Transportarlo',viable:true,carrierIds:['p0','p2','p3'],carrierCost:45,authorizedVoterIds:['p0','p2','p3']}],vote,decisions:[],transportedIds:[],abandonedIds:[],charges:[],transfers:[]};
 return {...emptyGame,room:{code:'ABCDEF123456',creatorId:'p0',status:'started',participants:[0,1,2,3].map(i=>({id:'p'+i,name:'Persona '+i,connected:true}))},transport:{cases:[c]},supplies:{gameId:'game',round:3,windowId:null,inventory:{packs:8,medicalUnits:4},characters:[0,1,2,3].map(i=>({participantId:'p'+i,name:'Persona '+i,role:'maintenance',status:'active',...(i===0?{health:80,energy:80}:{})}))},role:{participantId:'p0',role:'maintenance',sheet:{name:'Mantenimiento',responsibility:'Capacidad propia',objective:'Objetivo privado propio',knowledge:[{id:'own',text:'Conocimiento propio autorizado'}]}}};
}
const screen=(s:GameState)=>renderToStaticMarkup(createElement(GameScreen,{state:s,participantId:'p0',connected:true,busy:false,error:'',actions}));
const notices=(c:TransportCaseView)=>renderToStaticMarkup(createElement(TransportNotices,{state:c,participantId:'p0'}));
test.each([60,30,10,7])('prominent single clock uses server remainder %i including recovered attempts',seconds=>{
 const s=fixture();const vote=s.transport!.cases[0]!.vote!;vote.attemptNumber=seconds<=10?3:seconds===30?2:1;vote.deadline=100000;vote.serverNow=100000-seconds*1000;
 const html=screen(s);expect(html.match(/role="timer"/g)).toHaveLength(1);expect(html).toContain('class="vote-seconds">'+seconds+'<');expect(html).toContain('Votación de transporte');expect(html).not.toContain('de 2');
 expect(html.includes('¡Últimos segundos para decidir!')).toBe(seconds<=10);expect(html.indexOf('class="vote-status')).toBeLessThan(html.indexOf('data-panel="action"'));
 expect(screen(structuredClone(s))).toBe(html);
});
test('closed votes and introduction have no active clock',()=>{
 const s=fixture();s.transport!.cases[0]!.vote!.status='closed';expect(screen(s)).not.toContain('role="timer"');
 const html=renderToStaticMarkup(createElement(GameIntroduction));expect(html).toContain('El terremoto llegó sin previo aviso');expect(html).toContain('seis rondas');expect(html).not.toMatch(/role="timer"|conductos|cortafuegos|probabilidad|almacén|veneno/);
});
test('transport notices explain eligible voters and first lack of majority without claiming abstention',()=>{
 const s=fixture();const c=s.transport!.cases[0]!;c.vote!.attemptNumber=2;const html=notices(c);
 expect(html).toContain('Solo los votantes elegibles');expect(html).toContain('primer intento terminó sin mayoría');expect(html).toContain('segundo intento está abierto');expect(html).not.toMatch(/todos se abstuvieron|80|energía exacta/);
});
test('gas and explosion notices match confirmed incidents, personal damage and abandonment',()=>{
 const c=fixture().transport!.cases[0]!;c.vote!.attemptNumber=3;c.crisis={gas:{incidentId:'prep',at:1,victims:[{participantId:'p0',damage:5},{participantId:'p1'}],deceasedIds:[]}};
 expect(notices(c)).toContain('Una tubería ha cedido');expect(notices(c)).toContain('Solo quedan diez segundos');expect(notices(c)).toContain('5 puntos');
 c.phase='sector-evacuated';c.abandonedIds=['p1'];c.crisis.explosion={incidentId:'prep',at:2,victims:[{participantId:'p0',damage:5}],deceasedIds:[]};
 const html=notices(c);expect(html).toContain('puntos adicionales');expect(html).toContain('Compañeros abandonados por no poder desplazarse: 1');expect(html).toContain('No se ha ejecutado ni cobrado');expect(html.match(/data-transport-crisis=/g)).toHaveLength(1);expect(html).not.toContain('Fallecidos por la explosión');
});
test('approved chained decisions do not claim premature movement or abandonment',()=>{
 const c=fixture().transport!.cases[0]!;c.phase='selection';c.decisions=[{stage:'transport',vote:{...c.vote!,status:'closed'},outcome:'carry-one'}];
 expect(notices(c)).toContain('Falta decidir a quién transportar');expect(notices(c)).not.toContain('Desplazamiento completado');
 c.phase='blocked';expect(notices(c)).toContain('El desplazamiento sigue pendiente');
 c.phase='completed';c.transportedIds=['p1'];expect(notices(c)).toContain('Desplazamiento completado. Transportados: Persona 1');
});
test('private sheet is directly visible, foreign role rejected and repeated snapshots add no notices',()=>{
 const s=fixture();const html=screen(s);expect(html).toContain('Objetivo privado propio');expect(html).toContain('Capacidad propia');expect(html).toContain('Conocimiento propio autorizado');expect(html).not.toMatch(/<details class="private-details"/);
 expect(gameReducer(s,{type:'transport',value:structuredClone(s.transport)})).toBe(s);expect(html.match(/data-transport-notice=/g)).toHaveLength(1);
 s.role!.participantId='foreign';expect(screen(s)).not.toContain('Conocimiento propio autorizado');
});
test('browser fixtures cover full screen and introduction with real styles',()=>{
 const dir=new URL('../../../.cache/10e1/',import.meta.url);mkdirSync(dir,{recursive:true});const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 const s=fixture();s.transport!.cases[0]!.vote!.attemptNumber=3;s.transport!.cases[0]!.vote!.deadline=11000;
 for(const [name,html] of [['game',screen(s)],['intro',renderToStaticMarkup(createElement(GameIntroduction))]])writeFileSync(new URL(name+'.html',dir),'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><main class="shell">'+html+'</main></body></html>');
});