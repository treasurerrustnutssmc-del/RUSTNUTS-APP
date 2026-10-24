// Club chats: the whole club, each chapter, each ride, and private chats between two members.
// Who can read, post, remove and react. The database's chat actions apply the same rules with
// the same words (supabase/migrations/20261101000000_chat.sql).

import { accessLevel, isBoardOf, isNational } from './access';
import { daysBetween, formatAuDate } from './dates';
import { displayName } from './profile';
import { lastDay, melbourneDate } from './rides';
import type { ClubData, Member, Ride, RsvpAnswer } from './types';

export type ChatKind = 'club' | 'chapter' | 'ride' | 'direct';
export type MediaKind = 'photo' | 'video';

export interface Conversation {
  id: string;
  kind: ChatKind;
  chapterId: string | null; // chapter chats
  rideId: string | null; // ride chats
  memberIds: string[]; // private chats: the two people in it
}

export interface MessageMedia {
  id: string;
  messageId: string;
  kind: MediaKind;
  /** Where the file sits in the chat-media bucket (or a local address in the demo). */
  path: string;
  /** A video's still. */
  posterPath: string | null;
  width: number;
  height: number;
  durationMs: number | null;
  position: number;
}

export interface Reaction {
  messageId: string;
  memberId: string;
  emoji: string;
}

export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  body: string | null;
  createdAt: string;
  removedAt: string | null;
  media: MessageMedia[];
  reactions: Reaction[];
}

/** A photo or video picked on the phone, before it's uploaded. */
export interface PickedMedia {
  uri: string;
  kind: MediaKind;
  width: number;
  height: number;
  durationMs: number | null;
  fileSize: number | null;
  mimeType: string | null;
}

export const REACTIONS = ['👍', '❤️', '😂', '🔥', '🍺', '😮'] as const;
export const MAX_BODY = 4000;
export const MAX_MEDIA = 10;
export const MAX_VIDEO_MS = 60_000;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Messages from one person closer together than this sit in one run. */
const RUN_GAP_MS = 5 * 60_000;

function isApproved(me: Member | null): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  return null;
}

/** Why `me` can't read this chat, or null when they can. Mirrors private.chat_problem. */
export function readProblem(me: Member | null, conv: Conversation | undefined, data: ClubData): string | null {
  const notApproved = isApproved(me);
  if (notApproved || !me) return notApproved;
  if (!conv) return 'No such chat.';
  if (conv.kind === 'chapter') {
    if (me.chapterId === conv.chapterId || isNational(me.id, data.positions)) return null;
    const name = data.chapters.find((c) => c.id === conv.chapterId)?.name ?? 'that';
    return `That chat is for ${name} chapter members.`;
  }
  if (conv.kind === 'direct') return conv.memberIds.includes(me.id) ? null : 'That’s a private chat.';
  return null;
}

/** Why `me` can't send this message here, or null. Mirrors public.send_message. */
export function postProblem(
  me: Member | null,
  conv: Conversation | undefined,
  body: string,
  mediaCount: number,
  data: ClubData,
): string | null {
  const cant = readProblem(me, conv, data);
  if (cant) return cant;
  if (!body.trim() && mediaCount === 0) return 'Write something or add a photo.';
  if (body.length > MAX_BODY) return 'Keep it under 4,000 characters.';
  if (mediaCount > MAX_MEDIA) return 'Up to 10 photos or videos at a time.';
  return null;
}

/** Can tidy other people's messages: a chapter's board in its chat, any board member or the NEC in
 *  the whole-club and ride chats. Nobody moderates a private chat. */
export function canModerate(me: Member | null, conv: Conversation, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (conv.kind === 'chapter') return !!conv.chapterId && isBoardOf(me, conv.chapterId, data.positions);
  if (conv.kind === 'direct') return false;
  const level = accessLevel(me, data.positions);
  return level === 'board' || level === 'national';
}

function messageProblem(message: Message | undefined): string | null {
  if (!message) return 'No such message.';
  if (message.removedAt) return 'That message was removed.';
  return null;
}

/** Why `me` can't remove this message, or null. Mirrors public.remove_message. */
export function removeProblem(
  me: Member | null,
  conv: Conversation | undefined,
  message: Message | undefined,
  data: ClubData,
): string | null {
  const cant = readProblem(me, conv, data) ?? messageProblem(message);
  if (cant || !me || !conv || !message) return cant;
  if (message.authorId === me.id || canModerate(me, conv, data)) return null;
  return 'You can only remove your own messages.';
}

