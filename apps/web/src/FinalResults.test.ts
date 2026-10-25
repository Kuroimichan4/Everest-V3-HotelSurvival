import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { GameFinalResult, PrivateObjectiveEvidence } from "@everest/shared";
import { GameScreen, type GameActions } from "./GameScreen";
import { emptyGame, gameReducer } from "./game-state";
import { bindGameSocket, type GameSocket } from "./game-socket";
import { FinalResults } from "./FinalResults";
import { collectiveNarrative, objectiveNarrative, survivalNarrative } from '../../server/src/simulation/final-narrative';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const result: GameFinalResult = { id: "final", gameId: "game", closedAt: 1000, round: 6, kind: "evacuation-completed",
  humans: ["maintenance", "medic", "architect-engineer", "bellhop"].map((role, i) => ({ participantId: `p${i}`, name: `Persona ${i}`, role: role as GameFinalResult["humans"][number]["role"],
    health: i === 1 ? 0 : 70, energy: 15, status: i === 0 ? "abandoned" : i === 1 ? "dead" : "evacuated" })),
  npcs: [{ round: 1, status: "rescued", evacuated: null }, { round: 2, status: "abandoned", evacuated: null }, { round: 6, status: "rescued", evacuated: true }],
  counts: { evacuated: 2, dead: 1, abandoned: 1, rescuedNpcs: 2, evacuatedNpcs: 1 }, inventory: { packs: 4, medicalUnits: 2 }, crowbar: "lost",
  lastMovement: { routeName: "Grieta exterior", completed: true, accident: true, victimIds: ["p1", "p2"] }, decisions: ["La palanca se perdió."] };
const objective: PrivateObjectiveEvidence = { resultId: "final", participantId: "p2", objective: "OBJETIVO PROPIO", evaluation: "pending-evaluation", evidenceState: "confirmed", facts: ["HECHO PROPIO"], missing: ["Evaluación pendiente."] };
const actions: GameActions = { onVote: vi.fn(), onRoute: vi.fn(), onOpenThree: vi.fn(), onAdvance: vi.fn(), onOpenTransport: vi.fn(), onRetry: vi.fn(), onGive: vi.fn(), onTreat: vi.fn() };
const render = (value = objective) => renderToStaticMarkup(createElement(GameScreen, { state: { ...emptyGame, final: result, objective: value }, participantId: "p2", connected: true, busy: false, actions, error: "" }));

test('dramatic collective, own objective and survival prose render without losing facts or exposing foreign text', () => {
  const final = { ...result, narrative: collectiveNarrative(result), personalEpilogue: { participantId: 'p2', text: survivalNarrative(result.gameId, 'p2', 'evacuated') } };
  const own = { ...objective, evaluation: 'unfulfilled' as const, narrative: objectiveNarrative(result.gameId, 'p2', 'architect-engineer', 'unfulfilled') };
  const html = renderToStaticMarkup(createElement(FinalResults, { result: final, objective: own, participantId: 'p2', connected: true }));
  for (const text of [final.narrative.title, own.narrative, final.personalEpilogue.text, 'HECHO PROPIO', 'Recursos restantes:']) expect(html).toContain(text);
  expect(html).toContain('aria-label="Valoración colectiva"'); expect(html).toContain('aria-label="El destino de tu personaje"');
  const foreign = renderToStaticMarkup(createElement(FinalResults, { result: { ...final, personalEpilogue: { participantId: 'other', text: 'EPÍLOGO AJENO' } },
    objective: { ...own, participantId: 'other', narrative: 'ELOGIO AJENO' }, participantId: 'p2', connected: true }));
  expect(foreign).not.toContain('EPÍLOGO AJENO'); expect(foreign).not.toContain('ELOGIO AJENO');
});

