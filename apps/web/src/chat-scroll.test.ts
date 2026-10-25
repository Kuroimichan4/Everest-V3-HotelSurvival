import { expect, test } from 'vitest';
import type { ChatView } from '@everest/shared';
import { ChatScroll } from './chat-scroll';
const view = (count: number): ChatView => ({ code: 'room', sequence: count, nextRequestId: 1, canWrite: true,
  messages: Array.from({ length: count }, (_, i) => ({ id: '' + i, sequence: i + 1, requestId: i + 1, sentAt: i, text: 'Mensaje', sender: { kind: 'human', participantId: 'other', name: 'Persona' } })) });
test('initial desktop history and restored history after F5 open at the bottom', () => {
  for (const scroll of [new ChatScroll(), new ChatScroll()]) expect(scroll.update(view(80), true, 'self')).toEqual({ scroll: true, unread: 0 });
});
test('mobile reopening always shows the end, including messages arriving while closed', () => {
  const s = new ChatScroll(); s.update(view(40), false, 'self'); s.update(view(41), false, 'self');
  expect(s.update(view(41), true, 'self')).toEqual({ scroll: true, unread: 0 });
  s.scrolled({ scrollHeight: 3000, scrollTop: 20, clientHeight: 200 }); s.update(view(41), false, 'self');
  expect(s.update(view(41), true, 'self').scroll).toBe(true);
});
test('a tall new message follows the pre-render bottom position', () => {
  const s = new ChatScroll(); s.update(view(30), true, 'self'); s.scrolled({ scrollHeight: 2000, scrollTop: 1800, clientHeight: 200 });
  expect(s.update(view(31), true, 'self')).toEqual({ scroll: true, unread: 0 });
});
test('reading older messages is not interrupted and snapshots cannot inflate the new-message indicator', () => {
  const s = new ChatScroll(); s.update(view(30), true, 'self'); s.scrolled({ scrollHeight: 2000, scrollTop: 300, clientHeight: 200 });
  expect(s.update(view(31), true, 'self')).toEqual({ scroll: false, unread: 1 });
  expect(s.update(view(31), true, 'self')).toEqual({ scroll: false, unread: 1 });
  expect(s.update(view(32), true, 'self')).toEqual({ scroll: false, unread: 2 });
  s.latest(); expect(s.update(view(32), true, 'self')).toEqual({ scroll: true, unread: 0 });
});
test('manually reaching bottom clears the indicator and resumes following', () => {
  const s = new ChatScroll(); s.update(view(30), true, 'self'); s.scrolled({ scrollHeight: 2000, scrollTop: 300, clientHeight: 200 }); s.update(view(31), true, 'self');
  expect(s.scrolled({ scrollHeight: 2200, scrollTop: 2000, clientHeight: 200 })).toBe(0); expect(s.update(view(32), true, 'self').scroll).toBe(true);
});
