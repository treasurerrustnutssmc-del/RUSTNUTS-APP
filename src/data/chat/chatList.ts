// The chat list, photo feed and ride walls worked out from the chats in memory, the same way the
// database's chat_list, club_photos, ride_walls and ride_wall work them out. The demo uses these;
// the live app gets the same shapes from the database and sorts them with sortSummaries.

import { approvalProblem, chatTitle, readProblem, rideChatListed, type Block, type Message } from '../../domain/chat';
import type { ClubData, Member } from '../../domain/types';
import { NotAllowedError } from '../clubContext';
import type { ChatSummary, FeedItem, RideWall } from './chatContext';
import type { ChatData } from './demoChatActions';

const KIND_ORDER = ['club', 'chapter', 'board', 'nec', 'committee', 'ride', 'direct'];

/** The whole club first, then chapter, big table, NEC and committee chats, ride chats by when the
 *  ride starts, and private chats with the latest message first. */
export function sortSummaries(list: ChatSummary[]): ChatSummary[] {
  const rank = (s: ChatSummary) => KIND_ORDER.indexOf(s.conversation.kind);
  return [...list].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.conversation.kind === 'ride') return (a.ride?.startsAt ?? '').localeCompare(b.ride?.startsAt ?? '');
    if (a.conversation.kind === 'direct') return (b.last?.createdAt ?? '').localeCompare(a.last?.createdAt ?? '');
    return a.title.localeCompare(b.title);
  });
}

/** Messages, leaving out anyone `me` has blocked. */
export function withoutBlocked(messages: Message[], blocks: Block[], me: string | null): Message[] {
  const hidden = new Set(blocks.filter((b) => b.blockerId === me).map((b) => b.blockedId));
  return hidden.size ? messages.filter((m) => !hidden.has(m.authorId)) : messages;
}

export function listFor(chat: ChatData, club: ClubData, me: Member | null, today: string): ChatSummary[] {
  if (!me || approvalProblem(me)) return [];
  const mine = withoutBlocked(chat.messages, chat.blocks, me.id);
  const list = chat.conversations
    .filter((c) => !readProblem(me, c, club))
    .flatMap((c): ChatSummary[] => {
      const ride = c.rideId ? club.rides.find((r) => r.id === c.rideId) ?? null : null;
      if (c.kind === 'ride') {
        const answer = club.rsvps.find((a) => a.rideId === c.rideId && a.memberId === me.id)?.answer ?? null;
        if (!ride || !rideChatListed(ride, answer, today)) return [];
      }
      const here = mine.filter((m) => m.conversationId === c.id);
      const newest = here.reduce<Message | null>((best, m) => (!best || m.createdAt > best.createdAt ? m : best), null);
      const readAt = chat.reads.find((r) => r.conversationId === c.id && r.memberId === me.id)?.readAt ?? '';
      return [{
        conversation: c,
        title: chatTitle(c, me, club, ride),
        ride,
        last: newest && {
          id: newest.id, authorId: newest.authorId, body: newest.body, createdAt: newest.createdAt,
          removed: !!newest.removedAt, mediaCount: newest.media.length,
        },
        unread: here.filter((m) => m.authorId !== me.id && !m.removedAt && m.createdAt > readAt).length,
      }];
    });
  return sortSummaries(list);
}

const newestFirst = (a: Message, b: Message) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

function itemsOf(m: Message): FeedItem[] {
  return [...m.media]
    .filter((x) => x.kind !== 'gif')
    .sort((a, b) => a.position - b.position)
    .map((x) => ({ ...x, conversationId: m.conversationId, authorId: m.authorId, createdAt: m.createdAt }));
}

/** Photos and videos `me` can see in every chat but private ones, newest first, a page of about
 *  `limit` items that never splits a message. */
export function feedFrom(chat: ChatData, club: ClubData, me: Member | null, before?: string, limit = 60): FeedItem[] {
  if (!me || approvalProblem(me)) return [];
  const readable = new Set(chat.conversations.filter((c) => c.kind !== 'direct' && !readProblem(me, c, club)).map((c) => c.id));
  const page: FeedItem[] = [];
  for (const m of withoutBlocked(chat.messages, chat.blocks, me.id).sort(newestFirst)) {
    if (!readable.has(m.conversationId) || m.removedAt || (before && m.createdAt >= before)) continue;
    const items = itemsOf(m);
    if (!items.length) continue;
    if (page.length >= Math.min(Math.max(limit, 1), 200)) break;
    page.push(...items);
  }
  return page;
}

function wallItems(chat: ChatData, me: Member, chatId: string): FeedItem[] {
  return withoutBlocked(chat.messages, chat.blocks, me.id)
    .filter((m) => m.conversationId === chatId && !m.removedAt)
    .sort(newestFirst)
    .flatMap(itemsOf);
}

export function rideWallsFrom(chat: ChatData, club: ClubData, me: Member | null): RideWall[] {
  if (!me || approvalProblem(me)) return [];
  return chat.conversations
    .filter((c) => c.kind === 'ride')
    .flatMap((c): RideWall[] => {
      const ride = club.rides.find((r) => r.id === c.rideId);
      const media = wallItems(chat, me, c.id);
      return ride && media.length ? [{ ride, chatId: c.id, count: media.length, cover: media[0] }] : [];
    })
    .sort((a, b) => b.ride.startsAt.localeCompare(a.ride.startsAt));
}

export function rideWallFrom(chat: ChatData, club: ClubData, me: Member | null, rideId: string) {
  const cant = approvalProblem(me);
  if (cant || !me) throw new NotAllowedError(cant ?? 'Sign in first.');
  const ride = club.rides.find((r) => r.id === rideId);
  if (!ride) throw new NotAllowedError('No such ride.');
  const conv = chat.conversations.find((c) => c.kind === 'ride' && c.rideId === rideId);
  return { ride, chatId: conv?.id ?? `ride:${rideId}`, media: conv ? wallItems(chat, me, conv.id) : [] };
}
