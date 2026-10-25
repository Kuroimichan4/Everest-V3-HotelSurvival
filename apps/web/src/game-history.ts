import type { RoundOneSummary } from "@everest/shared";
import { rescueLabel, reasonLabel, type GameState } from "./game-state";
import { npcFourLabel } from "./RoundFour";
export interface HistoryEntry { id: string; round: number; title: string; details: string[]; snapshot?: RoundOneSummary["characters"] }
export function gameHistory(state: GameState): HistoryEntry[] {
  const entries = new Map<string, HistoryEntry>();
  const put = (e: HistoryEntry) => entries.set(e.id, e);
  if (state.summary) {
    const s = state.summary;
    put({ id: `route:${s.decisionId}`, round: 1, title: "Paso obligatorio completado", details: [rescueLabel(s.result), `Desplazamiento: ${s.costs.movementEnergy} de energía. Rescate: ${s.costs.rescueEnergy}.`, ...(s.microearthquake ? ["Microterremoto: −10 de salud."] : [])], snapshot: s.characters });
  }
  const second = state.roundTwo;
  if (second?.result) put({ id: "npc:2", round: 2, title: rescueLabel(second.result), details: [second.npc === "rescued" ? "Segundo superviviente rescatado." : "El segundo superviviente no acompaña al equipo."] });
  if (second?.movement?.status === "completed") {
    const m = second.movement;
    put({ id: `route:${m.decisionId}`, round: 2, title: `Ruta completada: ${m.routeName}`, details: [`Coste normal: ${m.energyCost} de energía.`, `Accidente: ${m.accident ? "sí" : "no"}.`, ...m.victims.filter(v => v.damage !== undefined).map(v => `${v.name}: −${v.damage} de salud.`), ...(m.microearthquake ? ["Microterremoto de ruta: −10 de salud."] : [])], snapshot: second.characters });
  }
  const third = state.roundThree;
  if (third?.movement && third.selection) {
    const m = third.movement;
    put({ id: `route:${third.selection.decisionId}`, round: 3, title: `Ruta completada: ${third.options.find(o => o.id === m.routeId)?.name ?? "Recorrido"}`,
      details: [`Coste normal: ${m.energyCost} de energía.`, `Accidente: ${m.accident ? "sí" : "no"}.`, ...m.environment.filter(v => v.damage !== undefined).map(v => `${v.name}: −${v.damage} de salud por humo/gas.`), ...m.victims.filter(v => v.damage !== undefined).map(v => `${v.name}: −${v.damage} de salud por accidente.`), `Recursos encontrados: ${m.gained.packs} packs y ${m.gained.medicalUnits} unidades médicas.`, ...(m.crowbarLost ? ["Palanca perdida; regreso bloqueado."] : [])], ...(third.afterRoute ? { snapshot: third.afterRoute.characters } : {}) });
  }
  const fourth = state.roundFour;
  if (fourth) {
    const npc = fourth.npc;
    if (npc.encounter !== "none") put({ id: `npc:4:${npc.vote?.decisionId ?? fourth.preparationId}`, round: 4,
      title: "Superviviente del vestíbulo", details: [npcFourLabel(npc.status), ...(npc.message ? [npc.message] : []),
        ...(npc.choice ? [`Esfuerzo acordado: ${npc.energyPerHuman} de energía por participante y ${npc.medicalUnits} unidad(es) médica(s).`] : [])] });
    if (fourth.collapse) put({ id: `collapse:${fourth.preparationId}`, round: 4, title: "Derrumbe parcial de la salida",
      details: [`−${fourth.collapse.damage} de salud a ${fourth.collapse.affectedIds.length} humanos activos.`, `Recargo de salida: ${fourth.surcharge} de energía.`, ...(fourth.forced ? ["Segundo intento sin acuerdo: grieta exterior obligatoria."] : [])] });
    if (fourth.movement) {
      const m = fourth.movement;
      const name = (id: string) => m.characters.find(c => c.participantId === id)?.name ?? "Compañero";
      put({ id: `route:${m.requestId}`, round: 4, title: "Evacuación completada",
        details: [fourth.options.find(o => o.id === m.routeId)?.name ?? "Salida", `Energía de ruta: ${m.energyCost}. Accidente: ${m.accident ? "sí" : "no"}.`,
          ...m.victims.filter(v => v.damage !== undefined).map(v => `${name(v.participantId)}: −${v.damage} de salud.`), `Han salido: ${m.escapedHumanIds.map(name).join(", ") || "Ninguno"}.`, npcFourLabel(npc.status)], snapshot: m.characters });
    }
  }
  for (const f of [...(second?.failedSelections ?? []), ...(third?.failedSelections ?? [])]) put({ id: `route:${f.decisionId}`, round: f.round, title: "Selección de ruta no ejecutada", details: [reasonLabel(f.reason)] });
  for (const c of state.transport?.cases ?? []) {
    const names = (ids: string[]) => ids.map(id => c.people.find(p => p.participantId === id)?.name ?? "Compañero").join(", ") || "Ninguno";
    for (const d of c.decisions) {
      if (!d.outcome) continue;
      const outcome = d.outcome === "NO_AGREEMENT" ? "Sin acuerdo" : d.outcome === "carry-all" ? "Transportar a los agotados" : d.outcome === "carry-one" ? "Transportar solamente a uno" : d.outcome === "leave-all" ? "Continuar sin transportar" : `Transportar a ${names([c.exhaustedIds[Number(d.outcome.split("-").at(-1))] ?? ""])}`;
      put({ id: `decision:${d.vote.decisionId}`, round: c.round, title: d.stage === "recipient" ? "Compañero seleccionado" : "Decisión de transporte", details: [outcome, `${d.vote.attemptNumber} intento(s). Mayoría: ${d.vote.requiredVotes}.`] });
    }
    if (c.phase === "completed" || c.abandonedIds.length) put({ id: `transport:${c.preparationId}`, round: c.round, title: "Plan de transporte resuelto", details: [`Transportados: ${names(c.transportedIds)}.`, `Abandonados: ${names(c.abandonedIds)}.`, ...c.charges.filter(p => p.routeEnergy !== undefined && p.transportEnergy !== undefined).map(p => `${names([p.participantId])}: ${p.routeEnergy} de ruta + ${p.transportEnergy} de transporte.`), ...c.transfers.map(t => `Objetos de ${names([t.participantId])} transferidos: ${t.items.map(i => i.kind).join(", ") || "ninguno"}.`)] });
  }
  for (const e of state.activity?.entries ?? []) {
    const name = state.supplies?.characters.find(c => c.participantId === e.targetParticipantId)?.name ?? "Compañero";
    put({ id: `activity:${e.id}`, round: e.round, title: `${e.kind === "pack" ? "Pack entregado" : "Tratamiento administrado"}: ${name}`, details: e.restored === undefined ? [] : [`+${e.restored} de ${e.kind === "pack" ? "energía" : "salud"}.`] });
  }
  return [...entries.values()].sort((a, b) => a.round - b.round);
}
