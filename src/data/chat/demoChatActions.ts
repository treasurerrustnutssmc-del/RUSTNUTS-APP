// What each chat action does to the demo's chats. Plain functions, like ../demoActions: they take
// the chats as they are and hand back the chats as they should be, or throw with the same words
// the database uses. src/data/parity.test.ts checks them against the database's rules.

import {
  approvalProblem,
  blockProblem,
  canSeeReport,
  directProblem,
  pinProblem,
  postProblem,
  readProblem,
  reactProblem,
  removeProblem,
  reportProblem,
  type Block,
  type Conversation,
  type Message,
  type MessageMedia,
} from '../../domain/chat';
import type { ClubData, Member } from '../../domain/types';
import { NotAllowedError } from '../clubContext';

export interface ChatRead {
  conversationId: string;
  memberId: string;
  readAt: string;
}

export interface ChatReport {
  id: string;
  messageId: string;
  reporterId: string;
  reason: string | null;
  /** What was said, kept for whoever deals with the report. */
  body: string | null;
  mediaCount: number;
  createdAt: string;
  resolvedAt: string | null;
  outcome: 'removed' | 'dismissed' | null;
}

export interface ChatData {
  conversations: Conversation[];
  messages: Message[];
  reads: ChatRead[];
  blocks: Block[];
  reports: ChatReport[];
}

export interface ChatCtx {
  chat: ChatData;
  club: ClubData;
  me: Member | null;
  /** The current instant (ISO). */
  now: string;
}

export type NewMedia = Omit<MessageMedia, 'id' | 'messageId' | 'position'>;

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

/** A private chat's id in the demo: the pair, smaller first, like the database's direct_key. */
export const directId = (a: string, b: string) => `direct:${[a, b].sort().join(':')}`;

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

const findChat = (chat: ChatData, id: string) => chat.conversations.find((c) => c.id === id);
const findMessage = (chat: ChatData, id: string) => chat.messages.find((m) => m.id === id);

function patchMessage(chat: ChatData, id: string, patch: (m: Message) => Message): ChatData {
  return { ...chat, messages: chat.messages.map((m) => (m.id === id ? patch(m) : m)) };
}

function withRead(chat: ChatData, conversationId: string, memberId: string, readAt: string): ChatData {
  const others = chat.reads.filter((r) => !(r.conversationId === conversationId && r.memberId === memberId));
  return { ...chat, reads: [...others, { conversationId, memberId, readAt }] };
}

export function sendMessage(
  ctx: ChatCtx,
  chatId: string,
  body: string,
  media: NewMedia[],
  replyToId: string | null = null,
): { chat: ChatData; id: string } {
  const conv = findChat(ctx.chat, chatId);
  // A reply to a message that isn't there is refused like one from another chat.
  const replyTo = replyToId ? findMessage(ctx.chat, replyToId) ?? { conversationId: '' } : null;
  refuse(postProblem(ctx.me, conv, body, media.length, ctx.club, ctx.chat.blocks, replyTo));
  const me = ctx.me!;
  const id = newId('msg');
  const words = body.trim();
  const message: Message = {
    id,
    conversationId: chatId,
    authorId: me.id,
    body: words || null,
    createdAt: ctx.now,
    removedAt: null,
    replyToId,
    media: media.map((m, position) => ({ ...m, id: `${id}-${position}`, messageId: id, position })),
    reactions: [],
  };
  return { chat: withRead({ ...ctx.chat, messages: [...ctx.chat.messages, message] }, chatId, me.id, ctx.now), id };
}

/** Blanks a message and takes away its reactions and pin; its open reports close as removed. */
function removeNow(chat: ChatData, messageId: string, at: string): ChatData {
  const blanked = patchMessage(chat, messageId, (m) => ({ ...m, body: null, media: [], reactions: [], removedAt: at }));
  return {
    ...blanked,
    conversations: blanked.conversations.map((c) => (c.pinnedMessageId === messageId ? { ...c, pinnedMessageId: null } : c)),
    reports: blanked.reports.map((r) =>
      r.messageId === messageId && !r.resolvedAt ? { ...r, resolvedAt: at, outcome: 'removed' as const } : r,
    ),
  };
}

