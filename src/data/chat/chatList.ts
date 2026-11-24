// The chat list, photo feed and ride walls worked out from the chats in memory, the same way the
// database's chat_list, club_photos, ride_walls and ride_wall work them out. The demo uses these;
// the live app gets the same shapes from the database and sorts them with sortSummaries.

import type { GalleryItem } from '../../domain/gallery';
import { approvalProblem, chatTitle, memberProblem, readProblem, rideChatListed, type Block, type Message } from '../../domain/chat';
import type { ClubData, Member } from '../../domain/types';
import { NotAllowedError } from '../clubContext';
import type { ChatSummary, FeedItem, RideWall } from './chatContext';
import type { ChatData } from './demoChatActions';

const KIND_ORDER = ['club', 'family', 'chapter', 'board', 'boards', 'nec', 'committee', 'ride', 'group', 'direct'];

/** The whole club first, then Family, chapter, big table, All boards, NEC and committee chats, ride chats
 *  by when the ride starts, then groups and private chats with the latest message first. */
export function sortSummaries(list: ChatSummary[]): ChatSummary[] {
  const rank = (s: ChatSummary) => KIND_ORDER.indexOf(s.conversation.kind);
  return [...list].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.conversation.kind === 'ride') return (a.ride?.startsAt ?? '').localeCompare(b.ride?.startsAt ?? '');
    if (a.conversation.kind === 'direct' || a.conversation.kind === 'group') {
      return (b.last?.createdAt ?? '').localeCompare(a.last?.createdAt ?? '');
    }
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
      // Writing in a chat counts as having read everything before it.
      const readAt = here.reduce(
        (latest, m) => (m.authorId === me.id && m.createdAt > latest ? m.createdAt : latest),
        chat.reads.find((r) => r.conversationId === c.id && r.memberId === me.id)?.readAt ?? '',
      );
      return [{
        conversation: c,
        title: chatTitle(c, me, club, ride),
        ride,
        last: newest && {
          id: newest.id, authorId: newest.authorId, body: newest.body, createdAt: newest.createdAt,
          removed: !!newest.removedAt, mediaCount: newest.media.length,
          voice: !newest.removedAt && newest.media.some((x) => x.kind === 'voice'),
        },
        unread: here.filter((m) => m.authorId !== me.id && !m.removedAt && m.createdAt > readAt).length,
      }];
    });
  return sortSummaries(list);
}

const newestFirst = (a: Message, b: Message) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

function itemsOf(m: Message): FeedItem[] {
  return [...m.media]
    .filter((x) => x.kind === 'photo' || x.kind === 'video')
    .sort((a, b) => a.position - b.position)
    .map((x) => ({ ...x, conversationId: m.conversationId, authorId: m.authorId, createdAt: m.createdAt }));
}

/** A gallery item as the feeds show it. */
export const galleryFeedItem = (g: GalleryItem): FeedItem => ({
  id: g.id, messageId: '', kind: g.kind, path: g.path, posterPath: g.posterPath, width: g.width, height: g.height,
  durationMs: g.durationMs, position: 0, conversationId: null, authorId: g.uploadedBy ?? '', createdAt: g.createdAt,
  gallery: { rideId: g.rideId, caption: g.caption },
});

const blockedIds = (chat: ChatData, meId: string) => new Set(chat.blocks.filter((b) => b.blockerId === meId).map((b) => b.blockedId));

/** The gallery items `me` sees: not taken down, not from someone they blocked. */
function galleryFor(chat: ChatData, me: Member): GalleryItem[] {
  const blocked = blockedIds(chat, me.id);
  return (chat.gallery ?? []).filter((g) => !g.removedAt && !(g.uploadedBy && blocked.has(g.uploadedBy)));
}

/** Photos and videos `me` can see in every chat but private ones and in the gallery, newest
 *  first, a page of about `limit` items that never splits a message. Mirrors club_photos. */
export function feedFrom(chat: ChatData, club: ClubData, me: Member | null, before?: string, limit = 60): FeedItem[] {
  if (!me || memberProblem(me)) return [];
  const readable = new Set(chat.conversations.filter((c) => c.kind !== 'direct' && !readProblem(me, c, club)).map((c) => c.id));
  const groups: { id: string; createdAt: string; items: FeedItem[] }[] = [];
  for (const m of withoutBlocked(chat.messages, chat.blocks, me.id)) {
    if (!readable.has(m.conversationId) || m.removedAt || (before && m.createdAt >= before)) continue;
    const items = itemsOf(m);
    if (items.length) groups.push({ id: m.id, createdAt: m.createdAt, items });
  }
  for (const g of galleryFor(chat, me)) {
    if (before && g.createdAt >= before) continue;
    groups.push({ id: g.id, createdAt: g.createdAt, items: [galleryFeedItem(g)] });
  }
  groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const page: FeedItem[] = [];
  for (const g of groups) {
    if (page.length >= Math.min(Math.max(limit, 1), 200)) break;
    page.push(...g.items);
  }
  return page;
}

function wallItems(chat: ChatData, me: Member, chatId: string): FeedItem[] {
  return withoutBlocked(chat.messages, chat.blocks, me.id)
    .filter((m) => m.conversationId === chatId && !m.removedAt)
    .sort(newestFirst)
    .flatMap(itemsOf);
}

function rideItems(chat: ChatData, me: Member, rideId: string): { chatId: string | null; media: FeedItem[] } {
  const conv = chat.conversations.find((c) => c.kind === 'ride' && c.rideId === rideId);
  const media = [
    ...(conv ? wallItems(chat, me, conv.id) : []),
    ...galleryFor(chat, me).filter((g) => g.rideId === rideId).map(galleryFeedItem),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.position - b.position);
  return { chatId: conv?.id ?? null, media };
}

export function rideWallsFrom(chat: ChatData, club: ClubData, me: Member | null): RideWall[] {
  if (!me || memberProblem(me)) return [];
  const rideIds = new Set([
    ...chat.conversations.filter((c) => c.kind === 'ride' && c.rideId).map((c) => c.rideId as string),
    ...(chat.gallery ?? []).flatMap((g) => (g.rideId ? [g.rideId] : [])),
  ]);
  return [...rideIds]
    .flatMap((rideId): RideWall[] => {
      const ride = club.rides.find((r) => r.id === rideId);
      const { chatId, media } = rideItems(chat, me, rideId);
      return ride && media.length ? [{ ride, chatId, count: media.length, cover: media[0] }] : [];
    })
    .sort((a, b) => b.ride.startsAt.localeCompare(a.ride.startsAt));
}

export function rideWallFrom(chat: ChatData, club: ClubData, me: Member | null, rideId: string) {
  const cant = memberProblem(me);
  if (cant || !me) throw new NotAllowedError(cant ?? 'Sign in first.');
  const ride = club.rides.find((r) => r.id === rideId);
  if (!ride) throw new NotAllowedError('No such ride.');
  return { ride, ...rideItems(chat, me, rideId) };
}
