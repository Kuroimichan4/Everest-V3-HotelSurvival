import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import type { RoomReply, TreatmentInput } from "@everest/shared";
import type { SimulationState } from "../simulation/state.js";
import { RoomManager } from "./manager.js";

const managers: RoomManager[] = [];
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose(); });
function value<T>(reply: RoomReply<T>): T { if (!reply.ok) throw new Error(reply.error); return reply.value; }
function setup() {
  const random = vi.fn(() => 0);
  const manager = new RoomManager(() => 0, { now: () => 1000, schedule: () => () => {} }, random);
  managers.push(manager);
  const first = value(manager.create("s0", "Player 0"));
  const sessions = [first, ...[1, 2, 3].map(i => value(manager.join(`s${i}`, `Player ${i}`, first.room.code)))];
  manager.start("s0");
  const code = first.room.code;
  const medic = [0, 1, 2, 3].find(i => manager.privateRole(`s${i}`)?.role === "medic")!;
  const view = () => manager.medicalView(code)!;
  const input = (index = medic): TreatmentInput => ({ requestId: randomUUID(), gameId: view().gameId, round: view().round, targetParticipantId: sessions[index]!.credential.participantId });
  const treat = (candidate = input()) => manager.treat(`s${medic}`, candidate);
  const finishVote = (optionId: string) => {
    const vote = manager.publicVote(code)!;
    for (const i of [0, 1, 2]) expect(manager.vote(`s${i}`, { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId }).ok).toBe(true);
  };
  // Construcción exclusiva de escenarios límite; no se añade API de depuración.
  const setState = (transform: (state: SimulationState) => SimulationState) => {
    const room = (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!;
    room.game.state = transform(room.game.state);
  };
  const wound = (health = 60) => setState(state => ({ ...state, characters: state.characters.map(c => ({ ...c, health })) }));
  return { manager, sessions, code, medic, view, input, treat, finishVote, setState, wound, random };
}

test.each([0, 1, 2, 3])("Médico puede tratar al humano %i, incluido él mismo, sin crear votación", index => {
  const f = setup(); f.wound();
  const votingChanged = vi.fn(); f.manager.onVotingChanged = votingChanged;
  const beforeVote = f.manager.publicVote(f.code)!;
  expect(f.treat(f.input(index)).ok).toBe(true);
  expect(f.view().characters[index]!.health).toBe(80);
  expect(f.view().inventory.medicalUnits).toBe(3);
  expect(f.view().treatments).toEqual([{ round: 1, participantId: f.sessions[index]!.credential.participantId, healthRestored: 20 }]);
  expect(f.manager.publicVote(f.code)).toMatchObject({ decisionId: beforeVote.decisionId, attemptId: beforeVote.attemptId, deadline: beforeVote.deadline, status: beforeVote.status });
  expect(votingChanged).not.toHaveBeenCalled();
  expect(f.random).not.toHaveBeenCalled();
  expect(f.treat(f.input(index))).toEqual({ ok: false, error: "treatment-used" });
});

test("sesión autenticada, Médico vivo, humano y partida correctos; no se confía en identidad del cliente", () => {
  const f = setup(); f.wound();
  const before = f.view();
  expect(f.manager.treat("outsider", f.input())).toEqual({ ok: false, error: "invalid-session" });
  for (const i of [0, 1, 2, 3].filter(i => i !== f.medic)) {
    expect(f.manager.treat(`s${i}`, f.input())).toEqual({ ok: false, error: "not-authorized" });
    expect(f.manager.treat(`s${i}`, { ...f.input(), role: "medic", actorId: f.sessions[f.medic]!.credential.participantId })).toEqual({ ok: false, error: "not-authorized" });
  }
  for (const bad of [null, {}, { ...f.input(), role: "medic" }, { ...f.input(), round: 7 }, { ...f.input(), requestId: "" }]) expect(f.manager.treat(`s${f.medic}`, bad)).toEqual({ ok: false, error: "invalid-input" });
  expect(f.treat({ ...f.input(), gameId: randomUUID() })).toEqual({ ok: false, error: "wrong-game" });
  expect(f.treat({ ...f.input(), round: 2 })).toEqual({ ok: false, error: "wrong-round" });
  expect(f.treat({ ...f.input(), round: 4 })).toEqual({ ok: false, error: "wrong-round" });
  for (const targetParticipantId of [randomUUID(), "round-two-survivor"]) expect(f.treat({ ...f.input(), targetParticipantId })).toEqual({ ok: false, error: "target-not-found" });
  expect(f.view()).toEqual(before);
  f.setState(state => ({ ...state, characters: state.characters.map(c => c.role === "medic" ? { ...c, health: 0 } : c) }));
  const dead = f.view();
  expect(f.treat(f.input(1))).toEqual({ ok: false, error: "medic-dead" });
  expect(f.view()).toEqual(dead);
});

test.each(["health-full-pending", "character-dead", "no-medical-units"])("rechazo seguro %s sin consumir ni registrar", error => {
  const f = setup();
  if (error === "character-dead") f.setState(state => ({ ...state, characters: state.characters.map((c, i) => i === 1 ? { ...c, health: 0 } : c) }));
  if (error === "no-medical-units") { f.wound(); f.setState(state => ({ ...state, inventory: { ...state.inventory, medicalUnits: 0 } })); }
  const before = f.view();
  expect(f.treat(f.input(1))).toEqual({ ok: false, error });
  expect(f.view()).toEqual(before);
});

test("recibos y límite sobreviven a reconexión; solo se permite otra unidad en otra ronda", () => {
  const f = setup(); f.wound(50);
  const request = f.input();
  expect(f.treat(request)).toEqual({ ok: true, requestId: request.requestId });
  const after = f.view();
  expect(f.treat(request).ok).toBe(true);
  expect(f.treat({ ...request, targetParticipantId: f.sessions[1]!.credential.participantId })).toEqual({ ok: false, error: "request-conflict" });
  expect(f.view()).toEqual(after);
  f.manager.disconnect(`s${f.medic}`);
  expect(f.manager.resume("replacement", f.sessions[f.medic]!.credential).ok).toBe(true);
  expect(f.manager.treat("replacement", request).ok).toBe(true);
  expect(f.manager.treat("replacement", f.input())).toEqual({ ok: false, error: "treatment-used" });
  // Volver al socket original para el helper de votos; la credencial es la misma.
  f.manager.disconnect("replacement"); f.manager.resume(`s${f.medic}`, f.sessions[f.medic]!.credential);
  f.finishVote("rescue");
  const history = f.manager.roundSummary(f.code)!;
  expect(f.manager.advanceRound("s0").ok).toBe(true);
  expect(f.view().characters.map(c => c.health)).toEqual(after.characters.map(c => c.health));
  expect(f.view().characters).toEqual(history.characters);
  expect(f.view().inventory).toEqual(after.inventory);
  expect(f.treat({ ...request, requestId: randomUUID() })).toEqual({ ok: false, error: "wrong-round" });
  expect(f.treat(request).ok).toBe(true); // Confirma el recibo anterior, sin nueva curación.
  expect(f.treat().ok).toBe(true);
  expect(f.view().characters[f.medic]!.health).toBe(90);
  expect(f.view().inventory.medicalUnits).toBe(2);
  expect(f.view().treatments.map(t => t.round)).toEqual([1, 2]);
  f.manager.routeAction("s0", "open"); f.finishVote("unstable-corridor");
  f.finishVote("rescue");
  f.manager.openTransport("s0", { preparationId: f.manager.transportView(f.code)!.cases.at(-1)!.preparationId });
  const historicalTwo = f.manager.roundTwoView(f.code)!;
  const rolls = f.random.mock.calls.length;
  const vote = f.manager.publicVote(f.code)!;
  expect(f.treat(f.input(2)).ok).toBe(true); // Otro humano, después del desplazamiento.
  expect(f.manager.roundTwoView(f.code)).toEqual(historicalTwo);
  expect(f.manager.roundSummary(f.code)).toEqual(history);
  expect(f.manager.publicVote(f.code)).toMatchObject({ decisionId: vote.decisionId, status: "closed" });
  expect(f.random).toHaveBeenCalledTimes(rolls);
});
