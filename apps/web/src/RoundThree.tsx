import { RouteRisk } from "./RouteInformation";
import type { OwnVote, RoundThreeView } from "@everest/shared";
import { VotePanel } from "./VotePanel";
import { RouteAvailabilityNotice, RouteRecoveryPanel } from "./RouteAvailability";
import { reasonLabel } from "./game-state";
export function RoundThree({ state, own, creator, enabled, busy, onOpen, onVote, onRetry }: {
  onRetry?: (decisionId: string) => void; state: RoundThreeView; own: OwnVote | null; creator: boolean; enabled: boolean; busy: boolean;
  onOpen: () => void; onVote: (option: string) => void;
}) {
  return <section aria-label="Elección de ruta de ronda 3">
    <p className="eyebrow">OBSTÁCULO TÉCNICO</p><h2>{state.phase === "voting" ? "Elegid la siguiente ruta" : "Preparad el recorrido"}</h2>
    <RouteRecoveryPanel recovery={state.recovery} enabled={enabled} busy={busy} onRetry={onRetry} />
    {state.phase === "preparation" && <>
      <p className="action-description">Revisad las rutas y preparad al equipo antes de votar.</p>
      {creator ? <button disabled={!enabled || busy || state.options.every(o => o.availability.status === "unavailable")} onClick={onOpen}>Abrir votación de ronda 3</button> : <p className="muted">Esperando al anfitrión para abrir la votación.</p>}
      {state.options.every(o => o.availability.status === "unavailable") && <p role="status">No hay rutas disponibles. Botones puede repartir packs para revisar las opciones.</p>}
    </>}
    {state.phase === "voting" && state.vote ? <VotePanel title="Votación de ruta" vote={state.vote} own={own} enabled={enabled} busy={busy} onVote={onVote}
      options={state.options.map(o => ({ id: o.id, label: o.name, disabled: o.availability.status === "unavailable", detail: <><p>{o.description}</p><span className="cost-badge">−{o.energyCost} energía</span><RouteRisk danger={o.danger} />{o.id === "fire-door" && <p className="cost-badge">−1 palanca · Requiere la palanca; se pierde al completar el recorrido.</p>}<RouteAvailabilityNotice value={o.availability} /></> }))} />
      : <div className="option-grid">{state.options.map(o => <article key={o.id} className={`option-card ${o.availability.status === "unavailable" ? "unavailable" : ""}`}><h4>{o.name}</h4><p>{o.description}</p><span className="cost-badge">−{o.energyCost} energía</span><RouteRisk danger={o.danger} />{o.id === "fire-door" && <p className="cost-badge">−1 palanca · Requiere la palanca; se pierde al completar el recorrido.</p>}<RouteAvailabilityNotice value={o.availability} /></article>)}</div>}
    {state.earthquake && <p className="warning">El terremoto ha bloqueado las otras rutas. La galería es obligatoria.</p>}
    {state.blocked && <p role="alert">{reasonLabel(state.blocked)}</p>}
  </section>;
}
