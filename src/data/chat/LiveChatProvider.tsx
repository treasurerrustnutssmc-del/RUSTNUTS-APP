// Live build: the club's chats in Supabase. Row-level security and the database's chat actions
// decide who reads and does what; the app checks the same rules first only so members get a clear
// message without a round trip. New and changed messages arrive through Realtime.

import type { SupabaseClient } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatTitle, postProblem, type Block, type Message } from '../../domain/chat';
import { NotAllowedError, useClub } from '../clubContext';
import { friendlyError, supabase } from '../supabase';
import {
  ChatContext,
  type Attachment,
  type ChatContextValue,
  type ChatSummary,
  type LinkPreview,
  type MediaSource,
} from './chatContext';
import { sortSummaries, withoutBlocked } from './chatList';
import {
  mergeMessages,
  toFeedItem,
  toMessage,
  toReport,
  toRide,
  toSummaryParts,
  uploadName,
  type ChatListJson,
  type FeedJson,
  type MessageRow,
  type ReportJson,
  type RideJson,
} from './liveChat';
import { prepareUpload, type Upload } from './media';

const PAGE = 40;
const BUCKET = 'chat-media';
const MESSAGE_FIELDS = '*, message_media(*), message_reactions(*)';
// Signed addresses last an hour; use them for 55 minutes.
const URL_LIFE_S = 3600;
const URL_KEEP_MS = 55 * 60_000;

// The chat tables and actions aren't in the generated types yet, so they go through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw friendlyError(error);
  return data as T;
}

/** Storage says "too large" or "quota" in its own words; members get ours. */
function uploadError(error: { message?: string; statusCode?: string }): Error {
  const msg = error.message ?? '';
  if (/maximum allowed size|too large|413/i.test(msg)) return new Error('That file is over 50 MB.');
  if (/quota|storage limit|exceeded/i.test(msg)) return new Error('The club’s photo space is full. Let the board know.');
  if (/mime|type.*not supported/i.test(msg)) return new Error('Only photos and videos can go in.');
  return friendlyError(error);
}