export function removeMessage(ctx: ChatCtx, messageId: string): ChatData {
  const message = findMessage(ctx.chat, messageId);
  refuse(removeProblem(ctx.me, message && findChat(ctx.chat, message.conversationId), message, ctx.club));
  return removeNow(ctx.chat, messageId, ctx.now);
}

export function toggleReaction(ctx: ChatCtx, messageId: string, emoji: string): ChatData {
  const message = findMessage(ctx.chat, messageId);
  refuse(reactProblem(ctx.me, message && findChat(ctx.chat, message.conversationId), message, emoji, ctx.club));
  const me = ctx.me!.id;
  return patchMessage(ctx.chat, messageId, (m) => {
    const mine = m.reactions.some((r) => r.memberId === me && r.emoji === emoji);
    return {
      ...m,
      reactions: mine
        ? m.reactions.filter((r) => !(r.memberId === me && r.emoji === emoji))
        : [...m.reactions, { messageId, memberId: me, emoji }],
    };
  });
}

/** Pins a message to the top of its chat, or with null takes the pin down. */
export function pinMessage(ctx: ChatCtx, chatId: string, messageId: string | null): ChatData {
  const conv = findChat(ctx.chat, chatId);
  refuse(pinProblem(ctx.me, conv, undefined, ctx.club));
  const message = messageId ? findMessage(ctx.chat, messageId) : undefined;
  if (messageId && message?.conversationId !== chatId) throw new NotAllowedError('No such message.');
  refuse(pinProblem(ctx.me, conv, message, ctx.club));
  return { ...ctx.chat, conversations: ctx.chat.conversations.map((c) => (c.id === chatId ? { ...c, pinnedMessageId: messageId } : c)) };
}

/** Reports a message, or reports it again with a new reason (one open report per person). */
export function reportMessage(ctx: ChatCtx, messageId: string, reason: string): { chat: ChatData; id: string } {
  const message = findMessage(ctx.chat, messageId);
  refuse(reportProblem(ctx.me, message && findChat(ctx.chat, message.conversationId), message, reason, ctx.club));
  const me = ctx.me!.id;
  const earlier = ctx.chat.reports.find((r) => r.messageId === messageId && r.reporterId === me);
  const report: ChatReport = {
    id: earlier?.id ?? newId('report'),
    messageId,
    reporterId: me,
    reason: reason.trim() || null,
    body: message!.body,
    mediaCount: message!.media.length,
    createdAt: ctx.now,
    resolvedAt: null,
    outcome: null,
  };
  return { chat: { ...ctx.chat, reports: [...ctx.chat.reports.filter((r) => r.id !== report.id), report] }, id: report.id };
}

/** Deals with a report: remove the message, or let it stand. Either way every open report on that
 *  message closes. */
export function resolveReport(ctx: ChatCtx, reportId: string, remove: boolean): ChatData {
  refuse(approvalProblem(ctx.me));
  const report = ctx.chat.reports.find((r) => r.id === reportId);
  if (!report) throw new NotAllowedError('No such report.');
  const message = findMessage(ctx.chat, report.messageId);
  const conv = message && findChat(ctx.chat, message.conversationId);
  const reporter = ctx.club.members.find((m) => m.id === report.reporterId);
  if (!conv || !canSeeReport(ctx.me, conv, reporter, ctx.club)) throw new NotAllowedError('Only moderators can do that.');
  if (report.resolvedAt) throw new NotAllowedError('That report was already dealt with.');
  if (remove) return removeNow(ctx.chat, report.messageId, ctx.now);
  return {
    ...ctx.chat,
    reports: ctx.chat.reports.map((r) =>
      r.messageId === report.messageId && !r.resolvedAt ? { ...r, resolvedAt: ctx.now, outcome: 'dismissed' as const } : r,
    ),
  };
}

