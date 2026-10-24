import { expect, test } from "vitest";
import { abandonCharacters } from "./abandonment.js";
import { createInitialState, isAlive } from "./state.js";

test("transferir objetos no duplica identidades existentes ni recursos compartidos", () => {
  const initial = createInitialState();
  const state = { ...initial, sharedItems: [{ id: "shared-map", kind: "map" }], characters: initial.characters.map((c, i) => i === 0
    ? { ...c, personalItems: [{ id: "shared-map", kind: "map" }, { id: "key", kind: "key" }, { id: "key", kind: "key" }] } : c) };
  const first = abandonCharacters(state, [state.characters[0]!.id]);
  expect(first.state.sharedItems).toEqual([{ id: "shared-map", kind: "map" }, { id: "key", kind: "key" }]);
  expect(first.transfers).toEqual([{ characterId: state.characters[0]!.id, items: [{ id: "key", kind: "key" }] }]);
  expect(first.state.inventory).toBe(state.inventory);
  expect(first.state.tools).toBe(state.tools);
  expect(abandonCharacters(first.state, [state.characters[0]!.id]).transfers).toEqual([]);
  expect(state.characters[0]!.personalItems).toHaveLength(3);
});

test("abandono mantiene salud y excluye del juego; un fallecido sigue siendo una muerte", () => {
  const initial = createInitialState();
  const state = { ...initial, characters: initial.characters.map((c, i) => i === 1 ? { ...c, health: 0 } : c) };
  const result = abandonCharacters(state, state.characters.slice(0, 2).map(c => c.id));
  expect(result.state.characters[0]).toMatchObject({ health: 100, eliminated: true });
  expect(result.state.characters[1]).toEqual(state.characters[1]);
  expect(result.state.characters.slice(0, 2).some(isAlive)).toBe(false);
  expect(result.state.characters.slice(2).every(isAlive)).toBe(true);
});
