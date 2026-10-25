import { createInitialState, isAlive, type EngineState, type HumanRole } from "./state.js";
import { consumePack, applyDamage } from "./operations.js";
import { simulateRouteEffectsForAnalysis } from "./routes.js";
import { MOVEMENT_ENERGY, INTERMEDIATE_ENERGY, EXIT_MOVEMENT_ENERGY, NPC_RESCUE_ENERGY } from "./energy-costs.js";
import { HISTORICAL_PROBABILITIES, PROPOSED_PROBABILITIES, type StructuralRisk } from "./balance-probabilities.js";
import { generateRoundFourEncounter } from "./round-four.js";

/** Mulberry32: enteros de 32 bits, muestras en [0,1). Exclusivo de análisis/pruebas. */
export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let x = Math.imul(value ^ (value >>> 15), value | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export interface BalanceScenario {
  roles?: readonly HumanRole[];
  id: string; prudent: boolean; rescueTwo: boolean; packs: number; humans: 1 | 2 | 3 | 4;
  /** Referencia con ambas consecuencias propuestas; constante en los dos modelos de probabilidad. */
  forcedIntermediate: boolean;
}
export const BALANCE_SCENARIOS: readonly BalanceScenario[] = [
  { id: "minimum", prudent: false, rescueTwo: false, packs: 8, humans: 4, forcedIntermediate: false },
  { id: "prudent-warehouse", prudent: true, rescueTwo: false, packs: 8, humans: 4, forcedIntermediate: false },
  { id: "two-npc-rescues", prudent: false, rescueTwo: true, packs: 8, humans: 4, forcedIntermediate: false },
  { id: "limited-packs", prudent: true, rescueTwo: false, packs: 0, humans: 4, forcedIntermediate: false },
  { id: "repeated-extreme-forced", prudent: false, rescueTwo: false, packs: 8, humans: 4, forcedIntermediate: true },
  { id: "three-humans", prudent: false, rescueTwo: false, packs: 8, humans: 3, forcedIntermediate: false },
  { id: "two-humans", prudent: false, rescueTwo: false, packs: 8, humans: 2, forcedIntermediate: false },
  { id: "one-human", prudent: false, rescueTwo: false, packs: 8, humans: 1, forcedIntermediate: false },
];
interface Step { cost: number; risk: StructuralRisk | null; damage: number; smoke: number }
function steps(s: BalanceScenario): Step[] {
  return [
    { cost: MOVEMENT_ENERGY["round-one-passage"], risk: null, damage: 0, smoke: 0 },
    s.prudent ? { cost: MOVEMENT_ENERGY.ventilation, risk: "LOW", damage: 5, smoke: 0 } : { cost: MOVEMENT_ENERGY["unstable-corridor"], risk: "HIGH", damage: 20, smoke: 0 },
    s.prudent ? { cost: MOVEMENT_ENERGY["metal-debris"], risk: "MODERATE", damage: 10, smoke: 0 } : { cost: MOVEMENT_ENERGY["pipe-gallery"], risk: "EXTREME", damage: 30, smoke: 20 },
    s.prudent ? { cost: INTERMEDIATE_ENERGY["technical-stairs"], risk: "LOW", damage: 5, smoke: 0 } : { cost: INTERMEDIATE_ENERGY["cracked-stairs"], risk: "HIGH", damage: 20, smoke: 0 },
    s.prudent ? { cost: INTERMEDIATE_ENERGY["extraction-gallery"], risk: "LOW", damage: 5, smoke: 0 } : { cost: INTERMEDIATE_ENERGY["collapsed-kitchen"], risk: "EXTREME", damage: 30, smoke: 0 },
    s.prudent ? { cost: EXIT_MOVEMENT_ENERGY["revolving-door"], risk: "LOW", damage: 5, smoke: 0 } : { cost: EXIT_MOVEMENT_ENERGY["exterior-crack"], risk: "EXTREME", damage: 30, smoke: 0 },
  ];
}
/** Referencia declarada, no política de jugadores:
 * - Sin curación automática ni elecciones de transporte/abandono.
 * - Botones activo entrega el mínimo de packs, por orden de personaje, antes de cada esfuerzo.
 * - Rutas privadas conocidas/reveladas como precondición del itinerario prudente.
 * - Dos rescates iniciales opcionales; NPC final generado con su regla real y siempre rechazado.
 * - Un bloqueo de energía detiene este itinerario, sin afirmar que otras decisiones sean inviables.
 * - Oportunidades médicas observadas en la trayectoria SIN curación; capacidad es una cota, no tratamientos ejecutados.
 */
export function simulateBalanceGame(scenario: BalanceScenario, probabilities: Readonly<Record<StructuralRisk, number>>, seed: number, victimLimit: 2|3 = 3) {
  const initial = createInitialState();
  const keep = scenario.humans === 4 ? [0, 1, 2, 3] : scenario.humans === 3 ? [0, 1, 3] : scenario.humans === 2 ? [1, 3] : [1];
  let state: EngineState = { ...initial, characters: initial.characters.filter((c, i) => scenario.roles ? scenario.roles.includes(c.role) : keep.includes(i)), inventory: { packs: scenario.packs, medicalUnits: 4 } };
  const opportunities = new Set<string>();
  let accidents = 0, accidentDeaths = 0, damage = 0, blocked = false, completed = false, capacity = 0, medicalBudget = 4, packsUsed = 0;
  const observeMedicalWindow = () => {
    if (!state.characters.some(c => isAlive(c) && c.role === "medic")) return;
    for (const human of state.characters.filter(c => isAlive(c) && c.health < 100)) {
      const key = `${state.currentRound}:${human.id}`;
      if (opportunities.has(key)) continue;
      opportunities.add(key);
      if (medicalBudget > 0) { capacity++; medicalBudget--; }
    }
  };
  const harm = (amount: number) => {
    for (const human of state.characters.filter(isAlive)) {
      const hit = applyDamage(state, human.id, amount);
      if (!hit.ok) throw new Error(hit.error);
      damage += Math.min(human.health, amount); state = hit.state;
    }
  };
  for (const [i, step] of steps(scenario).entries()) {
    state = { ...state, currentRound: (i + 1) as EngineState["currentRound"] };
    observeMedicalWindow();
    if (scenario.forcedIntermediate && (i === 3 || i === 4)) harm(10);
    if (!state.characters.some(isAlive)) break;
    const rescue = scenario.rescueTwo && i < 2 ? NPC_RESCUE_ENERGY : 0;
    const cost = step.cost + rescue;
    if (state.characters.some(c => isAlive(c) && c.role === "bellhop")) {
      for (const human of state.characters.filter(isAlive)) {
        while (state.characters.find(c => c.id === human.id)!.energy < cost && state.inventory.packs > 0) {
          const pack = consumePack(state, human.id); if (!pack.ok) throw new Error(pack.error);
          state = pack.state; packsUsed++;
        }
      }
    }
    if (i === 5) generateRoundFourEncounter(seededRandom(seed ^ 0x591CC45E));
    const moved = simulateRouteEffectsForAnalysis(state, { energyCost: cost, accidentProbability: step.risk ? probabilities[step.risk] : 0,
      accidentDamage: step.damage, guaranteedDamage: step.smoke }, seededRandom(seed ^ Math.imul(i + 1, 0x9E3779B9)), victimLimit);
    if (!moved.ok) { blocked = true; break; }
    accidentDeaths += moved.damage.filter(d => moved.deceasedIds.includes(d.characterId) && d.accidentDamage > 0 && state.characters.find(c => c.id === d.characterId)!.health > d.guaranteedDamage).length;
    state = moved.state;
    accidents += Number(moved.accident);
    damage += moved.damage.reduce((total, d) => total + d.healthLost, 0);
    if (i === 2 && scenario.prudent) {
      const packs = seededRandom(seed ^ 0x57415245)() < .7 ? 4 : 8;
      state = { ...state, inventory: { ...state.inventory, packs: state.inventory.packs + packs } };
    }
    if (i !== 5) observeMedicalWindow();
    if (i === 5 && state.characters.some(isAlive)) completed = true;
  }
  return { accidents, accidentDeaths, damage, noAccidents: accidents === 0, blocked, completed, packsUsed,
    below50: state.characters.filter(c => c.health > 0 && c.health < 50).length,
    dead: state.characters.filter(c => c.health === 0).length,
    evacuated: completed ? state.characters.filter(isAlive).length : 0,
    opportunities: opportunities.size, treatmentCapacity: capacity };
}
export function analyzeBalance(games = 10000, firstSeed = 20261025) {
  if (!Number.isSafeInteger(games) || games < 1 || !Number.isSafeInteger(firstSeed)) throw new Error("invalid-analysis-input");
  return BALANCE_SCENARIOS.flatMap(scenario => ([
    ["historical", HISTORICAL_PROBABILITIES], ["proposed", PROPOSED_PROBABILITIES],
  ] as const).map(([model, probabilities]) => {
    const totals = { accidents: 0, damage: 0, noAccidents: 0, blocked: 0, completed: 0, below50: 0, dead: 0, evacuated: 0, opportunities: 0, treatmentCapacity: 0, packsUsed: 0 };
    for (let i = 0; i < games; i++) {
      const result = simulateBalanceGame(scenario, probabilities, firstSeed + i);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += Number(result[key]);
    }
    return { scenario: scenario.id, model, games, firstSeed, initialHumans: scenario.humans,
      meanAccidents: totals.accidents / games, noAccidentRate: totals.noAccidents / games,
      meanDamage: totals.damage / games, meanBelow50: totals.below50 / games, meanDead: totals.dead / games,
      meanEvacuated: totals.evacuated / games, evacuationRate: totals.completed / games, energyBlockedRate: totals.blocked / games,
      meanMedicalOpportunities: totals.opportunities / games, meanTreatmentCapacity: totals.treatmentCapacity / games, meanPacksUsed: totals.packsUsed / games };
  }));
}

/** Contrafactual 10C.2: mismas rutas, probabilidades actuales y semillas por etapa. */
export function analyzeAccidentVictims(games=10000,firstSeed=20261025){
 if(!Number.isSafeInteger(games)||games<1||!Number.isSafeInteger(firstSeed))throw new Error('invalid-analysis-input');
 const scenarios=([4,2,1] as const).flatMap(humans=>[
  {id:`minimum-${humans}`,prudent:false,rescueTwo:false,packs:8,humans,forcedIntermediate:false},
  {id:`prudent-${humans}`,prudent:true,rescueTwo:false,packs:8,humans,forcedIntermediate:false,...(humans===2?{roles:["maintenance","bellhop"] as const}:humans===1?{roles:["maintenance"] as const}:{})},
  {id:`npc-rescues-${humans}`,prudent:false,rescueTwo:true,packs:8,humans,forcedIntermediate:false},
 ] satisfies BalanceScenario[]);
 return scenarios.flatMap(scenario=>([2,3] as const).map(victimLimit=>{
  const totals={damage:0,below50:0,dead:0,accidentDeaths:0,evacuated:0,completed:0,opportunities:0,treatmentCapacity:0,blocked:0};
  for(let i=0;i<games;i++){
   const result=simulateBalanceGame(scenario,PROPOSED_PROBABILITIES,firstSeed+i,victimLimit);
   for(const key of Object.keys(totals) as (keyof typeof totals)[])totals[key]+=Number(result[key]);
  }
  return {scenario:scenario.id,initialHumans:scenario.humans,victimLimit,games,firstSeed,
   meanDamage:totals.damage/games,meanBelow50:totals.below50/games,meanDead:totals.dead/games,meanAccidentDeaths:totals.accidentDeaths/games,
   meanEvacuated:totals.evacuated/games,evacuationRate:totals.completed/games,energyBlockedRate:totals.blocked/games,
   meanMedicalOpportunities:totals.opportunities/games,meanTreatmentCapacity:totals.treatmentCapacity/games};
 }));
}