import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { PublicVote } from "@everest/shared";
import { activeScene, emptyGame, gameReducer, type GameState } from "./game-state";
import { gameHistory } from "./game-history";
import { GameScreen, TeamStatus, type GameActions } from "./GameScreen";
import { VotePanel } from "./VotePanel";
import { bindGameSocket, type GameSocket } from "./game-socket";

const vote: PublicVote = { decisionId: "npc", attemptId: "first", round: 1, attemptNumber: 1, deadline: 61000, serverNow: 1000, requiredVotes: 3, status: "open", result: null };
function state(): GameState {
  const characters = Array.from({ length: 4 }, (_, i) => ({ participantId: `p${i}`, name: `Persona ${i}`, health: 80, energy: 50 }));
  return { ...emptyGame, room: { code: "ABCDEF123456", creatorId: "p0", status: "started", participants: characters.map(c => ({ id: c.participantId, name: c.name, connected: true })) },
    supplies: { gameId: "game", round: 1, windowId: null, characters, inventory: { packs: 8, medicalUnits: 4 } }, vote,
    role: { participantId: "p0", role: "bellhop", sheet: { name: "Botones", responsibility: "Mi responsabilidad", objective: "Objetivo privado propio", knowledge: [{ id: "own", text: "Conocimiento propio" }] } },
    medical: { gameId: "game", round: 1, characters, inventory: { packs: 8, medicalUnits: 4 }, treatments: [] },
    activity: { gameId: "game", tools: { crowbar: "available" }, entries: [] } };
}
const actions: GameActions = { onVote: vi.fn(), onRoute: vi.fn(), onOpenThree: vi.fn(), onAdvance: vi.fn(), onOpenTransport: vi.fn(), onRetry: vi.fn(), onGive: vi.fn(), onTreat: vi.fn() };
const render = (s: GameState) => renderToStaticMarkup(createElement(GameScreen, { state: s, participantId: "p0", connected: true, busy: false, error: "", actions }));

test.each([false, true])("10A: projected team has only authorized bars, active statuses and readable history (Medic %s)", medic => {
  const s = state();
  s.supplies = { ...s.supplies!, characters: s.supplies!.characters.map((c, i) => ({ participantId: c.participantId, name: c.name, status: "active" as const,
    ...(i === 0 || medic ? { health: 80 } : {}), ...(i === 0 ? { energy: 50 } : {}) })) };
  s.activity = { ...s.activity!, entries: [{ id: "foreign-pack", round: 1, kind: "pack", targetParticipantId: "p1" }] };
  const team = renderToStaticMarkup(createElement(TeamStatus, { state: s, participantId: "p0" }));
  expect(team.match(/<progress/g)).toHaveLength(medic ? 5 : 2);
  expect(team.match(/>Activo</g)).toHaveLength(4);
  expect(team).not.toContain("Agotado"); expect(team).not.toContain("Fallecido");
  const html = render(s);
  expect(html).toContain("Pack entregado"); expect(html).not.toContain("undefined");
});

test("10A: own current selection leaves every authorized alternative enabled until closure", () => {
  const props = { title: "Decision", vote, own: { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId: "rescue" },
    options: [{ id: "rescue", label: "Rescatar" }, { id: "abandon", label: "Abandonar" }], enabled: true, busy: false, onVote: vi.fn() };
  const open = renderToStaticMarkup(createElement(VotePanel, props));
  expect(open).toContain("Voto registrado"); expect(open).toContain("Votar Abandonar"); expect(open).not.toContain("disabled");
  const closed = renderToStaticMarkup(createElement(VotePanel, { ...props, vote: { ...vote, status: "closed" } }));
  expect(closed.match(/disabled=""/g)).toHaveLength(2);
});

