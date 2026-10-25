import { applyDamage } from "./operations.js";
import { isAlive, type SimulationState } from "./state.js";
export interface TransportIncident {
  readonly incidentId: string; readonly round: SimulationState["currentRound"]; readonly kind: "gas" | "explosion"; readonly at: number;
  readonly victims: readonly { characterId: string; damage: number }[]; readonly deceasedIds: readonly string[];
}
export interface SectorEvacuation { readonly round: 1|2|3|4|5; readonly incidentId: string; readonly routeId: string; readonly at: number }
/** Daño sin azar ni pagos; los recibos hacen idempotentes los dos sucesos del incidente. */
export function applyTransportIncident(state: SimulationState, incidentId: string, round: SimulationState["currentRound"], kind: TransportIncident["kind"], at: number) {
  const previous = state.transportIncidents?.find(r => r.incidentId === incidentId && r.kind === kind);
  if (previous) return { state, receipt: previous };
  let next = state; const living = state.characters.filter(isAlive);
  for (const human of living) { const hit = applyDamage(next, human.id, 5); if (!hit.ok) throw new Error(hit.error); next = hit.state; }
  const receipt: TransportIncident = { incidentId, round, kind, at, victims: living.map(c => ({ characterId: c.id, damage: Math.min(c.health, 5) })), deceasedIds: living.filter(c => !isAlive(next.characters.find(n => n.id === c.id)!)).map(c => c.id) };
  return { state: { ...next, transportIncidents: [...(state.transportIncidents ?? []), receipt] }, receipt };
}
export function sectorWasEvacuated(state: SimulationState, round = state.currentRound) { return state.sectorEvacuations?.some(r => r.round === round) ?? false; }
