import type { ChatView } from '@everest/shared';
/** Keeps the reader's intent from the scroll event, before new DOM nodes change height. */
export class ChatScroll {
  private last: number | null = null;
  private visible = false;
  private following = true;
  unread = 0;
  scrolled(box: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
    this.following = box.scrollHeight - box.scrollTop - box.clientHeight <= 48;
    if (this.following) this.unread = 0;
    return this.unread;
  }
  latest() { this.following = true; this.unread = 0; }
  update(view: ChatView, visible: boolean, participantId: string) {
    const additions = this.last === null ? 0 : view.messages.filter(m => m.sequence > this.last! && (m.sender.kind === 'server' || m.sender.participantId !== participantId)).length;
    const scroll = visible && (!this.visible || this.following || this.last === null);
    if (scroll) this.latest(); else this.unread += additions;
    this.last = view.sequence; this.visible = visible;
    return { scroll, unread: this.unread };
  }
}
