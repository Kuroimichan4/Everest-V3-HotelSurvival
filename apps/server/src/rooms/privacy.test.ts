import { expect, test } from "vitest";
import { RoomManager } from "./manager.js";
import type { SimulationState } from "../simulation/state.js";

function setup() {
  const manager = new RoomManager(() => 0, { now: () => 1000, schedule: () => () => {} });
  const created = manager.create("s0", "P0"); if (!created.ok) throw new Error(created.error);
  const sessions = [created.value]; const code = created.value.room.code;
  for (const i of [1, 2, 3]) { const r = manager.join(`s${i}`, `P${i}`, code); if (!r.ok) throw new Error(r.error); sessions.push(r.value); }
  manager.start("s0");
  const game = (manager as unknown as { rooms: Map<string, { game: { state: SimulationState } }> }).rooms.get(code)!.game;
  game.state = { ...game.state, characters: game.state.characters.map((c, i) => ({ ...c, health: 61 + i, energy: 41 + i })) };
  return { manager, sessions, code, game };
}

test.each([0, 1, 2, 3])("10A: authenticated role %i gets own exact vitals; only Medic gets others' health", i => {
  const f = setup();
  try {
    const raw = f.manager.suppliesView(f.code)!; const original = JSON.stringify(raw);
    const projected = f.manager.sessionProjection(`s${i}`, raw);
    const medic = f.manager.privateRole(`s${i}`)!.role === "medic";
    projected.characters.forEach((p, j) => {
      expect(p.health).toBe(i === j || medic ? 61 + j : undefined);
      expect(p.energy).toBe(i === j ? 41 + j : undefined);
      expect(p.status).toBe("active"); expect(p.participantId).toBe(f.sessions[j]!.credential.participantId);
      if (j !== i) expect(Object.hasOwn(p, "energy")).toBe(false);
      if (j !== i && !medic) expect(Object.hasOwn(p, "health")).toBe(false);
    });
    expect(JSON.stringify(raw)).toBe(original);
  } finally { f.manager.dispose(); }
});

test.each([0, 1, 2, 3])("10A: role %i cannot recover foreign numeric deltas from nested history or final DTO", i => {
  const f = setup();
  try {
    const ownId = f.sessions[i]!.credential.participantId; const medic = f.manager.privateRole(`s${i}`)!.role === "medic";
    const payload = {
      energyCost: 30, costs: { damage: 10 },
      final: { humans: f.manager.suppliesView(f.code)!.characters },
      history: f.sessions.map(s => ({ participantId: s.credential.participantId, routeEnergy: 30, transportEnergy: 15,
        damage: 7, healthRestored: 9, nested: { health: 61, energy: 41 } })),
      activity: f.sessions.flatMap(s => ["pack", "treatment"].map(kind => ({ targetParticipantId: s.credential.participantId, kind, restored: 9 }))),
    };
    const dto = f.manager.sessionProjection(`s${i}`, payload);
    expect(dto.energyCost).toBe(30); expect(dto.costs.damage).toBe(10);
    dto.history.forEach(p => {
      const own = p.participantId === ownId;
      expect(p.routeEnergy).toBe(own ? 30 : undefined); expect(p.transportEnergy).toBe(own ? 15 : undefined);
      expect(p.damage).toBe(own ? 7 : undefined); expect(p.healthRestored).toBe(own || medic ? 9 : undefined);
      expect(p.nested.energy).toBe(own ? 41 : undefined); expect(p.nested.health).toBe(own || medic ? 61 : undefined);
    });
    dto.activity.forEach(e => expect(e.restored).toBe(e.targetParticipantId === ownId || medic && e.kind === "treatment" ? 9 : undefined));
  } finally { f.manager.dispose(); }
});

test("10A: reconnect uses authenticated identity, keeps own vitals and public statuses; dead Medic loses extra access", () => {
  const f = setup();
  try {
    const i = f.sessions.findIndex((_, i) => f.manager.privateRole(`s${i}`)?.role === "medic");
    const prior = f.manager.sessionProjection(`s${i}`, f.manager.suppliesView(f.code));
    f.manager.disconnect(`s${i}`); expect(f.manager.resume("new", f.sessions[i]!.credential).ok).toBe(true);
    expect(f.manager.sessionProjection("new", f.manager.suppliesView(f.code))).toEqual(prior);
    f.game.state = { ...f.game.state, characters: f.game.state.characters.map((c, j) => j === i ? { ...c, health: 0 } : j === (i + 1) % 4 ? { ...c, eliminated: true } : c) };
    const view = f.manager.sessionProjection("new", f.manager.suppliesView(f.code)!);
    expect(view.characters[i]).toMatchObject({ health: 0, energy: 41 + i, status: "dead" });
    expect(view.characters[(i + 1) % 4]!.status).toBe("abandoned");
    expect(view.characters.filter((_, j) => j !== i).every(c => c.health === undefined && c.energy === undefined)).toBe(true);
    expect(() => f.manager.sessionProjection("outsider", f.manager.suppliesView(f.code))).toThrow();
  } finally { f.manager.dispose(); }
});
