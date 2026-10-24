import { useEffect, useRef, useState } from "react";
import type { MedicalView, TreatmentInput, TreatmentReply } from "@everest/shared";

function storedRequest(key: string): TreatmentInput | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const input = JSON.parse(raw) as Partial<TreatmentInput> | null;
    return input && typeof input.requestId === "string" && typeof input.gameId === "string"
      && (input.round === 1 || input.round === 2 || input.round === 3) && typeof input.targetParticipantId === "string" ? input as TreatmentInput : null;
  } catch { return null; }
}
const errors: Record<string, string> = {
  "no-medical-units": "No quedan unidades médicas disponibles.",
  "health-full-pending": "Salud completa: regla pendiente de decisión. Se rechaza por seguridad sin consumir recursos.",
  "treatment-used": "Este personaje ya recibió su unidad médica en esta ronda.",
  "character-dead": "No se puede tratar a un personaje fallecido.",
  "medic-dead": "El Médico ha fallecido. Su sustitución está pendiente; no se transfiere su autoridad.",
  "target-not-found": "El destinatario no es un humano de esta partida.",
  "not-authorized": "Solo el Médico puede administrar tratamientos.",
  "wrong-round": "La solicitud corresponde a otra ronda. No se ha aplicado el tratamiento.",
  "wrong-game": "La solicitud corresponde a otra partida.",
  "request-conflict": "Este identificador ya corresponde a otro tratamiento.",
};

export function Medical({ state, medic, enabled, onTreat }: {
  state: MedicalView; medic: boolean; enabled: boolean;
  onTreat: (input: TreatmentInput, done: (reply: TreatmentReply | null) => void) => void;
}) {
  const storageKey = `everest-medical-pending:${state.gameId}`;
  const [pending, setPending] = useState<TreatmentInput | null>(() => storedRequest(storageKey));
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [message, setMessage] = useState("");
  const treated = new Set(state.treatments.filter(t => t.round === state.round).map(t => t.participantId));
  const living = state.characters.filter(c => c.health > 0 && !c.eliminated);
  const target = living.find(c => c.participantId === targetId) ?? living[0];

  function send(input: TreatmentInput) {
    if (!enabled || sending.current) return;
    sending.current = true; setBusy(true); setMessage("");
    onTreat(input, reply => {
      sending.current = false; setBusy(false);
      if (!reply) {
        setMessage("No llegó la confirmación. Reintenta el tratamiento pendiente o recarga; se conserva el mismo identificador para evitar duplicados.");
        return;
      }
      try { if (storedRequest(storageKey)?.requestId === input.requestId) sessionStorage.removeItem(storageKey); }
      catch { /* El servidor conserva el recibo. */ }
      setPending(null);
      setMessage(reply.ok ? "Tratamiento confirmado." : errors[reply.error] ?? "El servidor rechazó el tratamiento. Reconecta para comprobar la sesión.");
    });
  }
  useEffect(() => {
    const saved = storedRequest(storageKey);
    if (medic && enabled && saved) { setPending(saved); send(saved); }
  }, [enabled, medic, storageKey]);

  function treat() {
    if (!target || !enabled || busy || pending) return;
    const input: TreatmentInput = { requestId: crypto.randomUUID(), gameId: state.gameId, round: state.round, targetParticipantId: target.participantId };
    try { sessionStorage.setItem(storageKey, JSON.stringify(input)); }
    catch { setMessage("No se pudo guardar la solicitud pendiente. Habilita el almacenamiento de sesión antes de tratar."); return; }
    setPending(input); send(input);
  }

  return <section aria-label="Tratamientos médicos">
    <h3>Tratamientos médicos — ronda {state.round}</h3>
    <p>Unidades médicas disponibles: {state.inventory.medicalUnits}. Máximo una por personaje y ronda.</p>
    <ul>{state.characters.map(c => <li key={c.participantId}>{c.name}: {c.health} de salud.
      {c.eliminated ? " Eliminado definitivamente." : c.health === 0 ? " Fallecido." : treated.has(c.participantId) ? " Ya recibió tratamiento en esta ronda." : " Sin tratamiento en esta ronda."}
    </li>)}</ul>
    {medic && <>
      <label>Destinatario<select value={target?.participantId ?? ""} disabled={!enabled || busy || !!pending} onChange={event => setTargetId(event.target.value)}>
        {living.map(c => <option key={c.participantId} value={c.participantId}>{c.name} — {c.health} de salud{treated.has(c.participantId) ? " (ya tratado)" : ""}</option>)}
      </select></label>
      <button disabled={!enabled || busy || !!pending || !target || target.health >= 100 || treated.has(target.participantId) || state.inventory.medicalUnits === 0} onClick={treat}>Administrar tratamiento</button>
      {state.inventory.medicalUnits === 0 && <p>No quedan unidades médicas.</p>}
      {target && treated.has(target.participantId) && <p>El destinatario ya recibió su unidad médica en esta ronda.</p>}
      {target?.health === 100 && <p>Salud completa: regla pendiente de decisión. Por seguridad no se consume una unidad médica.</p>}
    </>}
    {medic && pending && <button disabled={!enabled || busy} onClick={() => send(pending)}>Reintentar tratamiento pendiente</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
