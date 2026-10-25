import type { RoundTwoView, PublicVote, OwnVote } from "@everest/shared";
import { RoundOne } from "./RoundOne";
import { VotePanel } from "./VotePanel";
import { RouteAvailabilityNotice, RouteRecoveryPanel } from "./RouteAvailability";
import { reasonLabel } from "./game-state";
export function RoundTwo({ state, vote, own, enabled, busy, onVote, maintenance, creator, onRouteAction, onRetry }: {
  onRetry?: (decisionId: string) => void; maintenance: boolean; creator: boolean; onRouteAction: (action: "reveal" | "open") => void;
  state: RoundTwoView; vote: PublicVote | null; own: OwnVote | null; enabled: boolean; busy: boolean; onVote: (option: string) => void;
}) {
  if (state.phase === "rescue-vote" && vote) return <RoundOne summary={null} vote={vote} own={own} enabled={enabled} busy={busy} onVote={onVote} />;
  const route = state.routeChoice;
  const description = (id: string) => id === "ventilation" ? "Paso por los conductos revelados al equipo." : id === "shoring" ? "Despejar escombros y apuntalar el paso." : "Continuar por el pasillo principal.";
  return <section aria-label="Elección de ruta de ronda 2">
    <p className="eyebrow">PASILLO PRINCIPAL</p><h2>{route?.phase === "voting" ? "Elegid un camino" : "Preparad la siguiente ruta"}</h2>
    {state.blocked && <p role="alert">{reasonLabel(state.blocked)}</p>}
    {state.blocked && vote && <button disabled={!enabled || busy} onClick={() => onRetry?.(vote.decisionId)}>Reintentar la decisión del superviviente</button>}
    <RouteRecoveryPanel recovery={state.recovery} enabled={enabled} busy={busy} onRetry={onRetry} />
    {route?.phase === "preparation" && <>
      <p className="action-description">Compartid la información que decidáis revelar y preparad la energía del equipo.</p>
      <div className="action-buttons">{maintenance && !route.ventilationRevealed && <button className="secondary" disabled={!enabled || busy} onClick={() => onRouteAction("reveal")}>Revelar conductos de ventilación</button>}
        {creator && <button disabled={!enabled || busy || route.options.every(o => o.blocked)} onClick={() => onRouteAction("open")}>Abrir votación de ruta</button>}</div>
      {!creator && <p className="muted">El anfitrión abrirá la votación cuando el equipo esté preparado.</p>}
      {route.options.every(o => o.blocked) && <p role="status">No hay rutas disponibles. Botones puede repartir packs para revisar las opciones.</p>}
    </>}
    {route?.phase === "voting" && route.vote ? <VotePanel title="Votación de ruta" vote={route.vote} own={own} enabled={enabled} busy={busy} onVote={onVote}
      options={route.options.map(o => ({ id: o.id, label: o.name, disabled: !!o.blocked, detail: <><p>{description(o.id)}</p><span className="cost-badge">−{o.energyCost} energía</span><RouteAvailabilityNotice value={o.availability} /></> }))} />
      : route && <div className="option-grid">{route.options.map(o => <article key={o.id} className={`option-card ${o.blocked ? "unavailable" : ""}`}><h4>{o.name}</h4><p>{description(o.id)}</p><span className="cost-badge">−{o.energyCost} energía</span><RouteAvailabilityNotice value={o.availability} /></article>)}</div>}
    {!state.recovery && state.movement?.status === "blocked" && <p role="alert">{reasonLabel(state.movement.reason)}</p>}
  </section>;
}
