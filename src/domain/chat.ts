// Club chats: the whole club, each chapter, each ride, All boards, groups the boards set up, and private
// chats between two members.
// Who can read, post, remove and react. The database's chat actions apply the same rules with
// the same words (supabase/migrations/20261101000100_chat.sql).

import { accessLevel, activePositions, isApprovedMember, isBoardOf, isNational, seesBoardOf, seesEveryChapter } from './access';
import { isAnyBoard } from './social/help';
import { daysBetween, formatAuDate } from './dates';
import { postingRulesProblem } from './postingRules';
import { displayName } from './profile';
import { lastDay, melbourneDate } from './rides';
import type { ClubData, Member, Ride, RsvpAnswer } from './types';

/** 'family' is the one chat members share with Family accounts (2026-11-03-family-chat-design.md).
 *  'boards' is All boards, every chapter's board and the NEC; 'group' is a named group the boards set
 *  up (2026-11-20-chat-groups-design.md). 'topic' is a named chat inside a board, committee or group
 *  chat, for whoever reads that chat (2026-11-24-chat-topics-design.md). */
export type ChatKind = 'club' | 'family' | 'chapter' | 'board' | 'boards' | 'nec' | 'committee' | 'ride' | 'group' | 'direct' | 'topic';
export type ChatCommittee = 'ride' | 'charity';
/** A GIF is GIPHY's own https address, not a file in the club's storage. A voice note is a
 *  recording that goes in a message on its own. */
export type MediaKind = 'photo' | 'video' | 'gif' | 'voice';

export interface Conversation {
  id: string;
  kind: ChatKind;
  chapterId: string | null; // chapter and big table (board) chats
  rideId: string | null; // ride chats
  committee: ChatCommittee | null; // committee chats
  pinnedMessageId: string | null;
  memberIds: string[]; // private chats: the two people in it; groups: everyone in it
  /** A group's name. */
  name: string | null;
  /** Who started a group or a topic. */
  createdBy: string | null;
  /** A topic's chat (its id, and the chat itself once it's looked up, so the rules can look through it). */
  parentId?: string | null;
  parent?: Conversation | null;
  /** A closed topic: nobody posts until it's reopened. */
  closedAt?: string | null;
  closedBy?: string | null;
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
  /** The earlier message in the same chat that this one answers. */
  replyToId: string | null;
  media: MessageMedia[];
  reactions: Reaction[];
}

/** A photo or video picked on the phone, before it's uploaded. */
export interface PickedMedia {
  uri: string;
  kind: 'photo' | 'video';
  width: number;
  height: number;
  durationMs: number | null;
  fileSize: number | null;
  mimeType: string | null;
}

export interface Block {
  blockerId: string;
  blockedId: string;
}

export const REACTIONS = ['👍', '❤️', '😂', '🔥', '🍺', '😮'] as const;
export const MAX_BODY = 4000;
export const MAX_MEDIA = 10;
export const MAX_VIDEO_MS = 60_000;
export const MAX_VOICE_MS = 120_000;
export const VOICE_ALONE = 'A voice note goes on its own.';
export const VOICE_BROKEN = 'That voice note didn’t record properly. Try again.';
export const VOICE_TOO_LONG = 'Voice notes can be up to 2 minutes.';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_REASON = 500;

/** Words as the database keeps them: spaces, tabs and new lines off each end (other spaces stay). */
export const trimWords = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
/** Characters the way the database counts them: an emoji is one, not two. */
export const charCount = (s: string) => [...s].length;
/** The only GIF addresses a message can hold: GIPHY's own (the database checks the same pattern). */
export const GIF_URL = /^https:\/\/(media[0-9]?|i)\.giphy\.com\/[A-Za-z0-9_./?&=%-]+$/;
/** Messages from one person closer together than this sit in one run. */
const RUN_GAP_MS = 5 * 60_000;

/** Why `me` can't use the chats at all, or null. Approved members and approved Family (who then
 *  get the Family chat only). Mirrors private.is_chat_user. */
export function approvalProblem(me: Member | null): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  return null;
}

