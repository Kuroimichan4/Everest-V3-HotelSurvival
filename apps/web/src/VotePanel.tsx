import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { OwnVote, PublicVote } from "@everest/shared";

const VoteClock = createContext<{ id: string; remaining: number } | null>(null);
function useServerRemaining(vote: PublicVote | null) {
  const stamp = vote ? `${vote.attemptId}:${vote.deadline}:${vote.serverNow}:${vote.status}` : "none";
  const initial = () => vote?.status === "open" ? Math.max(0, Math.ceil((vote.deadline - vote.serverNow) / 1000)) : 0;
  const [tick, setTick] = useState(() => ({ stamp, remaining: initial() }));
  useEffect(() => {
    if (!vote || vote.status !== "open") { setTick({ stamp, remaining: 0 }); return; }
    const received = performance.now();
    const update = () => setTick({ stamp, remaining: Math.max(0, Math.ceil((vote.deadline - vote.serverNow - (performance.now() - received)) / 1000)) });
    update(); const timer = setInterval(update, 250); return () => clearInterval(timer);
  }, [vote?.decisionId, vote?.attemptId, vote?.deadline, vote?.serverNow, vote?.status]);
  return tick.stamp === stamp ? tick.remaining : initial();
}
export function VoteClockProvider({ vote, children }: { vote: PublicVote | null; children: ReactNode }) {
  const remaining = useServerRemaining(vote);
  return <VoteClock.Provider value={vote ? { id: vote.attemptId, remaining } : null}>{children}</VoteClock.Provider>;
}
export function useVoteRemaining(vote: PublicVote | null) {
  const clock = useContext(VoteClock);
  const matches = !!clock && clock.id === vote?.attemptId;
  const fallback = useServerRemaining(matches ? null : vote);
  return matches ? clock.remaining : fallback;
}
export function Countdown({ vote }: { vote: PublicVote | null }) {
  const remaining = useVoteRemaining(vote);
  return vote ? <span className={`countdown ${remaining <= 10 ? "urgent" : ""}`} aria-label="Tiempo restante">{remaining}s</span> : null;
}
export function VoteStatus({ vote, label }: { vote: PublicVote | null; label: string }) {
 const remaining = useVoteRemaining(vote);
 if (!vote || vote.status !== "open") return null;
 return <section className={`vote-status ${remaining <= 10 ? "urgent" : ""}`} aria-label="Votación en curso">
  <div><strong>{label}</strong><p>Intento {vote.attemptNumber}{vote.attemptNumber === 3 ? " · Extraordinario" : ""}</p>
  {remaining <= 10 && <strong className="time-warning">¡Últimos segundos para decidir!</strong>}</div>
  <div className="vote-time"><span>Tiempo restante</span><span role="timer" aria-label="Tiempo restante" className="vote-seconds">{remaining}<small> s</small></span></div>
 </section>;
}
export interface VoteOptionView { id: string; label: string; detail?: ReactNode; disabled?: boolean; reason?: string }
export function VotePanel({ title, vote, own, options, enabled, busy, onVote }: {
  title: string; vote: PublicVote; own: OwnVote | null; options: VoteOptionView[];
  enabled: boolean; busy: boolean; onVote: (id: string) => void;
}) {
  const remaining = useVoteRemaining(vote);
  const clock = useContext(VoteClock);
  const ownOption = own?.decisionId === vote.decisionId && own.attemptId === vote.attemptId ? own.optionId : null;
  return <div className="vote-panel" aria-label={title}>
    <div className="vote-meta"><span>Intento {vote.attemptNumber}</span><span>Mayoría necesaria: {vote.requiredVotes}</span>{!clock && <span>Tiempo restante: {remaining} s.</span>}</div>
    <div className="option-grid">{options.map(option => <article className={`option-card ${option.disabled ? "unavailable" : ""} ${ownOption === option.id ? "selected" : ""}`} key={option.id}>
      <h4>{option.label}</h4>{option.detail && <div className="option-detail">{option.detail}</div>}
      {option.reason && <p className="muted">{option.reason}</p>}
      <button disabled={!enabled || busy || !!option.disabled || remaining === 0 || vote.status !== "open"} onClick={() => onVote(option.id)}>{ownOption === option.id ? "Voto registrado" : `Votar ${option.label}`}</button>
    </article>)}</div>
    {ownOption && <p className="confirmation" role="status">Tu voto: {options.find(o => o.id === ownOption)?.label ?? "registrado"}. Esperando al equipo.</p>}
    {!enabled && <p className="muted">Puedes seguir la decisión; tu personaje no puede votar ahora.</p>}
    {remaining === 0 && vote.status === "open" && <p className="muted">Esperando la resolución del servidor…</p>}
  </div>;
}
