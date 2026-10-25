import type { ChatMessage, ChatReply, ChatInput } from '@everest/shared';
import { newId } from './identity.js';

/** Bounded room history. Monotonic per-identity requests also reject evicted retries. */
export class RoomChat {
  readonly messages: ChatMessage[] = [];
  private readonly requests = new Map<string, { last: number; at: number }>();
  sequence = 0;
  nextRequest(id: string) { return (this.requests.get(id)?.last ?? 0) + 1; }
  send(input: unknown, sender: Extract<ChatMessage['sender'], { kind: 'human' }>, now: number, writable: boolean): ChatReply {
    if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'requestId,text') return { ok: false, error: 'invalid-input' };
    const { requestId, text } = input as ChatInput;
    if (!Number.isSafeInteger(requestId) || requestId < 1 || typeof text !== 'string') return { ok: false, error: 'invalid-input' };
    const cleaned = text.trim();
    if (!cleaned || cleaned.length > 400) return { ok: false, error: 'invalid-text' };
    if (!writable) return { ok: false, error: 'read-only' };
    const previous = this.requests.get(sender.participantId);
    if (previous && requestId <= previous.last) {
      const receipt = this.messages.find(m => m.sender.kind === 'human' && m.sender.participantId === sender.participantId && m.requestId === requestId);
      return receipt?.text === cleaned ? { ok: true, messageId: receipt.id } : { ok: false, error: 'stale-request' };
    }
    if (previous && now - previous.at < 1000) return { ok: false, error: 'rate-limited' };
    const message: ChatMessage = { id: newId(), sequence: ++this.sequence, requestId, sentAt: now, text: cleaned, sender: { ...sender } };
    this.messages.push(message);
    if (this.messages.length > 150) this.messages.shift();
    this.requests.set(sender.participantId, { last: requestId, at: now });
    return { ok: true, messageId: message.id };
  }
}