/** Why `me` can't do a members-only chat thing (private chats, photo feeds, ride walls, reports
 *  queue), or null. Mirrors private.is_approved_member, which leaves Family out. */
export function memberProblem(me: Member | null): string | null {
  return approvalProblem(me) ?? (me?.status === 'family' ? 'Only approved members can do that.' : null);
}

/** Why `me` can't read this chat, or null when they can. Mirrors private.chat_problem. */
export function readProblem(me: Member | null, conv: Conversation | undefined, data: ClubData): string | null {
  const notApproved = approvalProblem(me);
  if (notApproved || !me) return notApproved;
  if (!conv) return 'No such chat.';
  // A topic is read by whoever reads its chat, with the chat's words.
  if (conv.kind === 'topic') return conv.parent ? readProblem(me, conv.parent, data) : 'No such chat.';
  // Family get the Family chat and nothing else.
  if (me.status === 'family') return conv.kind === 'family' ? null : 'Family can only use the Family chat.';
  // Someone who might join gets the whole-club and ride chats only, until they're an FNG.
  if (me.status === 'introduced' && conv.kind !== 'club' && conv.kind !== 'ride') {
    if (conv.kind === 'direct') return 'Private chats open up once you’re an FNG.';
    if (conv.kind === 'group') return 'Group chats open up once you’re an FNG.';
    return conv.kind === 'chapter' ? 'Chapter chats open up once you’re an FNG.' : 'That chat opens up once you’re an FNG.';
  }
  if (conv.kind === 'chapter') {
    // Another chapter's chat is member data: club-wide seats only, so not an Acting President.
    if (me.chapterId === conv.chapterId || seesEveryChapter(me, data.positions)) return null;
    const name = data.chapters.find((c) => c.id === conv.chapterId)?.name ?? 'that';
    return `That chat is for ${name} chapter members.`;
  }
  if (conv.kind === 'board') {
    if (conv.chapterId && seesBoardOf(me, conv.chapterId, data.positions)) return null;
    return `That chat is for the ${data.chapters.find((c) => c.id === conv.chapterId)?.name ?? 'chapter'} board.`;
  }
  if (conv.kind === 'boards') return isAnyBoard(me, data.positions) ? null : 'That chat is for board members and the NEC.';
  if (conv.kind === 'nec') return isNational(me.id, data.positions) ? null : 'That chat is for the NEC.';
  if (conv.kind === 'committee') {
    const onIt = conv.committee === 'charity' ? isCharityCommittee(me.id, data) : isRideCommittee(me.id, data);
    if (onIt || isNational(me.id, data.positions)) return null;
    return `That chat is for the ${conv.committee === 'charity' ? 'charity' : 'ride'} committee.`;
  }
  if (conv.kind === 'direct') return conv.memberIds.includes(me.id) ? null : 'That’s a private chat.';
  if (conv.kind === 'group') return conv.memberIds.includes(me.id) ? null : 'That’s a private group.';
  return null;
}

/** Holds a Road Captain or Ride Committee seat in any chapter. */
export function isRideCommittee(memberId: string, data: Pick<ClubData, 'positions'>): boolean {
  return activePositions(memberId, data.positions).some((p) => p.role === 'ride_committee' || p.role === 'road_captain');
}

/** Holds a Charity Committee seat in any chapter. */
export function isCharityCommittee(memberId: string, data: Pick<ClubData, 'positions'>): boolean {
  return activePositions(memberId, data.positions).some((p) => p.role === 'charity_committee');
}

const blockedBetween = (a: string, b: string, blocks: Block[]) =>
  blocks.some((x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));

/** Why `me` can't send this message here, or null. Mirrors public.send_message. `media` is what goes
 *  with it, or just how many photos. */
