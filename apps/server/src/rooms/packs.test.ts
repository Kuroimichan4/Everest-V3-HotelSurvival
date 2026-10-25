import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import type { PackInput, RoomReply } from "@everest/shared";
import type { SimulationState } from "../simulation/state.js";
import { RoomManager } from "./manager.js";

const managers: RoomManager[] = [];
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose(); });
function value<T>(reply: RoomReply<T>): T { if (!reply.ok) throw new Error(reply.error); return reply.value; }
function setup(random = () => 0.99) {
  const manager = new RoomManager(() => 0, { now: () => 1000, schedule: () => () => {} }, random);
  managers.push(manager);
  const first = value(manager.create("s0", "Player 0"));
  const sessions = [first, ...[1, 2, 3].map(i => value(manager.join(`s${i}`, `Player ${i}`, first.room.code)))];
  manager.start("s0");
  const code = first.room.code;
  const bellhop = [0, 1, 2, 3].find(i => manager.privateRole(`s${i}`)?.role === "bellhop")!;
  const view = () => manager.suppliesView(code)!;
  const input = (index = bellhop): PackInput => ({ requestId: randomUUID(), windowId: view().windowId ?? "closed", targetParticipantId: sessions[index]!.credential.participantId });
  const finishVote = (optionId: string) => {
    const vote = manager.publicVote(code)!;
    for (const i of [0, 1, 2]) expect(manager.vote(`s${i}`, { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId }).ok).toBe(true);
  };
  const give = (candidate = input()) => manager.givePack(`s${bellhop}`, candidate);
  // Solo para construir estados límite del dominio; no se añade una API de depuración.
  const setState = (transform: (state: SimulationState) => SimulationState) => {
    const room = (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!;
    room.game.state = transform(room.game.state);
  };
  return { manager, sessions, code, bellhop, view, input, give, finishVote, setState };
}

test("sesión, identidad de Botones y momento de consumo se validan en servidor", () => {
  const f = setup();
  expect(f.give()).toEqual({ ok: false, error: "supplies-not-open" });
  expect(f.manager.givePack("outsider", f.input())).toEqual({ ok: false, error: "invalid-session" });
  f.finishVote("rescue");
  const before = f.view();
  for (const i of [0, 1, 2, 3].filter(i => i !== f.bellhop)) {
    expect(f.manager.givePack(`s${i}`, f.input())).toEqual({ ok: false, error: "not-authorized" });
    expect(f.manager.givePack(`s${i}`, { ...f.input(), role: "bellhop", participantId: f.sessions[f.bellhop]!.credential.participantId })).toEqual({ ok: false, error: "not-authorized" });
  }
  for (const bad of [null, {}, { ...f.input(), role: "bellhop" }, { ...f.input(), requestId: "" }, { ...f.input(), windowId: null }]) {
    expect(f.manager.givePack(`s${f.bellhop}`, bad)).toEqual({ ok: false, error: "invalid-input" });
  }
  expect(f.give({ ...f.input(), targetParticipantId: randomUUID() })).toEqual({ ok: false, error: "target-not-found" });
  expect(f.view()).toEqual(before);
});

test.each([0, 1, 2, 3])("Botones puede entregar al participante %i, incluido sí mismo, hasta 100", index => {
  const f = setup(); f.finishVote("rescue");
  expect(f.give(f.input(index)).ok).toBe(true);
  expect(f.view().characters[index]!.energy).toBe(75);
  expect(f.give(f.input(index)).ok).toBe(true);
  expect(f.view().characters[index]!.energy).toBe(100);
  expect(f.view().inventory.packs).toBe(6);
  const before = f.view();
  expect(f.give(f.input(index))).toEqual({ ok: false, error: "energy-full" });
  expect(f.view()).toEqual(before);
  expect(f.view().characters.every((c, i) => c.health === 100 && c.energy === (i === index ? 100 : 50))).toBe(true);
});

test("sin existencias se rechaza y un fallecido no puede recibir ni administrar packs", () => {
  const f = setup(); f.finishVote("rescue");
  f.setState(state => ({ ...state, inventory: { ...state.inventory, packs: 0 } }));
  const empty = f.view();
  expect(f.give()).toEqual({ ok: false, error: "no-packs" });
  expect(f.view()).toEqual(empty);
  f.setState(state => ({ ...state, inventory: { ...state.inventory, packs: 8 },
    characters: state.characters.map((c, i) => i === 0 ? { ...c, health: 0 } : c) }));
  const deadTarget = f.view();
  expect(f.give(f.input(0))).toEqual({ ok: false, error: "character-dead" });
  expect(f.view()).toEqual(deadTarget);
  f.setState(state => ({ ...state, characters: state.characters.map(c => c.role === "bellhop" ? { ...c, health: 0 } : c) }));
  const deadBellhop = f.view();
  expect(f.give(f.input(1))).toEqual({ ok: false, error: "bellhop-dead" });
  for (const i of [0, 1, 2, 3].filter(i => i !== f.bellhop)) expect(f.manager.givePack(`s${i}`, f.input(1)).ok).toBe(false);
  expect(f.view()).toEqual(deadBellhop);
});

test("recibo único persiste tras nueva conexión y no admite cambiar el destinatario", () => {
  const f = setup(); f.finishVote("rescue");
  const request = f.input();
  expect(f.give(request)).toEqual({ ok: true, requestId: request.requestId });
  const after = f.view();
  expect(f.give(request)).toEqual({ ok: true, requestId: request.requestId });
  expect(f.give({ ...request, targetParticipantId: f.sessions[0]!.credential.participantId })).toEqual({ ok: false, error: "request-conflict" });
  expect(f.view()).toEqual(after);
  f.manager.disconnect(`s${f.bellhop}`);
  expect(f.manager.resume("replacement", f.sessions[f.bellhop]!.credential).ok).toBe(true);
  expect(f.manager.givePack("replacement", request)).toEqual({ ok: true, requestId: request.requestId });
  expect(f.manager.suppliesSession("replacement")).toEqual(after);
  expect(f.manager.privateRole("replacement")?.role).toBe("bellhop");
});

test("recursos actuales pasan a ronda 2 sin modificar la historia ni reabrir ventanas anteriores", () => {
  const f = setup(); f.finishVote("rescue");
  const history = f.manager.roundSummary(f.code)!;
  const firstRequest = f.input(0);
  expect(f.give(firstRequest).ok).toBe(true);
  const afterPack = f.view();
  expect(f.manager.roundSummary(f.code)).toEqual(history);
  expect(f.manager.advanceRound("s0").ok).toBe(true);
  expect(f.view().windowId).not.toBeNull();
  expect(f.view().characters).toEqual(afterPack.characters);
  expect(f.view().inventory).toEqual(afterPack.inventory);
  expect(f.give({ ...firstRequest, requestId: randomUUID() })).toEqual({ ok: false, error: "supplies-not-open" });
  expect(f.give(firstRequest).ok).toBe(true); // Solo confirma el recibo, nunca aplica otro pack.
  expect(f.give({ ...f.input(), windowId: firstRequest.windowId })).toEqual({ ok: false, error: "supplies-not-open" });
  expect(f.manager.routeAction("s0", "open").ok).toBe(true);
  expect(f.give()).toEqual({ ok: false, error: "supplies-not-open" });
  f.finishVote("unstable-corridor");
  f.finishVote("rescue");
  f.manager.openTransport("s0", { preparationId: f.manager.transportView(f.code)!.cases.at(-1)!.preparationId });
  expect(f.view().windowId).not.toBe(firstRequest.windowId);
  expect(f.give({ ...firstRequest, requestId: randomUUID() })).toEqual({ ok: false, error: "supplies-not-open" });
  const historyTwo = f.manager.roundTwoView(f.code)!;
  expect(f.give(f.input(0)).ok).toBe(true);
  expect(f.view().characters[0]!.energy).toBe(55); // 50 + 25 - 25 - 20 + 25
  expect(f.view().inventory.packs).toBe(6);
  expect(f.manager.roundTwoView(f.code)).toEqual(historyTwo);
  expect(f.manager.roundSummary(f.code)).toEqual(history);
  expect(f.manager.advanceRound("s0")).toEqual({ ok: false, error: "round-not-ready" });
});

test("una ruta bloqueada no habilita packs", () => {
  const f = setup(() => NaN); f.finishVote("rescue");
  f.manager.advanceRound("s0");
  f.manager.routeAction("s0", "open"); f.finishVote("unstable-corridor");
  f.finishVote("rescue");
  f.manager.openTransport("s0", { preparationId: f.manager.transportView(f.code)!.cases.at(-1)!.preparationId });
  expect(f.manager.roundTwoView(f.code)?.phase).toBe("movement-blocked");
  expect(f.view().windowId).toBeNull();
  expect(f.give()).toEqual({ ok: false, error: "supplies-not-open" });
});

test("no existe límite artificial de un pack por ronda y pueden agotarse todas las unidades", () => {
  const f = setup(); f.finishVote("rescue");
  for (const i of [0, 1, 2, 3]) for (let count = 0; count < 2; count++) expect(f.give(f.input(i)).ok).toBe(true);
  expect(f.view().inventory.packs).toBe(0);
  expect(f.view().characters.every(c => c.energy === 100)).toBe(true);
});


test("8A: un eliminado con salud positiva no recibe packs ni recupera autoridad", () => {
  const f = setup(); f.finishVote("rescue");
  f.setState(state => ({ ...state, characters: state.characters.map((c, i) => i === 0 ? { ...c, eliminated: true } : c) }));
  const before = f.view();
  expect(f.give(f.input(0))).toEqual({ ok: false, error: "character-dead" });
  expect(f.view()).toEqual(before);
  expect(f.manager.privateRole("s0")).toBeNull();
  expect(f.view().characters[0]!.eliminated).toBe(true);
});
