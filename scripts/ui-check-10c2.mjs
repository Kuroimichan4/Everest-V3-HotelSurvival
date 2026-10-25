// Fixtures: vitest run apps/web/src/structural-report-ui.test.ts
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const directory=path.join(root,".cache","10c2");
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
 for(const name of ["architect-preparation","architect-voting","medic-voting"]){
  await cdp("Page.navigate",{url:pathToFileURL(path.join(directory,`${name}.html`)).href});
  for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('.current-action')"))break;await pause(50);}
  for(const width of [1440,900,390,320]){
   await cdp("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<680});await evaluate('scrollTo(0,0)');
   const geometry=await evaluate(`(() => {const cards=[...document.querySelectorAll('.current-action .option-card')];return {overflow:document.documentElement.scrollWidth>innerWidth,reports:document.querySelectorAll('[aria-label="Informe estructural"]').length,pending:document.querySelectorAll('[data-structural-pending]').length,timers:document.querySelectorAll('[role=timer]').length,panels:document.querySelectorAll('[data-panel=action]').length,cardOverflow:cards.some(c=>c.scrollWidth>c.clientWidth),body:document.body.textContent};})()`);
   assert.equal(geometry.overflow,false,`${name}/${width}: desbordamiento`);assert.equal(geometry.cardOverflow,false);assert.equal(geometry.reports,name==="architect-voting"?3:0);assert.equal(geometry.pending,name==="architect-preparation"?1:0);assert.equal(geometry.timers,name==="architect-preparation"?0:1);assert.equal(geometry.panels,1);assert.doesNotMatch(geometry.body,/20 %|35 %|55 %|70 %|accidentProbability/);
   const shot=await cdp("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});await writeFile(path.join(directory,`${name}-${width}.png`),Buffer.from(shot.data,"base64"));checks.push({name,width,reports:geometry.reports,pending:geometry.pending,timers:geometry.timers,noOverflow:!geometry.overflow&&!geometry.cardOverflow});
  }
 }
 await writeFile(path.join(directory,"layout-result.json"),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
}finally{socket?.close();child.kill();}