test('final narrative desktop/mobile fixtures preserve fulfilled, unfulfilled and pending descriptions', () => {
  const dir = new URL('../../../.cache/10k1/', import.meta.url); mkdirSync(dir, { recursive: true });
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  for (const [name, status, evaluation] of [['complete', 'evacuated', 'fulfilled'], ['mixed', 'abandoned', 'unfulfilled'], ['fatal', 'dead', 'pending-evaluation']] as const) {
    const final: GameFinalResult = { ...result, kind: name === 'fatal' ? 'no-active-humans' : 'evacuation-completed',
      humans: result.humans.map((p, i) => ({ ...p, status: name === 'complete' ? 'evacuated' : name === 'fatal' ? 'dead' : i === 2 ? status : p.status })),
      counts: { ...result.counts, evacuated: name === 'complete' ? 4 : name === 'fatal' ? 0 : 1, dead: name === 'fatal' ? 4 : name === 'complete' ? 0 : 1, abandoned: name === 'mixed' ? 2 : 0 },
      personalEpilogue: { participantId: 'p2', text: survivalNarrative(result.gameId, 'p2', status) } };
    final.narrative = collectiveNarrative(final);
    const own = { ...objective, evaluation, narrative: objectiveNarrative(result.gameId, 'p2', 'architect-engineer', evaluation) };
    const html = renderToStaticMarkup(createElement(FinalResults, { result: final, objective: own, participantId: 'p2', connected: true }));
    expect(html).toContain('data-game-screen="final"'); expect(html).toContain(`data-evaluation="${evaluation}"`);
    writeFileSync(new URL(name + '.html', dir), '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + css + '</style></head><body><main class="shell">' + html + '</main></body></html>');
  }
});

test('only the host sees New Game; an eliminated host retains this administrative control', () => {
  const room = { code: 'ROOM', creatorId: 'p1', status: 'started' as const, participants: result.humans.map(p => ({ id: p.participantId, name: p.name, connected: true })) };
  const restart = vi.fn();
  const renderFor = (participantId: string, connected = true) => renderToStaticMarkup(createElement(GameScreen, {
    state: { ...emptyGame, final: result, room: { ...room, participants: room.participants.map((p, i) => ({ ...p, connected: i === 3 ? connected : true })) } },
    participantId, connected: true, busy: false, error: '', actions: { ...actions, onNewGame: restart },
  }));
  expect(result.humans[1]!.status).toBe('dead');
  expect(renderFor('p1')).toContain('Nueva partida'); expect(renderFor('p2')).not.toContain('Nueva partida');
  expect(renderFor('p1', false)).toContain('<button disabled=""');
});

test('room reset clears every previous game projection and preserves the room identity', () => {
  const room = { code: 'ROOM', creatorId: 'p1', status: 'waiting' as const, participants: result.humans.map(p => ({ id: p.participantId, name: p.name, connected: true })) };
  const old = { ...emptyGame, final: result, objective, ownVote: { decisionId: 'old', attemptId: 'old', optionId: 'rescue' } };
  expect(gameReducer(old, { type: 'reset', value: room })).toEqual({ ...emptyGame, room }); expect(old.final).toBe(result);
});

test('reset listener clears private data exactly once and is removed with the connection binding', () => {
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  const socket = { on: (name: string, fn: (v: unknown) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    off: (name: string, fn: (v: unknown) => void) => { listeners.get(name)?.delete(fn); } } as unknown as GameSocket;
  const lifecycle = { chat: vi.fn(), sabotage: vi.fn(), personalDeath: vi.fn(), reset: vi.fn(), participantId: () => 'p1', connect: vi.fn(), disconnect: vi.fn(), error: vi.fn() }; const dispatch = vi.fn();
  const unbind = bindGameSocket(socket, dispatch, lifecycle); const reset = [...listeners.get('room:reset')!][0]!;
  const room = { code: 'ROOM', creatorId: 'p1', status: 'waiting', participants: [] }; reset(room);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'reset', value: room });
  for (const callback of [lifecycle.chat, lifecycle.sabotage, lifecycle.personalDeath]) expect(callback).toHaveBeenCalledExactlyOnceWith(null);
  expect(lifecycle.reset).toHaveBeenCalledTimes(1); unbind(); reset(room); expect(lifecycle.reset).toHaveBeenCalledTimes(1);
  for (const value of listeners.values()) expect(value.size).toBe(0);
});

