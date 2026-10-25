// Ejecutar primero: vitest run apps/web/src/card-layout.test.ts
// Comprobación geométrica sobre las tarjetas renderizadas y el CSS real, sin servidor ni dependencias nuevas.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const directory=path.join(root,".cache","10e1");
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
 for(const name of ["game","intro"]){
  await cdp("Page.navigate",{url:pathToFileURL(path.join(directory,`${name}.html`)).href});
  for(let i=0;i<50;i++){if(await evaluate(name==="game"?"!!document.querySelector('.vote-status')":"!!document.querySelector('.game-introduction')"))break;await pause(50);}
  for(const width of [1440,900,390,320]){
   await cdp("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<680});
   const geometry=await evaluate(`(() => {const timer=document.querySelector('[role=timer]');const sheet=document.querySelector('.character-sheet');const banner=document.querySelector('.vote-status');return {overflow:document.documentElement.scrollWidth>innerWidth,timers:document.querySelectorAll('[role=timer]').length,timerSize:timer?parseFloat(getComputedStyle(timer).fontSize):0,sheetVisible:sheet?sheet.getBoundingClientRect().height>0:true,closedSheet:!!document.querySelector('details.private-details'),bannerHeight:banner?banner.getBoundingClientRect().height:0,controls:[...document.querySelectorAll('.vote-panel button')].every(b=>b.getBoundingClientRect().top>=banner.getBoundingClientRect().bottom)};})()`);
   assert.equal(geometry.overflow,false,`${name}/${width}: desbordamiento`);
   if(name==="game"){assert.equal(geometry.timers,1);assert.ok(geometry.timerSize>=40);assert.equal(geometry.closedSheet,false);assert.equal(geometry.sheetVisible,true);assert.equal(geometry.controls,true);assert.ok(geometry.bannerHeight<220);}
   else assert.equal(geometry.timers,0);
   const shot=await cdp("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});await writeFile(path.join(directory,`${name}-${width}.png`),Buffer.from(shot.data,"base64"));
   checks.push({name,width,...geometry});
  }
 }
 await writeFile(path.join(directory,"layout-result.json"),JSON.stringify(checks,null,2));
 console.log(JSON.stringify(checks,null,2));
}finally{socket?.close();child.kill();}
