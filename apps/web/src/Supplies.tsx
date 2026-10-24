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
  "supplies-not-open": "La entrega corresponde a una fase cerrada. Solo se puede repartir después de completar la ruta actual.",
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
  const living = state.characters.filter(c => c.health > 0);
  const target = living.find(c => c.participantId === targetId) ?? living[0];

  function send(input: PackInput) {
    if (!enabled || sending.current) return;
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
    if (!target || !state.windowId || pending || !enabled || busy) return;
    const input: PackInput = { requestId: crypto.randomUUID(), windowId: state.windowId, targetParticipantId: target.participantId };
    try { sessionStorage.setItem(storageKey, JSON.stringify(input)); }
    catch { setMessage("No se pudo guardar la entrega pendiente. Habilita el almacenamiento de sesión antes de repartir."); return; }
    setPending(input);
    send(input);
  }

  return <section aria-label="Estado actual y suministros">
    <h3>Estado actual del equipo</h3>
    <p>Ronda {state.round}. Estos valores incluyen los packs consumidos después de la ruta.</p>
    <table><thead><tr><th>Participante</th><th>Salud actual</th><th>Energía actual</th></tr></thead>
      <tbody>{state.characters.map(c => <tr key={c.participantId}><td>{c.name}</td><td>{c.health}</td><td>{c.energy}</td></tr>)}</tbody>
    </table>
    <p>Packs disponibles: {state.inventory.packs}. Unidades médicas: {state.inventory.medicalUnits}.</p>
    {bellhop && state.windowId && <details>
      <summary>Gestionar suministros</summary>
      <label>Destinatario<select value={target?.participantId ?? ""} disabled={!enabled || busy || !!pending} onChange={event => setTargetId(event.target.value)}>
        {living.map(c => <option key={c.participantId} value={c.participantId}>{c.name} — {c.energy} de energía</option>)}
      </select></label>
      <button disabled={!enabled || busy || !!pending || !target || target.energy >= 100 || state.inventory.packs === 0} onClick={give}>Entregar pack</button>
      {state.inventory.packs === 0 && <p>No quedan packs disponibles.</p>}
      {target?.energy === 100 && <p>El destinatario ya tiene 100 de energía.</p>}
    </details>}
    {bellhop && pending && <button disabled={!enabled || busy} onClick={() => send(pending)}>Reintentar entrega pendiente</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