export function postProblem(
  me: Member | null,
  conv: Conversation | undefined,
  body: string,
  media: number | Pick<MessageMedia, 'kind' | 'durationMs'>[],
  data: ClubData,
  blocks: Block[] = [],
  replyTo: Pick<Message, 'conversationId'> | null = null,
): string | null {
  const cant = readProblem(me, conv, data);
  if (cant || !me || !conv) return cant;
  if (conv.kind === 'direct') {
    const other = conv.memberIds.find((id) => id !== me.id);
    if (other && blockedBetween(me.id, other, blocks)) return 'You can’t message them.';
  }
  if (replyTo && replyTo.conversationId !== conv.id) return 'No such message.';
  const words = trimWords(body);
  const mediaCount = typeof media === 'number' ? media : media.length;
  if (!words && mediaCount === 0) return 'Write something or add a photo.';
  if (charCount(words) > MAX_BODY) return 'Keep it under 4,000 characters.';
  if (mediaCount > MAX_MEDIA) return 'Up to 10 photos or videos at a time.';
  const voice = typeof media === 'number' ? undefined : media.find((m) => m.kind === 'voice');
  if (voice) {
    if (words || mediaCount > 1) return VOICE_ALONE;
    if (!voice.durationMs || voice.durationMs < 1) return VOICE_BROKEN;
    if (voice.durationMs > MAX_VOICE_MS) return VOICE_TOO_LONG;
  }
  // As the message goes in: a closed topic (private.refuse_closed_topic), then agreed to the club rules for chats and posts? (The database
  // checks this in a trigger on the row, so it comes after everything about the content.)
  if (conv.kind === 'topic' && conv.closedAt) return TOPIC_CLOSED;
  return postingRulesProblem(me);
}

/** Can tidy other people's messages: a chapter's board in its chat and big table, the NEC in its own
 *  chat, any board member or the NEC in
 *  the whole-club and ride chats. Nobody moderates a private chat. */
export function canModerate(me: Member | null, conv: Conversation, data: ClubData): boolean {
  // Family never moderate (private.can_moderate needs is_approved_member, which leaves them out).
  if (!me || me.approval !== 'approved' || me.status === 'family') return false;
  // Whoever moderates a topic's chat moderates the topic.
  if (conv.kind === 'topic') return !!conv.parent && canModerate(me, conv.parent, data);
  if (conv.kind === 'chapter' || conv.kind === 'board') return !!conv.chapterId && isBoardOf(me, conv.chapterId, data.positions);
  if (conv.kind === 'nec') return isNational(me.id, data.positions);
  if (conv.kind === 'direct' || conv.kind === 'group') return false;
  if (conv.kind === 'committee' && readProblem(me, conv, data)) return false;
  const level = accessLevel(me, data.positions);
  return level === 'board' || level === 'national';
}

/** A message you can act on: it exists, you can read its chat, and it's still there. Checked in
 *  that order, like the database. */
function messageProblem(me: Member | null, conv: Conversation | undefined, message: Message | undefined, data: ClubData): string | null {
  if (!message) return approvalProblem(me) ?? 'No such message.';
  const cant = readProblem(me, conv, data);
  if (cant) return cant;
  return message.removedAt ? 'That message was removed.' : null;
}

/** Why `me` can't remove this message, or null. Mirrors public.remove_message. */
export function removeProblem(
  me: Member | null,
  conv: Conversation | undefined,
  message: Message | undefined,
  data: ClubData,
): string | null {
  const cant = messageProblem(me, conv, message, data);
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
  const cant = messageProblem(me, conv, message, data);
  if (cant) return cant;
  if (!(REACTIONS as readonly string[]).includes(emoji)) return 'Pick one of the reactions.';
  return null;
}

/** Why `me` can't start a private chat with `target`, or null. Mirrors public.open_direct_chat. */
export function directProblem(me: Member | null, target: Member | undefined, blocks: Block[] = []): string | null {
  const notApproved = memberProblem(me);
  if (notApproved || !me) return notApproved;
  if (!target) return 'That member no longer exists.';
  if (target.id === me.id) return 'You can’t message yourself.';
  if (target.approval !== 'approved') return 'They’re not an approved member.';
  if (target.status === 'family') return 'Family only use the Family chat, not private chats.';
  if (me.status === 'introduced') return 'Private chats open up once you’re an FNG.';
  if (target.status === 'introduced') return 'They can’t get private messages until they’re an FNG.';
  if (blockedBetween(me.id, target.id, blocks)) return 'You can’t message them.';
  return null;
}

