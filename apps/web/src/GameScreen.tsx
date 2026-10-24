import type { PackInput, PackReply, TreatmentInput, TreatmentReply, RoundOneSummary } from "@everest/shared";
import { activeScene, reasonLabel, type GameState } from "./game-state";
import { gameHistory } from "./game-history";
import { CharacterSheet } from "./CharacterSheet";
import { Countdown, VoteClockProvider } from "./VotePanel";
import { RoundOne } from "./RoundOne";
import { RoundTwo } from "./RoundTwo";
import { RoundThree } from "./RoundThree";
import { Transport } from "./Transport";
import { Supplies } from "./Supplies";
import { Medical } from "./Medical";
import { RoundFour } from "./RoundFour";

export interface GameActions {
  onOpenFour?: () => void; onRetryFour?: (id: string) => void;
  onVote: (id: string) => void; onRoute: (action: "reveal" | "open") => void;
  onOpenThree: () => void; onAdvance: () => void; onOpenTransport: (id: string) => void; onRetry: (id: string) => void;
  onGive: (input: PackInput, done: (reply: PackReply | null) => void) => void;
  onTreat: (input: TreatmentInput, done: (reply: TreatmentReply | null) => void) => void;
}
type Character = RoundOneSummary["characters"][number];
function statusOf(c: Character, state: GameState) {
  if (c.eliminated) return "Abandonado";
  if (!c.health) return "Fallecido";
  const scene = activeScene(state);
  if (scene.transport?.transportedIds.includes(c.participantId)) return "Transportado";
  if (!c.energy || scene.transport?.exhaustedIds.includes(c.participantId)) return "Agotado";
  return "Activo";
}
function Bars({ character }: { character: Character }) {
  return <div className="vitals">{(["health", "energy"] as const).map(kind => <div className={`vital ${kind}`} key={kind}>
    <div><span>{kind === "health" ? "Salud" : "Energía"}</span><strong>{character[kind]}<small>/100</small></strong></div>
    <progress max={100} value={character[kind]} aria-label={`${kind === "health" ? "Salud" : "Energía"} de ${character.name}`} />
  </div>)}</div>;
}
export function GameHeader({ state, connected }: { state: GameState; connected: boolean }) {
  const scene = activeScene(state);
  return <header className="game-header">
    <div className="brand"><span className="brand-mark" aria-hidden="true">▲</span><div><p className="eyebrow">EVEREST V3</p><h1>Hotel Survival</h1></div></div>
    <div className="header-status">{state.room && <span className="room-code">Sala <strong>{state.room.code}</strong></span>}
      {state.room?.status === "started" && <><span className="badge">Ronda {scene.round}</span><span className="phase-label">{scene.phase}</span><Countdown vote={scene.vote} /></>}
      <span className={`connection-badge ${connected ? "online" : "offline"}`}><i aria-hidden="true" />{connected ? "Conectado" : "Sin conexión"}</span>
    </div>
  </header>;
}
function MyCharacter({ state, participantId }: { state: GameState; participantId: string }) {
  const self = state.supplies?.characters.find(c => c.participantId === participantId);
  const role = state.role?.participantId === participantId ? state.role : null;
  return <section className="panel my-character" aria-label="Mi personaje">
    <p className="eyebrow">MI PERSONAJE</p><div className="character-avatar" aria-hidden="true">{self?.name.slice(0, 1).toUpperCase() ?? "?"}</div>
    <h2>{role?.sheet.name ?? self?.name ?? "Recuperando personaje…"}</h2>
    {self && <><p className={`status-label ${self.eliminated || !self.health ? "danger" : ""}`}>{statusOf(self, state)}</p><Bars character={self} /></>}
    {role && self && !self.eliminated && self.health > 0 ? <details className="private-details"><summary>Consultar mi ficha privada <span aria-hidden="true">↗</span></summary><CharacterSheet sheet={role.sheet} /></details>
      : <p className="muted">{self?.eliminated || self?.health === 0 ? "La ficha activa ya no está disponible para tu personaje." : "Esperando tu ficha privada…"}</p>}
  </section>;
}
export function TeamStatus({ state, participantId }: { state: GameState; participantId: string }) {
  const people = state.supplies?.characters ?? [];
  return <section className="panel team-panel" aria-label="Estado actual del equipo" data-panel="team">
    <div className="section-heading"><div><p className="eyebrow">SITUACIÓN EN TIEMPO REAL</p><h2>Estado del equipo</h2></div><span className="muted">{people.filter(c => c.health > 0 && !c.eliminated).length} activos</span></div>
    <div className="team-grid">{people.map(c => <article key={c.participantId} className={`player-card ${c.participantId === participantId ? "is-self" : ""}`} data-player={c.participantId}>
      <div className="player-heading"><strong>{c.name}{c.participantId === participantId && <small> · Tú</small>}</strong><span className={`status-label ${c.eliminated || !c.health ? "danger" : ""}`}>{statusOf(c, state)}</span></div>
      {c.participantId === participantId && state.role?.participantId === participantId && <p className="muted">{state.role.sheet.name}</p>}
      <Bars character={c} />
    </article>)}</div>
    <div className="shared-inventory" aria-label="Inventario compartido"><div><span aria-hidden="true">▣</span><strong>{state.supplies?.inventory.packs ?? 0}</strong><span>Packs</span></div>
      <div><span aria-hidden="true">✚</span><strong>{state.supplies?.inventory.medicalUnits ?? 0}</strong><span>Unidades médicas</span></div>
      <div><span aria-hidden="true">⌁</span><strong>{state.activity?.tools.crowbar === "lost" ? "Perdida" : state.activity ? "Disponible" : "…"}</strong><span>Palanca compartida</span></div></div>
  </section>;
}
function CurrentAction({ state, participantId, connected, busy, actions }: { state: GameState; participantId: string; connected: boolean; busy: boolean; actions: GameActions }) {
  const scene = activeScene(state); const creator = state.room?.creatorId === participantId;
  const self = state.supplies?.characters.find(c => c.participantId === participantId);
  const enabled = connected && state.role?.participantId === participantId && !!self && self.health > 0 && !self.eliminated;
  const common = { own: state.ownVote, enabled, busy, onVote: actions.onVote };
  return <section className="panel current-action" aria-label="Acción actual" data-panel="action">
    {scene.round === 4 && state.roundFour && scene.kind !== "transport" ? <RoundFour state={state.roundFour} creator={creator} {...common} onOpen={actions.onOpenFour ?? (() => {})} onRetry={actions.onRetryFour ?? (() => {})} />
      : scene.kind === "completed" ? <><p className="eyebrow">SIGUIENTE PASO</p><h2>El equipo ha terminado el recorrido</h2>
      {scene.round < 4 ? creator ? <><p className="action-description">Podéis revisar al equipo y usar suministros antes de continuar.</p><button disabled={!enabled || busy} onClick={actions.onAdvance}>Avanzar a ronda {scene.round + 1}</button></>
        : <p className="action-description">Revisad al equipo. El anfitrión abrirá la siguiente ronda.</p> : <p className="action-description">Habéis llegado al final de las rondas disponibles. Podéis revisar los resultados y el historial.</p>}</>
      : scene.kind === "transport" && scene.transport ? <>
        {scene.round === 4 && state.roundFour?.npc.status === "awaiting-effort" && <p>Rescate NPC aprobado y pendiente: {state.roundFour.npc.energyPerHuman} de energía por humano participante{state.roundFour.npc.medicalUnits ? ` y ${state.roundFour.npc.medicalUnits} unidad médica` : ""}. Los porteadores se calculan después de prever ese esfuerzo. Todavía no se ha cobrado.</p>}
        <Transport state={{ cases: [scene.transport] }} participantId={participantId} {...common} onOpen={actions.onOpenTransport} /></>
      : (scene.kind === "route-three" || scene.kind === "recovery") && scene.round === 3 && state.roundThree ? <RoundThree state={state.roundThree} creator={creator} {...common} onOpen={actions.onOpenThree} onRetry={actions.onRetry} />
      : (scene.kind === "route-two" || scene.kind === "recovery") && state.roundTwo && state.vote ? <RoundTwo state={state.roundTwo} vote={state.vote} creator={creator} maintenance={state.role?.role === "maintenance"} {...common} onRouteAction={actions.onRoute} onRetry={actions.onRetry} />
      : scene.kind === "rescue" && state.vote ? <RoundOne summary={null} vote={state.vote} {...common} />
      : <><p className="eyebrow">RESOLUCIÓN</p><h2>Esperando al servidor</h2><p>{state.supplies?.movementBlocked ? reasonLabel(state.supplies.movementBlocked) : "La partida se actualizará al confirmar el siguiente paso."}</p></>}
  </section>;
}
function ResultSummary({ state }: { state: GameState }) {
  const scene = activeScene(state); const entries = gameHistory(state).filter(e => e.round === scene.round);
  if (scene.round === 4) return null;
  const result = entries.find(e => e.id.startsWith("route:") && e.title.includes("completad")) ?? entries.findLast(e => e.id.startsWith("activity:")) ?? entries.findLast(e => e.id.startsWith("npc:"));
  if (!result) return null;
  const carried = scene.transport?.phase === "completed" ? scene.transport.transportedIds.length : 0;
  return <section className="panel result-panel" aria-label="Resultado reciente" data-panel="result"><p className="eyebrow">ÚLTIMO RESULTADO</p><h2>{result.title}</h2>
    <ul>{result.details.slice(0, 4).map((detail, i) => <li key={i}>{detail}</li>)}</ul>{carried > 0 && <p>{carried} compañero{carried > 1 ? "s" : ""} transportado{carried > 1 ? "s" : ""}.</p>}
  </section>;
}
export function GameHistory({ state }: { state: GameState }) {
  const entries = gameHistory(state);
  return <details className="panel game-history" aria-label="Historial de la partida" data-panel="history"><summary>Historial de la partida <span>{entries.length} registros</span></summary>
    {entries.length ? <ol>{entries.map(e => <li key={e.id} data-history-id={e.id}><span className="badge">Ronda {e.round}</span><h3>{e.title}</h3><ul>{e.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
      {e.snapshot && <details><summary>Estado histórico al terminar</summary><div className="table-scroll"><table><thead><tr><th>Participante</th><th>Salud</th><th>Energía</th></tr></thead><tbody>{e.snapshot.map(c => <tr key={c.participantId}><td>{c.name}</td><td>{c.health}</td><td>{c.energy}</td></tr>)}</tbody></table></div></details>}
    </li>)}</ol> : <p className="muted">Las acciones confirmadas aparecerán aquí.</p>}
  </details>;
}
export function GameScreen({ state, participantId, connected, busy, actions, error }: { state: GameState; participantId: string; connected: boolean; busy: boolean; actions: GameActions; error: string }) {
  const scene = activeScene(state);
  const self = state.supplies?.characters.find(c => c.participantId === participantId);
  const enabled = connected && state.role?.participantId === participantId && !!self && self.health > 0 && !self.eliminated;
  return <VoteClockProvider vote={scene.vote}>
    <GameHeader state={state} connected={connected} />
    {error && <p className="global-error" role="alert">{error}</p>}
    <div className="game-layout" data-game-screen="current"><aside className="sidebar">
      <MyCharacter state={state} participantId={participantId} />
      {state.supplies && state.role?.role === "bellhop" && <Supplies key={state.supplies.gameId} state={state.supplies} bellhop={enabled} enabled={enabled} onGive={actions.onGive} />}
      {state.medical && state.role?.role === "medic" && <Medical key={state.medical.gameId} state={{ ...state.medical, characters: state.supplies?.characters ?? state.medical.characters, inventory: state.supplies?.inventory ?? state.medical.inventory }} medic={enabled} enabled={enabled} canTreat={scene.round !== 4 || !!state.supplies?.windowId} onTreat={actions.onTreat} />}
    </aside><div className="main-column"><CurrentAction state={state} participantId={participantId} connected={connected} busy={busy} actions={actions} />
      <TeamStatus state={state} participantId={participantId} /><ResultSummary state={state} />
    </div><GameHistory state={state} /></div>
    <footer className="app-footer">Everest V3 · Simulación cooperativa · La sesión se conserva al recargar mientras el servidor siga activo.</footer>
  </VoteClockProvider>;
}
