import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { AssignedRole } from "@everest/shared";
import { GameScreen } from "./GameScreen";
import { emptyGame, type GameState } from "./game-state";
import { RoundIntroduction } from "./RouteInformation";
const roles:AssignedRole[]=["maintenance","medic","architect-engineer","bellhop"];
const actions={onVote:()=>{},onRoute:()=>{},onOpenThree:()=>{},onAdvance:()=>{},onOpenTransport:()=>{},onRetry:()=>{},onGive:()=>{},onTreat:()=>{}};
function fixture(role:AssignedRole):GameState{return{...emptyGame,role:{participantId:"p0",role,sheet:{name:"Mi personaje",responsibility:"",objective:"Privado",knowledge:[]}},supplies:{gameId:"game",round:3,windowId:"prep",inventory:{packs:8,medicalUnits:4},characters:roles.map((r,i)=>({participantId:`p${i}`,name:`Person ${i}`,role:r,status:"active",...(i===0||role==="medic"?{health:80}:{}),...(i===0?{energy:50}:{})})),resourceActions:roles.map((_,i)=>({participantId:`p${i}`,...(role==="medic"?{medicalEligibility:{allowed:true,reason:null}}:role==="bellhop"?{packEligibility:{allowed:true,reason:null}}:{})}))},roundThree:{round:3,phase:"preparation",options:[{id:"fire-door",name:"Puerta cortafuegos",description:"Una puerta pesada necesita la palanca.",energyCost:30,availability:{status:"available",reason:null},}],vote:null,selection:null,forced:false,earthquake:false,blockedRoutes:[],movement:null,blocked:null,afterRoute:null,previousNpcs:[]}};}
const render=(state:GameState)=>renderToStaticMarkup(createElement(GameScreen,{state,participantId:"p0",connected:true,busy:false,error:"",actions}));
test.each(roles)("role %s: four public roles and only authorized direct buttons, no dropdowns",role=>{
 const html=render(fixture(role));for(const label of ["Mantenimiento","Médico","Arquitecto / Ingeniero","Botones"])expect(html).toContain(label);
 expect(html.match(/data-player=/g)).toHaveLength(4);expect(html.match(/aria-label="Dar Botiquín a /g)??[]).toHaveLength(role==="medic"?4:0);
 expect(html.match(/aria-label="Dar Pack a /g)??[]).toHaveLength(role==="bellhop"?4:0);expect(html).not.toContain("<select");
 expect(html.match(/data-panel="action"/g)).toHaveLength(1);expect(html).not.toContain('<details open');
 expect(html.match(/<progress/g)).toHaveLength(role==="medic"?7:4); // propia ficha + tarjeta propia, salud ajena solo Médico
 expect(html.includes("MODERADO")).toBe(false);
});
test("fire door publicly displays its energy and tool cost before any route vote or reward",()=>{
 const html=render(fixture("maintenance"));expect(html).toContain("−1 palanca");expect(html).toContain("−30 energía");expect(html).toContain("se pierde al completar el recorrido");
 expect(html).not.toContain("dos unidades médicas");expect(html).not.toContain("almacén");
});
test.each(["energy-full","supplies-not-open","no-packs","character-dead"])("card pack reason %s is explicit without foreign energy values",reason=>{
 const state=fixture("bellhop");state.supplies!.resourceActions![1]!.packEligibility={allowed:false,reason};const html=render(state);
 expect(html).toContain('disabled="" aria-label="Dar Pack a Person 1"');expect(html).not.toContain("undefined");
});
test.each(["health-full-pending","treatment-used","no-medical-units","character-dead"])("card medical reason %s disables that patient",reason=>{
 const state=fixture("medic");state.supplies!.resourceActions![2]!.medicalEligibility={allowed:false,reason};expect(render(state)).toContain('disabled="" aria-label="Dar Botiquín a Person 2"');
});
test.each([1,2,3,6])("round %i public introduction contains no unencountered NPC, reward or classification",round=>{
 const html=renderToStaticMarkup(createElement(RoundIntroduction,{round}));expect(html.length).toBeGreaterThan(100);
 expect(html).not.toMatch(/BAJO|MODERADO|ALTO|EXTREMO|%|almacén|unidades médicas/);
 if(round!==1)expect(html).not.toContain("superviviente");
});

test("round 2 preparation presents the server narrative and technical requirements before voting",()=>{
 const state=fixture("maintenance");state.supplies!.round=2;state.roundThree=null;
 state.roundTwo={round:2,phase:"route-pending",routeChoice:{phase:"preparation",ventilationRevealed:false,options:[{id:"shoring",name:"Despeje y apuntalamiento",description:"Se necesitan Mantenimiento y Arquitecto para apuntalar el paso.",energyCost:40,blocked:null,availability:{status:"available",reason:null}}],vote:null,result:null,privateRoute:{id:"ventilation",name:"Conductos de ventilación",description:"Un paso de servicio conocido por Mantenimiento.",energyCost:30}},movement:null,npcId:"round-two-survivor",mobility:"walks-with-help",npc:"pending",previousNpc:"abandoned",blocked:null,result:null,microearthquake:false,characters:state.supplies!.characters,inventory:state.supplies!.inventory};
 const html=render(state);expect(html).toContain("Se necesitan Mantenimiento y Arquitecto");expect(html).toContain("Conocimiento de Mantenimiento");expect(html).toContain("−40 energía");expect(html).toContain("−30 energía");
 expect(html).not.toContain("Un segundo superviviente necesita ayuda");
});
