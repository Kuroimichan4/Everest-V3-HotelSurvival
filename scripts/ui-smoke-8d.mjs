// Prueba real de la UI de desarrollo (StrictMode), sin librería de navegador adicional.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, ".cache", "8d");
await mkdir(artifacts, { recursive: true });
const browserPath = process.env.BROWSER_EXECUTABLE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
if (!existsSync(browserPath)) throw new Error("Indica un navegador Chromium instalado mediante BROWSER_EXECUTABLE.");
const children = [];
const launch = (file, args, options = {}) => {
  const child = spawn(file, args, { cwd: root, windowsHide: true, stdio: "pipe", ...options });
  children.push(child); child.on("error", e => { process.stderr.write(`${e.message}\n`); });
  return child;
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 15000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { try { const value = await test(); if (value) return value; } catch (error) { last = error; } await delay(100); }
  throw new Error(`No se cumplió: ${label}${last ? ` (${last.message})` : ""}`);
}
let ws;
const pageSockets = new Map();
const checks = [];
try {
  launch(process.execPath, ["apps/server/dist/index.js"], { env: { ...process.env, PORT: "3101", HOST: "127.0.0.1", WEB_ORIGIN: "http://127.0.0.1:5183" } });
  launch(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5183", "--strictPort"], { cwd: path.join(root, "apps/web"), env: { ...process.env, BACKEND_URL: "http://127.0.0.1:3101" } });
  await until(async () => (await fetch("http://127.0.0.1:3101/api/health")).ok, "servidor");
  await until(async () => (await fetch("http://127.0.0.1:5183")).ok, "Vite");
  const profile = await mkdtemp(path.join(artifacts, "browser-"));
  launch(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"]);
  const portFile = await until(async () => readFile(path.join(profile, "DevToolsActivePort"), "utf8"), "DevTools");
  const [port, endpoint] = portFile.trim().split(/\r?\n/);
  ws = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let serial = 0; const pending = new Map(); const socketCounts = new Map(); const errors = [];
  const receive = (event, channel) => {
    const m = JSON.parse(event.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p?.timer); if (m.error) p?.reject(new Error(m.error.message)); else p?.resolve(m.result); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
    if (m.method === "Network.webSocketCreated" && m.params.url.includes("/socket.io/")) { const set = socketCounts.get(channel) ?? new Set(); set.add(m.params.requestId); socketCounts.set(channel, set); }
    if (m.method === "Network.webSocketClosed") socketCounts.get(channel)?.delete(m.params.requestId);
  };
  ws.addEventListener("message", event => receive(event, "browser"));
  const cdp = (method, params = {}, channel) => new Promise((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); (pageSockets.get(channel) ?? ws).send(JSON.stringify({ id, method, params }));
  });
  const tabs = [];
  for (let i = 0; i < 4; i++) {
    const target = await cdp("Target.createTarget", { url: "about:blank" });
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const info = list.find(item => item.id === target.targetId);
    const page = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { page.addEventListener("open", resolve, { once: true }); page.addEventListener("error", reject, { once: true }); });
    pageSockets.set(target.targetId, page); tabs.push(target.targetId);
    page.addEventListener("message", event => receive(event, target.targetId));
    await cdp("Runtime.enable", {}, target.targetId); await cdp("Network.enable", {}, target.targetId);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }, target.targetId);
    await cdp("Page.navigate", { url: "http://127.0.0.1:5183" }, target.targetId);
  }
  const evaluate = async (tab, expression) => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, tabs[tab]);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const click = async (tab, text) => {
    await until(() => evaluate(tab, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`), `boton disponible ${text}`);
    return evaluate(tab, `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Botón no disponible: '+${JSON.stringify(text)}); b.click(); return true; })()`);
  };
  const input = (tab, index, value) => evaluate(tab, `(() => { const el = document.querySelectorAll('.room-form input')[${index}]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  for (let i = 0; i < 4; i++) {
    await until(() => evaluate(i, `!!document.querySelector('.room-form input') && document.body.textContent.includes('Conectado')`), "formulario");
    await input(i, 0, ["Ana", "Bruno", "Celia", "Diego"][i]);
  }
  await click(0, "Crear sala");
  const code = await until(() => evaluate(0, `document.querySelector('.room-code strong')?.textContent`), "código");
  for (let i = 1; i < 4; i++) { await input(i, 1, code); await click(i, "Unirse a sala"); }
  await until(() => evaluate(0, `[...document.querySelectorAll('button')].some(b=>b.textContent==='Iniciar partida'&&!b.disabled)`), "cuatro conectados");
  await click(0, "Iniciar partida");
  for (let i = 0; i < 4; i++) await until(() => evaluate(i, `document.querySelectorAll('[data-panel=team] [data-player]').length===4 && !!document.querySelector('.my-character details')`), "equipo y ficha");
  const uniquePanels = async () => {
    for (let i = 0; i < 4; i++) {
      const counts = await evaluate(i, `({ screens:document.querySelectorAll('[data-game-screen]').length, teams:document.querySelectorAll('[data-panel=team]').length, actions:document.querySelectorAll('[data-panel=action]').length, results:document.querySelectorAll('[data-panel=result]').length, history:document.querySelectorAll('[data-panel=history]').length, historyClosed:!document.querySelector('[data-panel=history]').open, ids:[...document.querySelectorAll('[data-history-id]')].map(n=>n.dataset.historyId) })`);
      assert.equal(counts.screens, 1); assert.equal(counts.teams, 1); assert.equal(counts.actions, 1); assert.ok(counts.results <= 1); assert.equal(counts.history, 1); assert.ok(counts.historyClosed); assert.equal(new Set(counts.ids).size, counts.ids.length);
    }
  };
  const screenshot = async (tab, name) => {
    const png = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, tabs[tab]);
    await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(png.data, "base64"));
  };
  await uniquePanels(); await screenshot(0, "01-rescate-escritorio"); checks.push("Cuatro sesiones independientes: una pantalla, un equipo y una acción");
  const roles = await Promise.all(tabs.map((_, i) => evaluate(i, `document.querySelector('.my-character h2').textContent`)));
  const bellhop = roles.findIndex(r => r === "Botones"); const medic = roles.findIndex(r => r === "Médico");
  assert.ok(bellhop >= 0 && medic >= 0);
  const ownTarget = await evaluate(bellhop, `[...document.querySelectorAll('[data-panel=team] [data-player]')][0].dataset.player`);
  await click(0, "Votar Rescatar"); await delay(1500);
  const timeBefore = await evaluate(0, `parseInt(document.querySelector('.countdown').textContent)`);
  await evaluate(0, `window.__reloadProof=true`);
  await cdp("Page.reload", { ignoreCache: true }, tabs[0]);
  await until(() => evaluate(0, `typeof window.__reloadProof === 'undefined' && !!document.querySelector('[data-game-screen]') && document.querySelector('[data-panel=action]').textContent.includes('Voto registrado')`), "F5 conserva voto");
  const timeAfter = await evaluate(0, `parseInt(document.querySelector('.countdown').textContent)`);
  assert.ok(timeAfter <= timeBefore && timeAfter >= timeBefore - 8, `Tiempo antes/despues de F5: ${timeBefore}/${timeAfter}`);
  checks.push("F5 conserva voto y plazo del servidor bajo StrictMode");
  await click(1, "Votar Rescatar"); await click(2, "Votar Rescatar");
  await until(() => evaluate(0, `document.querySelector('[data-panel=action]').textContent.includes('Avanzar a ronda 2')`), "ronda 1 completada");
  for (let i = 0; i < 4; i++) await evaluate(i, `void (window.__teamBefore = document.querySelector('[data-panel=team]'))`);
  await click(bellhop, "Entregar pack");
  for (let i = 0; i < 4; i++) {
    await until(() => evaluate(i, `document.querySelector('.shared-inventory > div strong').textContent==='7'`), "pack sincronizado");
    assert.ok(await evaluate(i, `window.__teamBefore === document.querySelector('[data-panel=team]')`));
    assert.equal(await evaluate(i, `document.querySelectorAll('[data-history-id^="activity:pack:"]').length`), 1);
  }
  await uniquePanels(); checks.push("Pack actualiza los mismos nodos y una sola entrada por navegador");
  await click(0, "Avanzar a ronda 2");
  await until(() => evaluate(0, `document.querySelector('[data-panel=action]').textContent.includes('Votar Rescatar')`), "rescate 2");
  for (const i of [0, 1, 2]) await click(i, "Votar Rescatar");
  await until(() => evaluate(0, `document.querySelector('[data-panel=action]').textContent.includes('Abrir votación de ruta')`), "preparación 2");
  await click(0, "Abrir votación de ruta");
  await until(() => evaluate(0, `document.querySelector('[data-panel=action]').textContent.includes('Votar Pasillo principal inestable')`), "voto ruta 2");
  for (const i of [0, 1, 2]) await click(i, "Votar Pasillo principal inestable");
  await until(() => evaluate(0, `document.querySelector('[data-panel=action]').textContent.includes('Avanzar a ronda 3')`), "ruta 2 completada");
  await click(0, "Avanzar a ronda 3");
  await until(() => evaluate(0, `document.querySelector('.phase-label').textContent==='Preparación de ruta'`), "preparación 3");
  // El primer pack fue al primer destinatario (30 tras ronda 2). Preparar dos porteadores a 55.
  const target2 = await evaluate(bellhop, `[...document.querySelectorAll('[data-panel=team] [data-player]')][1].dataset.player`);
  const chooseTarget = (id) => evaluate(bellhop, `(() => { const s=document.querySelector('[aria-label="Gestionar suministros"] select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(id)}); s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await chooseTarget(ownTarget); await click(bellhop, "Entregar pack"); await until(() => evaluate(bellhop, `!document.querySelector('[aria-label="Gestionar suministros"] button').disabled`), "pack confirmado");
  await chooseTarget(target2); await click(bellhop, "Entregar pack"); await until(() => evaluate(bellhop, `!document.querySelector('[aria-label="Gestionar suministros"] button').disabled`), "pack confirmado");
  await click(bellhop, "Entregar pack");
  await until(() => evaluate(0, `document.querySelector('.shared-inventory > div strong').textContent==='4'`), "dos porteadores preparados");
  await screenshot(0, "02-rutas-escritorio");
  await click(0, "Abrir votación de ronda 3");
  await until(() => evaluate(0, `document.querySelector('[data-panel=action]').textContent.includes('Votar Galería de tuberías y calderas')`), "voto ruta 3");
  for (const i of [0, 1, 2]) await click(i, "Votar Galería de tuberías y calderas");
  await until(() => evaluate(0, `document.querySelector('[data-panel=action]').textContent.includes('Comprobar energía y continuar')`), "preparar transporte");
  await click(0, "Comprobar energía y continuar");
  await until(() => evaluate(0, `document.querySelector('.phase-label').textContent==='Votación de transporte'`), "transporte");
  await uniquePanels(); await screenshot(0, "03-transporte-escritorio");
  const carriers = [0, 1];
  for (const i of carriers) await click(i, "Votar Transportar a los dos");
  await until(() => evaluate(0, `document.querySelector('[data-panel=result]')?.textContent.includes('Ruta completada: Galería')`), "galería completada");
  await click(medic, "Administrar tratamiento");
  for (let i = 0; i < 4; i++) await until(() => evaluate(i, `document.querySelectorAll('[data-history-id^="activity:treatment:"]').length===1`), "tratamiento sincronizado");
  await uniquePanels(); checks.push("Rondas 1–3, rescates, rutas, dos transportados y tratamiento reales");
  assert.ok(await evaluate(0, `!document.querySelector('[data-panel=action]').textContent.includes('Votar')`));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, tabs[0]);
  await screenshot(0, "04-resultado-movil");
  assert.ok(await evaluate(0, `document.documentElement.scrollWidth <= window.innerWidth`));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }, tabs[0]);
  await evaluate(0, `document.querySelector('[data-panel=history]').open=true`); await screenshot(0, "05-historial-escritorio");
  checks.push("390px sin desbordamiento, historial cerrado inicialmente y apertura de solo lectura");
  for (const session of tabs) assert.equal(socketCounts.get(session)?.size, 1, "Una conexión WebSocket activa por navegador");
  assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify({ checks, screenshots: 5, runtimeErrors: errors, independentSessions: 4 }, null, 2));
  console.log(JSON.stringify({ passed: checks, screenshots: artifacts }, null, 2));
  await cdp("Browser.close");
} finally {
  if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ id: 999999, method: "Browser.close" })); await delay(200); }
  for (const page of pageSockets.values()) page.close();
  ws?.close();
  for (const child of children.reverse()) if (!child.killed) child.kill();
}
