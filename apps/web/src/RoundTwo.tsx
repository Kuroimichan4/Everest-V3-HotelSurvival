import { useEffect, useState } from "react";
import type { RoundTwoView, PublicVote, OwnVote } from "@everest/shared";
import { RoundOne } from "./RoundOne";

export function RoundTwo({ state, vote, own, enabled, busy, onVote, maintenance, creator, onRouteAction }: {
  maintenance: boolean; creator: boolean; onRouteAction: (action: "reveal" | "open") => void;
  state: RoundTwoView; vote: PublicVote; own: OwnVote | null;
  enabled: boolean; busy: boolean; onVote: (option: string) => void;
}) {
  const route = state.routeChoice;
  const routeVote = route?.vote;
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!routeVote) return;
    const received = performance.now();
    const update = () => setRemaining(Math.max(0, Math.ceil((routeVote.deadline - routeVote.serverNow - (performance.now() - received)) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [routeVote]);
  const ownOption = routeVote && own?.decisionId === routeVote.decisionId && own.attemptId === routeVote.attemptId ? own.optionId : null;
  return <section>
    {state.phase === "rescue-vote" ? <RoundOne summary={null} vote={vote} own={own} enabled={enabled} busy={busy} onVote={onVote} /> : <>
      <h3>{state.phase === "completed" ? "Ronda 2 completada" : "Ronda 2"}</h3>
      <p role="status">Resultado: {state.result}. Segundo NPC: {state.npc === "rescued" ? "rescatado" : state.npc === "abandoned" ? "abandonado" : "pendiente"}.</p>
      <p>Microterremoto por rescate: {state.microearthquake ? "sí" : "no"}.</p>
      {state.blocked ? <p role="alert">Energía insuficiente. Resolución bloqueada sin aplicar costes. Pendiente decidir cómo recuperar energía para este rescate.</p>
        : !state.movement && <p>Rescate resuelto. Preparación y elección de ruta.</p>}
    </>}
    {route && <section aria-label="Elección de ruta">
      <h3>Elección de ruta</h3>
      {route.phase === "preparation" && <>
        <p>Preparación sin límite de tiempo. Política provisional: el creador abre la votación cuando termine la conversación. Las opciones quedan fijadas al abrirla y ya no se pueden revelar rutas.</p>
        {maintenance && !route.ventilationRevealed && <button disabled={!enabled || busy} onClick={() => onRouteAction("reveal")}>Revelar conductos de ventilación</button>}
        {creator && <button disabled={!enabled || busy} onClick={() => onRouteAction("open")}>Abrir votación de ruta</button>}
      </>}
      {route.ventilationRevealed && <p>Se ha revelado públicamente la existencia de los conductos de ventilación.</p>}
      {routeVote && route.phase === "voting" && <p>Intento {routeVote.attemptNumber}. Mayoría: {routeVote.requiredVotes}. Tiempo restante: {remaining} s.</p>}
      <ul>{route.options.map(option => <li key={option.id}>
        {option.name}: {option.energyCost} de energía por persona al desplazarse.
        {option.blocked && <span> Pendiente de definir la disponibilidad con los supervivientes actuales.</span>}
        {route.phase === "voting" && <button disabled={!enabled || busy || !!option.blocked || !!ownOption || !remaining || routeVote?.status !== "open"} onClick={() => onVote(option.id)}>Votar {option.name}</button>}
      </li>)}</ul>
      {ownOption && <p role="status">Tu voto: {route.options.find(o => o.id === ownOption)?.name}.</p>}
      {route.result && <p role="status">Resultado de la votación de ruta: {route.result.outcome === "NO_AGREEMENT" ? "NO_AGREEMENT" : route.options.find(o => o.id === route.result?.outcome)?.name}.</p>}
    </section>}
    {state.movement?.status === "blocked" && <p role="alert">
      Desplazamiento bloqueado. No se han aplicado costes ni daños de esta resolución y la ronda sigue pendiente.
      {state.movement.reason === "insufficient-energy" ? " Falta energía para completar la ruta."
        : state.movement.reason === "single-survivor-pending" ? " Falta definir el desplazamiento con un único superviviente."
        : state.movement.reason === "no-living-characters" ? " No quedan humanos vivos; el desenlace está pendiente de definición."
        : state.movement.reason === "specialist-availability-pending" ? " Falta definir la disponibilidad sin los especialistas necesarios."
        : " Hay un caso pendiente de definición o validación. Se necesita revisión antes de continuar."}
    </p>}
    {state.movement?.status === "completed" && <section aria-label="Resumen del desplazamiento">
      <p>Ruta utilizada: {state.movement.routeName}. Desplazamiento forzoso: {state.movement.forced ? "sí" : "no"}.</p>
      <p>Coste de desplazamiento por humano: {state.movement.energyCost} de energía.</p>
      <p>Microterremoto por falta de acuerdo en la ruta: {state.movement.microearthquake ? "sí, −10 de salud por humano vivo" : "no"}.</p>
      <p>Accidente: {state.movement.accident ? "sí" : "no"}.</p>
      {state.movement.victims.length > 0 && <ul>{state.movement.victims.map(victim =>
        <li key={victim.participantId}>{victim.name}: −{victim.damage} de salud por accidente.</li>)}</ul>}
    </section>}
    <h4>{state.phase === "completed" ? "Estado al terminar la ruta (histórico)" : "Situación de la ronda"}</h4>
    <table><thead><tr><th>Participante</th><th>Salud</th><th>Energía</th></tr></thead>
      <tbody>{state.characters.map(c => <tr key={c.participantId}><td>{c.name}</td><td>{c.health}</td><td>{c.energy}</td></tr>)}</tbody></table>
    <p>{state.phase === "completed" ? "Inventario al terminar la ruta: " : "Inventario: "}{state.inventory.packs} packs y {state.inventory.medicalUnits} unidades médicas.</p>
    <p>NPC de ronda 1: {state.previousNpc === "rescued" ? "rescatado" : "abandonado"}.</p>
  </section>;
}