export function setBlock(ctx: ChatCtx, memberId: string, blocked: boolean): ChatData {
  refuse(blockProblem(ctx.me, ctx.club.members.find((m) => m.id === memberId)));
  const me = ctx.me!.id;
  const others = ctx.chat.blocks.filter((b) => !(b.blockerId === me && b.blockedId === memberId));
  return { ...ctx.chat, blocks: blocked ? [...others, { blockerId: me, blockedId: memberId }] : others };
}

/** The private chat between me and another member, made the first time. */
export function openDirect(ctx: ChatCtx, memberId: string): { chat: ChatData; id: string } {
  refuse(directProblem(ctx.me, ctx.club.members.find((m) => m.id === memberId), ctx.chat.blocks));
  const id = directId(ctx.me!.id, memberId);
  if (findChat(ctx.chat, id)) return { chat: ctx.chat, id };
  const conv: Conversation = {
    id, kind: 'direct', chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [ctx.me!.id, memberId],
  };
  return { chat: { ...ctx.chat, conversations: [...ctx.chat.conversations, conv] }, id };
}

/** A ride's chat, for any approved member. */
export function rideChat(ctx: ChatCtx, rideId: string): { chat: ChatData; id: string } {
  refuse(approvalProblem(ctx.me));
  if (!ctx.club.rides.some((r) => r.id === rideId)) throw new NotAllowedError('No such ride.');
  const existing = ctx.chat.conversations.find((c) => c.kind === 'ride' && c.rideId === rideId);
  if (existing) return { chat: ctx.chat, id: existing.id };
  const conv: Conversation = {
    id: `ride:${rideId}`, kind: 'ride', chapterId: null, rideId, committee: null, pinnedMessageId: null, memberIds: [],
  };
  return { chat: { ...ctx.chat, conversations: [...ctx.chat.conversations, conv] }, id: conv.id };
}

export function markRead(ctx: ChatCtx, chatId: string): ChatData {
  refuse(readProblem(ctx.me, findChat(ctx.chat, chatId), ctx.club));
  return withRead(ctx.chat, chatId, ctx.me!.id, ctx.now);
}

/** The chat actions in the shared case list (supabase/tests/parity.json). */
export type ChatAction =
  | { action: 'chatSend'; chat: string; body: string; repeat?: number; gifs?: number; replyTo?: string }
  | { action: 'chatRemove'; message: string }
  | { action: 'chatReact'; message: string; emoji: string }
  | { action: 'chatDirect'; member: string }
  | { action: 'chatPin'; chat: string; message: string | null }
  | { action: 'chatReport'; message: string; reason: string; repeat?: number }
  | { action: 'chatBlock'; member: string; blocked: boolean };

/** A case's words: `repeat` writes them out that many times, for the length limits. */
export const caseText = (text: string, repeat?: number) => (repeat ? text.repeat(repeat) : text);

/** A case's GIFs: n made-up Tenor addresses. */
export const caseGifs = (n = 0): NewMedia[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'gif' as const, path: `https://media1.giphy.com/media/parity${i}/giphy.gif`, posterPath: null, width: 220, height: 160, durationMs: null,
  }));

export function runChatAction(ctx: ChatCtx, a: ChatAction): ChatData {
  switch (a.action) {
    case 'chatSend':
      return sendMessage(ctx, a.chat, caseText(a.body, a.repeat), caseGifs(a.gifs), a.replyTo ?? null).chat;
    case 'chatRemove':
      return removeMessage(ctx, a.message);
    case 'chatReact':
      return toggleReaction(ctx, a.message, a.emoji);
    case 'chatDirect':
      return openDirect(ctx, a.member).chat;
    case 'chatPin':
      return pinMessage(ctx, a.chat, a.message);
    case 'chatReport':
      return reportMessage(ctx, a.message, caseText(a.reason, a.repeat)).chat;
    case 'chatBlock':
      return setBlock(ctx, a.member, a.blocked);
  }
}
