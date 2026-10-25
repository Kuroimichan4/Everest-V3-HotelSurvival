import { RouteRisk } from "./RouteInformation";
import type { OwnVote, RoundFourView } from "@everest/shared";
import { reasonLabel } from "./game-state";
import { VotePanel } from "./VotePanel";

export function npcFourLabel(status: RoundFourView["npc"]["status"]) {
  return { absent: "No apareció ningún superviviente adicional.", "awaiting-decision": "El superviviente necesita vuestra decisión.",
    "awaiting-effort": "Rescate aprobado, pendiente de completar el desplazamiento.", rescued: "Rescate completado.",
    abandoned: "El equipo decidió no rescatar al superviviente.", dead: "El superviviente falleció por falta de acuerdo." }[status];
}
export function RoundFour({ state, own, creator, enabled, busy, onVote, onOpen, onRetry }: {
  state: RoundFourView; own: OwnVote | null; creator: boolean; enabled: boolean; busy: boolean;
  onVote: (id: string) => void; onOpen: () => void; onRetry: (id: string) => void;
}) {
  const npc = state.npc;
  if (state.phase === "completed" && state.movement) {
    const m = state.movement;
    const names = (ids: string[]) => ids.map(id => m.characters.find(c => c.participantId === id)?.name ?? "Compañero").join(", ") || "Ninguno";
    return <><p className="eyebrow">EVACUACIÓN</p><h2>Resumen provisional de salida</h2>
      <p>Ruta utilizada: {state.options.find(o => o.id === m.routeId)?.name}.</p>
      <p>Accidente: {m.accident ? "sí" : "no"}.{m.victims.filter(v => v.damage !== undefined).map(v => ` ${names([v.participantId])}: −${v.damage} de salud.`).join("")}</p>
      <p>Han conseguido salir: {names(m.escapedHumanIds)}.</p>
      <p>Fallecidos: {names(m.characters.filter(c => c.status === "dead" || c.health === 0 && !c.eliminated).map(c => c.participantId))}.</p>
      <p>Abandonados: {names(m.characters.filter(c => c.eliminated).map(c => c.participantId))}.</p>
      {npc.encounter !== "none" && <p>{npcFourLabel(npc.status)}</p>}<p className="muted">La salud, energía, recursos restantes y palanca se muestran en el estado del equipo. La evaluación final sigue pendiente.</p></>;
  }
  if (state.phase === "npc-voting") return <><p className="eyebrow">SUPERVIVIENTE EN EL VESTÍBULO</p><h2>Decidir el rescate</h2>
    <p>{npc.encounter === "immobile" ? "El superviviente no puede caminar por sí mismo." : "El superviviente puede caminar con ayuda."}</p>
    {npc.message && <p className="notice" role="status">{npc.message}</p>}
    {npc.vote && <VotePanel title="Rescate del superviviente de ronda 6" vote={npc.vote} own={own} enabled={enabled} busy={busy} onVote={onVote}
      options={npc.options.map(o => ({ id: o.id, label: o.label, disabled: !o.available,
        detail: <p>{o.energyPerHuman} de energía adicional por humano participante{o.medicalUnits ? ` y ${o.medicalUnits} unidad médica compartida` : ""}.</p>,
        ...(!o.available ? { reason: "No quedan unidades médicas disponibles." } : {}) }))} />}
    <p className="muted">Aprobar el rescate no confirma su ejecución: el esfuerzo se pagará junto con la salida.</p></>;
  const options = state.options.map(o => ({ id: o.id, label: o.name,
    disabled: o.availability.status === "unavailable", detail: <><p>{o.description}</p><RouteRisk danger={o.danger} /><p>{o.energyCost} de energía por humano que camine.
      {o.id === "revolving-door" ? " Requiere la palanca existente." : " No requiere palanca."}
      {o.availability.status === "with-help" ? " Necesita transporte humano." : ""}</p></>,
    ...(o.availability.reason ? { reason: reasonLabel(o.availability.reason) } : {}) }));
  return <><p className="eyebrow">SALIDA DEL HOTEL</p><h2>{state.forced ? "Grieta exterior obligatoria" : "Elegir la salida"}</h2>
    <p>{npcFourLabel(npc.status)}</p>
    {npc.status === "awaiting-effort" && <p>Esfuerzo NPC pendiente: {npc.energyPerHuman} de energía por humano participante{npc.medicalUnits ? ` y ${npc.medicalUnits} unidad médica` : ""}, además de ruta y transporte humano.</p>}
    {state.collapse && <p className="notice">Derrumbe parcial aplicado: −{state.collapse.damage} de salud a los humanos afectados. Recargo de {state.surcharge} de energía incluido en las rutas.</p>}
    {state.blocked && <p role="status">{reasonLabel(state.blocked)}</p>}
    {state.phase === "exit-voting" && state.vote ? <VotePanel title="Votación de salida" vote={state.vote} own={own} options={options} enabled={enabled} busy={busy} onVote={onVote} />
      : <><div className="option-grid">{options.map(o => <article className={`option-card ${o.disabled ? "unavailable" : ""}`} key={o.id}><h4>{o.label}</h4>{o.detail}<p className="muted">{o.reason ?? "Disponible para la decisión colectiva."}</p></article>)}</div>
        {state.selection ? <button disabled={!enabled || busy} onClick={() => onRetry(state.preparationId)}>Comprobar de nuevo la salida acordada</button>
          : creator ? <button disabled={!enabled || busy || options.every(o => o.disabled)} onClick={onOpen}>Abrir votación de salida</button>
            : <p className="muted">El anfitrión abrirá la votación cuando termine la preparación.</p>}</>}
  </>;
}
