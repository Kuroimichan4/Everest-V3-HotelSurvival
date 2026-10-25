import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { ChatView } from '@everest/shared';
import { TeamChat } from './TeamChat';
import { bindGameSocket, type GameSocket } from './game-socket';
const view: ChatView = { code: 'ROOM', sequence: 2, nextRequestId: 2, canWrite: true, messages: [
  { id: 'one', sequence: 1, requestId: 1, sentAt: 1000, text: '<script>window.hacked=true</script>\nHola', sender: { kind: 'human', participantId: 'p', name: '<img src=x onerror=alert(1)>', role: 'maintenance' } },
  { id: 'two', sequence: 2, requestId: 1, sentAt: 1000, text: 'Segundo', sender: { kind: 'human', participantId: 'q', name: 'Compañero', role: 'medic' } }
] };
test('chat renders literal hostile text, canonical public labels, own styles and server order', () => {
  const html = renderToStaticMarkup(createElement(TeamChat, { view, participantId: 'p', connected: true, onSend: async () => null }));
  expect(html).toContain('Chat del equipo'); expect(html).toContain('Mantenimiento'); expect(html).toContain('Médico');
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  expect(html.match(/chat-message is-own/g)).toHaveLength(1); expect(html.indexOf('Hola')).toBeLessThan(html.indexOf('Segundo'));
  expect(html).toContain('maxLength="400"'); expect(html).toContain('Shift+Enter'); expect(html).toContain('aria-expanded="false"');
});
test.each([false, true])('read-only or disconnected history remains consultable; disconnected=%s', disconnected => {
  const html = renderToStaticMarkup(createElement(TeamChat, { view: { ...view, canWrite: false }, participantId: 'p', connected: !disconnected, onSend: async () => null }));
  expect(html).toContain('Segundo'); expect(html).toContain('<textarea maxLength="400" rows="3" disabled=""'); expect(html).toContain('<button disabled=""');
});
test('chat listener has exact cleanup across reconnect bindings and ignores obsolete callbacks', () => {
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  const socket = { on: (key: string, fn: (v: unknown) => void) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); },
    off: (key: string, fn: (v: unknown) => void) => { listeners.get(key)?.delete(fn); } } as unknown as GameSocket;
  const chat = vi.fn(); const dispatch = vi.fn(); const lifecycle = { chat, connect: vi.fn(), disconnect: vi.fn(), error: vi.fn(), participantId: () => 'p' };
  const unbind = bindGameSocket(socket, dispatch, lifecycle); const old = [...listeners.get('chat:updated')!][0]!;
  old(view); expect(chat).toHaveBeenCalledExactlyOnceWith(view); unbind(); old(view); expect(chat).toHaveBeenCalledTimes(1);
  const next = bindGameSocket(socket, dispatch, lifecycle); expect(listeners.get('chat:updated')!.size).toBe(1);
  [...listeners.get('disconnect')!][0]!({}); expect(chat).toHaveBeenLastCalledWith(null);
  next(); for (const set of listeners.values()) expect(set.size).toBe(0);
});