/** Why `me` can't pin this message (or, with none, take the pin down). Mirrors public.pin_message. */
export function pinProblem(
  me: Member | null,
  conv: Conversation | undefined,
  message: Message | undefined,
  data: ClubData,
): string | null {
  const cant = readProblem(me, conv, data);
  if (cant || !conv) return cant;
  if (!canModerate(me, conv, data)) return 'Only moderators can pin messages.';
  if (message?.removedAt) return 'That message was removed.';
  return null;
}

/** Why `me` can't report this message, or null. Mirrors public.report_message. */
export function reportProblem(
  me: Member | null,
  conv: Conversation | undefined,
  message: Message | undefined,
  reason: string,
  data: ClubData,
): string | null {
  const cant = messageProblem(me, conv, message, data);
  if (cant || !me || !message) return cant;
  if (message.authorId === me.id) return 'You can’t report your own message.';
  if (charCount(reason) > MAX_REASON) return 'Keep the reason under 500 characters.';
  return null;
}

/** Who acts on a report: whoever moderates the chat, or for a private chat or group (which nobody
 *  moderates) the reporter's chapter board. Mirrors private.can_act_on_report. */
export function canSeeReport(me: Member | null, conv: Conversation, reporter: Member | undefined, data: ClubData): boolean {
  // A report in a topic goes where one in its chat would.
  if (conv.kind === 'topic') return !!conv.parent && canSeeReport(me, conv.parent, reporter, data);
  if (conv.kind !== 'direct' && conv.kind !== 'group') return canModerate(me, conv, data);
  return !!reporter && isBoardOf(me, reporter.chapterId, data.positions);
}

/** Why `me` can't block (or unblock) `target`, or null. Mirrors public.set_block. */
export function blockProblem(me: Member | null, target: Member | undefined): string | null {
  const notApproved = approvalProblem(me);
  if (notApproved || !me) return notApproved;
  if (!target) return 'That member no longer exists.';
  if (target.id === me.id) return 'You can’t block yourself.';
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
    // The club's storage takes the two kinds every phone records: MP4 and Apple's MOV.
    if (p.mimeType && p.mimeType !== 'video/mp4' && p.mimeType !== 'video/quicktime') return 'Videos need to be MP4 or MOV.';
    if (p.durationMs !== null && p.durationMs > MAX_VIDEO_MS) return 'Videos can be up to 60 seconds.';
    if (p.fileSize !== null && p.fileSize > MAX_FILE_BYTES) return 'That file is over 50 MB.';
  }
  return null;
}

/** What a message with no words is called in the chat list, the pinned bar and reply quotes. */
export function mediaSummary(count: number, voice: boolean): string {
  if (voice) return 'Voice note';
  if (count === 0) return '';
  return count > 1 ? `${count} photos` : 'Photo';
}

/** What a reply's quote says: the quoted message's words, or what it held. */
export function quoteWords(message: Pick<Message, 'body' | 'removedAt' | 'media'> | undefined): string {
  if (!message) return 'An earlier message';
  if (message.removedAt) return 'Message removed';
  return message.body || mediaSummary(message.media.length, message.media.some((m) => m.kind === 'voice'));
}

const KIND_WORD: Record<MediaKind, string> = { photo: 'Photo', video: 'Video', gif: 'GIF', voice: 'Voice note' };
type TileKind = Exclude<MediaKind, 'voice'>;
const KIND_ONE: Record<TileKind, string> = { photo: 'photo', video: 'video', gif: 'GIF' };
const KIND_PLURAL: Record<TileKind, string> = { photo: 'photos', video: 'videos', gif: 'GIFs' };

/** A piece of media's name as a screen reader hears it: Photo, Video, GIF or Voice note. */
export function mediaKindWord(kind: MediaKind): string {
  return KIND_WORD[kind];
}

