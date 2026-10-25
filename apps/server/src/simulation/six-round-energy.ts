import { consumePack } from "./operations.js";
import { payMovement } from "./transport.js";
import { createInitialState, type EngineState } from "./state.js";
import { MOVEMENT_ENERGY, EXIT_MOVEMENT_ENERGY, NPC_RESCUE_ENERGY, IMMOBILE_NPC_RESCUE_ENERGY, INTERMEDIATE_ENERGY } from "./energy-costs.js";

export interface EnergyScenario {
  name: string; lowRisk: boolean; rescues: 0 | 2; finalNpc: "none" | "assist" | "carry";
  warehouse: 0 | 4 | 8; packs: number;
}
/** Evaluación energética determinista, sin accidentes: no acredita supervivencia ante todos los daños.
 * Evalúa los costes de las seis etapas sin generar encuentros ni otra evacuación.
 * Distribución simétrica: packs mínimos justo antes de cada esfuerzo. */
export function evaluateSixRoundEnergy(scenario: EnergyScenario) {
  let state: EngineState = { ...createInitialState(), inventory: { packs: scenario.packs, medicalUnits: 4 } };
  const movementCosts = [MOVEMENT_ENERGY["round-one-passage"], scenario.lowRisk ? MOVEMENT_ENERGY.ventilation : MOVEMENT_ENERGY["unstable-corridor"],
    scenario.warehouse ? MOVEMENT_ENERGY["metal-debris"] : scenario.lowRisk ? MOVEMENT_ENERGY["fire-door"] : MOVEMENT_ENERGY["pipe-gallery"],
    scenario.lowRisk ? INTERMEDIATE_ENERGY["technical-stairs"] : INTERMEDIATE_ENERGY["cracked-stairs"],
    scenario.lowRisk ? INTERMEDIATE_ENERGY["extraction-gallery"] : INTERMEDIATE_ENERGY["collapsed-kitchen"],
    scenario.lowRisk ? EXIT_MOVEMENT_ENERGY["revolving-door"] : EXIT_MOVEMENT_ENERGY["exterior-crack"]];
  const efforts = movementCosts.map((cost, i) => cost + (i < 2 && scenario.rescues === 2 ? NPC_RESCUE_ENERGY : 0)
    + (i === 5 ? scenario.finalNpc === "carry" ? IMMOBILE_NPC_RESCUE_ENERGY : scenario.finalNpc === "assist" ? NPC_RESCUE_ENERGY : 0 : 0));
  let used = 0;
  for (let i = 0; i < efforts.length; i++) {
    const cost = efforts[i]!;
    for (const human of state.characters) {
      while (state.characters.find(c => c.id === human.id)!.energy < cost && state.inventory.packs > 0) {
        const pack = consumePack(state, human.id);
        if (!pack.ok) throw new Error(pack.error);
        state = pack.state; used++;
      }
    }
    const moved = payMovement(state, cost);
    if (!moved.ok) return { name: scenario.name, viableAll: false, blockedAt: i + 1, totalPerHuman: efforts.reduce((a,b) => a+b,0), used, remaining: state.inventory.packs, energies: state.characters.map(c => c.energy) };
    state = moved.state;
    if (i === 2) state = { ...state, inventory: { ...state.inventory, packs: state.inventory.packs + scenario.warehouse } };
  }
  return { name: scenario.name, viableAll: true, blockedAt: null, totalPerHuman: efforts.reduce((a,b) => a+b,0), used, remaining: state.inventory.packs, energies: state.characters.map(c => c.energy) };
}
export const ENERGY_SCENARIOS: readonly EnergyScenario[] = [
  { name: "almacén cuatro sin rescates", lowRisk: true, rescues: 0, finalNpc: "none", warehouse: 4, packs: 8 },
  { name: "almacén ocho y último rescate asistido", lowRisk: true, rescues: 0, finalNpc: "assist", warehouse: 8, packs: 8 },
  { name: "mínimo sin rescates", lowRisk: false, rescues: 0, finalNpc: "none", warehouse: 0, packs: 8 },
  { name: "mínimo sin suministros", lowRisk: false, rescues: 0, finalNpc: "none", warehouse: 0, packs: 0 },
  { name: "menor riesgo", lowRisk: true, rescues: 0, finalNpc: "none", warehouse: 0, packs: 8 },
  { name: "mínimo con dos rescates", lowRisk: false, rescues: 2, finalNpc: "none", warehouse: 0, packs: 8 },
  { name: "menor riesgo con dos rescates", lowRisk: true, rescues: 2, finalNpc: "none", warehouse: 0, packs: 8 },
  { name: "almacén cuatro packs y dos rescates", lowRisk: true, rescues: 2, finalNpc: "none", warehouse: 4, packs: 8 },
  { name: "almacén ocho packs y dos rescates", lowRisk: true, rescues: 2, finalNpc: "none", warehouse: 8, packs: 8 },
  { name: "almacén ocho y tres rescates asistidos", lowRisk: true, rescues: 2, finalNpc: "assist", warehouse: 8, packs: 8 },
  { name: "almacén ocho y último NPC transportado", lowRisk: true, rescues: 2, finalNpc: "carry", warehouse: 8, packs: 8 },
];
