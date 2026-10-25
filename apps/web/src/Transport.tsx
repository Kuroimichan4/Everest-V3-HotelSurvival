import type { OwnVote, TransportView } from "@everest/shared";
import { VotePanel } from "./VotePanel";
import { reasonLabel } from "./game-state";
export function TransportCrisis({ state, participantId }: { state: TransportView["cases"][number]; participantId: string }) {
  const gas = state.crisis?.gas; const explosion = state.crisis?.explosion;
  if (!gas && !explosion) return null;
  const ownDamage = (event: NonNullable<typeof gas>) => event.victims.find(v => v.participantId === participantId)?.damage;
  return <div className="notice" role="status" data-transport-crisis={state.preparationId}>
    {gas && <p>Un estruendo metálico recorre el pasillo. Una tubería ha cedido y el gas comienza a extenderse entre los escombros. El equipo apenas dispone de unos segundos para decidir qué hacer.{ownDamage(gas) !== undefined && <> Tu personaje ha sufrido {ownDamage(gas)} puntos de daño.</>}</p>}
    {gas && gas.deceasedIds.length > 0 && <p>Fallecidos por la fuga: {gas.deceasedIds.length}.</p>}
    {gas && !explosion && state.vote?.status === "open" && state.vote.attemptNumber === 3 && <p>El aire se vuelve irrespirable. Solo quedan diez segundos para decidir quién podrá continuar.</p>}
    {explosion && <><p>La explosión sacude los cimientos del hotel. Entre el humo y los escombros, los humanos que pueden avanzar deben continuar antes de que el edificio vuelva a derrumbarse.{ownDamage(explosion) !== undefined && <> Tu personaje ha sufrido {ownDamage(explosion)} puntos adicionales de daño.</>}</p>
      {explosion.deceasedIds.length > 0 && <p>Fallecidos por la explosión: {explosion.deceasedIds.length}.</p>}
      <p>{state.abandonedIds.length ? `Compañeros abandonados por no poder desplazarse: ${state.abandonedIds.length}.` : "No se ha abandonado a ningún compañero vivo."}</p>
      {state.phase === "sector-evacuated" && <p>El sector se ha evacuado de forma precipitada. No se ha ejecutado ni cobrado el recorrido ordinario.</p>}</>}
  </div>;
}
/** Avisos declarativos por preparación: no se acumulan al reconectar. */
export function TransportNotices({state,participantId}:{state:TransportView["cases"][number];participantId:string}) {
 const active=state.phase==="voting"||state.phase==="selection";
 const names=(ids:string[])=>ids.map(id=>state.people.find(p=>p.participantId===id)?.name??"Compañero").join(", ")||"Ninguno";
 const approved=state.decisions.filter(d=>d.outcome&&d.outcome!=="NO_AGREEMENT");
 return <><TransportCrisis state={state} participantId={participantId}/>
 {active&&<aside className="transport-alert" aria-label="Decisión urgente de transporte" data-transport-notice={state.preparationId}>
  <h3>Compañeros que necesitan transporte</h3><p>{names(state.exhaustedIds)} {state.exhaustedIds.length === 1 ? "no puede" : "no pueden"} continuar por sus propios medios. Solo los votantes elegibles deciden a quién transportar. Sin acuerdo puede haber consecuencias graves.</p>
  {state.vote?.attemptNumber===2&&<p role="status">El primer intento terminó sin mayoría. El grupo sigue dividido; el segundo intento está abierto.</p>}
 </aside>}
 {approved.length>0&&<aside className="notice" aria-label="Acuerdo de transporte" data-transport-agreement={state.preparationId}>
  <h3>Acuerdo alcanzado</h3>{approved.map(d=><p key={d.vote.decisionId}>{d.outcome==="carry-all"?"Se aprobó transportar a quienes necesitan ayuda.":d.outcome==="carry-one"?"Se aprobó transportar solamente a un compañero.":d.outcome==="leave-all"?"Se aprobó continuar sin transportar a los compañeros agotados.":state.options.find(o=>o.id===d.outcome)?.label??"Destinatario del transporte confirmado."}</p>)}
  {state.phase==="selection"?<p>Falta decidir a quién transportar. Todavía no se ha ejecutado el desplazamiento ni confirmado un abandono.</p>:state.phase==="completed"?<><p>Desplazamiento completado. Transportados: {names(state.transportedIds)}.</p><p>Abandonados: {names(state.abandonedIds)}.</p></>:state.phase!=="sector-evacuated"&&<p>El desplazamiento sigue pendiente; el acuerdo no confirma que se haya completado.</p>}
 </aside>}</>;
}
export function Transport({ state, participantId, own, enabled, busy, onOpen, onVote }: {
  state: TransportView; participantId: string; own: OwnVote | null; enabled: boolean; busy: boolean;
  onOpen: (preparationId: string) => void; onVote: (optionId: string) => void;
}) {
  const current = state.cases.at(-1);
  if (!current || current.phase === "completed" || current.phase === "superseded" || current.phase === "sector-evacuated") return null;
  const names = (ids: string[]) => ids.map(id => current.people.find(p => p.participantId === id)?.name ?? "Compañero").join(", ") || "Ninguno";
  const eligible = current.eligibleIds.includes(participantId);
  const voting = current.phase === "voting" || current.phase === "selection";
  return <section aria-label="Transporte de compañeros agotados">
    <p className="eyebrow">PREPARACIÓN DEL DESPLAZAMIENTO</p><h2>{!current.exhaustedIds.length ? "Preparad el desplazamiento" : current.phase === "selection" ? "¿A quién transportamos?" : "Que nadie se quede atrás"}</h2>
    <p className="action-description">{current.routeName} · Coste normal: {current.routeCost} de energía.</p>
    <p>Necesitan ayuda: <strong>{names(current.exhaustedIds)}</strong>.</p>
    {current.phase === "preparation" && <>
      <p>Botones puede repartir packs antes de continuar. Se revisará de nuevo la energía del equipo.</p>
      <button disabled={!enabled || busy} onClick={() => onOpen(current.preparationId)}>Comprobar energía y continuar</button>
    </>}
    {current.phase === "selection" && <p>El equipo ha elegido transportar solamente a uno; todavía no se ha abandonado a nadie.</p>}
    <p className="muted">Cada porteador paga la ruta más 15 por compañero transportado. Los transportados no gastan energía.</p>
    {voting && eligible && current.vote ? <VotePanel title="Votación de transporte" vote={current.vote} own={own} enabled={enabled} busy={busy} onVote={onVote}
      options={current.options.map(o => ({ id: o.id, label: o.label, disabled: !o.viable || !o.authorizedVoterIds.includes(participantId),
        reason: !o.viable ? "Plan no viable energéticamente." : !o.authorizedVoterIds.includes(participantId) ? "No puedes votar esta alternativa: no tienes energía para participar en este plan." : "",
        detail: <><p>Porteadores: {names(o.carrierIds)}.</p><span className="cost-badge">Coste por porteador: {o.carrierCost}</span></> }))} />
      : <><div className="option-grid">{current.options.map(o => <article className={`option-card ${o.viable ? "" : "unavailable"}`} key={o.id}><h4>{o.label}</h4><p>{o.viable ? `Coste por porteador: ${o.carrierCost}` : "Plan no viable energéticamente."}</p><p className="muted">{names(o.carrierIds)}</p></article>)}</div>
        {voting && <p className="muted">Puedes seguir la decisión, pero no estás autorizado para votar en ella.</p>}</>}
    {current.reason && <p role="alert">{reasonLabel(current.reason)}</p>}
  </section>;
}
