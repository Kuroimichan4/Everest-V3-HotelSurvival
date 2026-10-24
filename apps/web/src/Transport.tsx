import type { OwnVote, TransportView } from "@everest/shared";
import { VotePanel } from "./VotePanel";
import { reasonLabel } from "./game-state";
export function Transport({ state, participantId, own, enabled, busy, onOpen, onVote }: {
  state: TransportView; participantId: string; own: OwnVote | null; enabled: boolean; busy: boolean;
  onOpen: (preparationId: string) => void; onVote: (optionId: string) => void;
}) {
  const current = state.cases.at(-1);
  if (!current || current.phase === "completed" || current.phase === "superseded") return null;
  const names = (ids: string[]) => ids.map(id => current.people.find(p => p.participantId === id)?.name ?? "Compañero").join(", ") || "Ninguno";
  const eligible = current.eligibleIds.includes(participantId);
  const voting = current.phase === "voting" || current.phase === "selection";
  return <section aria-label="Transporte de compañeros agotados">
    <p className="eyebrow">DECISIÓN DE TRANSPORTE</p><h2>{current.phase === "selection" ? "¿A quién transportamos?" : "Que nadie se quede atrás"}</h2>
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
