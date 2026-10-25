/** Un único recibo pendiente por operación y partida; compartido por las cuatro tarjetas. */
export class DirectResourceRequest<I extends { requestId: string; targetParticipantId: string }> {
  pending: I | null = null;
  sending = false;
  message = "";
  private confirmedSnapshot: string | null = null;
  constructor(readonly storageKey: string, validate: (value: unknown) => value is I,
    private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null) {
    try { const raw = storage?.getItem(storageKey); const value: unknown = raw ? JSON.parse(raw) : null; if (validate(value)) this.pending = value; } catch { /* Sin solicitud recuperable. */ }
  }
  blocked(snapshot: string) { return this.sending || this.pending !== null || this.confirmedSnapshot === snapshot; }
  begin(input: I, snapshot: string, send: (input: I, done: (reply: { ok: true } | { ok: false; error: string } | null) => void) => void, changed: () => void) {
    if (this.blocked(snapshot)) return false;
    try { if (!this.storage) throw new Error("storage"); this.storage.setItem(this.storageKey, JSON.stringify(input)); }
    catch { this.message = "No se pudo guardar la solicitud. Habilita el almacenamiento de sesión antes de administrar recursos."; changed(); return false; }
    this.pending = input;
    this.retry(snapshot, send, changed); return true;
  }
  retry(snapshot: string, send: (input: I, done: (reply: { ok: true } | { ok: false; error: string } | null) => void) => void, changed: () => void) {
    if (this.sending || !this.pending) return;
    const input = this.pending;
    this.sending = true; this.message = ""; changed();
    send(input, reply => {
      this.sending = false;
      if (!reply) { this.message = "Sin confirmación. Reintenta la solicitud pendiente o recarga; se conservará su identificador."; changed(); return; }
      try { const raw = this.storage?.getItem(this.storageKey); if (raw && (JSON.parse(raw) as { requestId?: string }).requestId === input.requestId) this.storage?.removeItem(this.storageKey); } catch { /* El servidor conserva el recibo. */ }
      this.pending = null;
      if (reply.ok) { this.confirmedSnapshot = snapshot; this.message = "Administración confirmada."; }
      else this.message = resourceReason(reply.error);
      changed();
    });
  }
}
export function resourceReason(reason: string | null | undefined) {
  const reasons: Record<string, string> = {
    "supplies-not-open": "Esta fase no permite administrar este recurso.", "no-packs": "No quedan packs disponibles.",
    "no-medical-units": "No quedan unidades médicas.", "energy-full": "El personaje ya tiene la energía completa.",
    "health-full-pending": "El personaje tiene la salud completa.", "treatment-used": "Este paciente ya recibió un botiquín en esta ronda.",
    "character-dead": "No se pueden administrar recursos a personajes fallecidos o abandonados.",
    "not-authorized": "Tu personaje no está autorizado para esta acción.", "wrong-round": "La solicitud pertenece a otra ronda.",
  };
  return reasons[reason ?? ""] ?? "El servidor no permite esta acción en el estado actual.";
}