export function LiveChatProvider({ children }: { children: React.ReactNode }) {
  const { data: club, me } = useClub();
  const [rawList, setRawList] = useState<Omit<ChatSummary, 'title'>[]>([]);
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState<Record<string, Message[]>>({});
  const [older, setOlder] = useState<Record<string, boolean>>({});
  const [blocks, setBlocks] = useState<Block[]>([]);
  const openChats = useRef(new Map<string, number>());
  const urls = useRef(new Map<string, { url: string; until: number }>());
  const previews = useRef(new Map<string, LinkPreview | null>());
  const meId = me?.id ?? null;

  const loadList = useCallback(async () => {
    const rows = await rpc<ChatListJson[]>('chat_list');
    setRawList((rows ?? []).map(toSummaryParts));
    setReady(true);
  }, []);

  const loadBlocks = useCallback(async () => {
    const { data, error } = await db().from('member_blocks').select('blocker_id, blocked_id');
    if (error) throw friendlyError(error);
    setBlocks((data ?? []).map((b: { blocker_id: string; blocked_id: string }) => ({ blockerId: b.blocker_id, blockedId: b.blocked_id })));
  }, []);

  const loadPage = useCallback(async (chatId: string, before?: string) => {
    let query = db().from('messages').select(MESSAGE_FIELDS).eq('conversation_id', chatId);
    if (before) query = query.lt('created_at', before);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(PAGE);
    if (error) throw friendlyError(error);
    const rows = (data ?? []) as MessageRow[];
    setPages((p) => ({ ...p, [chatId]: mergeMessages(p[chatId] ?? [], rows.map(toMessage)) }));
    // The first page says whether there's more behind it; later pages say when the start is reached.
    setOlder((o) => (before || o[chatId] === undefined ? { ...o, [chatId]: rows.length === PAGE } : o));
  }, []);

  const markRead = useCallback((chatId: string) => {
    rpc('mark_chat_read', { p_chat: chatId }).then(
      () => setRawList((list) => list.map((s) => (s.conversation.id === chatId ? { ...s, unread: 0 } : s))),
      () => undefined,
    );
  }, []);

  // ChatProvider gives each signed-in person a fresh provider, so this only loads.
  useEffect(() => {
    if (!meId) return;
    Promise.resolve()
      .then(() => Promise.all([loadList(), loadBlocks()]))
      .catch(() => setReady(true));
  }, [meId, loadList, loadBlocks]);

  // One Realtime feed for every chat this person can read; a burst of changes means one refetch.
  useEffect(() => {
    if (!meId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const catchUp = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        loadList().catch(() => undefined);
        for (const chatId of openChats.current.keys()) {
          loadPage(chatId).catch(() => undefined);
          markRead(chatId);
        }
      }, 300);
    };
    const channel = db()
      .channel(`chat:${meId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, catchUp)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      db().removeChannel(channel);
    };
  }, [meId, loadList, loadPage, markRead]);

  const list = useMemo(
    () => sortSummaries(rawList.map((s) => ({ ...s, title: chatTitle(s.conversation, me, club, s.ride) }))),
    [rawList, me, club],
  );
  const conversation = (chatId: string) => list.find((s) => s.conversation.id === chatId)?.conversation;

  const open = useCallback(
    (chatId: string) => {
      openChats.current.set(chatId, (openChats.current.get(chatId) ?? 0) + 1);
      loadPage(chatId).catch(() => undefined);
      markRead(chatId);
      return () => {
        const n = (openChats.current.get(chatId) ?? 1) - 1;
        if (n > 0) openChats.current.set(chatId, n);
        else openChats.current.delete(chatId);
      };
    },
    [loadPage, markRead],
  );

  const after = async (chatId?: string) => {
    await Promise.all([loadList(), chatId ? loadPage(chatId) : Promise.resolve()]);
  };

  const chatOf = (messageId: string) =>
    Object.entries(pages).find(([, msgs]) => msgs.some((m) => m.id === messageId))?.[0];

  const upload = async (chatId: string, file: Upload, uploaded: string[]): Promise<string> => {
    const path = uploadName(chatId, file.contentType);
    const { error } = await db().storage.from(BUCKET).upload(path, file.bytes, { contentType: file.contentType, upsert: false });
    if (error) throw uploadError(error);
    uploaded.push(path);
    return path;
  };

  const send = async (chatId: string, body: string, attachments: Attachment[], replyToId: string | null) => {
    const conv = conversation(chatId);
    const replyTo = replyToId ? pages[chatId]?.find((m) => m.id === replyToId) ?? null : null;
    const cant = postProblem(me, conv, body, attachments.length, club, blocks, replyTo);
    if (cant) throw new NotAllowedError(cant);
    const uploaded: string[] = [];
    try {
      const media = [];
      for (const a of attachments) {
        if (a.kind === 'gif') {
          media.push({ kind: 'gif', path: a.url, width: a.width, height: a.height });
          continue;
        }
        const prepared = await prepareUpload(a);
        const path = await upload(chatId, prepared.file, uploaded);
        const posterPath = prepared.poster ? await upload(chatId, prepared.poster, uploaded) : null;
        media.push({ kind: a.kind, path, posterPath, width: prepared.file.width, height: prepared.file.height, durationMs: a.durationMs });
      }
      await rpc('send_message', { p_chat: chatId, p_body: body, p_media: media, p_reply_to: replyToId });
    } catch (e) {
      // Nothing half-sent: files that went up for a message that didn't are taken down again.
      if (uploaded.length) db().storage.from(BUCKET).remove(uploaded).then(() => undefined, () => undefined);
      throw e instanceof Error ? e : friendlyError(e as { message?: string });
    }
    await after(chatId);
  };

  const mediaUrl = async (path: string): Promise<MediaSource> => {
    if (path.startsWith('https://')) return path;
    const kept = urls.current.get(path);
    if (kept && kept.until > Date.now()) return kept.url;
    const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, URL_LIFE_S);
    if (error || !data) throw friendlyError(error);
    urls.current.set(path, { url: data.signedUrl, until: Date.now() + URL_KEEP_MS });
    return data.signedUrl;
  };

  const linkPreview = async (url: string): Promise<LinkPreview | null> => {
    if (previews.current.has(url)) return previews.current.get(url) ?? null;
    const { data, error } = await db().functions.invoke('link-preview', { body: { url } });
    // A link without a card is fine; only keep answers, so a dropped connection tries again later.
    if (error) return null;
    const preview = (data as { preview?: LinkPreview | null } | null)?.preview ?? null;
    previews.current.set(url, preview);
    return preview;
  };

  const value: ChatContextValue = {
    ready,
    list,
    unreadTotal: list.reduce((sum, s) => sum + s.unread, 0),
    blocks: blocks.filter((b) => b.blockerId === meId),
    conversation,
    messages: (chatId) => withoutBlocked(pages[chatId] ?? [], blocks, meId),
    hasOlder: (chatId) => older[chatId] ?? false,
    open,
    loadOlder: async (chatId) => {
      const oldest = pages[chatId]?.[0];
      if (oldest) await loadPage(chatId, oldest.createdAt);
    },
    send,
    remove: async (messageId) => {
      await rpc('remove_message', { p_message: messageId });
      await after(chatOf(messageId));
    },
    react: async (messageId, emoji) => {
      await rpc('toggle_reaction', { p_message: messageId, p_emoji: emoji });
      const chatId = chatOf(messageId);
      if (chatId) await loadPage(chatId);
    },
    pin: async (chatId, messageId) => {
      await rpc('pin_message', { p_chat: chatId, p_message: messageId });
      await after(chatId);
    },
    report: async (messageId, reason) => {
      await rpc('report_message', { p_message: messageId, p_reason: reason });
    },
    setBlock: async (memberId, blocked) => {
      await rpc('set_block', { p_member: memberId, p_blocked: blocked });
      await Promise.all([loadBlocks(), loadList()]);
    },
    openDirect: async (memberId) => {
      const id = await rpc<string>('open_direct_chat', { p_member: memberId });
      await loadList();
      return id;
    },
    rideChat: async (rideId) => {
      const id = await rpc<string>('ride_chat', { p_ride: rideId });
      await loadList();
      return id;
    },
    reports: async () => ((await rpc<ReportJson[]>('chat_reports')) ?? []).map(toReport),
    resolveReport: async (reportId, remove) => {
      await rpc('resolve_report', { p_report: reportId, p_remove: remove });
      await loadList();
    },
    photos: async (before) => ((await rpc<FeedJson[]>('club_photos', { p_before: before ?? null, p_limit: 60 })) ?? []).map(toFeedItem),
    rideWalls: async () => {
      const walls = await rpc<{ ride: RideJson; chat_id: string; count: number; cover: FeedJson | null }[]>('ride_walls');
      return (walls ?? []).map((w) => ({ ride: toRide(w.ride), chatId: w.chat_id, count: w.count, cover: w.cover && toFeedItem(w.cover) }));
    },
    rideWall: async (rideId) => {
      const w = await rpc<{ ride: RideJson; chat_id: string; media: FeedJson[] }>('ride_wall', { p_ride: rideId });
      return { ride: toRide(w.ride), chatId: w.chat_id, media: w.media.map(toFeedItem) };
    },
    mediaUrl,
    linkPreview,
    refresh: async () => {
      await Promise.all([loadList(), loadBlocks(), ...[...openChats.current.keys()].map((id) => loadPage(id))]);
    },
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
