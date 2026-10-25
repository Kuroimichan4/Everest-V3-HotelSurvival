// Fixtures: vitest run apps/web/src/personal-death-ui.test.ts
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const directory=path.join(root,".cache","10f21");
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
 for(const name of ["accident","gas","explosion","unexpected","abandoned"]){
  await cdp("Page.navigate",{url:pathToFileURL(path.join(directory,`${name}.html`)).href});
  for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('.current-action')"))break;await pause(50);}
  for(const width of [1440,900,390,320]){
   await cdp("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<680});await evaluate('scrollTo(0,0)');
   const geometry=await evaluate(`(() => {const notice=document.querySelector('[data-personal-death]');const layout=document.querySelector('.game-layout');const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width};};return {overflow:document.documentElement.scrollWidth>innerWidth,panels:document.querySelectorAll('[data-personal-death]').length,timers:document.querySelectorAll('[role=timer]').length,notice:notice?rect(notice):null,layout:rect(layout),font:notice?parseFloat(getComputedStyle(notice.querySelector('p:not(.eyebrow)')).fontSize):0,dialogs:document.querySelectorAll('[role=dialog]').length,enabledActions:[...document.querySelectorAll('.current-action button')].filter(b=>!b.disabled).length,body:document.body.textContent};})()`);
   assert.equal(geometry.overflow,false,`${name}/${width}: desbordamiento`);assert.equal(geometry.panels,name==="abandoned"?0:1);assert.equal(geometry.timers,1);assert.equal(geometry.dialogs,0);assert.equal(geometry.enabledActions,0);assert.doesNotMatch(geometry.body,/venen|sabot|25 %|tirada/i);
   if(geometry.notice){assert.ok(geometry.font>=14);assert.ok(geometry.notice.bottom<=geometry.layout.top);}
   const shot=await cdp("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});await writeFile(path.join(directory,`${name}-${width}.png`),Buffer.from(shot.data,"base64"));
   checks.push({name,width,overflow:geometry.overflow,panels:geometry.panels,noOverlays:geometry.dialogs===0,enabledActions:geometry.enabledActions});
  }
 }
 await writeFile(path.join(directory,"layout-result.json"),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
}finally{socket?.close();child.kill();}
