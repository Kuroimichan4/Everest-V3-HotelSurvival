import { RoundTwo } from "./RoundTwo";
import type { RoundTwoView } from "@everest/shared";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, PrivateRole, PublicRoom, RoomError, RoomReply, RoomSession, ServerToClientEvents, SessionCredential } from "@everest/shared";
import { CharacterSheet } from "./CharacterSheet";
import { RoundOne } from "./RoundOne";
import type { OwnVote, PublicVote, RoundOneSummary } from "@everest/shared";

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
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const credential = useRef<SessionCredential | null>(readCredential());
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [role, setRole] = useState<PrivateRole | null>(null);
  const [vote, setVote] = useState<PublicVote | null>(null);
  const [roundTwo, setRoundTwo] = useState<RoundTwoView | null>(null);
  const [summary, setSummary] = useState<RoundOneSummary | null>(null);
  const [ownVote, setOwnVote] = useState<OwnVote | null>(null);
  const [votingBusy, setVotingBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [hasSession, setHasSession] = useState(credential.current !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({ autoConnect: false });
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
    socket.on("connect", () => {
      setConnected(true);
      if (credential.current) {
        setBusy(true);
        socket.timeout(5000).emit("room:resume", credential.current, (err, reply) => {
          if (!active) return;
          if (err) { setBusy(false); setError("No llegó la respuesta. Reintenta la reconexión."); }
          else accept(reply);
        });
      }
    });
    socket.on("disconnect", () => { setConnected(false); setAuthenticated(false); setRole(null); setBusy(false); setVote(null); setSummary(null); setRoundTwo(null); setOwnVote(null); setVotingBusy(false); });
    socket.on("connect_error", () => { setConnected(false); setError("No se pudo conectar con el servidor."); });
    socket.on("room:updated", setRoom);
    socket.on("vote:updated", setVote);
    socket.on("round:completed", setSummary);
    socket.on("round-two:updated", setRoundTwo);
    socket.on("vote:own", setOwnVote);
    socket.on("game:role", (assignment) => {
      if (assignment.participantId === credential.current?.participantId) setRole(assignment);
    });
    socket.connect();
    return () => { active = false; socket.disconnect(); socketRef.current = null; };
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
      else if (!reply.ok) setError("No se puede avanzar: " + reply.error);
    });
  }

  function cast(optionId: string) {
    const socket = socketRef.current;
    if (!socket?.connected || !authenticated || !vote || votingBusy) return;
    setVotingBusy(true);
    setError("");
    socket.timeout(5000).emit("vote:cast", { decisionId: vote.decisionId, attemptId: vote.attemptId, optionId }, (err, reply) => {
      setVotingBusy(false);
      if (err) { setError("No llegó la confirmación del voto. Reconecta para recuperar su estado."); socket.disconnect().connect(); return; }
      if (reply.ok) setOwnVote(reply.own);
      else setError(reply.error === "vote-change-pending" ? "El cambio de voto todavía no está disponible."
        : "El servidor no ha aceptado el voto. Comprueba el intento y el estado actuales de la votación.");
    });
  }

  const count = room?.participants.filter((participant) => participant.connected).length ?? 0;
  const creator = room?.creatorId === credential.current?.participantId;
  return (
    <section className="connection-panel" aria-labelledby="lobby-title">
      <h2 id="lobby-title">Sala multijugador</h2>
      <p aria-live="polite">{connected ? "Conectado" : "Sin conexión"}</p>
      {error && <p role="alert">{error}</p>}
      {!room && !hasSession && <div className="room-form">
        <label>Nombre visible<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label>
        <button disabled={!connected || busy || !name.trim()} onClick={() => enter("create")}>Crear sala</button>
        <label>Código de sala<input value={code} maxLength={12} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>
        <button disabled={!connected || busy || !name.trim() || !code.trim()} onClick={() => enter("join")}>Unirse a sala</button>
      </div>}
      {hasSession && !authenticated && <div>
        <button disabled={!connected || busy} onClick={() => socketRef.current?.disconnect().connect()}>Reintentar reconexión</button>
        <button disabled={busy} onClick={() => {
          try { sessionStorage.removeItem(storageKey); } catch { /* Puede estar deshabilitado. */ }
          credential.current = null; setHasSession(false); setRoom(null); setRole(null); setError("");
        }}>Olvidar credencial local</button>
        <p>Olvidarla no libera la plaza reservada en el servidor.</p>
      </div>}
      {room && <>
        <h3>Información común de la sala</h3>
        <p>Código: <strong>{room.code}</strong></p>
        <p>{count}/4 participantes conectados · {room.status === "waiting" ? "Sala de espera" : "Partida iniciada"}</p>
        <ol>{Array.from({ length: 4 }, (_, index) => {
          const participant = room.participants[index];
          return <li key={participant?.id ?? index}>{participant
            ? `${participant.name}${participant.id === room.creatorId ? " (creador)" : ""} — ${participant.connected ? "conectado" : "desconectado"}`
            : "Plaza libre"}</li>;
        })}</ol>
        {room.status === "waiting" && creator && <button disabled={!connected || !authenticated || busy || count !== 4} onClick={start}>Iniciar partida</button>}
        {room.status === "started" && <>
          <p aria-live="polite">Partida iniciada.{!role && " Recuperando tu ficha…"}</p>
          {authenticated && role && <CharacterSheet sheet={role.sheet} />}
          {authenticated && vote && (roundTwo && vote.round === 2
            ? <RoundTwo state={roundTwo} vote={vote} own={ownVote} enabled={connected && !!role} busy={votingBusy} onVote={cast} />
            : <RoundOne summary={summary} vote={vote} own={ownVote} enabled={connected && !!role} busy={votingBusy} onVote={cast} />)}
          {authenticated && summary && !roundTwo && (creator
            ? <button disabled={!connected || busy} onClick={advance}>Avanzar a ronda 2</button>
            : <p>Esperando a que el creador avance a la ronda 2.</p>)}
        </>}
      </>}
      <p className="notice">Versión de desarrollo: las salas se pierden al reiniciar el servidor. Disponibles la ronda 1 y el segundo rescate; la elección de ruta queda pendiente.</p>
    </section>
  );
}
