import { useEffect, useReducer, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { PublicRoom, OwnVote, RoomError, RoomReply, RoomSession, SessionCredential, PackInput, PackReply, TreatmentInput, TreatmentReply } from "@everest/shared";
import { bindGameSocket, type GameSocket } from "./game-socket";
import { activeScene, emptyGame, gameReducer, reasonLabel } from "./game-state";
import { GameHeader, GameScreen } from "./GameScreen";

const storageKey = "everest-room-session";
const errors: Record<RoomError, string> = {
  "invalid-input": "Introduce un nombre de 1 a 40 caracteres y un código de sala válido.",
  "room-not-found": "La sala no existe.", "room-full": "La sala ya tiene cuatro participantes.",
  "already-started": "La partida ya ha comenzado.", "not-creator": "Solo el creador puede iniciar la partida.",
  "not-four-connected": "Deben estar conectados los cuatro participantes.",
  "invalid-credentials": "No se puede recuperar la sesión. Puede que el servidor se haya reiniciado.",
  "session-in-use": "Esta sesión sigue conectada en otra conexión. Ciérrala y pulsa Reintentar reconexión.",
  "already-in-room": "Esta conexión ya pertenece a una sala.",
};

function readCredential(): SessionCredential | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<SessionCredential>;
    return typeof candidate.code === "string" && typeof candidate.participantId === "string" && typeof candidate.token === "string"
      ? candidate as SessionCredential : null;
  } catch { return null; }
}

