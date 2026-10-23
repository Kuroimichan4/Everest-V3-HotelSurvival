/** Estado interno del backend. No es un contrato de mensajes para clientes. */
export type HumanRole = "maintenance" | "medic" | "architect-engineer" | "bellhop";

export interface HumanCharacter {
  readonly id: string;
  readonly role: HumanRole;
  readonly health: number;
  readonly energy: number;
}

export interface SharedInventory {
  readonly packs: number;
  readonly medicalUnits: number;
}

export interface SimulationState {
  readonly characters: readonly HumanCharacter[];
  readonly inventory: SharedInventory;
}

/** Los identificadores son internos y únicos dentro de cada partida. */
export function createInitialState(): SimulationState {
  const roles: readonly HumanRole[] = ["maintenance", "medic", "architect-engineer", "bellhop"];
  return {
    characters: roles.map((role) => ({ id: role, role, health: 100, energy: 100 })),
    inventory: { packs: 8, medicalUnits: 4 },
  };
}

/** La muerte se deriva de salud para evitar dos campos que puedan contradecirse. */
export function isAlive(character: HumanCharacter): boolean {
  return character.health > 0;
}
