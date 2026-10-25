import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { RoundFourView, PublicVote } from "@everest/shared";
import { GameScreen, type GameActions } from "./GameScreen";
import { activeScene, emptyGame, gameReducer, type GameState } from "./game-state";
import { gameHistory } from "./game-history";
import { bindGameSocket, type GameSocket } from "./game-socket";

const vote: PublicVote = { decisionId: "npc4", attemptId: "first", round: 6, attemptNumber: 1, deadline: 61000,
  serverNow: 1000, requiredVotes: 3, status: "open", result: null };
const actions: GameActions = { onVote: vi.fn(), onRoute: vi.fn(), onOpenThree: vi.fn(), onOpenFour: vi.fn(), onRetryFour: vi.fn(),
  onAdvance: vi.fn(), onOpenTransport: vi.fn(), onRetry: vi.fn(), onGive: vi.fn(), onTreat: vi.fn() };
function fixture(): GameState {
  const characters = Array.from({ length: 4 }, (_, i) => ({ participantId: `p${i}`, name: `Persona ${i}`, health: 80, energy: 65 }));
  const roundFour: RoundFourView = { round: 6, preparationId: "prep4", phase: "npc-voting",
    npc: { encounter: "immobile", status: "awaiting-decision", choice: null, message: null, energyPerHuman: 0, medicalUnits: 0, vote,
      options: [{ id: "abandon", label: "Abandonar", energyPerHuman: 0, medicalUnits: 0, available: true },
        { id: "carry", label: "Transportar al superviviente", energyPerHuman: 40, medicalUnits: 0, available: true },
        { id: "medical-assist", label: "Usar medicina", energyPerHuman: 25, medicalUnits: 1, available: true }] },
    options: [{ id: "revolving-door", name: "Puerta giratoria", energyCost: 20, availability: { status: "available", reason: null } },
      { id: "exterior-crack", name: "Grieta exterior", energyCost: 10, availability: { status: "available", reason: null } }],
    vote: null, selection: null, forced: false, surcharge: 0, collapse: null, blocked: null, movement: null };
  return { ...emptyGame, roundFour, vote, supplies: { gameId: "game", round: 6, windowId: null, characters, inventory: { packs: 8, medicalUnits: 4 } },
    room: { code: "ABCDEF123456", creatorId: "p0", status: "started", participants: characters.map(c => ({ id: c.participantId, name: c.name, connected: true })) },
    role: { participantId: "p0", role: "bellhop", sheet: { name: "Botones", objective: "Privado propio", responsibility: "Packs", knowledge: [] } },
    summary: { gameId: "game", round: 1, completed: true, decisionId: "r1", result: "RESCUE_APPROVED", npc: "rescued", microearthquake: false,
      costs: { rescueEnergy: 25, movementEnergy: 25, damage: 0 }, inventory: { packs: 8, medicalUnits: 4 }, characters },
    activity: { gameId: "game", tools: { crowbar: "available" }, entries: [] } };
}
const render = (state: GameState) => renderToStaticMarkup(createElement(GameScreen, { state, participantId: "p0", connected: true, busy: false, error: "", actions }));

test.each(["maintenance", "medic", "architect-engineer", "bellhop"] as const)("%s sees NPC vote despite a delayed round-three supplies snapshot", role => {
  const s = fixture(); s.supplies = { ...s.supplies!, round: 3 };
  s.role = { ...s.role!, role };
  expect(activeScene(s)).toMatchObject({ round: 6, kind: "round-four", vote: { decisionId: "npc4", attemptId: "first" } });
  const current = render(s).split('class="panel game-history"')[0]!;
  expect(current).toContain("Decidir el rescate");
  expect(current).toContain('class="vote-seconds">60<');
  expect(current).not.toContain("El equipo ha terminado el recorrido");
});