/** Why `me` can't react to this message with this emoji, or null. Mirrors public.toggle_reaction. */
export function reactProblem(
  me: Member | null,
  conv: Conversation | undefined,
  message: Message | undefined,
  emoji: string,
  data: ClubData,
): string | null {
  const cant = readProblem(me, conv, data) ?? messageProblem(message);
  if (cant) return cant;
  if (!(REACTIONS as readonly string[]).includes(emoji)) return 'Pick one of the reactions.';
  return null;
}

/** Why `me` can't start a private chat with `target`, or null. Mirrors public.open_direct_chat. */
export function directProblem(me: Member | null, target: Member | undefined): string | null {
  const notApproved = isApproved(me);
  if (notApproved || !me) return notApproved;
  if (!target) return 'That member no longer exists.';
  if (target.id === me.id) return 'You can’t message yourself.';
  if (target.approval !== 'approved') return 'They’re not an approved member.';
  return null;
}

/** A ride's chat shows in your list from 7 days before it to 3 days after its last day, if you're
 *  going or a maybe. It's always reachable from the ride itself. Mirrors public.chat_list. */
export function rideChatListed(ride: Ride, answer: RsvpAnswer | null, today: string): boolean {
  if (answer !== 'going' && answer !== 'maybe') return false;
  return daysBetween(today, melbourneDate(ride.startsAt)) <= 7 && daysBetween(lastDay(ride), today) <= 3;
}

/** "Today", "Yesterday" or "DD/MM/YYYY", by the Melbourne date. */
export function dayLabel(iso: string, today: string): string {
  const day = melbourneDate(iso);
  const ago = daysBetween(day, today);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return formatAuDate(day);
}

export interface MessageRun {
  authorId: string;
  messages: Message[];
}

/** Oldest first, by Melbourne day, then by runs of one person's messages. */
export function groupMessages(messages: Message[], today: string): { day: string; runs: MessageRun[] }[] {
  const days: { key: string; day: string; runs: MessageRun[] }[] = [];
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const m of sorted) {
    const key = melbourneDate(m.createdAt);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, day: dayLabel(m.createdAt, today), runs: [] };
      days.push(day);
    }
    const run = day.runs[day.runs.length - 1];
    const prev = run?.messages[run.messages.length - 1];
    if (run && run.authorId === m.authorId && prev && Date.parse(m.createdAt) - Date.parse(prev.createdAt) <= RUN_GAP_MS) {
      run.messages.push(m);
    } else {
      day.runs.push({ authorId: m.authorId, messages: [m] });
    }
  }
  return days.map(({ day, runs }) => ({ day, runs }));
}

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>]+/gi;
const TRAILING = /[.,!?;:'")\]]+$/;

/** Splits text into plain parts and links (a bare www. address gets https://). */
export function findLinks(text: string): { text: string; url: string | null }[] {
  const parts: { text: string; url: string | null }[] = [];
  let at = 0;
  const push = (t: string, url: string | null) => {
    if (!t) return;
    const last = parts[parts.length - 1];
    if (!url && last && !last.url) last.text += t;
    else parts.push({ text: t, url });
  };
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const link = raw.replace(TRAILING, '');
    push(text.slice(at, start), null);
    push(link, /^www\./i.test(link) ? `https://${link}` : link);
    at = start + link.length;
  }
  push(text.slice(at), null);
  return parts.length ? parts : [{ text, url: null }];
}

/** Why this picked file can't go in, or null. Photos are resized before upload, so only a video's
 *  own size counts against the 50 MB cap. */
export function mediaProblem(p: PickedMedia): string | null {
  if (p.mimeType && !/^(image|video)\//.test(p.mimeType)) return 'Only photos and videos can go in.';
  if (p.kind === 'video') {
    if (p.durationMs !== null && p.durationMs > MAX_VIDEO_MS) return 'Videos can be up to 60 seconds.';
    if (p.fileSize !== null && p.fileSize > MAX_FILE_BYTES) return 'That file is over 50 MB.';
  }
  return null;
}

/** What a chat is called in the list and its header. */
export function chatTitle(conv: Conversation, me: Member | null, data: ClubData, ride?: Ride | null): string {
  switch (conv.kind) {
    case 'club':
      return 'Whole club';
    case 'chapter':
      return `${data.chapters.find((c) => c.id === conv.chapterId)?.name ?? 'Chapter'} chapter`;
    case 'ride':
      return ride?.title ?? 'Ride chat';
    case 'direct': {
      const other = data.members.find((m) => conv.memberIds.includes(m.id) && m.id !== me?.id);
      return other ? displayName(other) : 'Private chat';
    }
  }
}
