// Live build: the club's chats in Supabase. Row-level security and the database's chat actions
// decide who reads and does what; the app checks the same rules first only so members get a clear
// message without a round trip. New and changed messages arrive through Realtime.

import type { SupabaseClient } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { addProblem as galleryAddProblem, GALLERY_FOLDER } from '../../domain/gallery';
import { chatTitle, postProblem, withParent, type Block, type Conversation, type Message } from '../../domain/chat';
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
  goneMedia,
  mergeMessages,
  toConversation,
  toFeedItem,
  toGalleryItem,
  toMessage,
  toReport,
  toRide,
  toSeenRead,
  toSummaryParts,
  uploadName,
  type ChatJson,
  type ChatListJson,
  type FeedJson,
  type MessageRow,
  type ReportJson,
  type RideJson,
  type SeenRow,
} from './liveChat';
import type { SeenRead } from '../../domain/chatSeen';
import { prepareUpload, prepareVoiceUpload, type Upload } from './media';
import { clearChatNotifications } from '../clearChatNotifications';

const PAGE = 40;
const BUCKET = 'chat-media';
const MESSAGE_FIELDS = '*, message_media(*), message_reactions(*)';
// A signed address keeps working until it runs out, even after the photo is removed, so they're
// short: five minutes, used for four. Removing a message also throws away its addresses here.
const URL_LIFE_S = 300;
const URL_KEEP_MS = 4 * 60_000;
// A link that got no answer (a dropped connection, a slow site) is tried again after this long.
const PREVIEW_RETRY_MS = 10 * 60_000;
// Someone else opening a chat sends nothing to this phone, so Seen by is fetched again this often while a chat is open.
const SEEN_EVERY_MS = 30_000;
const CONVERSATION_FIELDS = 'id, kind, chapter_id, ride_id, committee, pinned_message_id, conversation_members(member_id)';
// From the chat topics paste on, a chat opened before the list arrives (from a push) also needs these.
const TOPIC_FIELDS = `${CONVERSATION_FIELDS}, name, created_by, parent_id, closed_at, closed_by`;

// The chat tables and actions aren't in the generated types yet, so they go through an untyped client.
const db = () => supabase() as unknown as SupabaseClient;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw friendlyError(error);
  return data as T;
}