test("NPC death selects exit preparation even with stale supplies and the old generic vote", () => {
  const s = fixture(); s.supplies = { ...s.supplies!, round: 3 };
  s.roundFour = { ...s.roundFour!, phase: "preparation", npc: { ...s.roundFour!.npc, status: "dead",
    vote: { ...vote, status: "closed", attemptNumber: 2, result: "NO_AGREEMENT" } } };
  expect(activeScene(s)).toMatchObject({ round: 6, kind: "round-four", vote: null });
  const current = render(s).split('class="panel game-history"')[0]!;
  expect(current).toContain("Elegir la salida");
  expect(current).toContain("Abrir votación de salida");
  expect(current).not.toContain("Decidir el rescate");
  expect(current).not.toContain("Esperando al servidor");
});

test("only the public round-four transport phase can activate a round-four transport snapshot", () => {
  const s = fixture();
  s.transport = { cases: [{ preparationId: "old", round: 6, routeId: "exterior-crack", routeName: "Grieta", routeCost: 10,
    phase: "voting", reason: null, exhaustedIds: [], eligibleIds: [], people: [], options: [], vote: { ...vote, decisionId: "transport" },
    decisions: [], transportedIds: [], abandonedIds: [], charges: [], transfers: [] }] };
  expect(activeScene(s)).toMatchObject({ kind: "round-four", vote: { decisionId: "npc4" } });
  s.roundFour = { ...s.roundFour!, phase: "preparation", npc: { ...s.roundFour!.npc, status: "dead" } };
  expect(activeScene(s)).toMatchObject({ kind: "round-four", vote: null });
  s.roundFour.phase = "transport";
  expect(activeScene(s)).toMatchObject({ kind: "transport", vote: { decisionId: "transport" } });
});

