import { traverseRouteEffects, type RandomSource, type RouteEffects, type RouteError } from "./routes.js";
import { isAlive, type HumanRole, type SimulationState } from "./state.js";

export type RoundThreeRouteId = "fire-door" | "pipe-gallery" | "metal-debris";
interface Definition extends RouteEffects {
  readonly id: RoundThreeRouteId;
  readonly name: string;
  readonly danger: "MODERATE" | "EXTREME";
}
// Exclusivo del backend. Las vistas públicas se proyectan sin copiar estas definiciones.
const definitions: readonly Definition[] = [
  { id: "fire-door", name: "Puerta cortafuegos", energyCost: 20, danger: "MODERATE", accidentProbability: 0.2, accidentDamage: 10 },
  { id: "pipe-gallery", name: "Galería de tuberías", energyCost: 10, danger: "EXTREME", accidentProbability: 0.5, accidentDamage: 30 },
  { id: "metal-debris", name: "Escombros metálicos", energyCost: 30, danger: "MODERATE", accidentProbability: 0.2, accidentDamage: 10 },
];
export type RoundThreeRouteError = RouteError | "crowbar-unavailable-pending"
  | "round-three-already-resolved" | "invalid-request";
export interface RoundThreeRouteOutcome {
  readonly requestId: string;
  readonly routeId: RoundThreeRouteId;
  readonly energyCost: number;
  readonly accident: boolean;
  readonly accidentDamage: number;
  readonly victimIds: readonly string[];
  readonly deceasedIds: readonly string[];
  readonly environmentalDamage: number;
  readonly environmentalVictimIds: readonly string[];
  readonly crowbarLost: boolean;
  readonly returnBlocked: boolean;
  readonly discovery: "medical-conference-room" | "supply-warehouse" | null;
  readonly gained: { readonly packs: number; readonly medicalUnits: number };
}
export type RoundThreeRouteResolution =
  | { readonly status: "completed"; readonly outcome: RoundThreeRouteOutcome }
  | { readonly status: "blocked"; readonly requestId: string; readonly routeId: RoundThreeRouteId; readonly error: RoundThreeRouteError };
export type RoundThreeRouteResult =
  | { readonly ok: true; readonly state: SimulationState; readonly outcome: RoundThreeRouteOutcome }
  | { readonly ok: false; readonly state: SimulationState; readonly error: RoundThreeRouteError };

/** Motor interno sin transición de ronda, votos ni conexiones. Una resolución por partida. */
export function resolveRoundThreeRoute(state: SimulationState, requestId: string, routeId: string, random: RandomSource): RoundThreeRouteResult {
  const reject = (error: RoundThreeRouteError): RoundThreeRouteResult => ({ ok: false, state, error });
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 100) return reject("invalid-request");
  const previous = state.roundThreeRoute;
  if (previous) {
    const saved = previous.status === "completed" ? previous.outcome : previous;
    if (saved.requestId !== requestId || saved.routeId !== routeId) return reject("round-three-already-resolved");
    return previous.status === "completed" ? { ok: true, state, outcome: previous.outcome } : reject(previous.error);
  }
  const route = definitions.find(entry => entry.id === routeId);
  if (!route) return reject("unknown-route");
  // Solo se guarda el bloqueo; no se confirman pagos, daños, pérdidas ni premios parciales.
  // Conservarlo evita volver a tirar después de un rechazo que haya consumido azar.
  const block = (error: RoundThreeRouteError): RoundThreeRouteResult => ({ ok: false, error,
    state: { ...state, roundThreeRoute: { status: "blocked", requestId, routeId: route.id, error } } });
  if (route.id === "fire-door" && state.tools.crowbar !== "available") return block("crowbar-unavailable-pending");
  const living = state.characters.filter(isAlive);
  if (!living.length) return block("no-living-characters");
  const environmentalDamage = route.id === "pipe-gallery" ? 20 : 0;
  const traversal = traverseRouteEffects(state, { ...route, guaranteedDamage: environmentalDamage }, random);
  if (!traversal.ok) return block(traversal.error);
  const next = traversal.state;
  let packs = 0;
  if (route.id === "metal-debris") {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) return block("invalid-random");
    packs = sample < 0.7 ? 4 : 8;
  }
  const medicalUnits = route.id === "fire-door" ? 2 : 0;
  const crowbarLost = route.id === "fire-door";
  const outcome: RoundThreeRouteOutcome = { requestId, routeId: route.id, energyCost: route.energyCost,
    accident: traversal.accident, accidentDamage: traversal.accident ? route.accidentDamage : 0,
    victimIds: [...traversal.victimIds], deceasedIds: [...traversal.deceasedIds], environmentalDamage,
    environmentalVictimIds: environmentalDamage ? living.map(c => c.id) : [], crowbarLost, returnBlocked: crowbarLost,
    discovery: route.id === "fire-door" ? "medical-conference-room" : route.id === "metal-debris" ? "supply-warehouse" : null,
    gained: { packs, medicalUnits } };
  return { ok: true, outcome, state: { ...next,
    tools: crowbarLost ? { ...next.tools, crowbar: "lost" } : next.tools,
    inventory: { packs: next.inventory.packs + packs, medicalUnits: next.inventory.medicalUnits + medicalUnits },
    roundThreeRoute: { status: "completed", outcome } } };
}

export interface RoundThreeRouteView { id: RoundThreeRouteId; name: string; energyCost: number }
export function publicRoundThreeRouteViews(): RoundThreeRouteView[] {
  return definitions.map(route => ({ id: route.id, name: route.name, energyCost: route.energyCost }));
}

/** Proyección privada a un rol que el futuro llamador deberá obtener de su sesión. Sin cantidades. */
export function privateRoundThreeKnowledge(role: HumanRole): { routeId: RoundThreeRouteId; destination: string }[] {
  if (role === "medic") return [{ routeId: "fire-door", destination: "Sala de conferencias médicas" }];
  if (role === "bellhop") return [{ routeId: "metal-debris", destination: "Almacén de suministros" }];
  return [];
}

/** Solo tras completar: no serializar SimulationState ni el catálogo como resultado público. */
export function roundThreeExplorationView(state: SimulationState) {
  const resolution = state.roundThreeRoute;
  if (resolution?.status !== "completed") return null;
  const result = resolution.outcome;
  return { routeId: result.routeId, energyCost: result.energyCost, accident: result.accident,
    accidentDamage: result.accidentDamage, victimIds: [...result.victimIds], environmentalDamage: result.environmentalDamage,
    environmentalVictimIds: [...result.environmentalVictimIds], crowbarLost: result.crowbarLost,
    returnBlocked: result.returnBlocked, discovery: result.discovery, gained: { ...result.gained } };
}
