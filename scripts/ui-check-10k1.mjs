// Fixtures: vitest run apps/web/src/FinalResults.test.ts
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const directory=path.join(root,".cache","10k1");
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
 for(const name of ['complete','mixed','fatal']){
  await cdp('Page.navigate',{url:pathToFileURL(path.join(directory,name+'.html')).href});
  for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('[data-game-screen=final]')"))break;await pause(50);}
  for(const width of [1440,900,390,320]){
   await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<680});await evaluate('scrollTo(0,0)');
   const geometry=await evaluate("(()=>({overflow:document.documentElement.scrollWidth>innerWidth,collective:document.querySelectorAll('[aria-label=\"Valoración colectiva\"]').length,objectives:document.querySelectorAll('[aria-label=\"Mi objetivo individual\"]').length,epilogues:document.querySelectorAll('[aria-label=\"El destino de tu personaje\"]').length,cards:document.querySelectorAll('[data-player]').length,buttons:document.querySelectorAll('button').length,clipped:[...document.querySelectorAll('.panel')].some(p=>p.scrollWidth>p.clientWidth)}))()");
   assert.equal(geometry.overflow,false);assert.equal(geometry.clipped,false);assert.equal(geometry.collective,1);assert.equal(geometry.objectives,1);assert.equal(geometry.epilogues,1);assert.equal(geometry.cards,4);assert.equal(geometry.buttons,0);
   const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(directory,name+'-'+width+'.png'),Buffer.from(shot.data,'base64'));checks.push({name,width,...geometry});
  }
 }
 await writeFile(path.join(directory,'layout-result.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
}finally{socket?.close();child.kill();}
