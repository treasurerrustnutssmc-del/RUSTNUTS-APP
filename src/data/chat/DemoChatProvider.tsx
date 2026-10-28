// Demo build: made-up chats held in memory. Every action goes through demoChatActions, which
// applies the same rules the database enforces (checked by src/data/parity.test.ts).

import React, { useCallback, useMemo, useState } from 'react';
import { canSeeReport, type MessageMedia } from '../../domain/chat';
import type { ClubData } from '../../domain/types';
import { useClub } from '../clubContext';
import { ChatContext, type Attachment, type ChatContextValue, type ReportView } from './chatContext';
import { feedFrom, listFor, rideWallFrom, rideWallsFrom, withoutBlocked } from './chatList';
import * as act from './demoChatActions';
import { DEMO_MEDIA, DEMO_PAST_RIDES, DEMO_PREVIEWS, demoChatData } from './demoChatData';

const toNewMedia = (a: Attachment): Omit<MessageMedia, 'id' | 'messageId' | 'position'> =>
  a.kind === 'gif'
    ? { kind: 'gif', path: a.url, posterPath: null, width: a.width, height: a.height, durationMs: null }
    : a.kind === 'voice'
      ? { kind: 'voice', path: a.uri, posterPath: null, width: 0, height: 0, durationMs: a.durationMs }
      : { kind: a.kind, path: a.uri, posterPath: null, width: a.width, height: a.height, durationMs: a.durationMs };

const voiceOf = (m: { media: MessageMedia[] }) => {
  const v = m.media.find((x) => x.kind === 'voice');
  return v ? { path: v.path, durationMs: v.durationMs } : null;
};

export function DemoChatProvider({ children }: { children: React.ReactNode }) {
  const { data, me, today } = useClub();
  const club: ClubData = useMemo(() => ({ ...data, rides: [...DEMO_PAST_RIDES, ...data.rides] }), [data]);
  const [chat, setChat] = useState<act.ChatData>(() => demoChatData(new Date(), data.rides));
  const ctx = (): act.ChatCtx => ({ chat, club, me, now: new Date().toISOString() });

  const list = useMemo(() => listFor(chat, club, me, today), [chat, club, me, today]);
  const myBlocks = useMemo(() => chat.blocks.filter((b) => b.blockerId === me?.id), [chat.blocks, me]);

  const open = useCallback(
    (chatId: string) => {
      setChat((current) => {
        try {
          return act.markRead({ chat: current, club, me, now: new Date().toISOString() }, chatId);
        } catch {
          return current;
        }
      });
      return () => {};
    },
    [club, me],
  );

  const value: ChatContextValue = {
    ready: true,
    list,
    unreadTotal: list.reduce((sum, s) => sum + s.unread, 0),
    blocks: myBlocks,
    conversation: (chatId) => chat.conversations.find((c) => c.id === chatId),
    messages: (chatId) => withoutBlocked(chat.messages.filter((m) => m.conversationId === chatId), chat.blocks, me?.id ?? null),
    hasOlder: () => false,
    open,
    loadOlder: async () => {},
    send: async (chatId, body, attachments, replyToId) => {
      setChat(act.sendMessage(ctx(), chatId, body, attachments.map(toNewMedia), replyToId).chat);
    },
    remove: async (messageId) => setChat(act.removeMessage(ctx(), messageId)),
    react: async (messageId, emoji) => setChat(act.toggleReaction(ctx(), messageId, emoji)),
    pin: async (chatId, messageId) => setChat(act.pinMessage(ctx(), chatId, messageId)),
    report: async (messageId, reason) => setChat(act.reportMessage(ctx(), messageId, reason).chat),
    setBlock: async (memberId, blocked) => setChat(act.setBlock(ctx(), memberId, blocked)),
    openDirect: async (memberId) => {
      const result = act.openDirect(ctx(), memberId);
      setChat(result.chat);
      return result.id;
    },
    rideChat: async (rideId) => {
      const result = act.rideChat(ctx(), rideId);
      setChat(result.chat);
      return result.id;
    },
    reports: async () =>
      chat.reports.flatMap((r): ReportView[] => {
        const message = chat.messages.find((m) => m.id === r.messageId);
        const conversation = message && chat.conversations.find((c) => c.id === message.conversationId);
        const reporter = club.members.find((m) => m.id === r.reporterId);
        if (r.resolvedAt || !message || !conversation || !canSeeReport(me, conversation, reporter, club)) return [];
        return [{
          id: r.id, reason: r.reason, createdAt: r.createdAt, reporterId: r.reporterId, conversation,
          message: {
            id: message.id, conversationId: message.conversationId, authorId: message.authorId, body: r.body,
            mediaCount: r.mediaCount, createdAt: message.createdAt,
            voice: voiceOf(message),
          },
        }];
      }),
    resolveReport: async (reportId, remove) => setChat(act.resolveReport(ctx(), reportId, remove)),
    photos: async (before) => feedFrom(chat, club, me, before),
    rideWalls: async () => rideWallsFrom(chat, club, me),
    rideWall: async (rideId) => rideWallFrom(chat, club, me, rideId),
    mediaUrl: async (path) => DEMO_MEDIA[path] ?? path,
    linkPreview: async (url) => DEMO_PREVIEWS[url] ?? null,
    refresh: async () => {},
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
