// Ejecutar primero: vitest run apps/web/src/card-layout.test.ts
// Comprobación geométrica sobre las tarjetas renderizadas y el CSS real, sin servidor ni dependencias nuevas.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const directory=path.join(root,".cache","10f2");
const profile=await mkdtemp(path.join(directory,"browser-"));
const child=spawn(process.env.BROWSER_EXECUTABLE??"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{windowsHide:true,stdio:"ignore"});
let launchError;child.on("error",e=>{launchError=e;});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try{
 let port;
 for(let i=0;i<100;i++){if(launchError)throw launchError;try{port=(await readFile(path.join(profile,"DevToolsActivePort"),"utf8")).split(/\r?\n/)[0];break;}catch{await pause(100);}}
 assert.ok(port,"El navegador no inició DevTools");
 const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 socket=new WebSocket(pages.find(p=>p.type==="page").webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
 let serial=0;const pending=new Map();
 socket.addEventListener("message",e=>{const m=JSON.parse(e.data);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await cdp("Runtime.evaluate",{expression,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;};
 await cdp("Runtime.enable");
 await cdp("Page.enable");
 const checks=[];
 for(const name of ["bellhop","medic","death"]){
  await cdp("Page.navigate",{url:pathToFileURL(path.join(directory,`${name}.html`)).href});
  for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('.vote-status')"))break;await pause(50);}
  for(const width of [1440,900,390,320]){
   await cdp("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<680});
   await evaluate('scrollTo(0,0)');
   const geometry=await evaluate(`(() => {const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};};const action=document.querySelector('.current-action');const capacity=document.querySelector('.bellhop-sabotage');const cardButtons=[...document.querySelectorAll('.player-card button')];return {overflow:document.documentElement.scrollWidth>innerWidth,timers:document.querySelectorAll('[role=timer]').length,capacities:document.querySelectorAll('[data-private-capacity]').length,deaths:document.querySelectorAll('[data-medical-death]').length,privateAccordion:!!document.querySelector('details.private-details'),action:rect(action),capacity:capacity?rect(capacity):null,cardButtons:cardButtons.map(b=>({button:rect(b),card:rect(b.closest('.player-card'))})),noOverlays:document.querySelectorAll('[role=dialog]').length===0};})()`);
   assert.equal(geometry.overflow,false,`${name}/${width}: desbordamiento`);assert.equal(geometry.timers,1);assert.equal(geometry.capacities,name==="bellhop"?1:0);assert.equal(geometry.deaths,name==="death"?1:0);assert.equal(geometry.privateAccordion,false);assert.equal(geometry.noOverlays,true);
   if(geometry.capacity){if(width<680)assert.ok(geometry.capacity.top>=geometry.action.bottom);else assert.ok(geometry.capacity.bottom<=geometry.action.top||geometry.capacity.top>=geometry.action.bottom||geometry.capacity.width<400);}
   const rows=new Map();for(const item of geometry.cardButtons){assert.ok(item.button.bottom<=item.card.bottom);const key=Math.round(item.card.top);rows.set(key,[...(rows.get(key)??[]),item]);}for(const cards of rows.values())assert.ok(Math.max(...cards.map(c=>c.button.bottom))-Math.min(...cards.map(c=>c.button.bottom))<=1);
   const shot=await cdp("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});await writeFile(path.join(directory,`${name}-${width}.png`),Buffer.from(shot.data,"base64"));
   checks.push({name,width,overflow:geometry.overflow,timers:geometry.timers,capacities:geometry.capacities,deaths:geometry.deaths,noOverlays:geometry.noOverlays,aligned:true});
  }
 }
 await writeFile(path.join(directory,"layout-result.json"),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
}finally{socket?.close();child.kill();}
