import { useEffect, useRef, useState } from 'react';
import type { ChatInput, ChatReply, ChatView } from '@everest/shared';
import { finalRoles } from './FinalResults';

const errors = { 'invalid-session': 'Reconecta para recuperar el chat.', 'invalid-input': 'El mensaje no es válido.',
  'invalid-text': 'Escribe entre 1 y 400 caracteres.', 'read-only': 'El chat está en modo de solo lectura.',
  'stale-request': 'El envío ya fue procesado o ha caducado. Revisa el historial.', 'rate-limited': 'Espera un segundo antes de enviar otro mensaje.' };
export function TeamChat({ view, participantId, connected, onSend }: {
  view: ChatView | null; participantId: string; connected: boolean;
  onSend: (input: ChatInput) => Promise<ChatReply | null>;
}) {
  const [open, setOpen] = useState(false); const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false); const last = useRef<number | null>(null); const history = useRef<HTMLDivElement>(null);
  const retry = useRef<ChatInput | null>(null);
  useEffect(() => {
    if (!view) return;
    const visible = history.current?.offsetParent !== null;
    if (last.current !== null && !visible) setUnread(n => n + view.messages.filter(m => m.sequence > last.current! && m.sender.kind === 'human' && m.sender.participantId !== participantId).length);
    if (visible) setUnread(0);
    const initial = last.current === null;
    last.current = view.sequence;
    const box = history.current;
    if (box && (initial || box.scrollHeight - box.scrollTop - box.clientHeight < 100)) box.scrollTop = box.scrollHeight;
  }, [view, open, participantId]);
  async function send() {
    if (lock.current || !view?.canWrite || !connected || !draft.trim()) return;
    const input = retry.current?.text === draft ? retry.current : { requestId: view.nextRequestId, text: draft };
    retry.current = input; lock.current = true; setBusy(true); setError('');
    try {
      const reply = await onSend(input);
      if (!reply) setError('Sin confirmación. Reintenta el mismo mensaje; no se duplicará si ya llegó.');
      else if (reply.ok) { retry.current = null; setDraft(''); }
      else { retry.current = null; setError(errors[reply.error]); }
    } finally { lock.current = false; setBusy(false); }
  }
  return <aside className={`panel chat-panel ${open ? 'is-open' : ''}`} aria-label="Chat del equipo">
    <div className="section-heading"><h2>Chat del equipo</h2><button type="button" className="secondary chat-toggle" aria-expanded={open} aria-controls="team-chat-content"
      onClick={() => { setOpen(v => !v); setUnread(0); }}>{open ? 'Cerrar chat' : `Abrir chat${unread ? ` (${unread} nuevos)` : ''}`}</button></div>
    <div className="chat-content" id="team-chat-content">
      <a className="chat-vote-link" href="#current-action">Ir a la decisión actual</a>
      <div className="chat-history" ref={history} role="log" aria-label="Mensajes del equipo" aria-live="polite" aria-relevant="additions">
        {!view?.messages.length && <p className="muted">Todavía no hay mensajes.</p>}
        {view?.messages.map(message => <article key={message.id} className={`chat-message ${message.sender.kind === 'human' && message.sender.participantId === participantId ? 'is-own' : ''}`}>
          <p className="chat-sender"><strong>{message.sender.name}</strong>{message.sender.kind === 'human' && message.sender.role ? ` · ${finalRoles[message.sender.role]}` : ''}</p>
          <p className="chat-text">{message.text}</p>
        </article>)}
      </div>
      <form onSubmit={e => { e.preventDefault(); void send(); }}>
        <label>Mensaje al equipo<textarea value={draft} maxLength={400} rows={3} disabled={!connected || !view?.canWrite || busy}
          onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /></label>
        <div className="chat-send"><span className="muted">{draft.length}/400</span><button disabled={!connected || !view?.canWrite || busy || !draft.trim()}>{busy ? 'Enviando…' : 'Enviar'}</button></div>
      </form>
      <p className="muted">{!connected ? 'Reconectando…' : !view?.canWrite ? 'Solo lectura.' : 'Enter envía · Shift+Enter añade una línea.'}</p>
      {error && <p role="alert">{error}</p>}
    </div>
  </aside>;
}
