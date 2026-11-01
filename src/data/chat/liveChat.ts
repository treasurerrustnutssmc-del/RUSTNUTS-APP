// Turns the database's chat rows and JSON (snake_case) into the app's records (camelCase), and
// merges pages of messages as they arrive. Pure, so it's tested without a database.

import type { ChatCommittee, ChatKind, Conversation, MediaKind, Message, MessageMedia } from '../../domain/chat';
import type { Ride, RideCategory } from '../../domain/types';
import type { ChatSummary, FeedItem, ReportView } from './chatContext';

/** Postgres timestamps ("2026-11-07T21:30:00+00:00") as the app's ISO instants. */
const instant = (ts: string) => new Date(ts).toISOString();

export interface MediaRow {
  id: string;
  message_id: string;
  kind: MediaKind;
  path: string;
  poster_path: string | null;
  width: number;
  height: number;
  duration_ms: number | null;
  position: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string | null;
  reply_to_id: string | null;
  created_at: string;
  removed_at: string | null;
  message_media: MediaRow[];
  message_reactions: { message_id: string; member_id: string; emoji: string }[];
}

export interface RideJson {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  category: RideCategory;
  cancelled_at: string | null;
  source?: 'feed' | 'app';
  website?: boolean;
}

export interface ChatJson {
  id: string;
  kind: ChatKind;
  chapter_id: string | null;
  ride_id: string | null;
  committee: ChatCommittee | null;
  pinned_message_id?: string | null;
  member_ids?: string[];
}

export interface ChatListJson extends ChatJson {
  ride: RideJson | null;
  // voice: from the voice notes paste on; before it, there are none.
  last: { id: string; author_id: string; body: string | null; created_at: string; removed: boolean; media_count: number; voice?: boolean } | null;
  unread: number;
}

export interface FeedJson extends MediaRow {
  conversation_id: string;
  author_id: string;
  created_at: string;
}

export interface ReportJson {
  id: string;
  reason: string | null;
  created_at: string;
  reporter_id: string;
  message: {
    id: string; conversation_id: string; author_id: string; body: string | null; media_count: number; created_at: string;
    voice?: { path: string; duration_ms: number | null } | null;
  };
  chat: ChatJson;
}

function toMedia(r: MediaRow): MessageMedia {
  return {
    id: r.id, messageId: r.message_id, kind: r.kind, path: r.path, posterPath: r.poster_path,
    width: r.width, height: r.height, durationMs: r.duration_ms, position: r.position,
  };
}

export function toMessage(r: MessageRow): Message {
  const removed = !!r.removed_at;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    authorId: r.author_id,
    body: removed ? null : r.body,
    createdAt: instant(r.created_at),
    removedAt: r.removed_at ? instant(r.removed_at) : null,
    replyToId: r.reply_to_id,
    media: removed ? [] : [...r.message_media].sort((a, b) => a.position - b.position).map(toMedia),
    reactions: removed ? [] : r.message_reactions.map((x) => ({ messageId: x.message_id, memberId: x.member_id, emoji: x.emoji })),
  };
}

export function toRide(r: RideJson): Ride {
  return {
    id: r.id, title: r.title, startsAt: instant(r.starts_at), endsAt: r.ends_at ? instant(r.ends_at) : null,
    allDay: r.all_day, location: r.location, notes: r.notes, category: r.category,
    cancelledAt: r.cancelled_at ? instant(r.cancelled_at) : null,
    // The chat feed carries the ride columns only; the source and website switch aren't needed there.
    source: r.source ?? 'feed', website: r.website ?? true,
  };
}

export function toConversation(c: ChatJson): Conversation {
  return {
    id: c.id, kind: c.kind, chapterId: c.chapter_id, rideId: c.ride_id, committee: c.committee,
    pinnedMessageId: c.pinned_message_id ?? null, memberIds: c.member_ids ?? [],
  };
}

/** Everything in a chat-list entry but its title, which needs the club data to work out. */
export function toSummaryParts(c: ChatListJson): Omit<ChatSummary, 'title'> {
  return {
    conversation: toConversation(c),
    ride: c.ride ? toRide(c.ride) : null,
    last: c.last && {
      id: c.last.id, authorId: c.last.author_id, body: c.last.body, createdAt: instant(c.last.created_at),
      removed: c.last.removed, mediaCount: c.last.media_count, voice: c.last.voice === true,
    },
    unread: c.unread,
  };
}

export function toFeedItem(f: FeedJson): FeedItem {
  return { ...toMedia(f), conversationId: f.conversation_id, authorId: f.author_id, createdAt: instant(f.created_at) };
}

export function toReport(r: ReportJson): ReportView {
  return {
    id: r.id,
    reason: r.reason,
    createdAt: instant(r.created_at),
    reporterId: r.reporter_id,
    message: {
      id: r.message.id, conversationId: r.message.conversation_id, authorId: r.message.author_id, body: r.message.body,
      mediaCount: r.message.media_count, createdAt: instant(r.message.created_at),
      voice: r.message.voice ? { path: r.message.voice.path, durationMs: r.message.voice.duration_ms } : null,
    },
    conversation: toConversation(r.chat),
  };
}

/** One copy of each message (the incoming copy wins), oldest first. */
export function mergeMessages(have: Message[], incoming: Message[]): Message[] {
  const byId = new Map(have.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** The files of messages that were there in `have` and come back removed, so any addresses handed
 *  out for them can be thrown away. */
export function goneMedia(have: Message[], incoming: Message[]): string[] {
  const removed = new Set(incoming.filter((m) => m.removedAt).map((m) => m.id));
  return have
    .filter((m) => removed.has(m.id) && !m.removedAt)
    .flatMap((m) => m.media.flatMap((x) => (x.posterPath ? [x.path, x.posterPath] : [x.path])));
}

const ENDINGS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'audio/mp4': 'm4a', 'audio/webm': 'webm',
};

/** What a voice note goes up as: phones and Safari record AAC (.m4a), Chrome and Firefox WebM. Null for
 *  anything else, which the club's storage won't take. */
export function voiceUploadType(r: { uri: string; mimeType: string | null }): 'audio/mp4' | 'audio/webm' | null {
  const type = r.mimeType?.split(';')[0].trim().toLowerCase();
  if (type === 'audio/mp4' || type === 'audio/x-m4a' || type === 'audio/aac') return 'audio/mp4';
  if (type === 'audio/webm') return 'audio/webm';
  if (!type && /\.m4a$/i.test(r.uri)) return 'audio/mp4';
  return null;
}

/** Where an upload goes in the chat-media bucket: the chat's folder, a fresh random name. */
export function uploadName(chatId: string, contentType: string): string {
  let hex = '';
  for (let i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
  return `${chatId}/${hex}.${ENDINGS[contentType] ?? 'bin'}`;
}