export function Lobby() {
  const socketRef = useRef<GameSocket | null>(null);
  const credential = useRef<SessionCredential | null>(readCredential());
  const [game, dispatch] = useReducer(gameReducer, emptyGame);
  const { room, supplies } = game;
  const setRoom = (value: PublicRoom | null) => dispatch({ type: "room", value });
  const setOwnVote = (value: OwnVote | null) => dispatch({ type: "ownVote", value });
  const [votingBusy, setVotingBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [hasSession, setHasSession] = useState(credential.current !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const scene = activeScene(game);
  useEffect(() => setError(""), [scene.round, scene.kind, scene.vote?.decisionId, scene.vote?.attemptId]);

  useEffect(() => {
    const socket: GameSocket = io({ autoConnect: false });
    socketRef.current = socket;
    let active = true;
    const accept = (result: RoomReply<RoomSession>) => {
      if (!active) return;
      setBusy(false);
      if (!result.ok) { setError(errors[result.error]); return; }
      credential.current = result.value.credential;
      setHasSession(true);
      setAuthenticated(true);
      setRoom(result.value.room);
      setError("");
      try { sessionStorage.setItem(storageKey, JSON.stringify(result.value.credential)); }
      catch { setError("No se pudo guardar la sesión: una recarga podría impedir la reconexión."); }
    };
    const unbind = bindGameSocket(socket, dispatch, {
      participantId: () => credential.current?.participantId,
      connect: () => {
        setConnected(true);
      if (credential.current) {
        setBusy(true);
        socket.timeout(5000).emit("room:resume", credential.current, (err, reply) => {
          if (!active) return;
          if (err) { setBusy(false); setError("No llegó la respuesta. Reintenta la reconexión."); }
          else accept(reply);
        });
      }
      },
      disconnect: () => { setConnected(false); setAuthenticated(false); setBusy(false); setVotingBusy(false); },
      error: () => { setConnected(false); setError("No se pudo conectar con el servidor."); },
    });
    socket.connect();
    return () => { active = false; unbind(); socket.disconnect(); socketRef.current = null; };
  }, []);

  function enter(kind: "create" | "join") {
    const socket = socketRef.current;
    if (!socket?.connected || busy) return;
    setBusy(true);
    setError("");
    const callback = (err: Error | null, result: RoomReply<RoomSession>) => {
      setBusy(false);
      if (err) { setError("No llegó la respuesta. Reconecta antes de repetir la operación."); socket.disconnect().connect(); return; }
      if (!result.ok) { setError(errors[result.error]); return; }
      credential.current = result.value.credential;
      setHasSession(true);
      setAuthenticated(true);
      setRoom(result.value.room);
      try { sessionStorage.setItem(storageKey, JSON.stringify(result.value.credential)); }
      catch { setError("No se pudo guardar la sesión: una recarga podría impedir la reconexión."); }
    };
    if (kind === "create") socket.timeout(5000).emit("room:create", { name }, callback);
    else socket.timeout(5000).emit("room:join", { name, code }, callback);
  }

  function start() {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated || busy) return;
    setBusy(true);
    setError("");
    socket.timeout(5000).emit("room:start", (err, result) => {
      setBusy(false);
      if (err) { setError("No llegó la respuesta. Reintenta la reconexión para recuperar el estado."); return; }
      if (!result.ok) setError(errors[result.error]);
      else setRoom(result.value);
    });
  }

  function advance() {
    if (!socketRef.current?.connected || !authenticated || busy) return;
    setBusy(true);
    setError("");
    socketRef.current.timeout(5000).emit("round:advance", (err, reply) => {
      setBusy(false);
      if (err) setError("No llegó la respuesta. Reconecta para recuperar el estado.");
      else if (!reply.ok) setError(reasonLabel(reply.error));
    });
  }

  function roundThreeAction(action: "advance" | "open") {
    if (!socketRef.current?.connected || !authenticated || busy) return;
    setBusy(true); setError("");
    socketRef.current.timeout(5000).emit(action === "advance" ? "round-three:advance" : "round-three:open", (err, reply) => {
      setBusy(false);
      if (err) setError("No llegó la respuesta. Reconecta para recuperar el estado.");
      else if (!reply.ok) setError(reasonLabel(reply.error));
    });
  }

  function roundFourAction(action: "advance" | "open" | "retry", preparationId?: string) {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated || busy) return;
    setBusy(true); setError("");
    const done = (err: Error | null, reply: import("@everest/shared").RouteActionReply) => {
      setBusy(false);
      if (err) setError("Sin confirmación. Reconecta para recuperar la evacuación.");
      else if (!reply.ok) setError(reasonLabel(reply.error));
    };
    if (action === "retry") socket.timeout(5000).emit("round-four:retry", { preparationId: preparationId ?? "" }, done);
    else socket.timeout(5000).emit(action === "advance" ? "round-four:advance" : "round-four:open", done);
  }

  function routeAction(action: "reveal" | "open") {
    if (!socketRef.current?.connected || !authenticated || votingBusy) return;
    setVotingBusy(true);
    setError("");
    socketRef.current.timeout(5000).emit(action === "reveal" ? "route:reveal" : "route:open", (err, reply) => {
      setVotingBusy(false);
      if (err) { setError("No llegó la respuesta. Reconecta para recuperar el estado."); socketRef.current?.disconnect().connect(); }
      else if (!reply.ok) setError(reasonLabel(reply.error));
    });
  }

  function cast(optionId: string) {
    const currentVote = activeScene(game).vote;
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated || !currentVote || votingBusy) return;
    setVotingBusy(true);
    setError("");
    socket.timeout(5000).emit("vote:cast", { decisionId: currentVote.decisionId, attemptId: currentVote.attemptId, optionId }, (err, reply) => {
      setVotingBusy(false);
      if (err) { setError("No llegó la confirmación del voto. Reconecta para recuperar su estado."); socket.disconnect().connect(); return; }
      if (reply.ok) setOwnVote(reply.own);
      else setError(reply.error === "vote-change-pending" ? "El cambio de voto todavía no está disponible."
        : "El servidor no ha aceptado el voto. Comprueba el intento y el estado actuales de la votación.");
    });
  }

  function openTransport(preparationId: string) {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated || votingBusy) return;
    setVotingBusy(true); setError("");
    socket.timeout(5000).emit("transport:open", { preparationId }, (err, reply) => {
      setVotingBusy(false);
      if (err) setError("Sin confirmación. Reconecta para recuperar el estado del transporte.");
      else if (!reply.ok) setError(reasonLabel(reply.error));
    });
  }

  function retryRoute(decisionId: string) {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated || votingBusy) return;
    setVotingBusy(true); setError("");
    socket.timeout(5000).emit("route:retry", { decisionId }, (err, reply) => {
      setVotingBusy(false);
      if (err) setError("Sin confirmación. Reconecta para recuperar la selección.");
      else if (!reply.ok) setError(reasonLabel(reply.error));
    });
  }

  function givePack(input: PackInput, done: (reply: PackReply | null) => void) {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated) { done(null); return; }
    socket.timeout(5000).emit("pack:give", input, (err, reply) => done(err ? null : reply));
  }

  function treat(input: TreatmentInput, done: (reply: TreatmentReply | null) => void) {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated) { done(null); return; }
    socket.timeout(5000).emit("medical:treat", input, (err, reply) => done(err ? null : reply));
  }

  const count = room?.participants.filter((participant) => participant.connected).length ?? 0;
  const creator = room?.creatorId === credential.current?.participantId;
  if (room?.status === "started" && authenticated) return <GameScreen state={game} participantId={credential.current?.participantId ?? ""}
    connected={connected} busy={busy || votingBusy} error={error} actions={{ onVote: cast, onRoute: routeAction,
      onOpenThree: () => roundThreeAction("open"), onOpenFour: () => roundFourAction("open"), onRetryFour: id => roundFourAction("retry", id),
      onAdvance: () => { if (supplies?.round === 3) roundFourAction("advance"); else if (supplies?.round === 2) roundThreeAction("advance"); else advance(); },
      onOpenTransport: openTransport, onRetry: retryRoute, onGive: givePack, onTreat: treat }} />;
  return <>
    <GameHeader state={game} connected={connected} />
    <section className="panel lobby-panel" aria-label="Sala multijugador">
      <p className="eyebrow">SIMULACIÓN COOPERATIVA</p><h2>{hasSession && !authenticated ? "Recuperar partida" : room ? "El equipo se está reuniendo" : "Preparaos para sobrevivir"}</h2>
      <p className="action-description">Cuatro personas, un hotel en crisis. Cada decisión cuenta.</p>
      {error && <p role="alert">{error}</p>}
      {!room && !hasSession && <div className="room-form">
        <label>Tu nombre<input value={name} maxLength={40} onChange={event => setName(event.target.value)} autoComplete="nickname" /></label>
        <div className="join-actions"><button disabled={!connected || busy || !name.trim()} onClick={() => enter("create")}>Crear sala</button>
          <label>Código de sala<input value={code} maxLength={12} onChange={event => setCode(event.target.value.toUpperCase())} /></label>
          <button className="secondary" disabled={!connected || busy || !name.trim() || !code.trim()} onClick={() => enter("join")}>Unirse a sala</button></div>
      </div>}
      {hasSession && !authenticated && <div className="action-buttons">
        <button disabled={!connected || busy} onClick={() => socketRef.current?.disconnect().connect()}>Reintentar reconexión</button>
        <button className="secondary" disabled={busy} onClick={() => {
          try { sessionStorage.removeItem(storageKey); } catch { /* La credencial puede no estar almacenada. */ }
          credential.current = null; setHasSession(false); dispatch({ type: "clear" }); setError(""); socketRef.current?.disconnect().connect();
        }}>Olvidar credencial local</button>
      </div>}
      {room?.status === "waiting" && <><div className="section-heading"><h3>Tu equipo</h3><span className="badge">{count}/4 conectados</span></div>
        <div className="waiting-grid">{Array.from({ length: 4 }, (_, i) => { const p = room.participants[i]; return <div className="player-card" key={p?.id ?? `empty-${i}`}><strong>{p?.name ?? "Esperando compañero"}</strong><p className="muted">{p ? `${p.id === room.creatorId ? "Anfitrión" : "Participante"} / ${p.connected ? "Conectado" : "Desconectado"}` : "Plaza disponible"}</p></div>; })}</div>
        {creator ? <button disabled={!connected || !authenticated || busy || count !== 4} onClick={start}>Iniciar partida</button> : <p className="muted">El anfitrión iniciará cuando estén los cuatro.</p>}
      </>}
    </section>
    <footer className="app-footer">Everest V3 / Las salas se conservan hasta reiniciar el servidor.</footer>
  </>;
}
