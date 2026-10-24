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
  readonly currentRound: 1 | 2;
  readonly roundTwo?: {
    readonly movement?: import("./round-two-movement.js").MovementResolution;
    readonly npcId: "round-two-survivor";
    readonly resolution: SimulationState["roundOne"];
    readonly blocked: "insufficient-energy" | null;
  };
  readonly roundOne: {
    readonly decisionId: string;
    readonly result: import("@everest/shared").RescueOutcome;
    readonly npc: "rescued" | "abandoned";
    readonly consequencesApplied: true;
    readonly completed: true;
    readonly microearthquake: boolean;
    readonly costs: { readonly rescueEnergy: number; readonly movementEnergy: number; readonly damage: number };
  } | null;
  readonly characters: readonly HumanCharacter[];
  readonly inventory: SharedInventory;
}

/** Los identificadores son internos y únicos dentro de cada partida. */
export function createInitialState(): SimulationState {
  const roles: readonly HumanRole[] = ["maintenance", "medic", "architect-engineer", "bellhop"];
  return {
    currentRound: 1, roundOne: null,
    characters: roles.map((role) => ({ id: role, role, health: 100, energy: 100 })),
    inventory: { packs: 8, medicalUnits: 4 },
  };
}

/** La muerte se deriva de salud para evitar dos campos que puedan contradecirse. */
export function isAlive(character: HumanCharacter): boolean {
  return character.health > 0;
}
