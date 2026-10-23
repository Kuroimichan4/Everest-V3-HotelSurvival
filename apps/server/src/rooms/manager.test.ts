import { expect, test } from "vitest";
import type { RoomReply } from "@everest/shared";
import { RoomManager } from "./manager.js";
import { shuffleRoles } from "./roles.js";

function value<T>(reply: RoomReply<T>): T {
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
function fullRoom() {
  const manager = new RoomManager(() => 0);
  const creator = value(manager.create("socket-0", "Ana"));
  const guests = [1, 2, 3].map((i) => value(manager.join(`socket-${i}`, `Persona ${i}`, creator.room.code)));
  return { manager, creator, guests };
}

test("crea salas con códigos únicos y creador dentro sin rol previo", () => {
  const manager = new RoomManager();
  const sessions = Array.from({ length: 100 }, (_, i) => value(manager.create(`s${i}`, "Ana")));
  expect(new Set(sessions.map((session) => session.room.code)).size).toBe(100);
  for (const session of sessions) {
    expect(session.room.participants).toHaveLength(1);
    expect(session.room.creatorId).toBe(session.credential.participantId);
    expect(session.room.status).toBe("waiting");
    expect(session.credential.token).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(manager.privateRole("s0")).toBeNull();
});

test("admite cuatro participantes y rechaza un quinto sin cambiar la sala", () => {
  const { manager, creator } = fullRoom();
  expect(manager.join("fifth", "Quinta", creator.room.code)).toEqual({ ok: false, error: "room-full" });
  expect(value(manager.start("socket-0")).participants).toHaveLength(4);
});

test("rechaza código inexistente, entradas inválidas y duplicar conexión", () => {
  const manager = new RoomManager();
  expect(manager.join("s", "Ana", "000000000000")).toEqual({ ok: false, error: "room-not-found" });
  expect(manager.create("s", " ")).toEqual({ ok: false, error: "invalid-input" });
  const created = value(manager.create("s", " Ana "));
  expect(created.room.participants[0]?.name).toBe("Ana");
  expect(manager.create("s", "Otra")).toEqual({ ok: false, error: "already-in-room" });
  expect(manager.join("other", "Ana", null)).toEqual({ ok: false, error: "invalid-input" });
});

test("solo el creador autenticado puede iniciar y necesita cuatro conectados", () => {
  const manager = new RoomManager();
  const creator = value(manager.create("creator", "Ana"));
  expect(manager.start("creator")).toEqual({ ok: false, error: "not-four-connected" });
  value(manager.join("guest", "Luis", creator.room.code));
  expect(manager.start("guest")).toEqual({ ok: false, error: "not-creator" });
  expect(manager.start("outsider")).toEqual({ ok: false, error: "invalid-credentials" });
});

test("desconectar reserva plaza, impide inicio y no transfiere creador", () => {
  const { manager, creator } = fullRoom();
  const room = manager.disconnect("socket-0")!;
  expect(room.creatorId).toBe(creator.credential.participantId);
  expect(room.participants[0]?.connected).toBe(false);
  expect(manager.start("socket-1")).toEqual({ ok: false, error: "not-creator" });
  expect(manager.join("new", "Nueva", room.code)).toEqual({ ok: false, error: "room-full" });
  value(manager.resume("new-creator", creator.credential));
  manager.disconnect("socket-1");
  expect(manager.start("new-creator")).toEqual({ ok: false, error: "not-four-connected" });
});

test("Fisher–Yates usa límites correctos y permite un sorteo determinista", () => {
  const bounds: number[] = [];
  expect(shuffleRoles((max) => { bounds.push(max); return 0; }))
    .toEqual(["medic", "architect-engineer", "bellhop", "maintenance"]);
  expect(bounds).toEqual([4, 3, 2]);
  expect(shuffleRoles((max) => max - 1)).toEqual(["maintenance", "medic", "architect-engineer", "bellhop"]);
});

test("asigna cuatro roles únicos solo al iniciar y rechaza segundo inicio sin sortear otra vez", () => {
  const { manager, creator } = fullRoom();
  for (let i = 0; i < 4; i++) expect(manager.privateRole(`socket-${i}`)).toBeNull();
  expect(value(manager.start("socket-0")).status).toBe("started");
  const roles = Array.from({ length: 4 }, (_, i) => manager.privateRole(`socket-${i}`));
  expect(new Set(roles.map((assignment) => assignment?.role)).size).toBe(4);
  expect(roles[0]?.participantId).toBe(creator.credential.participantId);
  expect(manager.start("socket-0")).toEqual({ ok: false, error: "already-started" });
  expect(Array.from({ length: 4 }, (_, i) => manager.privateRole(`socket-${i}`))).toEqual(roles);
  expect(manager.join("late", "Nueva", creator.room.code)).toEqual({ ok: false, error: "already-started" });
});

test("reconexión autorizada conserva identidad, plaza, rol y creador", () => {
  const { manager, creator } = fullRoom();
  value(manager.start("socket-0"));
  const role = manager.privateRole("socket-0");
  manager.disconnect("socket-0");
  expect(manager.privateRole("socket-0")).toBeNull();
  const resumed = value(manager.resume("replacement", creator.credential));
  expect(resumed.credential).toEqual(creator.credential);
  expect(resumed.room.participants).toHaveLength(4);
  expect(resumed.room.participants.every((participant) => participant.connected)).toBe(true);
  expect(manager.privateRole("replacement")).toEqual(role);
  expect(value(manager.resume("replacement", creator.credential)).room.participants).toHaveLength(4);
});

test("rechaza credenciales falsas y dos conexiones simultáneas de la misma sesión", () => {
  const { manager, creator } = fullRoom();
  expect(manager.resume("intruder", { ...creator.credential, token: "0".repeat(64) }))
    .toEqual({ ok: false, error: "invalid-credentials" });
  expect(manager.resume("intruder", creator.credential)).toEqual({ ok: false, error: "session-in-use" });
  manager.disconnect("socket-0");
  for (const input of [null, {}, { ...creator.credential, participantId: "missing" }, { ...creator.credential, token: "x" }]) {
    expect(manager.resume("intruder", input)).toEqual({ ok: false, error: "invalid-credentials" });
  }
  expect(manager.privateRole("intruder")).toBeNull();
});

test("la proyección pública no incluye roles, personajes, credenciales ni estado interno", () => {
  const { manager } = fullRoom();
  const room = value(manager.start("socket-0"));
  expect(Object.keys(room).sort()).toEqual(["code", "creatorId", "participants", "status"]);
  for (const participant of room.participants) {
    expect(Object.keys(participant).sort()).toEqual(["connected", "id", "name"]);
    expect(["maintenance", "medic", "architect-engineer", "bellhop"]).not.toContain(participant.id);
  }
});

test("no permite suplantar a otro participante para obtener su ficha", () => {
  const { manager, creator, guests } = fullRoom();
  value(manager.start("socket-0"));
  const original = manager.privateRole("socket-0");
  manager.disconnect("socket-1");
  expect(manager.resume("socket-0", { ...guests[0]!.credential, token: creator.credential.token }))
    .toEqual({ ok: false, error: "invalid-credentials" });
  expect(manager.privateRole("socket-0")).toEqual(original);
  expect(manager.privateRole("outsider")).toBeNull();
});