test("10A: final screen accepts private numeric fields omitted by the server and retains all outcomes", () => {
  const projected = { ...result, humans: result.humans.map((p, i) => {
    const { health, energy, ...publicPerson } = p;
    return i === 2 ? { ...publicPerson, ...(health !== undefined ? { health } : {}), ...(energy !== undefined ? { energy } : {}) } : publicPerson;
  }) };
  const html = renderToStaticMarkup(createElement(FinalResults, { result: projected, objective, participantId: "p2", connected: true }));
  expect(html.match(/Salud:/g)).toHaveLength(1); expect(html.match(/Energía:/g)).toHaveLength(1);
  expect(html.match(/data-player="/g)).toHaveLength(4);
  expect(html).toContain("Fallecido"); expect(html).toContain("Abandonado"); expect(html).toContain("Evacuado");
  expect(html).not.toContain("undefined");
});

test("one final screen with four role cards, objective facts and folded read-only history; no active controls", () => {
  const html = render();
  expect(html.match(/data-game-screen="final"/g)).toHaveLength(1); expect(html.match(/data-panel="team"/g)).toHaveLength(1);
  expect(html.match(/data-player="/g)).toHaveLength(4); expect(html.match(/data-panel="history"/g)).toHaveLength(1);
  expect(html).toContain("Fin de la simulación"); expect(html).toContain("Evacuado"); expect(html).toContain("Abandonado"); expect(html).toContain("Fallecido");
  expect(html).toContain("OBJETIVO PROPIO"); expect(html).toContain("HECHO PROPIO"); expect(html).toContain("Pendiente de evaluación");
  expect(html).toContain("Su llegada a la calle no está registrada");
  expect(html).not.toContain("<button"); expect(html).not.toContain('data-panel="action"');
  expect(html).not.toMatch(/class="panel game-history"[^>]*open/);
});

test("foreign objective or evidence for another resolution is never rendered", () => {
  expect(render({ ...objective, participantId: "other", objective: "SECRETO AJENO" })).not.toContain("SECRETO AJENO");
  expect(render({ ...objective, resultId: "other", objective: "RESULTADO ANTIGUO" })).not.toContain("RESULTADO ANTIGUO");
});

test.each([["fulfilled", "Objetivo cumplido con información suficiente"], ["unfulfilled", "Objetivo incumplido con información suficiente"],
  ["pending-evaluation", "Pendiente de evaluación"]] as const)("own objective %s has an explicit descriptive state without scores", (evaluation, text) => {
  const html = render({ ...objective, evaluation });
  expect(html).toContain(text); expect(html).not.toMatch(/Puntos:|Ganador:|Ranking:/);
  expect(html).not.toContain("ni evaluación definitiva de objetivos");
  expect(html).toContain("Última ruta recorrida:");
});

test("repeated final snapshots do not append results, and disconnect clears private evidence", () => {
  const state = gameReducer({ ...emptyGame, objective }, { type: "final", value: result });
  expect(gameReducer(state, { type: "final", value: structuredClone(result) })).toBe(state);
  expect(gameReducer(state, { type: "disconnect" }).final).toBe(null);
  expect(gameReducer(state, { type: "disconnect" }).objective).toBe(null);
});

test("final and objective listeners clean up, ignore old callbacks and reject another participant's evidence", () => {
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  const socket = { on: (name: string, fn: (v: unknown) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    off: (name: string, fn: (v: unknown) => void) => listeners.get(name)?.delete(fn) } as unknown as GameSocket;
  const dispatch = vi.fn(); const lifecycle = { participantId: () => "p2", connect: vi.fn(), disconnect: vi.fn(), error: vi.fn() };
  const unbind = bindGameSocket(socket, dispatch, lifecycle); const old = [...listeners.get("game:finished")!][0]!;
  for (const fn of listeners.get("game:objective")!) fn({ ...objective, participantId: "other" });
  expect(dispatch).not.toHaveBeenCalled(); old(result); expect(dispatch).toHaveBeenCalledTimes(1);
  unbind(); old(result); expect(dispatch).toHaveBeenCalledTimes(1);
  const cleanup = bindGameSocket(socket, dispatch, lifecycle); expect(listeners.get("game:finished")!.size).toBe(1);
  cleanup(); expect([...listeners.values()].every(s => s.size === 0)).toBe(true);
});
