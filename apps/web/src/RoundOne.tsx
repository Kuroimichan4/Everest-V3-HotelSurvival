import { useEffect, useState } from "react";
import type { OwnVote, PublicVote } from "@everest/shared";

export function RoundOne({ vote, own, enabled, busy, onVote }: {
  vote: PublicVote; own: OwnVote | null; enabled: boolean; busy: boolean; onVote: (option: string) => void;
}) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const received = performance.now();
    const update = () => setRemaining(Math.max(0, Math.ceil((vote.deadline - vote.serverNow - (performance.now() - received)) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [vote]);
  const ownOption = own?.decisionId === vote.decisionId && own.attemptId === vote.attemptId ? own.optionId : null;
  const disabled = !enabled || busy || vote.status !== "open" || !!ownOption || remaining === 0;
  return <section className="round-panel" aria-labelledby="round-title">
    <h3 id="round-title">Ronda 1 — El despertar</h3>
    <p>El hotel ha sufrido un terremoto. Encontráis a un superviviente que necesita ayuda para caminar.</p>
    <h4>¿Rescatamos al superviviente?</h4>
    <p>Intento {vote.attemptNumber === 1 ? "primero" : "segundo"} · Mayoría necesaria: {vote.requiredVotes}</p>
    {vote.status === "open" && <p>Tiempo restante: {remaining} s{remaining === 0 && " · Esperando al servidor…"}</p>}
    <div className="vote-actions">
      <button disabled={disabled} onClick={() => onVote("rescue")}>RESCATAR</button>
      <button disabled={disabled} onClick={() => onVote("abandon")}>ABANDONAR</button>
    </div>
    {ownOption && <p role="status">Tu voto se ha registrado: {ownOption === "rescue" ? "RESCATAR" : "ABANDONAR"}.</p>}
    {vote.result && <p role="status">Resultado: {vote.result === "RESCUE_APPROVED" ? "RESCUE_APPROVED — Rescate aprobado"
      : vote.result === "ABANDON_APPROVED" ? "ABANDON_APPROVED — Abandono aprobado" : "NO_AGREEMENT — Sin acuerdo"}.</p>}
    <p className="notice">En esta fase solo se registra la decisión. Sus consecuencias todavía no se aplican.</p>
  </section>;
}
