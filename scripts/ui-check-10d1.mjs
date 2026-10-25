// Ejecutar primero: vitest run apps/web/src/card-layout.test.ts
// Comprobación geométrica sobre las tarjetas renderizadas y el CSS real, sin servidor ni dependencias nuevas.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const directory=path.join(root,".cache","10d1");
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
 for(const role of ["bellhop","medic"]){
  await cdp("Page.navigate",{url:pathToFileURL(path.join(directory,`${role}.html`)).href});
  for(let i=0;i<50;i++){if(await evaluate("document.querySelectorAll('.player-card').length===4"))break;await pause(50);}
  for(const width of [1440,900,390,320]){
   await cdp("Emulation.setDeviceMetricsOverride",{width,height:1400,deviceScaleFactor:1,mobile:width<680});
   const geometry=await evaluate(`(() => {const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width};};return {overflow:document.documentElement.scrollWidth>innerWidth,cards:[...document.querySelectorAll('.player-card')].map(c=>({card:rect(c),button:rect(c.querySelector('button')),overflow:c.scrollWidth>c.clientWidth,disabled:c.querySelector('button').disabled}))};})()`);
   assert.equal(geometry.overflow,false,`${role}/${width}: desbordamiento de página`);
   const rows=new Map();
   for(const c of geometry.cards){assert.equal(c.overflow,false,`${role}/${width}: desbordamiento de tarjeta`);assert.ok(c.button.bottom<=c.card.bottom);const key=Math.round(c.card.top);rows.set(key,[...(rows.get(key)??[]),c]);}
   for(const cards of rows.values()){assert.ok(Math.max(...cards.map(c=>c.button.bottom))-Math.min(...cards.map(c=>c.button.bottom))<=1,`${role}/${width}: botones desalineados`);assert.ok(Math.max(...cards.map(c=>c.card.height))-Math.min(...cards.map(c=>c.card.height))<=1);}
   assert.ok(geometry.cards.some(c=>c.disabled));checks.push({role,width,rows:rows.size,aligned:true,noOverflow:true});
  }
 }
 await writeFile(path.join(directory,"layout-result.json"),JSON.stringify(checks,null,2));
 console.log(JSON.stringify(checks,null,2));
}finally{socket?.close();child.kill();}