/** What a message holds, by kind, for the words a screen reader hears: "Photo", "2 photos, 1 video". */
export function mediaSpoken(media: Pick<MessageMedia, 'kind'>[]): string {
  if (media.some((m) => m.kind === 'voice')) return KIND_WORD.voice;
  if (media.length === 1) return KIND_WORD[media[0].kind];
  const kinds: TileKind[] = ['photo', 'video', 'gif'];
  return kinds
    .map((k) => ({ k, n: media.filter((m) => m.kind === k).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${x.n === 1 ? KIND_ONE[x.k] : KIND_PLURAL[x.k]}`)
    .join(', ');
}

/**
 * The words on a message's own VoiceOver stop on iPhone, in the order they sit on screen: the name
 * (only where it is no button of its own), the quote ("Replying to Rusty: Who's keen?", so the two names
 * don't run together), what it holds, its words, and its time when that shows. The play button, the photos and the links are stops of their own after it.
 */
export function messageSpoken(parts: {
  author?: string;
  quote?: { name: string; words: string };
  media: Pick<MessageMedia, 'kind'>[];
  body: string | null;
  time?: string;
}): string {
  const said = [
    parts.author,
    parts.quote ? (parts.quote.name ? `Replying to ${parts.quote.name}: ${parts.quote.words}` : `Replying to ${parts.quote.words}`) : undefined,
    mediaSpoken(parts.media),
    parts.body ?? undefined,
    parts.time,
  ].filter((x): x is string => !!x);
  return said.length ? said.join(', ') : 'Message';
}

/** Authors the member list doesn't have yet: someone who joined after the club was loaded (or a
 *  removed member). The chat reloads the club once for these before calling anyone "Former member". */
export function unknownAuthors(messages: Pick<Message, 'authorId'>[], members: Pick<Member, 'id'>[]): string[] {
  const known = new Set(members.map((m) => m.id));
  return [...new Set(messages.map((m) => m.authorId))].filter((id) => !known.has(id));
}

/** What a chat is called in the list and its header. */
export function chatTitle(conv: Conversation, me: Member | null, data: ClubData, ride?: Ride | null): string {
  switch (conv.kind) {
    case 'club':
      return 'Whole club';
    case 'family':
      return 'Family';
    case 'chapter':
      return `${data.chapters.find((c) => c.id === conv.chapterId)?.name ?? 'Chapter'} chapter`;
    case 'board':
      return `${data.chapters.find((c) => c.id === conv.chapterId)?.name ?? 'Chapter'} big table`;
    case 'boards':
      return 'All boards';
    case 'nec':
      return 'NEC';
    case 'group':
      return conv.name ?? 'Group chat';
    case 'topic':
      return conv.name ?? 'Topic';
    case 'committee':
      return conv.committee === 'charity' ? 'Charity committee' : 'Ride committee';
    case 'ride':
      return ride?.title ?? 'Ride chat';
    case 'direct': {
      const other = data.members.find((m) => conv.memberIds.includes(m.id) && m.id !== me?.id);
      return other ? displayName(other) : 'Private chat';
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Groups (2026-11-20-chat-groups-design.md). Each mirrors its database action in
// supabase/migrations/20270880000100_chat_groups.sql, in the same order and with the same words.

export const MAX_GROUP_NAME = 40;
export const MAX_GROUP_PEOPLE = 100;

/** Starts groups and runs them (adds people, renames, takes people out): a board member of any chapter
 *  or the NEC, the same people as All boards. Mirrors private.raise_not_group_runner. */
export function canRunGroups(me: Member | null, data: Pick<ClubData, 'positions'>): boolean {
  return isApprovedMember(me) && isAnyBoard(me, data.positions);
}

/** Why this can't be a group's name, or null. Mirrors private.group_name. */
export function groupNameProblem(name: string): string | null {
  const words = trimWords(name);
  if (!words) return 'Give the group a name.';
  if (charCount(words) > MAX_GROUP_NAME) return 'Keep the name to 40 characters.';
  return null;
}

/** Why `me` can't put these people in a group, or null. Mirrors private.put_in_group (but the
 *  100-people count, which the callers check). */
function peopleProblem(me: Member, memberIds: string[], data: ClubData, blocks: Block[]): string | null {
  for (const id of memberIds) {
    if (id === me.id) continue;
    const t = data.members.find((m) => m.id === id);
    if (!t) return 'That member no longer exists.';
    if (t.approval !== 'approved') return `${displayName(t)} isn’t an approved member.`;
    if (t.status === 'family') return 'Family only use the Family chat, not groups.';
    if (t.status === 'introduced') return `${displayName(t)} can’t join groups until they’re an FNG.`;
    if (blockedBetween(me.id, id, blocks)) return `You can’t add ${displayName(t)}.`;
  }
  return null;
}

/** Why `me` can't start this group, or null. Mirrors public.create_group_chat. */
export function createGroupProblem(me: Member | null, name: string, memberIds: string[], data: ClubData, blocks: Block[] = []): string | null {
  const cant = memberProblem(me);
  if (cant || !me) return cant;
  if (!canRunGroups(me, data)) return 'Only board members and the NEC can start groups.';
  const badName = groupNameProblem(name);
  if (badName) return badName;
  const others = new Set(memberIds.filter((id) => id !== me.id));
  if (others.size === 0) return 'Add at least one other person.';
  if (others.size + 1 > MAX_GROUP_PEOPLE) return 'A group can have up to 100 people.';
  return peopleProblem(me, memberIds, data, blocks);
}

/** A group `me` is in, or why not. Mirrors private.my_group. */
function myGroupProblem(me: Member | null, conv: Conversation | undefined, data: ClubData): string | null {
  if (!me) return 'Sign in first.';
  if (conv && conv.kind !== 'group') return 'That’s not a group chat.';
  return readProblem(me, conv, data);
}

/** Why `me` can't add these people to this group, or null. Mirrors public.add_to_group. */
export function addToGroupProblem(me: Member | null, conv: Conversation | undefined, memberIds: string[], data: ClubData, blocks: Block[] = []): string | null {
  const cant = myGroupProblem(me, conv, data);
  if (cant || !me || !conv) return cant;
  if (!canRunGroups(me, data)) return 'Only board members and the NEC can add people.';
  const bad = peopleProblem(me, memberIds, data, blocks);
  if (bad) return bad;
  if (new Set([...conv.memberIds, ...memberIds]).size > MAX_GROUP_PEOPLE) return 'A group can have up to 100 people.';
  return null;
}

/** Why `me` can't rename this group, or null. Mirrors public.rename_group. */
export function renameGroupProblem(me: Member | null, conv: Conversation | undefined, name: string, data: ClubData): string | null {
  const cant = myGroupProblem(me, conv, data);
  if (cant || !me) return cant;
  if (!canRunGroups(me, data)) return 'Only board members and the NEC can rename a group.';
  return groupNameProblem(name);
}

/** Why `me` can't take this person out of this group, or null. Mirrors public.remove_from_group. */
export function removeFromGroupProblem(me: Member | null, conv: Conversation | undefined, memberId: string, data: ClubData): string | null {
  const cant = myGroupProblem(me, conv, data);
  if (cant || !me || !conv) return cant;
  if (!canRunGroups(me, data)) return 'Only board members and the NEC can take people out.';
  if (memberId === me.id) return 'Use Leave group to leave.';
  if (!conv.memberIds.includes(memberId)) return 'They’re not in that group.';
  return null;
}

/** Why `me` can't leave this group, or null. Mirrors public.leave_group. */
export function leaveGroupProblem(me: Member | null, conv: Conversation | undefined, data: ClubData): string | null {
  return myGroupProblem(me, conv, data);
}

// ---------------------------------------------------------------------------------------------
// Topics (2026-11-24-chat-topics-design.md). Each mirrors its database action in
// supabase/migrations/20270980000100_chat_topics.sql, in the same order and with the same words.

export const MAX_TOPIC_NAME = 40;
export const MAX_OPEN_TOPICS = 50;
const TOPIC_CLOSED = 'This topic is closed. Reopen it to post.';
const TOPIC_KINDS: ChatKind[] = ['board', 'boards', 'nec', 'committee', 'group'];
const NOT_TOPIC_RUNNER = 'Only whoever started the topic, or a board member or the NEC, can do that.';
const TOO_MANY_TOPICS = 'This chat has 50 open topics. Close one first.';

/** Big tables, All boards, the NEC chat, committee chats and groups have topics. */
export function hasTopics(conv: Pick<Conversation, 'kind'>): boolean {
  return TOPIC_KINDS.includes(conv.kind);
}

/** The chat a topic sits in, as its header's second line ("All boards"). */
export function topicParentTitle(conv: Conversation, me: Member | null, data: ClubData): string {
  return conv.parent ? chatTitle(conv.parent, me, data) : 'Chat';
}

/** Gives a topic its chat from the chats `me` has, so the rules can look through it. */
export function withParent(conv: Conversation | undefined, all: Conversation[]): Conversation | undefined {
  if (!conv || conv.kind !== 'topic') return conv;
  const parent = all.find((c) => c.id === conv.parentId) ?? null;
  return parent === conv.parent ? conv : { ...conv, parent };
}

/** Why this can't be a topic's name, or null. Mirrors private.topic_name. */
export function topicNameProblem(name: string): string | null {
  const words = trimWords(name);
  if (!words) return 'Give the topic a name.';
  if (charCount(words) > MAX_TOPIC_NAME) return 'Keep the name to 40 characters.';
  return null;
}

/** Why `me` can't start this topic in this chat, which has `openCount` open topics, or null.
 *  Mirrors public.start_topic. */
export function startTopicProblem(me: Member | null, parent: Conversation | undefined, name: string, data: ClubData, openCount: number): string | null {
  if (!me) return 'Sign in first.';
  const cant = readProblem(me, parent, data);
  if (cant || !parent) return cant;
  if (!hasTopics(parent)) return 'Topics are for board, committee and group chats.';
  const badName = topicNameProblem(name);
  if (badName) return badName;
  return openCount >= MAX_OPEN_TOPICS ? TOO_MANY_TOPICS : null;
}

/** Renames, closes and reopens this topic: whoever started it, or a board member or the NEC (who
 *  can read it). Mirrors private.my_topic. */
export function canRunTopic(me: Member | null, conv: Conversation, data: ClubData): boolean {
  return topicRunProblem(me, conv, data) === null;
}

function topicRunProblem(me: Member | null, conv: Conversation | undefined, data: ClubData): string | null {
  if (!me) return 'Sign in first.';
  if (conv && conv.kind !== 'topic') return 'That’s not a topic.';
  const cant = readProblem(me, conv, data);
  if (cant || !conv) return cant;
  if (conv.createdBy !== me.id && !isAnyBoard(me, data.positions)) return NOT_TOPIC_RUNNER;
  return null;
}

/** Why `me` can't rename this topic, or null. Mirrors public.rename_topic. */
export function renameTopicProblem(me: Member | null, conv: Conversation | undefined, name: string, data: ClubData): string | null {
  return topicRunProblem(me, conv, data) ?? topicNameProblem(name);
}

/** Why `me` can't close this topic, or null. Mirrors public.close_topic. */
export function closeTopicProblem(me: Member | null, conv: Conversation | undefined, data: ClubData): string | null {
  return topicRunProblem(me, conv, data) ?? (conv?.closedAt ? 'That topic is already closed.' : null);
}

/** Why `me` can't reopen this topic, whose chat has `openCount` open topics, or null. Mirrors public.reopen_topic. */
export function reopenTopicProblem(me: Member | null, conv: Conversation | undefined, data: ClubData, openCount: number): string | null {
  const cant = topicRunProblem(me, conv, data);
  if (cant) return cant;
  if (!conv?.closedAt) return 'That topic is already open.';
  return openCount >= MAX_OPEN_TOPICS ? TOO_MANY_TOPICS : null;
}
