// Demo build: made-up chats held in memory. Every action goes through demoChatActions, which
// applies the same rules the database enforces (checked by src/data/parity.test.ts).

import React, { useCallback, useMemo, useState } from 'react';
import { canSeeReport, withParent, type MessageMedia } from '../../domain/chat';
import type { ClubData } from '../../domain/types';
import { NotAllowedError, useClub } from '../clubContext';
import { addProblem as galleryAddProblem, albumChoices, approveProblem, removeProblem as galleryRemoveProblem, waitsForWebsite, type GalleryItem } from '../../domain/gallery';
import { cleanCaption, isSitePhotoEditor } from '../../domain/sitePhotos';
import { demoSitePhotoCrew } from '../sitePhotosData';
import { ChatContext, type Attachment, type ChatContextValue, type ReportView } from './chatContext';
import { feedFrom, listFor, rideWallFrom, rideWallsFrom, withoutBlocked } from './chatList';
import * as act from './demoChatActions';
import { demoSession } from '../reviewMode';
import { DEMO_PREVIEWS, demoChatData, demoPastRides } from './demoChatData';
import { DEMO_MEDIA } from './demoMedia';

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
  // The chats and the past ride are built for the demo session's instant, like the club itself.
  const [pastRides] = useState(() => demoPastRides(demoSession.now()));
  const club: ClubData = useMemo(() => ({ ...data, rides: [...pastRides, ...data.rides] }), [data, pastRides]);
  const [chat, setChat] = useState<act.ChatData>(() => demoChatData(demoSession.now(), data.rides));
  // The website photo crew, as the demo's Website photos screen has it (who may take gallery items down or approve them).
  const [demoCrew] = useState(() => demoSitePhotoCrew(demoSession.now()));
  const ctx = (): act.ChatCtx => ({ chat, club, me, now: new Date().toISOString() });

  const list = useMemo(() => listFor(chat, club, me, today), [chat, club, me, today]);
  const myBlocks = useMemo(() => chat.blocks.filter((b) => b.blockerId === me?.id), [chat.blocks, me]);
  // Member content rules: what I've reported disappears from my view until the board has looked.
  const reportedMessageIds = useMemo(
    () => chat.reports.filter((r) => r.reporterId === me?.id && !r.resolvedAt).map((r) => r.messageId),
    [chat.reports, me],
  );

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
    reportedMessageIds,
    conversation: (chatId) => withParent(chat.conversations.find((c) => c.id === chatId), chat.conversations),
    messages: (chatId) =>
      withoutBlocked(chat.messages.filter((m) => m.conversationId === chatId), chat.blocks, me?.id ?? null).filter((m) => !reportedMessageIds.includes(m.id)),
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
    createGroup: async (name, memberIds) => {
      const result = act.createGroup(ctx(), name, memberIds);
      setChat(result.chat);
      return result.id;
    },
    addToGroup: async (chatId, memberIds) => setChat(act.addToGroup(ctx(), chatId, memberIds)),
    renameGroup: async (chatId, name) => setChat(act.renameGroup(ctx(), chatId, name)),
    removeFromGroup: async (chatId, memberId) => setChat(act.removeFromGroup(ctx(), chatId, memberId)),
    leaveGroup: async (chatId) => setChat(act.leaveGroup(ctx(), chatId)),
    startTopic: async (chatId, name) => {
      const result = act.startTopic(ctx(), chatId, name);
      setChat(result.chat);
      return result.id;
    },
    renameTopic: async (chatId, name) => setChat(act.renameTopic(ctx(), chatId, name)),
    closeTopic: async (chatId) => setChat(act.closeTopic(ctx(), chatId)),
    reopenTopic: async (chatId) => setChat(act.reopenTopic(ctx(), chatId)),
    rideChat: async (rideId) => {
      const result = act.rideChat(ctx(), rideId);
      setChat(result.chat);
      return result.id;
    },
    reports: async () =>
      chat.reports.flatMap((r): ReportView[] => {
        const message = chat.messages.find((m) => m.id === r.messageId);
        const conversation = message && withParent(chat.conversations.find((c) => c.id === message.conversationId), chat.conversations);
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
    addToGallery: async (add) => {
      const cant = galleryAddProblem(me, { ...add, count: add.files.length }, club.rides);
      if (cant || !me) throw new NotAllowedError(cant ?? 'Sign in first.');
      const now = new Date().toISOString();
      const caption = cleanCaption(add.caption);
      const added: GalleryItem[] = add.files.map((f, i) => ({
        id: `demo-g-${Date.now()}-${i}`, uploadedBy: me.id, rideId: add.rideId, kind: f.kind, path: f.uri, posterPath: null,
        width: f.width, height: f.height, durationMs: f.kind === 'video' ? f.durationMs : null, caption, websiteOk: add.websiteOk,
        websiteDeclinedAt: null, onWebsite: false, createdAt: now, removedAt: null,
      }));
      setChat((c) => ({ ...c, gallery: [...(c.gallery ?? []), ...added] }));
      return added.length;
    },
    removeGalleryItem: async (id) => {
      const item = chat.gallery?.find((g) => g.id === id);
      const cant = galleryRemoveProblem(me, club.positions, demoCrew, item);
      if (cant) throw new NotAllowedError(cant);
      const now = new Date().toISOString();
      setChat((c) => ({ ...c, gallery: (c.gallery ?? []).map((g) => (g.id === id ? { ...g, removedAt: now } : g)) }));
    },
    galleryAlbums: async () => albumChoices(club.rides, today),
    galleryForSite: async () =>
      isSitePhotoEditor(me, club.positions, demoCrew)
        ? (chat.gallery ?? []).filter(waitsForWebsite).map((g) => ({ ...g, albumTitle: club.rides.find((r) => r.id === g.rideId)?.title ?? null }))
        : [],
    approveGalleryForSite: async (id, caption) => {
      const cant = approveProblem(me, club.positions, demoCrew, chat.gallery?.find((g) => g.id === id), caption);
      if (cant) throw new NotAllowedError(cant);
      setChat((c) => ({ ...c, gallery: (c.gallery ?? []).map((g) => (g.id === id ? { ...g, onWebsite: true } : g)) }));
    },
    declineGalleryForSite: async (id) => {
      const cant = approveProblem(me, club.positions, demoCrew, chat.gallery?.find((g) => g.id === id), '');
      if (cant) throw new NotAllowedError(cant);
      const now = new Date().toISOString();
      setChat((c) => ({ ...c, gallery: (c.gallery ?? []).map((g) => (g.id === id ? { ...g, websiteDeclinedAt: now } : g)) }));
    },
    mediaUrl: async (path) => DEMO_MEDIA[path] ?? path,
    linkPreview: async (url) => DEMO_PREVIEWS[url] ?? null,
    refresh: async () => {},
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
