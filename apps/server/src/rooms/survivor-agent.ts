import type { VotingClock } from './voting.js';

export interface SurvivorContext {
  encounterId: string; round: 1 | 2 | 6; situation: 'trapped' | 'walking-assisted' | 'immobile';
  vote: { decisionId: string; attemptId: string; attempt: 1 | 2; openedAt: number; deadline: number };
}
export interface SurvivorPrompt extends SurvivorContext { slot: number; secondsRemaining: number; previousMessages: string[] }
export type SurvivorResponse = { action: 'advise' | 'warn' | 'summarize'; text: string } | { action: 'none' };
export interface SurvivorAdapter { readonly mode: string; respond(prompt: Readonly<SurvivorPrompt>): unknown | Promise<unknown> }
export const demonstrationAdapter: SurvivorAdapter = { mode: 'demonstration', respond: c => {
  const introductions = {
    1: '¡Por favor, no os vayáis! Estoy atrapado en esta planta y no puedo salir por mis propios medios. Os oigo ahí fuera… ¿podéis ayudarme?',
    2: '¡Aquí, sigo aquí! Pensaba que nadie más llegaría a este pasillo. No puedo salir solo. Por favor, no me dejéis atrás.',
    6: c.situation === 'immobile' ? '¡Ayudadme, por favor! No puedo moverme. Oigo que estáis cerca de la salida; no quiero quedarme aquí solo.' : '¡Esperad! Puedo caminar si alguien me ayuda. Tengo miedo de caerme y quedarme atrás. Por favor, dejadme salir con vosotros.',
  };
  const first = [introductions[c.round],
    c.situation === 'walking-assisted' ? 'Sé que vosotros también tenéis miedo. Si me ayudáis a mantenerme en pie intentaré seguir vuestro paso. Solo os pido que no os olvidéis de mí.' : 'Sé que rescatarme os exige un esfuerzo. También tengo miedo, pero sigo aquí, esperando. Por favor, habladlo entre vosotros antes de marcharos.',
    'Cada ruido me hace pensar que voy a quedarme aquí para siempre. Todavía os escucho… por favor, decidid ayudarme antes de que sea demasiado tarde.'];
  const second = ['¿No os habéis puesto de acuerdo? Por favor, sigo esperando. No me dejéis solo ahora que sé que hay alguien al otro lado.',
    '¡Por favor, decididlo ya! Me cuesta seguir esperando sin saber si volveréis por mí. Quiero salir de aquí con vosotros. No os vayáis sin responderme.'];
  return { action: c.vote.attempt === 2 || c.slot === 2 ? 'warn' : 'advise', text: (c.vote.attempt === 1 ? first : second)[c.slot] };
} };
export function validateSurvivorResponse(input: unknown): SurvivorResponse | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  if (v.action === 'none') return Object.keys(v).join(',') === 'action' ? { action: 'none' } : null;
  if (!['warn', 'advise', 'summarize'].includes(String(v.action)) || Object.keys(v).sort().join(',') !== 'action,text' || typeof v.text !== 'string') return null;
  const text = v.text.trim();
  if (!text || text.length > 400 || /[<>\d]|https?:|sabot|envenen|poison|EXTREMO|MODERADO|riskCategory|actorId|objetivo individual/i.test(text)) return null;
  return { action: v.action as 'warn' | 'advise' | 'summarize', text };
}
const key = (c: SurvivorContext) => `${c.encounterId}:${c.vote.decisionId}:${c.vote.attemptId}`;
/** Reuses the agent pipeline with server-authoritative timing and NPC-only context. */
export class SurvivorAgent {
  private current: string | null = null;
  private readonly seen = new Set<string>();
  private readonly spoken = new Map<string, string[]>();
  private cancels: (() => void)[] = [];
  private disposed = false;
  constructor(private readonly adapter: SurvivorAdapter, private readonly clock: VotingClock,
    private readonly timings: readonly (readonly number[])[] = [[0, 20000, 40000], [0, 15000]], private readonly maxDelayMs = 5000) {}
  private cancel() { this.cancels.splice(0).forEach(cancel => cancel()); this.current = null; }
  dispose() { this.disposed = true; this.cancel(); }
  observe(read: () => SurvivorContext | null, publish: (text: string, context: SurvivorContext) => void) {
    const context = read(); const identity = context ? key(context) : null;
    if (this.disposed || identity === this.current) return;
    this.cancel(); if (!context) return; this.current = identity;
    for (const [slot, offset] of (this.timings[context.vote.attempt - 1] ?? []).entries()) {
      const due = context.vote.openedAt + offset; const eventId = `${identity}:${slot}`;
      const run = () => {
        const current = read(); const now = this.clock.now();
        if (this.disposed || !current || key(current) !== identity || now >= current.vote.deadline || now - due > this.maxDelayMs || this.seen.has(eventId)) return;
        this.seen.add(eventId);
        const prompt: SurvivorPrompt = { ...structuredClone(current), slot, secondsRemaining: Math.ceil((current.vote.deadline - now) / 1000), previousMessages: [...(this.spoken.get(current.encounterId) ?? [])] };
        try {
          const deliver = (output: unknown) => {
            const latest = read();
            if (this.disposed || !latest || key(latest) !== identity || this.clock.now() >= latest.vote.deadline || this.clock.now() - now > this.maxDelayMs) return;
            const response = validateSurvivorResponse(output); if (!response || response.action === 'none') return;
            const history = this.spoken.get(current.encounterId) ?? []; history.push(response.text); this.spoken.set(current.encounterId, history);
            publish(response.text, current);
          };
          const output = this.adapter.respond(prompt);
          if (output instanceof Promise) void output.then(deliver).catch(() => {}); else deliver(output);
        } catch { /* Generation cannot block voting. */ }
      };
      if (due <= this.clock.now()) run(); else this.cancels.push(this.clock.schedule(run, due - this.clock.now()));
    }
  }
}
