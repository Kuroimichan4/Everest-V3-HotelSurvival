import { isAlive } from "./state.js";
import type { HumanCharacter, SimulationState } from "./state.js";

export type OperationError =
  | "invalid-amount"
  | "character-not-found"
  | "character-dead"
  | "insufficient-energy"
  | "no-packs"
  | "energy-full"
  | "no-medical-units"
  | "treatment-used"
  | "health-full-pending"
  | "transport-vote-pending"
  | "invalid-transport-plan"
  | "transport-plan-infeasible"
  | "no-living-characters";

export type OperationResult =
  | { readonly ok: true; readonly state: SimulationState }
  | { readonly ok: false; readonly error: OperationError; readonly state: SimulationState };

function reject(state: SimulationState, error: OperationError): OperationResult {
  return { ok: false, error, state };
}

function replaceCharacter(state: SimulationState, updated: HumanCharacter): SimulationState {
  return {
    ...state,
    characters: state.characters.map((character) => character.id === updated.id ? updated : character),
  };
}

// No se impone una granularidad entera a salud/energía: no está aprobada.
function validAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount >= 0;
}

export function applyDamage(state: SimulationState, characterId: string, damage: number): OperationResult {
  if (!validAmount(damage)) return reject(state, "invalid-amount");
  const character = state.characters.find((candidate) => candidate.id === characterId);
  if (!character) return reject(state, "character-not-found");
  return {
    ok: true,
    state: replaceCharacter(state, { ...character, health: Math.max(0, character.health - damage) }),
  };
}

/** Valida y paga el coste energético; los efectos de acciones futuras quedan fuera. */
export function spendEnergy(state: SimulationState, characterId: string, cost: number): OperationResult {
  if (!validAmount(cost)) return reject(state, "invalid-amount");
  const character = state.characters.find((candidate) => candidate.id === characterId);
  if (!character) return reject(state, "character-not-found");
  if (!isAlive(character)) return reject(state, "character-dead");
  if (character.energy < cost) return reject(state, "insufficient-energy");
  return { ok: true, state: replaceCharacter(state, { ...character, energy: character.energy - cost }) };
}

/** Primitiva interna: no decide quién solicita el pack ni cuándo puede hacerlo. */
export function consumePack(state: SimulationState, characterId: string): OperationResult {
  const character = state.characters.find((candidate) => candidate.id === characterId);
  if (!character) return reject(state, "character-not-found");
  if (!isAlive(character)) return reject(state, "character-dead");
  if (state.inventory.packs <= 0) return reject(state, "no-packs");
  if (character.energy === 100) return reject(state, "energy-full");
  const updated = replaceCharacter(state, { ...character, energy: Math.min(100, character.energy + 25) });
  return {
    ok: true,
    state: { ...updated, inventory: { ...state.inventory, packs: state.inventory.packs - 1 } },
  };
}

/** Un humano vivo por unidad; el límite se conserva por destinatario y ronda. */
export function administerTreatment(state: SimulationState, characterId: string): OperationResult {
  const character = state.characters.find(candidate => candidate.id === characterId);
  if (!character) return reject(state, "character-not-found");
  if (!isAlive(character)) return reject(state, "character-dead");
  const history = state.medicalTreatments ?? [];
  if (history.some(treatment => treatment.round === state.currentRound && treatment.characterId === characterId)) return reject(state, "treatment-used");
  // Regla pendiente: rechazo seguro, sin gastar ni registrar un tratamiento.
  if (character.health >= 100) return reject(state, "health-full-pending");
  if (state.inventory.medicalUnits <= 0) return reject(state, "no-medical-units");
  const health = Math.min(100, character.health + 20);
  const updated = replaceCharacter(state, { ...character, health });
  return { ok: true, state: { ...updated,
    inventory: { ...state.inventory, medicalUnits: state.inventory.medicalUnits - 1 },
    medicalTreatments: [...history, { round: state.currentRound, characterId, healthRestored: health - character.health }] } };
}
