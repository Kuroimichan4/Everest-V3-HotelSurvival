import type { RoundTwoView, PublicVote, OwnVote } from "@everest/shared";
import { RoundOne } from "./RoundOne";

export function RoundTwo({ state, vote, own, enabled, busy, onVote }: {
  state: RoundTwoView; vote: PublicVote; own: OwnVote | null;
  enabled: boolean; busy: boolean; onVote: (option: string) => void;
}) {
  return <section>
    {state.phase === "rescue-vote" ? <RoundOne summary={null} vote={vote} own={own} enabled={enabled} busy={busy} onVote={onVote} /> : <>
      <h3>Ronda 2</h3>
      <p role="status">Resultado: {state.result}. Segundo NPC: {state.npc === "rescued" ? "rescatado" : state.npc === "abandoned" ? "abandonado" : "pendiente"}.</p>
      <p>Microterremoto: {state.microearthquake ? "sí" : "no"}.</p>
      {state.blocked ? <p role="alert">Energía insuficiente. Resolución bloqueada sin aplicar costes. Pendiente decidir cómo recuperar energía para este rescate.</p>
        : <p>Rescate resuelto. Pendiente la elección de ruta.</p>}
    </>}
    <table><thead><tr><th>Participante</th><th>Salud</th><th>Energía</th></tr></thead>
      <tbody>{state.characters.map(c => <tr key={c.participantId}><td>{c.name}</td><td>{c.health}</td><td>{c.energy}</td></tr>)}</tbody></table>
    <p>Packs: {state.inventory.packs}. Unidades médicas: {state.inventory.medicalUnits}.</p>
    <p>NPC de ronda 1: {state.previousNpc === "rescued" ? "rescatado" : "abandonado"}.</p>
  </section>;
}
