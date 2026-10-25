// Run after npm run build. Starts an isolated app and Vite; no existing room is touched.
import {createServer} from 'vite';
import {io} from 'socket.io-client';
import {buildApp} from '../apps/server/dist/app.js';
import {RoomManager} from '../apps/server/dist/rooms/manager.js';
import {mkdir} from 'node:fs/promises';
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const directory=path.join(root,'.cache','10i');await mkdir(directory,{recursive:true});
let time=Date.now();const tasks=new Set();
const clock={now:()=>time,schedule:(run,delay)=>{const task={at:time+delay,run};tasks.add(task);return()=>tasks.delete(task);}};
const advance=ms=>{time+=ms;for(const task of [...tasks])if(task.at<=time){tasks.delete(task);task.run();}};
const manager=new RoomManager(()=>0,clock);const app=buildApp({roomManager:manager});await app.listen({host:'127.0.0.1',port:0});
const backend='http://127.0.0.1:'+app.server.address().port;
const vite=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false,proxy:{'/api':{target:backend},'/socket.io':{target:backend,ws:true}}}});await vite.listen();
const url='http://127.0.0.1:'+vite.httpServer.address().port;const clients=[];
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
 const evaluate=async expression=>{const r=await cdp("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;};
 await cdp("Runtime.enable");
 await cdp("Page.enable");

 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(50);}throw new Error('Timeout: '+expression);};
 await cdp('Page.navigate',{url});await wait("!!document.querySelector('.room-form input')");
 await evaluate("(()=>{const e=document.querySelector('.room-form input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Visual Host');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await pause(100);await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Crear sala').click()");
 await wait("!!document.querySelector('.chat-panel')");
 const code=[...manager.rooms.keys()][0];
 for(let i=1;i<4;i++){const client=io(backend,{reconnection:false});clients.push(client);await new Promise(resolve=>client.on('connect',resolve));const reply=await client.timeout(3000).emitWithAck('room:join',{name:'Visual '+i,code});assert.equal(reply.ok,true);}
 await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Iniciar partida'&&!b.disabled)");
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Iniciar partida').click()");
 await wait("!!document.querySelector('[role=timer]')");
 const before=manager.publicVote(code);const voteDeadline=before.deadline;
 const checks=[];
 for(const width of [1440,900,390,320]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<680});
  await evaluate("scrollTo(0,0)");
  if(width<=1100&&!await evaluate("document.querySelector('.chat-panel').classList.contains('is-open')"))await evaluate("document.querySelector('.chat-toggle').click()");
  await pause(100);
  const geometry=await evaluate("(()=>{const timer=document.querySelector('[role=timer]');const chat=document.querySelector('.chat-panel');return {overflow:document.documentElement.scrollWidth>innerWidth,timers:document.querySelectorAll('[role=timer]').length,chatVisible:chat.getBoundingClientRect().width>0,timerVisible:getComputedStyle(timer).display!=='none',voteEnabled:[...document.querySelectorAll('#current-action button')].some(b=>!b.disabled),horizontalChat:chat.scrollWidth>chat.clientWidth};})()");
  assert.equal(geometry.overflow,false);assert.equal(geometry.horizontalChat,false);assert.equal(geometry.timers,1);assert.equal(geometry.timerVisible,true);assert.equal(geometry.voteEnabled,true);
  const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(directory,'chat-'+width+'.png'),Buffer.from(shot.data,'base64'));checks.push({width,...geometry});
 }
 await evaluate("document.querySelector('.chat-panel textarea').focus()");await cdp('Input.insertText',{text:'<script>window.chatInjected=true</script>'});
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',modifiers:8,text:'\r'});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',modifiers:8,text:'\r'});
 await cdp('Input.insertText',{text:'Segunda línea'});assert.ok((await evaluate("document.querySelector('.chat-panel textarea').value")).includes('\n'));
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
 await wait("document.querySelectorAll('.chat-message:not(.is-npc)').length===1");assert.equal(await evaluate('window.chatInjected===true'),false);
 assert.equal(manager.publicVote(code).deadline,voteDeadline);

 await evaluate("document.querySelector('.chat-toggle').click()");
 const maintenance=clients.find(c=>manager.privateRole(c.id)?.role==='maintenance');assert.ok(maintenance);
 assert.equal((await maintenance.timeout(3000).emitWithAck('chat:send',{requestId:1,text:'Mensaje mientras está cerrado'})).ok,true);
 await wait("document.querySelector('.chat-toggle').textContent.includes('1 nuevos')");
 await evaluate("document.querySelector('.chat-toggle').click()");await wait("!document.querySelector('.chat-toggle').textContent.includes('nuevos')");
 await evaluate("document.querySelector('.chat-vote-link').click()");
 const button=await evaluate("[...document.querySelectorAll('#current-action button')].filter(b=>!b.disabled).length");assert.ok(button>0);
 await evaluate('window.__beforeChatReload=true');
 await cdp('Page.reload');await wait("window.__beforeChatReload!==true && document.querySelectorAll('.chat-message:not(.is-npc)').length===2");
 assert.equal(await evaluate("document.querySelectorAll('.chat-message:not(.is-npc)').length"),2);
 assert.equal(manager.publicVote(code).deadline,voteDeadline);
 const game=manager.rooms.get(code).game;
 game.state={...game.state,characters:game.state.characters.map((c,i)=>({...c,energy:i===3?0:100}))};
 const npc=manager.publicVote(code);
 for(const client of clients)assert.equal((await client.timeout(3000).emitWithAck('vote:cast',{decisionId:npc.decisionId,attemptId:npc.attemptId,optionId:'abandon'})).ok,true);
 await wait("[...document.querySelectorAll('#current-action button')].some(b=>b.textContent==='Comprobar energía y continuar')");
 await evaluate("[...document.querySelectorAll('#current-action button')].find(b=>b.textContent==='Comprobar energía y continuar').click()");
 await wait("!!document.querySelector('[role=timer]')");
 advance(60000);advance(30000);
 await wait("document.querySelector('[role=timer]')?.textContent.includes('10')");
 const extraordinary=manager.publicVote(code);assert.equal(extraordinary.deadline-clock.now(),10000);
 await evaluate("document.querySelector('.chat-toggle').click()");
 assert.equal(await evaluate("document.querySelector('.chat-panel').classList.contains('is-open')"),true);
 await evaluate("document.querySelector('.chat-vote-link').click()");
 await evaluate("[...document.querySelectorAll('#current-action button')].find(b=>b.textContent==='Votar Transportarlo').click()");
 assert.equal(await evaluate("document.querySelector('.chat-panel').classList.contains('is-open')"),true);
 const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(directory,'extraordinary-320.png'),Buffer.from(shot.data,'base64'));
 for(const client of clients.slice(0,1))assert.equal((await client.timeout(3000).emitWithAck('vote:cast',{decisionId:extraordinary.decisionId,attemptId:extraordinary.attemptId,optionId:'carry-all'})).ok,true);
 assert.equal(manager.publicVote(code).status,'closed');
 await writeFile(path.join(directory,'layout-result.json'),JSON.stringify({checks,enter:true,shiftEnter:true,escapedHtml:true,unread:true,refresh:true,deadlinePreserved:true,extraordinaryVoteWithChatOpen:true},null,2));
 console.log(JSON.stringify({checks,interaction:'Enter, Shift+Enter, literal HTML, unread, F5 and unchanged deadline passed'},null,2));
}finally{socket?.close();child.kill();clients.forEach(c=>c.disconnect());await vite.close();await app.close();}