test.each(["npc-voting", "preparation", "exit-voting", "blocked", "completed"] as const)("round 4 %s has one screen, active action, four cards, folded read-only history", phase => {
  const s = fixture(); const fourth = s.roundFour!;
  fourth.phase = phase;
  if (phase !== "npc-voting") fourth.npc = { ...fourth.npc, status: "awaiting-effort", choice: "medical-assist", energyPerHuman: 25, medicalUnits: 1 };
  if (phase === "exit-voting") fourth.vote = { ...vote, decisionId: "exit4" };
  if (phase === "blocked") { fourth.blocked = "combined-effort-pending"; fourth.selection = { decisionId: "exit4", outcome: "exterior-crack" }; }
  if (phase === "completed") {
    fourth.npc.status = "rescued";
    fourth.movement = { requestId: "exit4", routeId: "exterior-crack", energyCost: 10, accident: true, victims: [{ participantId: "p0", damage: 30 }],
      deceasedIds: [], escapedHumanIds: ["p0", "p1", "p2", "p3"], rescuedNpc: true, characters: s.supplies!.characters, inventory: s.supplies!.inventory, crowbar: "available" };
  }
  const html = render(s); const current = html.split('class="panel game-history"')[0]!;
  expect(html.match(/data-game-screen="current"/g)).toHaveLength(1);
  expect(html.match(/data-panel="action"/g)).toHaveLength(1);
  expect(html.match(/data-panel="team"/g)).toHaveLength(1);
  expect(html.match(/data-player="/g)).toHaveLength(4);
  expect(html).not.toMatch(/class="panel game-history"[^>]*open/);
  expect(html).not.toContain('data-panel="result"');
  expect(current).not.toContain("Paso obligatorio completado");
  expect(current).not.toContain("Avanzar a ronda 5");
  expect(current).not.toMatch(/10 %|50 %|accidentProbability|EXTREME|LOW/);
  if (phase === "npc-voting") { expect(current).toContain("Decidir el rescate"); expect(current).not.toContain("Elegir la salida"); expect(current).toContain('class="vote-seconds">60<'); }
  if (phase === "blocked") expect(current).toContain("No se ha gastado ningún recurso");
  if (phase === "completed") { expect(current).toContain("Resumen provisional"); expect(current).toContain("Rescate completado"); expect(current).not.toContain("Abrir votación"); }
  if (phase === "preparation") { expect(current).toContain("pendiente de completar el desplazamiento"); expect(current).not.toContain("Rescate completado"); }
});

test("second NPC attempt displays exact message, server countdown, own recovered vote once", () => {
  const s = fixture(); const v = { ...vote, attemptNumber: 2, attemptId: "second", deadline: 91000, serverNow: 61000 };
  s.roundFour!.npc.vote = v; s.roundFour!.npc.message = "El superviviente parece debilitarse a cada segundo que pasa";
  s.ownVote = { decisionId: v.decisionId, attemptId: v.attemptId, optionId: "carry" };
  const current = render(s).split('class="panel game-history"')[0]!;
  expect(current).toContain("El superviviente parece debilitarse a cada segundo que pasa");
  expect(current).toContain('class="vote-seconds">30<'); expect(current.match(/Voto registrado/g)).toHaveLength(1);
  expect(current).toContain("Intento 2");
});

test("repeated fourth snapshots replace state and preserve one history entry per decision", () => {
  let s = fixture(); s.roundFour!.npc.status = "awaiting-effort"; s.roundFour!.npc.choice = "carry";
  s = gameReducer(s, { type: "roundFour", value: structuredClone(s.roundFour) }); const before = s;
  for (let i = 0; i < 4; i++) s = gameReducer(s, { type: "roundFour", value: structuredClone(s.roundFour) });
  expect(s).toBe(before);
  expect(gameHistory(s).filter(e => e.id.startsWith("npc:6"))).toHaveLength(1);
  expect(activeScene(s).round).toBe(6);
  expect(gameReducer(s, { type: "disconnect" }).roundFour).toBe(null);
});

test("fourth listener setup/cleanup, no stale callback after reconnect, old round vote cannot take over", () => {
  const listeners = new Map<string, Set<(v?: unknown) => void>>();
  const socket = { on: (name: string, fn: (v?: unknown) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    off: (name: string, fn: (v?: unknown) => void) => listeners.get(name)?.delete(fn) } as unknown as GameSocket;
  const dispatch = vi.fn(); const lifecycle = { connect: vi.fn(), disconnect: vi.fn(), error: vi.fn(), participantId: () => "p0" };
  const cleanup = bindGameSocket(socket, dispatch, lifecycle); const old = [...listeners.get("round-six:updated")!][0]!;
  old(fixture().roundFour); expect(dispatch).toHaveBeenCalledTimes(1);
  cleanup(); old(fixture().roundFour); expect(dispatch).toHaveBeenCalledTimes(1);
  const next = bindGameSocket(socket, dispatch, lifecycle); expect(listeners.get("round-six:updated")!.size).toBe(1);
  next(); expect(listeners.get("round-six:updated")!.size).toBe(0);
  const s = fixture(); s.vote = { ...vote, round: 1, decisionId: "old" };
  expect(activeScene(s).vote!.decisionId).toBe("npc4");
});

test("unavailable medicine/door and dead or foreign role never enable an action or private sheet", () => {
  const s = fixture(); s.roundFour!.npc.options.find(o => o.id === "medical-assist")!.available = false;
  expect(render(s)).toMatch(/<button disabled="">Votar Usar medicina/);
  s.roundFour!.phase = "preparation"; s.roundFour!.npc.status = "abandoned";
  s.roundFour!.options[0]!.availability = { status: "unavailable", reason: "crowbar-unavailable" };
  expect(render(s)).toContain("La palanca se perdió");
  s.role = { ...s.role!, participantId: "other", sheet: { ...s.role!.sheet, objective: "SECRETO AJENO" } };
  expect(render(s)).not.toContain("SECRETO AJENO");
  expect(render(s)).toMatch(/<button disabled="">Abrir votación de salida/);
  s.supplies!.characters[0]!.health = 0;
  expect(render(s)).not.toContain("Consultar mi ficha privada");
});
