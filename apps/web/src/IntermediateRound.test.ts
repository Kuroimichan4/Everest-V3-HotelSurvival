import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { IntermediateRoundView } from "@everest/shared";
import { GameScreen } from "./GameScreen";
import { activeScene, emptyGame, gameReducer } from "./game-state";
import { gameHistory } from "./game-history";

function stage(round:4|5):IntermediateRoundView{return{round,title:round===4?"Descenso entre las ruinas":"El último corredor",narrative:"Contexto de la ronda",preparationId:`prep-${round}`,phase:"preparation",canReveal:false,vote:null,blocked:null,movement:null,options:[{id:"public",name:"Ruta pública",description:"Paso disponible",energyCost:10,danger:"HIGH",selectable:true,availability:{status:"available",reason:null}}]};}
function fixture(round:4|5){return{...emptyGame,intermediates:[stage(4),...(round===5?[stage(5)]:[])],supplies:{gameId:"game",round,windowId:"window",inventory:{packs:8,medicalUnits:4},characters:[0,1,2,3].map(i=>({participantId:`p${i}`,name:`Person ${i}`,status:"active" as const,...(i===0?{health:80,energy:30}:{})}))},role:{participantId:"p0",role:"maintenance" as const,sheet:{name:"Mantenimiento",responsibility:"",objective:"",knowledge:[]}}};}
const actions={onVote:()=>{},onRoute:()=>{},onOpenThree:()=>{},onAdvance:()=>{},onOpenTransport:()=>{},onRetry:()=>{},onGive:()=>{},onTreat:()=>{}};
test.each([4,5] as const)("round %s shows one active scene, four team cards and folded history",round=>{
 const state=fixture(round);expect(activeScene(state)).toMatchObject({round,kind:"intermediate"});
 const html=renderToStaticMarkup(createElement(GameScreen,{state,participantId:"p0",connected:true,busy:false,error:"",actions}));
 expect(html.match(/data-panel="action"/g)).toHaveLength(1);expect(html.match(/data-player=/g)).toHaveLength(4);
 expect(html).toContain(state.intermediates.at(-1)!.title);expect(html).not.toContain("SALIDA DEL HOTEL");expect(html).not.toContain('<details open');
});
test("replayed intermediate snapshots replace data and keep a single history entry",()=>{
 let state=fixture(4);const first=state.intermediates[0]!;first.phase="completed";first.movement={requestId:"move",routeId:"public",routeName:"Ruta pública",energyCost:10,accident:false,victims:[],deceasedIds:[],characters:state.supplies.characters,inventory:state.supplies.inventory};
 for(let i=0;i<4;i++)state=gameReducer(state,{type:"intermediates",value:structuredClone(state.intermediates)}) as typeof state;
 expect(gameHistory(state).filter(e=>e.id==="route:move")).toHaveLength(1);
 state.intermediates.push(stage(5));
 expect(activeScene(state)).toMatchObject({round:5,kind:"intermediate"});
});
test("forced consequence renders own damage and no reopened route vote",()=>{
 const state=fixture(5);state.intermediates.at(-1)!.phase="movement"; state.intermediates.at(-1)!.failedAttempts=[{attemptNumber:1,closedAt:60000},{attemptNumber:2,closedAt:90000}]; state.intermediates.at(-1)!.consequence={decisionId:"v",forcedRouteId:"collapsed-kitchen",routeName:"Cocina industrial derrumbada",victims:[{participantId:"p0",name:"Person 0",damage:10},{participantId:"p1",name:"Person 1"}],deceasedIds:[]};
 const html=renderToStaticMarkup(createElement(GameScreen,{state,participantId:"p0",connected:true,busy:false,error:"",actions}));
 expect(html).toContain("Ruta obligatoria");expect(html).toContain("10 puntos de da");expect(html.match(/Tu personaje ha sufrido/g)).toHaveLength(1);expect(html).not.toContain("Abrir votación");expect(html).not.toContain("Avanzar a ronda");
});

test("first failed attempt displays once and never announces earthquake damage early",()=>{
 const state=fixture(4);state.intermediates[0]!.phase="voting";state.intermediates[0]!.failedAttempts=[{attemptNumber:1,closedAt:60000}];
 const html=renderToStaticMarkup(createElement(GameScreen,{state,participantId:"p0",connected:true,busy:false,error:"",actions}));
 expect(html.match(/Primer intento de votación sin mayoría/g)).toHaveLength(1);expect(html).not.toContain("Tu personaje ha sufrido");expect(html).not.toContain("Ruta obligatoria");
});
test("completed forced route keeps one consequence banner and unique history receipts",()=>{
 let state=fixture(4);const first=state.intermediates[0]!;first.phase="completed";
 first.consequence={decisionId:"vote",forcedRouteId:"cracked-stairs",routeName:"Escalera agrietada",victims:[{participantId:"p0",name:"Person 0",damage:10}],deceasedIds:[]};
 first.failedAttempts=[{attemptNumber:1,closedAt:60000},{attemptNumber:2,closedAt:90000}];
 for(let i=0;i<3;i++)state=gameReducer(state,{type:"intermediates",value:structuredClone(state.intermediates)}) as typeof state;
 const html=renderToStaticMarkup(createElement(GameScreen,{state,participantId:"p0",connected:true,busy:false,error:"",actions}));
 expect(html.match(/data-intermediate-consequence="4"/g)).toHaveLength(1);expect(html).toContain("Ruta obligatoria");
 expect(gameHistory(state).filter(e=>e.id==="earthquake:vote")).toHaveLength(1);
});