test("10A: R2 preparation renders route controls without an active NPC vote", () => {
  const s: GameState = second(state()); s.vote = null; s.roundTwo = { ...s.roundTwo!, npc: "pending", result: null };
  const html = render(s);
  expect(html).toContain("Abrir votación de ruta"); expect(html).not.toContain("¿Rescatamos al superviviente?");
});
function second(s: GameState) {
  return { ...s, supplies: { ...s.supplies!, round: 2 as const }, roundTwo: { round: 2 as const, npcId: "round-two-survivor" as const, mobility: "walks-with-help" as const, npc: "rescued" as const, phase: "route-pending" as const, blocked: null, result: "RESCUE_APPROVED" as const, microearthquake: false,
    characters: s.supplies!.characters, inventory: s.supplies!.inventory, previousNpc: "rescued" as const, movement: null,
    routeChoice: { phase: "preparation" as const, ventilationRevealed: false, options: [{ id: "unstable-corridor" as const, name: "Pasillo", energyCost: 20, blocked: null, availability: { status: "available" as const, reason: null } }], vote: null, result: null } } };
}
test.each(["rescue", "route", "transport", "selection", "completed", "recovery"])("una sola pantalla, acción y equipo en fase %s", phase => {
  let s: GameState = state();
  if (phase !== "rescue") s = second(s);
  if (phase === "transport" || phase === "selection") s.transport = { cases: [{ preparationId: "t", round: 2, routeId: "unstable-corridor", routeName: "Pasillo", routeCost: 20, phase: phase === "selection" ? "selection" : "voting", reason: null,
    exhaustedIds: ["p0"], eligibleIds: ["p1", "p2", "p3"], people: s.supplies!.characters.map(c => ({ participantId: c.participantId, name: c.name, ...(c.energy !== undefined ? { energy: c.energy } : {}) })), options: [], vote: { ...vote, decisionId: "transport", round: 2 }, decisions: [], transportedIds: [], abandonedIds: [], charges: [], transfers: [] }] };
  if (phase === "completed") s.roundTwo = { ...s.roundTwo!, phase: "completed", movement: { status: "completed", decisionId: "route2", routeId: "unstable-corridor", routeName: "Pasillo", energyCost: 20, forced: false, microearthquake: false, accident: false, victims: [] } };
  if (phase === "recovery") s.roundTwo = { ...s.roundTwo!, recovery: { decisionId: "route2", forced: false, reason: "route-energy-insufficient" } };
  const html = render(s);
  expect(html.match(/data-game-screen="current"/g)).toHaveLength(1);
  expect(html.match(/data-panel="team"/g)).toHaveLength(1);
  expect(html.match(/data-panel="action"/g)).toHaveLength(1);
  expect(html.match(/data-player="/g)).toHaveLength(4);
  expect(html.match(/data-panel="history"/g)).toHaveLength(1);
  expect(html).not.toMatch(/class="panel game-history"[^>]*open/);
  expect(html).not.toMatch(/RESCUE_APPROVED|NO_AGREEMENT/);
  expect(html.split('class="panel game-history"')[0]).not.toContain("<table");
  if (phase !== "rescue") expect(html).not.toContain("¿Rescatamos al superviviente?");
  if (phase === "transport" || phase === "selection") expect(html).not.toContain("Abrir votación de ruta");
});

test("snapshots repetidos sustituyen y no duplican historia, paneles ni acciones confirmadas", () => {
  let s = state();
  const supplies = { ...s.supplies!, characters: s.supplies!.characters.map((c, i) => i ? c : { ...c, energy: 75 }), inventory: { packs: 7, medicalUnits: 4 } };
  s = gameReducer(s, { type: "supplies", value: supplies });
  const activity = { ...s.activity!, entries: [{ id: "pack:receipt", kind: "pack" as const, round: 1 as const, targetParticipantId: "p0", restored: 25 }] };
  s = gameReducer(s, { type: "activity", value: activity }); const first = s;
  for (let i = 0; i < 4; i++) { s = gameReducer(s, { type: "supplies", value: structuredClone(supplies) }); s = gameReducer(s, { type: "activity", value: structuredClone(activity) }); }
  expect(s).toBe(first); expect(gameHistory(s)).toHaveLength(1);
  expect(render(s).match(/data-panel="team"/g)).toHaveLength(1);
  expect(render(s).match(/data-history-id="activity:pack:receipt"/g)).toHaveLength(1);
});

test("la ronda actual prevalece sobre snapshots antiguos y transportes completados", () => {
  const s = second(state());
  s.summary = { gameId: "game", round: 1, completed: true, decisionId: "r1", result: "RESCUE_APPROVED", npc: "rescued", microearthquake: false, costs: { rescueEnergy: 25, movementEnergy: 25, damage: 0 }, characters: s.supplies!.characters, inventory: s.supplies!.inventory };
  expect(activeScene(s).kind).toBe("route-two");
  expect(render(s)).not.toContain("Avanzar a ronda 2");
  expect(gameHistory(s).filter(e => e.id === "route:r1")).toHaveLength(1);
});

test("ficha propia visible directamente, sin información privada de otros ni controles médicos ajenos", () => {
  const s = state(); const html = render(s);
  expect(html).toContain("Objetivo privado propio"); expect(html).toContain("Capacidades y responsabilidad");
  expect(html).not.toMatch(/<details class="private-details"/);
  expect(html).not.toContain("Administrar tratamiento");
  s.role = { ...s.role!, participantId: "other", sheet: { ...s.role!.sheet, objective: "Secreto ajeno" } };
  expect(render(s)).not.toContain("Secreto ajeno");
  expect(render(s)).not.toContain("Entregar pack");
  expect(gameReducer(s, { type: "disconnect" }).role).toBeNull();
});

test("bind/cleanup/bind de StrictMode y reconexiones conservan una suscripción y retiran todas al desmontar", () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket = { on: (e: string, fn: (...args: unknown[]) => void) => { const set = listeners.get(e) ?? new Set(); set.add(fn); listeners.set(e, set); }, off: (e: string, fn: (...args: unknown[]) => void) => { listeners.get(e)?.delete(fn); } } as unknown as GameSocket;
  const dispatch = vi.fn(); const connect = vi.fn(); const lifecycle = { connect, disconnect: vi.fn(), error: vi.fn(), participantId: () => "self" };
  const cleanup = bindGameSocket(socket, dispatch, lifecycle);
  const old = [...listeners.get("supplies:updated")!][0]!;
  cleanup(); old(state().supplies);
  expect(dispatch).not.toHaveBeenCalled();
  const next = bindGameSocket(socket, dispatch, lifecycle);
  for (const set of listeners.values()) expect(set.size).toBe(1);
  for (let i = 0; i < 4; i++) for (const fn of listeners.get("connect")!) fn();
  expect(connect).toHaveBeenCalledTimes(4);
  for (const set of listeners.values()) expect(set.size).toBe(1);
  for (const fn of listeners.get("game:role")!) fn({ ...state().role, participantId: "other" });
  expect(dispatch).not.toHaveBeenCalled();
  for (const fn of listeners.get("supplies:updated")!) fn(state().supplies);
  expect(dispatch).toHaveBeenCalledTimes(1);
  next(); for (const set of listeners.values()) expect(set.size).toBe(0);
});
