import { isAlive, type EngineState } from "./state.js";

/** Transferencia única por identidad; no toca los recursos compartidos ni la palanca global. */
export function abandonCharacters<S extends EngineState>(state: S, ids: readonly string[]) {
  const shared = [...(state.sharedItems ?? [])];
  const transfers: { characterId: string; items: { id: string; kind: string }[] }[] = [];
  for (const id of ids) {
    const character = state.characters.find(c => c.id === id);
    if (!character || !isAlive(character)) continue;
    const items = [];
    for (const item of character.personalItems ?? []) {
      if (shared.some(existing => existing.id === item.id)) continue;
      items.push(item); shared.push(item);
    }
    transfers.push({ characterId: id, items: items.map(item => ({ ...item })) });
  }
  return { state: { ...state, sharedItems: shared, characters: state.characters.map(c =>
    ids.includes(c.id) && isAlive(c) ? { ...c, eliminated: true, personalItems: [] } : c) }, transfers };
}
