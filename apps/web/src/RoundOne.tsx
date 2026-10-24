import { useEffect, useState } from "react";
import type { OwnVote, PublicVote, RoundOneSummary } from "@everest/shared";

export function RoundOne({ summary, vote, own, enabled, busy, onVote }: {
  summary: RoundOneSummary | null;
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
  if (summary) return <section className="round-panel" aria-labelledby="round-title">
    <h3 id="round-title">Ronda 1 completada</h3>
    <p>Resultado: {summary.result === "RESCUE_APPROVED" ? "Rescate aprobado" : summary.result === "ABANDON_APPROVED" ? "Abandono aprobado" : "Sin acuerdo"} ({summary.result}).</p>
    <p>NPC: {summary.npc === "rescued" ? "rescatado" : "abandonado"}.</p>
    <p>Microterremoto: {summary.microearthquake ? "sí" : "no"}.</p>
    <h4>Estado al terminar la ruta (histórico)</h4>
    <table><thead><tr><th>Participante</th><th>Salud</th><th>Energía</th></tr></thead>
      <tbody>{summary.characters.map((character) => <tr key={character.participantId}>
        <td>{character.name}</td><td>{character.health}</td><td>{character.energy}</td>
      </tr>)}</tbody></table>
    <p>Inventario al terminar la ruta: {summary.inventory.packs} packs y {summary.inventory.medicalUnits} unidades médicas.</p>
    <p>Costes por personaje: {summary.costs.rescueEnergy} de energía por rescate, después {summary.costs.movementEnergy} por desplazamiento. Daño por microterremoto: {summary.costs.damage}.</p>
  </section>;
  return <section className="round-panel" aria-labelledby="round-title">
    <h3 id="round-title">Ronda {vote.round} — {vote.round === 1 ? "El despertar" : "Pasillo principal"}</h3>
    <p>{vote.round === 1 ? "El hotel ha sufrido un terremoto. Encontráis a un superviviente que necesita ayuda para caminar." : "En el pasillo principal encontráis a otro superviviente, distinto al de la ronda 1, que puede caminar con ayuda."}</p>
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
    <p className="notice">{vote.round === 1 ? "El servidor aplica las consecuencias y el desplazamiento al terminar la votación." : "El servidor aplica las consecuencias del rescate. La elección de ruta queda pendiente."}</p>
  </section>;
}
