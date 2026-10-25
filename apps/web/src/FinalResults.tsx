import type { GameFinalResult, PrivateObjectiveEvidence } from "@everest/shared";
export const finalRoles = { maintenance: "Mantenimiento", medic: "Médico", "architect-engineer": "Arquitecto / Ingeniero", bellhop: "Botones" };
export const finalHumanStatus = { evacuated: "Evacuado", dead: "Fallecido", abandoned: "Abandonado", active: "Activo" };
const npcStatus = { "not-encountered": "Encuentro no alcanzado", absent: "No apareció", pending: "Decisión pendiente",
  approved: "Ayuda aprobada, rescate no completado", rescued: "Rescate completado", abandoned: "Abandonado", dead: "Fallecido" };

export function FinalResults({ result, objective, participantId, connected }: {
  result: GameFinalResult; objective: PrivateObjectiveEvidence | null; participantId: string; connected: boolean;
}) {
  const own = objective?.participantId === participantId && objective.resultId === result.id ? objective : null;
  const names = (ids: string[]) => ids.map(id => result.humans.find(p => p.participantId === id)?.name ?? "Compañero").join(", ");
  return <div className="main-column" data-game-screen="final">
    <header className="game-header"><div className="brand"><div><p className="eyebrow">HOTEL SURVIVAL</p><h1>Fin de la simulación</h1></div></div>
      <span className={`connection-badge ${connected ? "online" : "offline"}`}>{connected ? "Conectado" : "Sin conexión"}</span></header>
    <section className="panel" aria-label="Desenlace"><p className="eyebrow">RESULTADO DESCRIPTIVO</p>
      <h2>{result.kind === "evacuation-completed" ? "Desplazamiento de evacuación completado" : "No quedan humanos activos para continuar"}</h2>
      <p>Sin puntuaciones, clasificación ni evaluación definitiva de objetivos.</p>
      <div className="shared-inventory"><div><strong>{result.counts.evacuated}</strong><span>Humanos evacuados</span></div>
        <div><strong>{result.counts.dead}</strong><span>Fallecidos</span></div><div><strong>{result.counts.abandoned}</strong><span>Abandonados</span></div>
        <div><strong>{result.counts.rescuedNpcs}</strong><span>NPC con rescate completado</span></div></div>
    </section>
    <section className="panel team-panel" data-panel="team" aria-label="Estado final del equipo"><h2>Resumen del equipo</h2>
      <div className="team-grid">{result.humans.map(p => <article className={`player-card ${p.participantId === participantId ? "is-self" : ""}`} key={p.participantId} data-player={p.participantId}>
        <h3>{p.name}</h3><p>{finalRoles[p.role]}</p><p className="status-label">{finalHumanStatus[p.status]}</p>
        <p>{p.health !== undefined && <>Salud: {p.health}/100 </>}{p.energy !== undefined && <>Energía: {p.energy}/100</>}</p></article>)}</div>
    </section>
    <section className="panel" aria-label="Encuentros NPC"><h2>Supervivientes adicionales</h2>
      {result.npcs.map(npc => <article key={npc.round}><h3>NPC de ronda {npc.round}</h3><p>{npcStatus[npc.status]}.
        {npc.evacuated === true ? " Evacuación confirmada." : npc.evacuated === null && npc.status === "rescued" ? " Su llegada a la calle no está registrada; no se presupone un fallecimiento." : ""}</p></article>)}
      <p>Evacuaciones NPC confirmadas: {result.counts.evacuatedNpcs}. El recuento de rescates conserva los hechos históricos.</p>
    </section>
    <section className="panel" aria-label="Última decisión"><h2>Última decisión y consecuencias</h2>
      {result.lastMovement ? <><p>Ruta final: {result.lastMovement.routeName}.</p><p>Accidente: {result.lastMovement.accident ? "sí" : "no"}.
        {result.lastMovement.victimIds.length > 0 ? ` Humanos afectados: ${names(result.lastMovement.victimIds)}.` : ""}</p></>
        : <p>El desplazamiento final no llegó a completarse.</p>}
      <p>Recursos restantes: {result.inventory.packs} packs y {result.inventory.medicalUnits} unidades médicas. Palanca: {result.crowbar === "lost" ? "perdida" : "disponible"}.</p>
      <ul>{result.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
    </section>
    <section className="panel" aria-label="Mi objetivo individual"><h2>Tu objetivo individual</h2>
      {own ? <><p>{own.objective}</p><p>{own.evaluation === "fulfilled" ? "Objetivo cumplido con información suficiente." : own.evaluation === "unfulfilled" ? "Objetivo incumplido con información suficiente." : "Pendiente de evaluación."} {own.evidenceState === "confirmed" ? "Hay hechos confirmados para revisar." : "La evaluación utiliza únicamente los datos registrados."}</p>
        <ul>{own.facts.map((f, i) => <li key={i}>{f}</li>)}</ul><ul>{own.missing.map((f, i) => <li key={i}>{f}</li>)}</ul></>
        : <p>La información individual se muestra únicamente a su sesión autorizada. Se mantienen las restricciones de personajes fallecidos o abandonados.</p>}
    </section>
  </div>;
}
