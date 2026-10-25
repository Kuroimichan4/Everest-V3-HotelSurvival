import { RouteRisk } from "./RouteInformation";
import type { IntermediateRoundView, OwnVote } from "@everest/shared";
import { VotePanel } from "./VotePanel";
import { reasonLabel } from "./game-state";

/** Se muestra también al preparar transporte o al completar el movimiento, sin repetir paneles. */
export function IntermediateConsequences({ state, participantId }: { state: IntermediateRoundView; participantId: string }) {
  const failed = state.failedAttempts ?? [];
  const consequence = state.consequence;
  const own = consequence?.victims.find(v => v.participantId === participantId);
  if (!failed.length && !consequence) return null;
  return <div className="notice" role="status" data-intermediate-consequence={state.round}>
    {failed.map(f => <p key={f.attemptNumber}>{f.attemptNumber === 1 ? "Primer" : "Segundo"} intento de votación sin mayoría.</p>)}
    {consequence && <><p>Una réplica ha sacudido la estructura tras el segundo intento fallido.</p>
      {own?.damage !== undefined && <p>Tu personaje ha sufrido {own.damage} puntos de daño por la réplica.</p>}
      <p>Ruta obligatoria: <strong>{consequence.routeName}</strong>.</p>
      {state.phase === "movement" && <p>Comienza la preparación del desplazamiento. Se comprobarán la energía y el transporte antes de continuar.</p>}
    </>}
  </div>;
}
export function IntermediateRound({ state, creator, own, enabled, busy, onVote, onAction }: {
  state: IntermediateRoundView; creator: boolean; own: OwnVote | null; enabled: boolean; busy: boolean;
  onVote: (id: string) => void; onAction: (action: "reveal" | "open" | "retry") => void;
}) {
  const options = state.options.map(o => ({ id: o.id, label: o.name,
    disabled: !o.selectable || o.availability.status === "unavailable",
    detail: <><p>{o.description}</p><p>{o.energyCost} de energía por humano que camine.</p><RouteRisk danger={o.danger} />{!o.selectable && <p>Conocimiento privado: debes revelarlo al equipo antes de votarlo.</p>}</>,
    ...(o.availability.reason ? { reason: reasonLabel(o.availability.reason) } : {}) }));
  return <><p className="eyebrow">RONDA {state.round}</p><h2>{state.title}</h2><p className="action-description">{state.narrative}</p>
    {state.phase === "voting" && state.vote ? <VotePanel title="Votación de ruta" vote={state.vote} own={own} enabled={enabled} busy={busy} onVote={onVote} options={options.filter(o => state.options.find(r => r.id === o.id)?.selectable)} />
      : <><div className="option-grid">{options.map(o => <article className={`option-card ${o.disabled ? "unavailable" : ""}`} key={o.id}><h4>{o.label}</h4>{o.detail}{o.reason && <p>{o.reason}</p>}</article>)}</div>
        {state.canReveal && <button disabled={!enabled || busy} onClick={() => onAction("reveal")}>Revelar ruta alternativa al equipo</button>}
        {state.phase === "preparation" && creator && <button disabled={!enabled || busy || options.every(o => o.disabled)} onClick={() => onAction("open")}>Abrir votación de ruta</button>}
        {state.phase === "movement" && <><p role="status">{state.blocked ? reasonLabel(state.blocked) : "Preparación del desplazamiento."}</p><button disabled={!enabled || busy} onClick={() => onAction("retry")}>Comprobar de nuevo el desplazamiento</button></>}
      </>}
  </>;

}
