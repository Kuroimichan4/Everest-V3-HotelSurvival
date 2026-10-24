import { useEffect, useState } from "react";
import type { OwnVote, RoundThreeView } from "@everest/shared";

const blockedMessages: Record<string, string> = {
  "transport-vote-pending": "Hay compañeros que necesitan transporte. El avance espera la votación de la fase 8B; no se elimina a nadie automáticamente.",
  "insufficient-energy": "No todos los humanos disponen de energía suficiente para esta ruta.",
  "no-living-characters": "No quedan humanos vivos; su desenlace sigue pendiente.",
  "crowbar-unavailable-pending": "La palanca no está disponible; este caso sigue pendiente.",
};

export function RoundThree({ state, own, creator, enabled, busy, onOpen, onVote }: {
  state: RoundThreeView; own: OwnVote | null; creator: boolean; enabled: boolean; busy: boolean;
  onOpen: () => void; onVote: (option: string) => void;
}) {
  const vote = state.vote;
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!vote) return;
    const received = performance.now();
    const update = () => setRemaining(Math.max(0, Math.ceil((vote.deadline - vote.serverNow - (performance.now() - received)) / 1000)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [vote]);
  const ownOption = vote && own?.decisionId === vote.decisionId && own.attemptId === vote.attemptId ? own.optionId : null;
  const routeName = (id: string) => state.options.find(option => option.id === id)?.name ?? id;
  return <section aria-label="Ronda 3">
    <h3>{state.phase === "completed" ? "Ronda 3 completada" : "Ronda 3 — Obstáculo técnico"}</h3>
    {state.phase === "preparation" && <>
      <p>Preparación sin temporizador. Compartid verbalmente lo que decidáis de vuestras fichas privadas. Política provisional: el anfitrión abre la votación cuando termine el debate.</p>
      {creator ? <button disabled={!enabled || busy} onClick={onOpen}>Abrir votación de ronda 3</button> : <p>Esperando a que el anfitrión abra la votación.</p>}
    </>}
    <ul>{state.options.map(option => <li key={option.id}>
      <strong>{option.name}</strong>. {option.description} Coste: {option.energyCost} de energía por humano vivo.
      {state.phase === "voting" && <button disabled={!enabled || busy || !!ownOption || remaining === 0 || vote?.status !== "open"} onClick={() => onVote(option.id)}>Votar {option.name}</button>}
    </li>)}</ul>
    {state.phase === "voting" && vote && <p>Intento {vote.attemptNumber}. Mayoría necesaria: {vote.requiredVotes}. Tiempo restante: {remaining} s.</p>}
    {ownOption && <p role="status">Tu voto: {routeName(ownOption)}.</p>}
    {state.selection && <p>Resultado de votación: {state.forced ? "NO_AGREEMENT — sin acuerdo" : routeName(state.selection.outcome)}.</p>}
    {state.earthquake && <p>Un terremoto ha bloqueado {state.blockedRoutes.map(routeName).join(" y ")}. La galería es obligatoria. Este terremoto no añade daño directo.</p>}
    {state.phase === "blocked" && <p role="alert">Resolución bloqueada. {blockedMessages[state.blocked ?? ""] ?? "Se necesita revisar un caso pendiente o de validación."} No se han aplicado pagos, daños ni recompensas de este recorrido. La ronda no está completada.</p>}
    {state.movement && <>
      <h4>Resultado del desplazamiento</h4>
      <p>Ruta utilizada: {routeName(state.movement.routeId)}. Forzosa: {state.forced ? "sí" : "no"}. Coste por humano: {state.movement.energyCost} de energía.</p>
      <p>Accidente: {state.movement.accident ? "sí" : "no"}.</p>
      {state.movement.victims.length > 0 && <ul>{state.movement.victims.map(v => <li key={v.participantId}>{v.name}: −{v.damage} de salud por accidente.</li>)}</ul>}
      {state.movement.environment.length > 0 && <ul>{state.movement.environment.map(v => <li key={v.participantId}>{v.name}: −{v.damage} de salud por humo/gas.</li>)}</ul>}
      <p>Recursos encontrados: {state.movement.gained.packs} packs y {state.movement.gained.medicalUnits} unidades médicas.</p>
      {state.movement.discovery && <p>Exploración: {state.movement.discovery === "medical-conference-room" ? "sala de conferencias médicas encontrada" : "almacén de suministros encontrado"}.</p>}
      {state.movement.crowbarLost && <p>Un nuevo temblor ha bloqueado el regreso y ha provocado la pérdida de la palanca, sin daño directo adicional.</p>}
    </>}
    {state.afterRoute && <>
      <h4>Estado al terminar la ruta (histórico)</h4>
      <table><thead><tr><th>Participante</th><th>Salud</th><th>Energía</th><th>Estado</th></tr></thead>
        <tbody>{state.afterRoute.characters.map(c => <tr key={c.participantId}><td>{c.name}</td><td>{c.health}</td><td>{c.energy}</td><td>{c.eliminated ? "Eliminado" : c.health > 0 ? "Vivo" : "Fallecido"}</td></tr>)}</tbody>
      </table>
      <p>Inventario al terminar la ruta: {state.afterRoute.inventory.packs} packs y {state.afterRoute.inventory.medicalUnits} unidades médicas.</p>
      <p>Palanca: {state.afterRoute.crowbar === "available" ? "disponible" : "perdida"}.</p>
      <p>El panel de estado actual incluye los suministros y tratamientos posteriores.</p>
    </>}
    <p>{state.previousNpcs.map(npc => `NPC de ronda ${npc.round}: ${npc.status === "rescued" ? "rescatado" : "abandonado"}`).join(". ")}.</p>
  </section>;
}