/** Storage says "too large" or "quota" in its own words; members get ours. */
function uploadError(error: { message?: string; statusCode?: string }, contentType: string): Error {
  const msg = error.message ?? '';
  // Before the voice notes paste, the club's storage doesn't take recordings yet.
  if (/mime|type.*not supported/i.test(msg) && contentType.startsWith('audio/')) return new Error('Voice notes aren’t switched on yet. Try again later.');
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
  const [seen, setSeen] = useState<Record<string, SeenRead[]>>({});
  const [blocks, setBlocks] = useState<Block[]>([]);
  // Member content rules: messages I've reported that the board hasn't dealt with yet.
  const [reportedMessageIds, setReportedMessageIds] = useState<string[]>([]);
  // Chats opened from somewhere other than the list (a ride outside its week, a photo, a report).
  const [extra, setExtra] = useState<Record<string, Conversation>>({});
  const openChats = useRef(new Map<string, number>());
  const listed = useRef(new Set<string>());
  const urls = useRef(new Map<string, { url: Promise<string>; until: number }>());
  const previews = useRef(new Map<string, { preview: LinkPreview | null; until: number }>());
  const meId = me?.id ?? null;

  const loadList = useCallback(async () => {
    const rows = (await rpc<ChatListJson[]>('chat_list')) ?? [];
    listed.current = new Set(rows.map((r) => r.id));
    setRawList(rows.map(toSummaryParts));
    setReady(true);
  }, []);

  const loadMyReports = useCallback(async () => {
    const mine = (await rpc<{ kind: string; target_id: string }[]>('my_open_reports').catch(() => [])) ?? [];
    setReportedMessageIds(mine.filter((r) => r.kind === 'message').map((r) => r.target_id));
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
    const incoming = ((data ?? []) as MessageRow[]).map(toMessage);
    setPages((p) => {
      for (const path of goneMedia(p[chatId] ?? [], incoming)) urls.current.delete(path);
      return { ...p, [chatId]: mergeMessages(p[chatId] ?? [], incoming) };
    });
    // The first page says whether there's more behind it; later pages say when the start is reached.
    setOlder((o) => (before || o[chatId] === undefined ? { ...o, [chatId]: incoming.length === PAGE } : o));
  }, []);

  const loadConversation = useCallback(async (chatId: string) => {
    let { data, error } = await db().from('conversations').select(TOPIC_FIELDS).eq('id', chatId).maybeSingle();
    // Before the topics paste those columns aren't there yet.
    if (error) ({ data, error } = await db().from('conversations').select(CONVERSATION_FIELDS).eq('id', chatId).maybeSingle());
    if (error || !data) return;
    const row = data as ChatJson & { conversation_members: { member_id: string }[] };
    setExtra((x) => ({ ...x, [chatId]: toConversation({ ...row, member_ids: row.conversation_members.map((m) => m.member_id) }) }));
  }, []);

  // Before the Seen by paste the database has no chat_seen: the line just doesn't show.
  const loadSeen = useCallback(async (chatId: string) => {
    const rows = await rpc<SeenRow[]>('chat_seen', { p_chat: chatId }).catch(() => null);
    if (rows) setSeen((x) => ({ ...x, [chatId]: rows.map(toSeenRead) }));
  }, []);

  const markRead = useCallback(
    (chatId: string) =>
      rpc('mark_chat_read', { p_chat: chatId }).then(
        () => {
          setRawList((list) => list.map((s) => (s.conversation.id === chatId ? { ...s, unread: 0 } : s)));
          void clearChatNotifications(chatId);
        },
        () => undefined,
      ),
    [],
  );

  // ChatProvider gives each signed-in person a fresh provider, so this only loads.
  useEffect(() => {
    if (!meId) return;
    Promise.resolve()
      .then(() => Promise.all([loadList(), loadBlocks(), loadMyReports()]))
      .catch(() => setReady(true));
  }, [meId, loadList, loadBlocks, loadMyReports]);

  // One Realtime feed for every chat this person can read; a burst of changes means one refetch.
  useEffect(() => {
    if (!meId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const catchUp = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const open = [...openChats.current.keys()];
        for (const chatId of open) {
          loadPage(chatId).catch(() => undefined);
          void loadSeen(chatId);
        }
        // Open chats are marked read before the list is fetched, so their counts don't come back. Not
        // while the app is in the background: nobody's looking, and the club would hold back pushes.
        const looking = AppState.currentState === 'active' ? open : [];
        Promise.all(looking.map(markRead)).then(() => loadList()).catch(() => undefined);
      }, 300);
    };
    // Also catch up whenever the feed (re)connects and when the app comes back to the front, since
    // nothing arrives while the phone sleeps.
    const channel = db()
      .channel(`chat:${meId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, catchUp)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') catchUp();
      });
    const awake = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });
    const seenTimer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      for (const chatId of openChats.current.keys()) void loadSeen(chatId);
    }, SEEN_EVERY_MS);
    return () => {
      clearInterval(seenTimer);
      if (timer) clearTimeout(timer);
      awake.remove();
      db().removeChannel(channel);
    };
  }, [meId, loadList, loadPage, markRead, loadSeen]);

  const list = useMemo(() => {
    // A topic comes with its chat, so the rules can look through it.
    const all = rawList.map((s) => s.conversation);
    return sortSummaries(rawList.map((s) => {
      const conversation = withParent(s.conversation, all)!;
      return { ...s, conversation, title: chatTitle(conversation, me, club, s.ride) };
    }));
  }, [rawList, me, club]);
  const conversation = (chatId: string) =>
    list.find((s) => s.conversation.id === chatId)?.conversation ?? withParent(extra[chatId], [...list.map((s) => s.conversation), ...Object.values(extra)]);

  const open = useCallback(
    (chatId: string) => {
      openChats.current.set(chatId, (openChats.current.get(chatId) ?? 0) + 1);
      if (!listed.current.has(chatId)) loadConversation(chatId).catch(() => undefined);
      loadPage(chatId).catch(() => undefined);
      markRead(chatId);
      void loadSeen(chatId);
      return () => {
        const n = (openChats.current.get(chatId) ?? 1) - 1;
        if (n > 0) openChats.current.set(chatId, n);
        else openChats.current.delete(chatId);
      };
    },
    [loadPage, markRead, loadConversation, loadSeen],
  );

  const after = async (chatId?: string) => {
    await Promise.all([
      loadList(),
      chatId ? loadPage(chatId) : Promise.resolve(),
      chatId && !listed.current.has(chatId) ? loadConversation(chatId) : Promise.resolve(),
    ]);
  };

  const chatOf = (messageId: string) =>
    Object.entries(pages).find(([, msgs]) => msgs.some((m) => m.id === messageId))?.[0];

  const upload = async (chatId: string, file: Upload, uploaded: string[]): Promise<string> => {
    const path = uploadName(chatId, file.contentType);
    const { error } = await db().storage.from(BUCKET).upload(path, file.bytes, { contentType: file.contentType, upsert: false });
    if (error) throw uploadError(error, file.contentType);
    uploaded.push(path);
    return path;
  };

  const send = async (chatId: string, body: string, attachments: Attachment[], replyToId: string | null) => {
    const conv = conversation(chatId);
    const replyTo = replyToId ? pages[chatId]?.find((m) => m.id === replyToId) ?? null : null;
    const kinds = attachments.map((a) => ({ kind: a.kind, durationMs: a.kind === 'gif' ? null : a.durationMs }));
    const cant = postProblem(me, conv, body, kinds, club, blocks, replyTo);
    if (cant) throw new NotAllowedError(cant);
    const uploaded: string[] = [];
    try {
      const media = [];
      for (const a of attachments) {
        if (a.kind === 'gif') {
          media.push({ kind: 'gif', path: a.url, width: a.width, height: a.height });
          continue;
        }
        if (a.kind === 'voice') {
          const path = await upload(chatId, await prepareVoiceUpload(a), uploaded);
          media.push({ kind: 'voice', path, posterPath: null, width: 0, height: 0, durationMs: Math.round(a.durationMs) });
          continue;
        }
        const prepared = await prepareUpload(a);
        const path = await upload(chatId, prepared.file, uploaded);
        const posterPath = prepared.poster ? await upload(chatId, prepared.poster, uploaded) : null;
        media.push({
          kind: a.kind, path, posterPath, width: Math.round(prepared.file.width), height: Math.round(prepared.file.height),
          durationMs: a.durationMs === null ? null : Math.round(a.durationMs),
        });
      }
      await rpc('send_message', { p_chat: chatId, p_body: body, p_media: media, p_reply_to: replyToId });
    } catch (e) {
      // Nothing half-sent: files that went up for a message that didn't are taken down again.
      if (uploaded.length) db().storage.from(BUCKET).remove(uploaded).then(() => undefined, () => undefined);
      throw e instanceof Error ? e : friendlyError(e as { message?: string });
    }
    await after(chatId);
  };

  // One request per file however many tiles ask at once.
  const mediaUrl = useCallback(async (path: string): Promise<MediaSource> => {
    if (path.startsWith('https://')) return path;
    const kept = urls.current.get(path);
    if (kept && kept.until > Date.now()) return kept.url;
    const url = db()
      .storage.from(BUCKET)
      .createSignedUrl(path, URL_LIFE_S)
      .then(({ data, error }) => {
        if (error || !data) throw friendlyError(error);
        return data.signedUrl;
      });
    urls.current.set(path, { url, until: Date.now() + URL_KEEP_MS });
    url.catch(() => urls.current.delete(path));
    return url;
  }, []);

  const linkPreview = useCallback(async (url: string): Promise<LinkPreview | null> => {
    const kept = previews.current.get(url);
    if (kept && kept.until > Date.now()) return kept.preview;
    const { data, error } = await db().functions.invoke('link-preview', { body: { url } });
    // A link without a card is fine. A real answer is kept; no answer is tried again later.
    const preview = error ? null : (data as { preview?: LinkPreview | null } | null)?.preview ?? null;
    previews.current.set(url, { preview, until: error ? Date.now() + PREVIEW_RETRY_MS : Infinity });
    return preview;
  }, []);

  const reports = useCallback(async () => ((await rpc<ReportJson[]>('chat_reports')) ?? []).map(toReport), []);

  const value: ChatContextValue = {
    ready,
    list,
    unreadTotal: list.reduce((sum, s) => sum + s.unread, 0),
    blocks: blocks.filter((b) => b.blockerId === meId),
    reportedMessageIds,
    conversation,
    messages: (chatId) => withoutBlocked(pages[chatId] ?? [], blocks, meId).filter((m) => !reportedMessageIds.includes(m.id)),
    hasOlder: (chatId) => older[chatId] ?? false,
    seenReads: (chatId) => seen[chatId],
    loadSeen,
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
      await loadMyReports();
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
    createGroup: async (name, memberIds) => {
      const id = await rpc<string>('create_group_chat', { p_name: name, p_members: memberIds });
      await loadList();
      return id;
    },
    addToGroup: async (chatId, memberIds) => {
      await rpc('add_to_group', { p_chat: chatId, p_members: memberIds });
      await loadList();
    },
    renameGroup: async (chatId, name) => {
      await rpc('rename_group', { p_chat: chatId, p_name: name });
      await loadList();
    },
    removeFromGroup: async (chatId, memberId) => {
      await rpc('remove_from_group', { p_chat: chatId, p_member: memberId });
      await loadList();
    },
    leaveGroup: async (chatId) => {
      await rpc('leave_group', { p_chat: chatId });
      await loadList();
    },
    startTopic: async (chatId, name) => {
      const id = await rpc<string>('start_topic', { p_chat: chatId, p_name: name });
      await loadList();
      return id;
    },
    renameTopic: async (chatId, name) => {
      await rpc('rename_topic', { p_chat: chatId, p_name: name });
      await loadList();
    },
    closeTopic: async (chatId) => {
      await rpc('close_topic', { p_chat: chatId });
      await loadList();
    },
    reopenTopic: async (chatId) => {
      await rpc('reopen_topic', { p_chat: chatId });
      await loadList();
    },
    rideChat: async (rideId) => {
      const id = await rpc<string>('ride_chat', { p_ride: rideId });
      await loadList();
      return id;
    },
    reports,
    resolveReport: async (reportId, remove) => {
      await rpc('resolve_report', { p_report: reportId, p_remove: remove });
      await loadList();
    },
    photos: async (before) => ((await rpc<FeedJson[]>('club_photos', { p_before: before ?? null, p_limit: 60 })) ?? []).map(toFeedItem),
    rideWalls: async () => {
      const walls = await rpc<{ ride: RideJson; chat_id: string | null; count: number; cover: FeedJson | null }[]>('ride_walls');
      return (walls ?? []).map((w) => ({ ride: toRide(w.ride), chatId: w.chat_id, count: w.count, cover: w.cover && toFeedItem(w.cover) }));
    },
    rideWall: async (rideId) => {
      const w = await rpc<{ ride: RideJson; chat_id: string | null; media: FeedJson[] }>('ride_wall', { p_ride: rideId });
      return { ride: toRide(w.ride), chatId: w.chat_id, media: w.media.map(toFeedItem) };
    },
    addToGallery: async (add) => {
      // Its ride list starts today, so the database checks the album (an older ride's wall can add too).
      const cant = galleryAddProblem(me, { ...add, count: add.files.length }, null);
      if (cant || !me) throw new NotAllowedError(cant ?? 'Sign in first.');
      const folder = `${GALLERY_FOLDER}/${me.id}`;
      const uploaded: string[] = [];
      try {
        const items = [];
        for (const f of add.files) {
          const prepared = await prepareUpload(f);
          const path = await upload(folder, prepared.file, uploaded);
          const posterPath = prepared.poster ? await upload(folder, prepared.poster, uploaded) : null;
          items.push({
            kind: f.kind, path, poster_path: posterPath, width: Math.round(prepared.file.width), height: Math.round(prepared.file.height),
            duration_ms: f.durationMs === null ? null : Math.round(f.durationMs),
          });
        }
        return await rpc<number>('add_gallery_items', {
          p_ride: add.rideId, p_caption: add.caption, p_website_ok: add.websiteOk, p_consent: add.consent, p_items: items,
        });
      } catch (e) {
        // Nothing half-added: files that went up are taken down again.
        if (uploaded.length) db().storage.from(BUCKET).remove(uploaded).then(() => undefined, () => undefined);
        throw e instanceof Error ? e : friendlyError(e as { message?: string });
      }
    },
    removeGalleryItem: async (id) => {
      await rpc('remove_gallery_item', { p_id: id });
    },
    galleryForSite: async () => ((await rpc<FeedJson[]>('gallery_for_site')) ?? []).map(toGalleryItem),
    galleryAlbums: async () =>
      ((await rpc<{ id: string; title: string; starts_at: string }[]>('gallery_albums')) ?? []).map((r) => ({
        id: r.id, title: r.title, startsAt: r.starts_at, cancelledAt: null,
      })),
    approveGalleryForSite: async (id, caption) => {
      await rpc('approve_gallery_for_site', { p_id: id, p_caption: caption });
    },
    declineGalleryForSite: async (id) => {
      await rpc('decline_gallery_for_site', { p_id: id });
    },
    mediaUrl,
    linkPreview,
    refresh: async () => {
      await Promise.all([loadList(), loadBlocks(), loadMyReports(), ...[...openChats.current.keys()].map((id) => loadPage(id))]);
    },
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
