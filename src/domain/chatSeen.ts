// "Seen by" on chat messages, Messenger style. Each member's last look at a chat is already kept for
// their unread count; a message counts as seen by everyone whose last look (or own post since) is at
// or after it. Who can read the chat, and blocks either way, are the database's call (chat_seen) and
// the demo's (seenReads in ../data/chat/demoChatActions).

import { formatAuDate } from './dates';
import { melbourneDate, melbourneTime } from './rides';
import type { ChatKind } from './chat';

/** Someone else who reads the chat, and when they last saw it (null: never opened it). */
export interface SeenRead {
  memberId: string;
  seenAt: string | null;
}

export interface SeenBy {
  /** Who has seen it, first to see it first. */
  seen: { memberId: string; at: string }[];
  /** Who reads the chat and hasn't seen it yet. */
  notYet: string[];
}

type MessageLike = { id: string; authorId: string; createdAt: string; removedAt: string | null };

const NAMED = 3;

export function seenBy(message: Pick<MessageLike, 'authorId' | 'createdAt'>, reads: SeenRead[]): SeenBy {
  const sent = Date.parse(message.createdAt);
  const seen: SeenBy['seen'] = [];
  const notYet: string[] = [];
  for (const r of reads) {
    if (r.memberId === message.authorId) continue;
    if (r.seenAt && Date.parse(r.seenAt) >= sent) seen.push({ memberId: r.memberId, at: r.seenAt });
    else notYet.push(r.memberId);
  }
  seen.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { seen, notYet };
}

/** When someone saw it: "2:05 pm" today, "Yesterday 2:05 pm", or "20/11/2026 2:05 pm". */
export function seenWhen(iso: string, today: string): string {
  const day = melbourneDate(iso);
  const time = melbourneTime(iso);
  if (day === today) return time;
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return `Yesterday ${time}`;
  return `${formatAuDate(day)} ${time}`;
}

/** The line under my newest message; null when nobody else reads the chat. */
export function seenLine(s: SeenBy, kind: ChatKind, nameOf: (id: string) => string, today: string): string | null {
  const total = s.seen.length + s.notYet.length;
  if (!total) return null;
  if (!s.seen.length) return 'Not seen yet';
  if (kind === 'direct') return `Seen ${seenWhen(s.seen[s.seen.length - 1].at, today)}`;
  if (!s.notYet.length) return 'Seen by everyone';
  if (s.seen.length > NAMED) return `Seen by ${s.seen.length} of ${total}`;
  const names = s.seen.map((r) => nameOf(r.memberId));
  return `Seen by ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}`;
}

/** My newest message that's still there: the one the Seen line goes under. */
export function lastOwnMessage<M extends MessageLike>(messages: M[], meId: string): M | undefined {
  let best: M | undefined;
  for (const m of messages) {
    if (m.authorId !== meId || m.removedAt) continue;
    if (!best || m.createdAt > best.createdAt) best = m;
  }
  return best;
}
