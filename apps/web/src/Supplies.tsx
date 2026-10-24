import { useEffect, useRef, useState } from "react";
import type { PackInput, PackReply, SuppliesView } from "@everest/shared";

function storedRequest(key: string): PackInput | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const input = JSON.parse(raw) as Partial<PackInput> | null;
    return input && typeof input.requestId === "string" && typeof input.windowId === "string"
      && typeof input.targetParticipantId === "string" ? input as PackInput : null;
  } catch { return null; }
}

const errors: Record<string, string> = {
  "no-packs": "No quedan packs disponibles.",
  "energy-full": "El destinatario ya tiene 100 de energía.",
  "character-dead": "No se pueden entregar packs a un personaje fallecido.",
  "target-not-found": "El destinatario no pertenece a esta partida.",
  "supplies-not-open": "La entrega corresponde a una fase cerrada. Reparte durante la preparación de una ruta o después de completarla.",
  "not-authorized": "Solo Botones puede repartir packs.",
  "bellhop-dead": "Botones ha fallecido. Está pendiente decidir quién podrá gestionar los packs.",
  "request-conflict": "El identificador de entrega ya corresponde a otra solicitud.",
};

export function Supplies({ state, bellhop, enabled, onGive }: {
  state: SuppliesView; bellhop: boolean; enabled: boolean;
  onGive: (input: PackInput, done: (reply: PackReply | null) => void) => void;
}) {
  const storageKey = `everest-pack-pending:${state.gameId}`;
  const [pending, setPending] = useState<PackInput | null>(() => storedRequest(storageKey));
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [message, setMessage] = useState("");
  const living = state.characters.filter(c => c.health > 0 && !c.eliminated);
  const target = living.find(c => c.participantId === targetId) ?? living[0];
  const unavailable = !enabled ? "Esperando conexión y autenticación del personaje."
    : !state.windowId ? "Reparto cerrado. Disponible durante la preparación de una ruta o después de completarla; no durante votaciones, desplazamientos ni su resolución."
    : pending ? "Hay una entrega pendiente de confirmación."
    : state.inventory.packs === 0 ? "No quedan packs disponibles."
    : !target ? "No hay destinatarios vivos disponibles."
    : target.energy >= 100 ? "El destinatario ya tiene 100 de energía."
    : null;

  function send(input: PackInput) {
    if (!bellhop || !enabled || sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    onGive(input, reply => {
      sending.current = false;
      setBusy(false);
      if (!reply) {
        setMessage("No llegó la confirmación. Reintenta la entrega pendiente o recarga para recuperarla sin gastar dos veces.");
        return;
      }
      try {
        if (storedRequest(storageKey)?.requestId === input.requestId) sessionStorage.removeItem(storageKey);
      } catch { /* El servidor conserva el recibo idempotente. */ }
      setPending(null);
      setMessage(reply.ok ? "Entrega confirmada." : errors[reply.error] ?? "El servidor rechazó la entrega. Reconecta para comprobar la sesión.");
    });
  }

  useEffect(() => {
    const saved = storedRequest(storageKey);
    if (bellhop && enabled && saved) { setPending(saved); send(saved); }
  }, [enabled, bellhop, storageKey]);

  function give() {
    if (!bellhop || unavailable || !target || !state.windowId || busy) return;
    const input: PackInput = { requestId: crypto.randomUUID(), windowId: state.windowId, targetParticipantId: target.participantId };
    try { sessionStorage.setItem(storageKey, JSON.stringify(input)); }
    catch { setMessage("No se pudo guardar la entrega pendiente. Habilita el almacenamiento de sesión antes de repartir."); return; }
    setPending(input);
    send(input);
  }

  return <section aria-label="Estado actual y suministros">
    <h3>Estado actual del equipo</h3>
    <p>Ronda {state.round}. Estos valores incluyen los packs y tratamientos aplicados.</p>
    <table><thead><tr><th>Participante</th><th>Salud actual</th><th>Energía actual</th><th>Estado</th></tr></thead>
      <tbody>{state.characters.map(c => <tr key={c.participantId}><td>{c.name}</td><td>{c.health}</td><td>{c.energy}</td><td>{c.eliminated ? "Eliminado" : c.health > 0 ? "Vivo" : "Fallecido"}</td></tr>)}</tbody>
    </table>
    {state.movementBlocked && <p role="alert">{state.movementBlocked === "transport-vote-pending" ? "Hay compañeros que necesitan transporte. Pendiente la votación de la fase 8B; nadie ha sido eliminado ni se han confirmado costes parciales." : "El avance está bloqueado por un caso pendiente de resolución."}</p>}
    <p>Packs disponibles: {state.inventory.packs}. Unidades médicas: {state.inventory.medicalUnits}.</p>
    <h3>Gestionar suministros</h3>
    {!bellhop && <p>Solo Botones vivo puede autorizar el reparto. Las existencias son compartidas.</p>}
    {bellhop && <div>
      <p role="status">{unavailable ?? "Reparto disponible. Cada pack recupera hasta 25 de energía, con máximo de 100."}</p>
      <label>Destinatario<select value={target?.participantId ?? ""} disabled={!enabled || !state.windowId || busy || !!pending} onChange={event => setTargetId(event.target.value)}>
        {living.map(c => <option key={c.participantId} value={c.participantId}>{c.name} — {c.energy} de energía</option>)}
      </select></label>
      <button disabled={!!unavailable || busy} onClick={give}>Entregar pack</button>
    </div>}
    {bellhop && pending && <button disabled={!enabled || busy} onClick={() => send(pending)}>Reintentar entrega pendiente</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
