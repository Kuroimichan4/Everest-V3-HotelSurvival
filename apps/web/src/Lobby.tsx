import { useEffect, useReducer, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { PersonalDeathMessage, PrivateMedicalSabotage, MedicalSabotageInput, MedicalSabotageReply, PublicRoom, OwnVote, RoomError, RoomReply, RoomSession, SessionCredential, PackInput, PackReply, TreatmentInput, TreatmentReply } from "@everest/shared";
import { bindGameSocket, type GameSocket } from "./game-socket";
import { activeScene, emptyGame, gameReducer, reasonLabel } from "./game-state";
import { GameIntroduction } from "./GameIntroduction";
import { GameHeader, GameScreen } from "./GameScreen";
import { TeamChat } from './TeamChat';
import type { ChatView, ChatInput, ChatReply } from '@everest/shared';

const storageKey = "everest-room-session";
const errors: Record<RoomError, string> = {
  'game-not-finished': 'La partida debe haber terminado para volver al lobby.',
  'wrong-game': 'La solicitud pertenece a otra partida o a un resultado anterior.',
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
  const resetGeneration = useRef(0);
  const [chat, setChat] = useState<ChatView | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const credential = useRef<SessionCredential | null>(readCredential());
  const [game, dispatch] = useReducer(gameReducer, emptyGame);
  const { room } = game;
  const setRoom = (value: PublicRoom | null) => dispatch({ type: "room", value });
  const setOwnVote = (value: OwnVote | null) => dispatch({ type: "ownVote", value });
  const [personalDeath, setPersonalDeath] = useState<PersonalDeathMessage | null>(null);
  const [privateSabotage, setPrivateSabotage] = useState<PrivateMedicalSabotage | null>(null);
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
      reset: () => { resetGeneration.current++; setError(''); setBusy(false); setVotingBusy(false); },
      chat: value => setChat(previous => !value || !previous || value.code !== previous.code || value.sequence >= previous.sequence ? value : previous),
      participantId: () => credential.current?.participantId,
      sabotage: setPrivateSabotage,
      personalDeath: setPersonalDeath,
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

  function newGame() {
    const socket = socketRef.current; const final = game.final;
    if (!socket?.connected || !authenticated || busy || !final) return;
    const generation = resetGeneration.current;
    setBusy(true); setError('');
    socket.timeout(5000).emit('room:restart', { gameId: final.gameId, resultId: final.id }, (err, reply) => {
      if (generation !== resetGeneration.current) return;
      setBusy(false);
      if (err) { setError('No llegó la confirmación. Reconecta para recuperar el estado antes de reintentar.'); return; }
      if (!reply.ok) setError(errors[reply.error]);
    });
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
    if (action === "retry") socket.timeout(5000).emit("round-six:retry", { preparationId: preparationId ?? "" }, done);
    else socket.timeout(5000).emit(action === "advance" ? "round-six:advance" : "round-six:open", done);
  }

  function intermediateAction(round: 4 | 5, action: "advance" | "reveal" | "open" | "retry") {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated || busy) return;
    setBusy(true); setError("");
    socket.timeout(5000).emit("intermediate:action", { round, action }, (err, reply) => {
      setBusy(false);
      if (err) setError("Sin confirmación. Reconecta para recuperar la ronda.");
      else if (!reply.ok) setError(reasonLabel(reply.error));
    });
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

  function sabotage(input: MedicalSabotageInput, done: (reply: MedicalSabotageReply | null) => void) {
    const socket = socketRef.current; const owner = credential.current?.participantId;
    if (!socket?.connected || !authenticated || !owner) { done(null); return; }
    socket.timeout(5000).emit("medical:sabotage", input, (err, reply) => {
      if (credential.current?.participantId !== owner || !socket.connected) return;
      if (err) { done(null); return; }
      if (reply.ok) {
        if (reply.requestId !== input.requestId || reply.state.gameId !== input.gameId || reply.state.participantId !== owner) { done(null); return; }
        setPrivateSabotage(reply.state);
      }
      done(reply);
    });
  }

  const count = room?.participants.filter((participant) => participant.connected).length ?? 0;
  const sendChat = (input: ChatInput) => new Promise<ChatReply | null>(resolve => {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated) { resolve(null); return; }
    socket.timeout(5000).emit('chat:send', input, (err, reply) => resolve(err ? null : reply));
  });
  const chatPanel = room && authenticated ? <TeamChat key={game.supplies?.gameId ?? `lobby-${resetGeneration.current}`} view={chat} participantId={credential.current?.participantId ?? ''} connected={connected} onSend={sendChat} /> : null;
  const creator = room?.creatorId === credential.current?.participantId;
  if (room?.status === "started" && authenticated) return <div className="room-with-chat"><div className="room-content"><GameScreen state={game} participantId={credential.current?.participantId ?? ""}
    privateSabotage={privateSabotage} personalDeath={personalDeath} connected={connected} busy={busy || votingBusy} error={error} actions={{ onNewGame: newGame, onVote: cast, onRoute: routeAction, onIntermediate: intermediateAction,
      onOpenThree: () => roundThreeAction("open"), onOpenFour: () => roundFourAction("open"), onRetryFour: id => roundFourAction("retry", id),
      onAdvance: () => { if (scene.round === 5) roundFourAction("advance"); else if (scene.round === 4) intermediateAction(5, "advance"); else if (scene.round === 3) intermediateAction(4, "advance"); else if (scene.round === 2) roundThreeAction("advance"); else advance(); },
      onOpenTransport: openTransport, onRetry: retryRoute, onGive: givePack, onTreat: treat, onSabotage: sabotage }} /></div>{chatPanel}</div>;
  return <div className={chatPanel ? 'room-with-chat' : ''}><div className="room-content">
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
          credential.current = null; setPrivateSabotage(null); setPersonalDeath(null); setHasSession(false); dispatch({ type: "clear" }); setError(""); socketRef.current?.disconnect().connect();
        }}>Olvidar credencial local</button>
      </div>}
      {room?.status === "waiting" && <><GameIntroduction /><div className="section-heading"><h3>Tu equipo</h3><span className="badge">{count}/4 conectados</span></div>
        <div className="waiting-grid">{Array.from({ length: 4 }, (_, i) => { const p = room.participants[i]; return <div className="player-card" key={p?.id ?? `empty-${i}`}><strong>{p?.name ?? "Esperando compañero"}</strong><p className="muted">{p ? `${p.id === room.creatorId ? "Anfitrión" : "Participante"} / ${p.connected ? "Conectado" : "Desconectado"}` : "Plaza disponible"}</p></div>; })}</div>
        {creator ? <button disabled={!connected || !authenticated || busy || count !== 4} onClick={start}>Iniciar partida</button> : <p className="muted">El anfitrión iniciará cuando estén los cuatro.</p>}
      </>}
    </section>
    <footer className="app-footer">Everest V3 / Las salas se conservan hasta reiniciar el servidor.</footer>
  </div>{chatPanel}</div>;
}
