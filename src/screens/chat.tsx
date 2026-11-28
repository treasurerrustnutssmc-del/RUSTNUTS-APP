// The club's chats: the list of your chats, one chat with its messages and composer, starting a
// private chat, starting and running a group (board members and the NEC), and the reports a
// moderator looks at.

import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { useAiConsent } from '../data/aiConsent';
import { useCatchUpApi } from '../data/catchUpApi';
import { isFamily } from '../domain/access'; // Family chat
import { AI_PROVIDER_LINE } from '../domain/aiConsent';
import { catchUpCount } from '../domain/catchUp';
import { firstNewMessage } from '../domain/chatResume';
import { lastOwnMessage, readTags, seenBy, seenLine, withOwnPosts, type SeenRead } from '../domain/chatSeen';
import { composerBottomRoom } from '../domain/keyboard';
import { useChat } from '../data/chat/ChatProvider';
import { useSocial } from '../data/social/SocialProvider'; // Member content rules
import { REPORT_KIND_LABEL, type ContentReport } from '../domain/reports';
import type { Attachment, ChatSummary, ReportView, VoiceRecording } from '../data/chat/chatContext';
import { foldTopics, topicsOf } from '../data/chat/chatList';
import { pickMedia } from '../data/chat/media';
import { watchChat } from '../data/viewingChat';
import {
  addToGroupProblem,
  trimWords,
  canModerate,
  canRunGroups,
  canRunTopic,
  hasTopics,
  topicParentTitle,
  chatTitle,
  createGroupProblem,
  directProblem,
  groupNameProblem,
  MAX_GROUP_NAME,
  findLinks,
  groupMessages,
  MAX_MEDIA,
  mediaSummary,
  messageSpoken,
  quoteWords,
  readProblem,
  removeProblem,
  unknownAuthors,
  type Conversation,
  type Message,
} from '../domain/chat';
import { pickReadable } from '../domain/contrast';
import { hasAgreedPostingRules } from '../domain/postingRules'; // Family chat
import { formatAuDate } from '../domain/dates';
import { authorPageLabel, authorSpoken } from '../domain/home';
import { displayName, FORMER_MEMBER, initials } from '../domain/profile';
import { insertTag, tagQuery, tagSuggestions } from '../domain/chatTags';
import { melbourneDate, melbourneTime } from '../domain/rides';
import type { Member } from '../domain/types';
import type { RootScreen, TabScreen } from '../navigation/types';
import { colors, fonts, MAX_CONTENT_WIDTH, radius, space, type } from '../theme';
import {
  ActionChip,
  AttachmentStrip,
  AuthorLine,
  feedItemsOf,
  GifPicker,
  IconButton,
  LinkCard,
  MediaGrid,
  MessageText,
  ReactionBar,
  ReactionPills,
  ReplyQuote,
} from '../ui/ChatBits';
import { AiConsentCard } from '../ui/AiConsentCard';
import { MemberRow } from '../ui/MemberBits';
import {
  Avatar,
  Body,
  Button,
  Card,
  ConfirmButton,
  Field,
  IconBadge,
  Ionicons,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  type IconName,
} from '../ui/primitives';
import { voiceNoteOffHint } from '../domain/rideVoiceDemo';
import { useOnRideCall, VoiceNote, VoiceRecorderBar } from '../ui/VoiceBits';

const KIND_ICON: Record<string, IconName> = {
  club: 'people',
  family: 'heart',
  chapter: 'flag',
  board: 'shield',
  boards: 'shield-half',
  nec: 'star',
  committee: 'construct',
  ride: 'speedometer',
  group: 'people-circle',
};

/** "7:30 am" today, "Yesterday", or the date. */
export function when(iso: string, today: string): string {
  const day = melbourneDate(iso);
  if (day === today) return melbourneTime(iso);
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
  return formatAuDate(day);
}

export function preview(s: ChatSummary, me: Member | null, members: Member[]): string {
  const last = s.last;
  if (!last) return s.conversation.kind === 'direct' ? 'Say g’day.' : 'Nothing yet.';
  const who = last.authorId === me?.id ? 'You' : displayName(members.find((m) => m.id === last.authorId) ?? { roadName: null, fullName: 'Someone' });
  const what = last.removed ? 'Message removed' : last.body ?? (mediaSummary(last.mediaCount, last.voice) || 'Photo');
  const line = s.conversation.kind === 'direct' && who !== 'You' ? what : `${who}: ${what}`;
  // The newest line is from one of the chat's topics: say which.
  return s.lastTopic ? `${s.lastTopic} · ${line}` : line;
}

export function UnreadBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <View style={styles.unread} accessibilityLabel={`${n} unread`}>
      <Text style={styles.unreadText}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

export function ChatListScreen({ navigation }: TabScreen<'Chats'>) {
  const { me, data, today } = useClub();
  const chat = useChat();
  const social = useSocial();
  const [reportCount, setReportCount] = useState(0);
  // Someone who might join gets no private chats until they're an FNG. Family get the Family chat only:
  // no private chats and no photo feeds.
  const family = isFamily(me);
  const mayMessage = !!me && me.approval === 'approved' && me.status !== 'introduced' && !family;
  // Board members and the NEC start groups (2026-11-20-chat-groups-design.md).
  const mayGroup = canRunGroups(me, data);
  const people = useMemo(() => [...data.members, ...(data.chatPeople ?? [])], [data.members, data.chatPeople]);
  // Topics sit inside their chat, which counts their new messages (2026-11-24-chat-topics-design.md).
  const rows = useMemo(() => foldTopics(chat.list), [chat.list]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Row style={{ gap: 2, marginRight: space.sm }}>
          {family ? null : <IconButton icon="images-outline" label="Photos and ride walls" caption="Photos" onPress={() => navigation.navigate('Photos')} />}
          {mayGroup ? <IconButton icon="people-outline" label="New group" caption="New group" onPress={() => navigation.navigate('NewGroup')} /> : null}
          {mayMessage ? <IconButton icon="create-outline" label="New private chat" caption="Message" onPress={() => navigation.navigate('NewChat')} /> : null}
        </Row>
      ),
    });
  }, [navigation, mayMessage, mayGroup, family]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      // Chat reports and reports of posts (listings, builds, nominations, workshops, profiles) count together.
      Promise.all([chat.reports(), social.contentReports().catch(() => [])]).then(([a, b]) => live && setReportCount(a.length + b.length), () => undefined);
      return () => {
        live = false;
      };
    }, [chat.reports, social.contentReports]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <Screen onRefresh={chat.refresh}>
      {reportCount ? (
        <Card style={{ padding: 0 }}>
          <ListRow
            last
            left={<IconBadge icon="flag-outline" />}
            title={`Reports to look at (${reportCount})`}
            subtitle="Messages and posts members have flagged for the board."
            onPress={() => navigation.navigate('ChatReports')}
          />
        </Card>
      ) : null}
      {!chat.ready ? (
        <Small>Loading your chats…</Small>
      ) : rows.length === 0 ? (
        <Notice title="No chats yet">Chats open up once the board approves you.</Notice>
      ) : (
        <Card style={{ padding: 0 }}>
          {rows.map((s, i) => {
            const other = s.conversation.kind === 'direct' ? data.members.find((m) => s.conversation.memberIds.includes(m.id) && m.id !== me?.id) : null;
            return (
              <ListRow
                key={s.conversation.id}
                last={i === rows.length - 1}
                left={other ? <Avatar text={initials(other)} /> : <IconBadge icon={KIND_ICON[s.conversation.kind] ?? 'chatbubbles'} />}
                title={
                  <Row style={{ gap: space.sm, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <Text numberOfLines={2} style={[type.name, { flex: 1 }]}>{s.title}</Text>
                    {s.last ? <Text style={styles.listTime}>{when(s.last.createdAt, today)}</Text> : null}
                  </Row>
                }
                subtitle={
                  <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
                    <Small numberOfLines={1} style={[{ flex: 1 }, s.unread ? { color: colors.boneDim } : null]}>{preview(s, me, people)}</Small>
                    <UnreadBadge n={s.unread} />
                  </Row>
                }
                onPress={() => navigation.navigate('Chat', { chatId: s.conversation.id })}
              />
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

type Item = { key: string; kind: 'day'; label: string } | { key: string; kind: 'new'; count: number; complete: boolean } | { key: string; kind: 'message'; message: Message; first: boolean; last: boolean };

// Members the club was reloaded for once already this run, so a removed member's old messages
// don't reload it every time.
const reloadedFor = new Set<string>();

/** Phones only: how far the keyboard covers the screen, so the composer sits on top of it. */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export function ChatScreen({ route, navigation }: RootScreen<'Chat'>) {
  const { chatId } = route.params;
  const { me, data, today, refresh, isDemo } = useClub();
  const chat = useChat();
  const catchUpApi = useCatchUpApi();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth, MAX_CONTENT_WIDTH);
  const summary = chat.list.find((s) => s.conversation.id === chatId);
  const conv = chat.conversation(chatId);
  const messages = chat.messages(chatId);
  const [selected, setSelected] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Lane E: share in. Something shared from another app starts in the message box.
  const [draft, setDraft] = useState(route.params.shared?.text ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>(route.params.shared?.media ?? []);
  const [gifs, setGifs] = useState(false);
  const [recording, setRecording] = useState(false);
  // A ride call holds the microphone, so voice notes wait until it's over (on an iPhone the
  // recorder would take the call's microphone away).
  const onCall = useOnRideCall();
  const voiceOff = voiceNoteOffHint(onCall);
  // A ride call holds the microphone: a voice note already being recorded stops when one starts.
  if (onCall && recording) setRecording(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState<string | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const sendingNow = useRef(false); // two quick taps land before the state catches up
  // Catch me up. The chat is marked read as soon as it's on screen, so how many were new is taken
  // when it opens (or when the chat list first arrives, opened from a notification) and kept while
  // it's open. The demo counts other people's messages so it can be tried.
  const [unreadAtOpen, setUnreadAtOpen] = useState<number | null>(() =>
    isDemo ? messages.filter((m) => m.authorId !== me?.id && !m.removedAt).length : (summary?.unread ?? null),
  );
  if (unreadAtOpen === null && summary) setUnreadAtOpen(summary.unread);
  // Open where I left off (Jeff, 28 Nov): how many were new when it opened, in the demo too, and the
  // first of them, fixed once enough is loaded so new arrivals don't move the line.
  const [newAtOpen, setNewAtOpen] = useState<number | null>(() => summary?.unread ?? null);
  if (newAtOpen === null && summary) setNewAtOpen(summary.unread);
  const [resumeAt, setResumeAt] = useState<string | null | undefined>(undefined);
  const [resumeComplete, setResumeComplete] = useState(true);
  const resumeLoads = useRef(0);
  const resumeLoading = useRef(false);
  const [resumeTick, setResumeTick] = useState(0);
  // Family chat: Catch me up, profiles and the photo feeds are members' things.
  const family = isFamily(me);
  const people = useMemo(() => [...data.members, ...(data.chatPeople ?? [])], [data.members, data.chatPeople]);
  const catchCount = family ? 0 : catchUpCount(unreadAtOpen ?? 0, isDemo);
  const [catching, setCatching] = useState(false);
  const [caught, setCaught] = useState<{ summary: string; count: number } | null>(null);
  const [catchError, setCatchError] = useState<string | null>(null);
  const catchingNow = useRef(false);
  // Nothing goes to Anthropic until the member has agreed, once, on this phone.
  const catchConsent = useAiConsent('catchUp');
  const [askingConsent, setAskingConsent] = useState(false);

  // Only the chat on screen is marked read; one under the photo viewer or a member's page isn't.
  useFocusEffect(
    useCallback(() => {
      const close = chat.open(chatId);
      const unwatch = watchChat(chatId); // no banner for this chat while it's on screen
      return () => {
        close();
        unwatch();
      };
    }, [chatId]), // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Someone who joined after the club was loaded isn't in the member list yet: reload it once
  // rather than calling them "Former member".
  const missingKey = useMemo(
    () => unknownAuthors(messages, people).filter((id) => !reloadedFor.has(id)).join(','),
    [messages, people],
  );
  useEffect(() => {
    if (!missingKey) return;
    const ids = missingKey.split(',');
    ids.forEach((id) => reloadedFor.add(id));
    // A failed reload (offline) can try again next time.
    refresh().catch(() => ids.forEach((id) => reloadedFor.delete(id)));
  }, [missingKey, refresh]);
  useLayoutEffect(() => {
    // A chat opened from a ride, photo or report may not be in the list, so its name is worked out here.
    const title = summary?.title ?? (conv && me ? chatTitle(conv, me, data, data.rides.find((r) => r.id === conv.rideId) ?? null) : 'Chat');
    navigation.setOptions({ title });
  }, [navigation, summary?.title, conv, me, data]);
  // A group's people, and for board members and the NEC adding, renaming and taking out. A topic's
  // name, who started it, and closing it.
  const isGroup = conv?.kind === 'group';
  const isTopic = conv?.kind === 'topic';
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: isGroup
        ? () => (
            <View style={{ marginRight: space.sm }}>
              <IconButton icon="people-outline" label="Group info" onPress={() => navigation.navigate('GroupInfo', { chatId })} />
            </View>
          )
        : isTopic
          ? () => (
              <View style={{ marginRight: space.sm }}>
                <IconButton icon="information-circle-outline" label="Topic info" onPress={() => navigation.navigate('TopicInfo', { chatId })} />
              </View>
            )
          : undefined,
    });
  }, [navigation, isGroup, isTopic, chatId]);
  // A board, committee or group chat's topics, for the bar at the top.
  const topics = useMemo(() => (conv && hasTopics(conv) ? topicsOf(chat.list, chatId) : []), [conv, chat.list, chatId]);
  const openTopics = topics.filter((t) => !t.conversation.closedAt).length;
  const topicsUnread = topics.reduce((n, t) => n + t.unread, 0);

  // Find the first new message, loading older pages (up to 5 more) when more were new than are loaded.
  useEffect(() => {
    if (resumeAt !== undefined || resumeLoading.current || newAtOpen === null || !me || !chat.pageLoaded(chatId)) return;
    const found = firstNewMessage(messages, me.id, newAtOpen);
    if (found && !found.complete && chat.hasOlder(chatId) && resumeLoads.current < 5) {
      resumeLoads.current += 1;
      resumeLoading.current = true;
      chat
        .loadOlder(chatId)
        .catch(() => { resumeLoads.current = 5; })
        .finally(() => { resumeLoading.current = false; setResumeTick((n) => n + 1); });
      return;
    }
    setResumeComplete(found?.complete ?? true);
    setResumeAt(found?.messageId ?? null);
  }, [messages.length, messages[0]?.id, newAtOpen, me, resumeAt, chatId, resumeTick, chat.pageLoaded(chatId)]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const day of groupMessages(messages, today)) {
      out.push({ key: `day-${day.day}-${day.runs[0]?.messages[0]?.id}`, kind: 'day', label: day.day });
      for (const run of day.runs) {
        run.messages.forEach((m, i) => {
          if (m.id === resumeAt) out.push({ key: 'new-messages', kind: 'new', count: newAtOpen ?? 0, complete: resumeComplete });
          // The line splits a run of bubbles, so each side rounds off at it.
          const first = i === 0 || m.id === resumeAt;
          const last = i === run.messages.length - 1 || run.messages[i + 1].id === resumeAt;
          out.push({ key: m.id, kind: 'message', message: m, first, last });
        });
      }
    }
    return out.reverse(); // newest at the bottom of an upside-down list
  }, [messages, today, resumeAt, newAtOpen, resumeComplete]);

  // Scroll once so the New messages line sits at the top of the screen. The list is upside down, so
  // the top of the screen is the far end (viewPosition 1).
  // Never once they've started scrolling themselves, and a few tries at most while rows are drawn.
  const list = useRef<FlatList<Item>>(null);
  const itemsNow = useRef(items);
  useLayoutEffect(() => {
    itemsNow.current = items;
  }, [items]);
  const scrolledToNew = useRef(false);
  const userScrolled = useRef(false);
  const scrollTries = useRef(0);
  const toNewLine = useCallback(() => {
    if (userScrolled.current) return;
    const index = itemsNow.current.findIndex((i) => i.kind === 'new');
    if (index >= 0) list.current?.scrollToIndex({ index, viewPosition: 1, animated: false });
  }, []);
  const hasNewLine = items.some((i) => i.kind === 'new');
  useEffect(() => {
    if (scrolledToNew.current || !hasNewLine) return;
    const t = setTimeout(() => {
      scrolledToNew.current = true;
      toNewLine();
    }, 50);
    return () => clearTimeout(t);
  }, [hasNewLine, toNewLine]);
  const [awayFromNewest, setAwayFromNewest] = useState(false);

  // Seen by goes under my newest message (2026-11-26, Jeff: tell "seen, no reply" from "not seen yet").
  const rawReads = chat.seenReads(chatId);
  const lastMine = me ? lastOwnMessage(messages, me.id) : undefined;
  // Messages arrive live but looks only every 30 seconds: a newer post of theirs moves their look up to it.
  // Keyed on what the answer depends on, so a re-render with the same messages and looks doesn't redo it.
  const seenKey = rawReads
    ? `${rawReads.map((r) => `${r.memberId}:${r.seenAt ?? ''}`).join('|')}#${messages.map((m) => `${m.id}:${m.authorId}:${m.createdAt}:${m.removedAt ? 1 : 0}`).join('|')}`
    : '';
  const seenReads = useMemo(() => (rawReads ? withOwnPosts(rawReads, messages) : undefined), [seenKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Messenger-style tags (Jeff, 28 Nov): everyone's initials under the last message they've seen, anyone's message.
  const tags = useMemo(() => (seenReads ? readTags(messages, seenReads) : new Map<string, string[]>()), [seenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinned = conv?.pinnedMessageId ? messages.find((m) => m.id === conv.pinnedMessageId) : undefined;
  const moderator = !!conv && canModerate(me, conv, data);
  const nameOf = (id: string) => (id === me?.id ? 'You' : displayName(people.find((m) => m.id === id) ?? { roadName: null, fullName: 'Former member' }));

  // Chat tags (Jeff, 28 Nov 2026): @name or @everyone rings that person's phone. Anyone who reads this
  // chat can be tagged; the database tells them (20271020000000_chat_tags.sql).
  const readers = useMemo(
    () => (conv ? people.filter((p) => readProblem(p, conv, data) === null) : []),
    [people, conv, data],
  );
  const tagNames = useMemo(() => readers.map(displayName), [readers]);
  const myName = me ? displayName(me) : undefined;
  // Where the cursor is, so a tag can be typed anywhere in the message, not only at the end.
  const [cursor, setCursor] = useState<number | null>(null);
  const at = Math.min(cursor ?? draft.length, draft.length);
  const typingTag = tagQuery(draft, at);
  const tagChoices = useMemo(
    () => (typingTag === null ? [] : tagSuggestions(typingTag, readers.filter((p) => p.id !== me?.id).map((p) => ({ id: p.id, name: displayName(p) })), 5)),
    [typingTag, readers, me?.id],
  );

  const run = async (job: () => Promise<void>) => {
    try {
      setError(null);
      await job();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const catchUp = () => {
    if (!catchConsent.loaded) return;
    if (!catchConsent.agreed) setAskingConsent(true);
    else void runCatchUp();
  };

  const agreeToCatchUp = async () => {
    await catchConsent.agree();
    setAskingConsent(false);
    await runCatchUp();
  };

  // Only ever reached after the member has agreed (catchUp and agreeToCatchUp).
  const runCatchUp = async () => {
    if (!catchCount || catchingNow.current) return;
    catchingNow.current = true;
    setCatching(true);
    setCatchError(null);
    try {
      setCaught(await catchUpApi.catchUp(chatId, catchCount, messages));
    } catch (e) {
      setCatchError((e as Error).message);
    } finally {
      catchingNow.current = false;
      setCatching(false);
    }
  };

  const pick = (source: 'library' | 'camera') =>
    run(async () => {
      const picked = await pickMedia(source, MAX_MEDIA - attachments.length);
      setAttachments((a) => [...a, ...picked].slice(0, MAX_MEDIA));
    });

  const send = async (voice?: VoiceRecording) => {
    if (sendingNow.current) return;
    sendingNow.current = true;
    setSending(true);
    await run(async () => {
      // A voice note goes on its own; whatever was typed stays in the box.
      if (voice) {
        await chat.send(chatId, '', [voice], replyTo?.id ?? null);
        setRecording(false);
      } else {
        await chat.send(chatId, draft, attachments, replyTo?.id ?? null);
        setDraft('');
        setAttachments([]);
      }
      setReplyTo(null);
      setGifs(false);
    });
    sendingNow.current = false;
    setSending(false);
  };

  const startRecording = () => {
    setError(null);
    setGifs(false);
    Keyboard.dismiss();
    setRecording(true);
  };

  if (!conv || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Chat not found">It may have closed, or it isn’t one of yours.</Notice>
      </Screen>
    );
  }

  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !sending;
  const bubbleWidth = Math.min(width - space.lg * 2 - 40, 420);

  const renderMessage = (m: Message, first: boolean, last: boolean) => {
    const mine = m.authorId === me.id;
    const author = people.find((x) => x.id === m.authorId);
    const isSelected = selected === m.id;
    const showAuthor = first && !mine && conv.kind !== 'direct';
    // The name is a button of its own only when it opens their page (not for Family viewers or a former member).
    const nameLinks = showAuthor && author !== undefined && !family;
    const firstLink = m.body ? findLinks(m.body).find((p) => p.url)?.url : undefined;
    const replied = m.replyToId ? messages.find((x) => x.id === m.replyToId) : undefined;
    const removable = removeProblem(me, conv, m, data) === null;
    const toggle = () => {
      setSelected(isSelected ? null : m.id);
      setReporting(null);
    };
    // iPhone's VoiceOver reads a button as one item and never looks inside it, so there the message's
    // button stands aside (it keeps every tap) and a reader behind the content says the message.
    const ios = Platform.OS === 'ios';
    const spoken = ios
      ? messageSpoken({
          author: showAuthor && !nameLinks ? authorSpoken(author, data) : undefined,
          quote: m.replyToId ? { name: replied ? nameOf(replied.authorId) : '', words: quoteWords(replied) } : undefined,
          media: m.media,
          body: m.body,
          time: last || isSelected ? melbourneTime(m.createdAt) : undefined,
        })
      : '';
    if (m.removedAt) {
      return (
        <View style={[styles.msgRow, mine && styles.msgRowMine, first && { marginTop: space.md }]}>
          <View style={[styles.bubble, styles.removed]}>
            <Small>Message removed</Small>
          </View>
        </View>
      );
    }
    return (
      <View style={[first && { marginTop: space.md }]}>
        <View style={[styles.msgRow, mine && styles.msgRowMine]}>
          {!mine && conv.kind !== 'direct' ? (
            <View style={{ width: 32 }}>{first && author ? <Avatar text={initials(author)} size={32} /> : null}</View>
          ) : null}
          {/* The name and the message are two buttons in one bubble, the name above, not one inside the other:
              iPhone VoiceOver reads a button as one item, so a name inside the message's button can't be reached. */}
          <View style={[styles.bubbleShell, mine ? styles.bubbleMine : styles.bubbleTheirs, { maxWidth: bubbleWidth }, isSelected && styles.bubbleSelected]}>
            {nameLinks ? (
              <Pressable
                onPress={() => navigation.navigate('MemberDetail', { memberId: author.id })}
                style={styles.bubbleName}
                accessibilityRole="button"
                accessibilityLabel={authorPageLabel(author, data)}
                accessibilityHint="Opens their page, where you can message, block or report them"
              >
                <AuthorLine member={author} data={data} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={toggle}
              accessible={ios ? false : undefined}
              accessibilityRole="button"
              accessibilityHint="Shows reactions and what you can do with this message"
              style={[styles.bubbleBody, nameLinks && styles.bubbleBodyUnderName]}
            >
              {/* iPhone only: the message's own VoiceOver stop, with its words and the double-tap that shows its
                  actions. A plain View first, behind the content, so a tap anywhere still reaches the button.
                  The play button, each photo or video and each link after it are stops of their own. */}
              {ios ? (
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={spoken}
                  accessibilityHint="Shows reactions and what you can do with this message"
                  accessibilityState={{ selected: isSelected }}
                  onAccessibilityTap={toggle}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {showAuthor && !nameLinks ? (
                <View style={styles.bubbleNameText} accessibilityElementsHidden={ios}>
                  <AuthorLine member={author} data={data} />
                </View>
              ) : null}
              {m.replyToId ? <ReplyQuote message={replied} author={replied ? nameOf(replied.authorId) : ''} spokenByMessage={ios} /> : null}
              {m.media[0]?.kind === 'voice' ? (
                <VoiceNote media={m.media[0]} width={Math.min(bubbleWidth - space.md * 2, 260)} hideTimeFromReader={ios} />
              ) : m.media.length ? (
                <MediaGrid
                  media={m.media}
                  width={bubbleWidth - space.md * 2}
                  spokenByMessage={ios}
                  onOpen={(index) => {
                    const items = feedItemsOf(m);
                    const shown = m.media[index];
                    if (shown.kind === 'gif') return toggle();
                    navigation.navigate('MediaViewer', { items, index: Math.max(0, items.findIndex((x) => x.id === shown.id)) });
                  }}
                />
              ) : null}
              {m.body ? <MessageText body={m.body} spokenByMessage={ios} tagNames={tagNames} myName={mine ? undefined : myName} /> : null}
              {firstLink ? <LinkCard url={firstLink} /> : null}
              {last || isSelected ? <Text accessibilityElementsHidden={ios} style={[styles.time, mine && { textAlign: 'right', color: MINE_META_COLOR }]}>{melbourneTime(m.createdAt)}</Text> : null}
            </Pressable>
          </View>
        </View>
        <View style={[styles.under, mine ? { alignItems: 'flex-end' } : { paddingLeft: conv.kind !== 'direct' ? 40 : 0 }]}>
          <ReactionPills message={m} meId={me.id} onToggle={(e) => run(() => chat.react(m.id, e))} />
        </View>
        {mine && m.id === lastMine?.id && seenReads ? <SeenLine message={m} kind={conv.kind} reads={seenReads} nameOf={nameOf} today={today}
          onOpen={() => navigation.navigate('SeenBy', { chatId, messageId: m.id })} /> : null}
        {tags.get(m.id) ? <SeenTags ids={tags.get(m.id)!} people={people} nameOf={nameOf}
          onOpen={() => navigation.navigate('SeenBy', { chatId, messageId: m.id })} /> : null}
        {isSelected ? (
          <View style={[styles.actions, mine && { alignItems: 'flex-end' }]}>
            <ReactionBar
              mine={m.reactions.filter((r) => r.memberId === me.id).map((r) => r.emoji)}
              onPick={(e) => run(async () => {
                await chat.react(m.id, e);
                setSelected(null);
              })}
            />
            <View style={styles.actionRow}>
              <ActionChip label="Reply" icon="arrow-undo-outline" onPress={() => { setReplyTo(m); setSelected(null); input.current?.focus(); }} />
              {moderator ? (
                <ActionChip
                  label={conv.pinnedMessageId === m.id ? 'Unpin' : 'Pin'}
                  icon="pin-outline"
                  onPress={() => run(async () => { await chat.pin(chatId, conv.pinnedMessageId === m.id ? null : m.id); setSelected(null); })}
                />
              ) : null}
              {seenReads && (() => { const s = seenBy(m, seenReads); return s.seen.length + s.notYet.length > 0; })() ? (
                <ActionChip label="Seen by" icon="eye-outline" onPress={() => { setSelected(null); navigation.navigate('SeenBy', { chatId, messageId: m.id }); }} />
              ) : null}
              {!mine ? <ActionChip label="Report" icon="flag-outline" onPress={() => { setReporting(m.id); setReason(''); }} /> : null}
            </View>
            {/* Member content rules: block from the message itself, not only from their page */}
            {!mine && author && !chat.blocks.some((b) => b.blockedId === author.id) ? (
              <ConfirmButton
                label={`Block ${displayName(author)}`}
                confirmLabel={`Yes, block ${displayName(author)}`}
                kind="quiet"
                size="small"
                icon="eye-off-outline"
                confirmNote="You won’t see their messages or posts, and neither of you can message the other. Only you know."
                onConfirm={() => run(async () => { await chat.setBlock(author.id, true); setSelected(null); })}
              />
            ) : null}
            {removable ? (
              <ConfirmButton
                label={mine ? 'Remove my message' : 'Remove message'}
                confirmLabel="Yes, remove it"
                icon="trash-outline"
                onConfirm={() => run(async () => { await chat.remove(m.id); setSelected(null); })}
                style={{ alignSelf: 'stretch' }}
              />
            ) : null}
            {reporting === m.id ? (
              <Stack gap={space.sm} style={{ alignSelf: 'stretch' }}>
                <Field label="What’s wrong with it? (optional)" value={reason} onChangeText={setReason} maxLength={500} multiline />
                <Button
                  label="Send report"
                  kind="secondary"
                  icon="flag-outline"
                  onPress={() => run(async () => {
                    await chat.report(m.id, reason);
                    setReporting(null);
                    setSelected(null);
                    setReported('Reported. The moderators of this chat will look at it.');
                  })}
                />
              </Stack>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <View style={{ flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
        {hasTopics(conv) ? (
          <Pressable
            onPress={() => navigation.navigate('Topics', { chatId })}
            style={({ pressed }) => [styles.topicsBar, pressed && { backgroundColor: colors.steel }]}
            accessibilityRole="button"
            accessibilityLabel={`Topics, ${openTopics === 1 ? '1 open' : `${openTopics} open`}${topicsUnread ? `, ${topicsUnread} unread` : ''}`}
          >
            <Ionicons name="albums-outline" size={18} color={colors.bone} />
            <Text style={styles.topicsBarText}>{openTopics ? `Topics · ${openTopics} open` : 'Topics · start one'}</Text>
            <UnreadBadge n={topicsUnread} />
            <Ionicons name="chevron-forward" size={18} color={colors.boneDim} />
          </Pressable>
        ) : isTopic ? (
          <Pressable
            onPress={() => conv.parentId && navigation.navigate('Chat', { chatId: conv.parentId })}
            style={({ pressed }) => [styles.topicsBar, pressed && { backgroundColor: colors.steel }]}
            accessibilityRole="button"
            accessibilityLabel={`A topic in ${topicParentTitle(conv, me, data)}${conv.closedAt ? ', closed' : ''}. Opens ${topicParentTitle(conv, me, data)}`}
          >
            <Ionicons name="return-up-back" size={18} color={colors.boneDim} />
            <Text style={[styles.topicsBarText, { color: colors.boneDim }]} numberOfLines={1}>{`In ${topicParentTitle(conv, me, data)}`}</Text>
            {conv.closedAt ? <Text style={styles.closedChip}>Closed</Text> : null}
          </Pressable>
        ) : null}
        {pinned && !pinned.removedAt ? (
          <View style={styles.pinned}>
            <Ionicons name="pin" size={16} color={colors.boneDim} />
            <Small numberOfLines={2} style={{ flex: 1, color: colors.boneDim }}>
              {nameOf(pinned.authorId)}: {pinned.body || mediaSummary(pinned.media.length, pinned.media.some((x) => x.kind === 'voice')) || 'Photo'}
            </Small>
          </View>
        ) : null}
        {caught ? (
          <View style={styles.catchCard} accessibilityLiveRegion="polite">
            <Text style={styles.catchHeading}>Catch-up</Text>
            <ScrollView style={styles.catchScroll}>
              <Body selectable>{caught.summary}</Body>
            </ScrollView>
            <Small>{`From the last ${caught.count} messages. It can get things wrong: check the chat for anything that matters.`}</Small>
            <Small>{AI_PROVIDER_LINE.catchUp}</Small>
            <Button label="Close" kind="secondary" size="small" icon="close" onPress={() => setCaught(null)} />
          </View>
        ) : catchCount && askingConsent && !catchConsent.agreed ? (
          <ScrollView style={styles.consentScroll} contentContainerStyle={styles.consentWrap}>
            <AiConsentCard feature="catchUp" onAgree={agreeToCatchUp} onNotNow={() => setAskingConsent(false)} />
          </ScrollView>
        ) : catchCount ? (
          <View>
            <Pressable
              onPress={catchUp}
              disabled={catching}
              style={({ pressed }) => [styles.catchBar, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel={`Catch me up on ${unreadAtOpen} new messages`}
              accessibilityState={{ busy: catching }}
            >
              {catching ? <ActivityIndicator color={colors.bone} size="small" /> : <Ionicons name="sparkles-outline" size={18} color={colors.bone} />}
              <Text style={styles.catchBarText}>{catching ? `Reading ${catchCount} messages…` : `Catch me up · ${unreadAtOpen} new`}</Text>
              {catching ? null : <Ionicons name="chevron-forward" size={18} color={colors.boneDim} />}
            </Pressable>
            {catchError ? (
              <Pressable onPress={() => setCatchError(null)} style={styles.catchError} accessibilityRole="button" accessibilityHint="Closes this note">
                <Notice tone="danger">{catchError}</Notice>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <FlatList
          ref={list}
          data={items}
          inverted
          // Rows differ in height, so a far jump lands near first and then goes again once they're drawn.
          onScrollToIndexFailed={(info) => {
            if (userScrolled.current || scrollTries.current >= 3) return;
            scrollTries.current += 1;
            list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(toNewLine, 100);
          }}
          onScrollBeginDrag={() => { userScrolled.current = true; }}
          onScroll={(e) => {
            const away = e.nativeEvent.contentOffset.y > 600;
            if (away !== awayFromNewest) setAwayFromNewest(away);
          }}
          scrollEventThrottle={100}
          keyExtractor={(i) => i.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
          onEndReached={() => chat.hasOlder(chatId) && chat.loadOlder(chatId).catch(() => undefined)}
          onEndReachedThreshold={0.4}
          // The list flips the empty card back itself (scale -1 on Android, scaleY -1 elsewhere).
          // A transform here replaces that flip and left the card mirrored on Android.
          ListEmptyComponent={
            <View>
              <Notice title={conv.kind === 'direct' ? 'Start the chat' : 'Nothing here yet'}>Say g’day.</Notice>
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <Text style={styles.day}>{item.label}</Text>
            ) : item.kind === 'new' ? (
              <View style={styles.newLine} accessibilityRole="header" accessibilityLabel={item.complete ? `${item.count} new ${item.count === 1 ? 'message' : 'messages'} from here` : 'New messages from here, and more above'}>
                <View style={styles.newRule} />
                <Text style={styles.newText}>New messages</Text>
                <View style={styles.newRule} />
              </View>
            ) : (
              renderMessage(item.message, item.first, item.last)
            )
          }
        />
        {awayFromNewest ? (
          <Pressable
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
            style={({ pressed }) => [styles.toNewest, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel="Go to the newest message"
          >
            <Ionicons name="arrow-down" size={22} color={colors.bone} />
          </Pressable>
        ) : null}
        {reported ? (
          <Pressable onPress={() => setReported(null)} style={styles.banner} accessibilityRole="button" accessibilityHint="Closes this note">
            <Notice tone="ok">{reported}</Notice>
          </Pressable>
        ) : null}
        {error ? (
          <Pressable onPress={() => setError(null)} style={styles.banner} accessibilityRole="button" accessibilityHint="Closes this note">
            <Notice tone="danger">{error}</Notice>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.composerWrap, { paddingBottom: composerBottomRoom(Platform.OS, keyboard, insets.bottom, space.sm) }]}>
        <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
          {isTopic && conv.closedAt ? (
            // A closed topic: nobody posts until it's reopened (2026-11-24-chat-topics-design.md).
            <View style={styles.rulesCard}>
              <Small>This topic is closed.{canRunTopic(me, conv, data) ? ' Reopen it to post again.' : ' Whoever started it, or a board member, can reopen it.'}</Small>
              {canRunTopic(me, conv, data) ? (
                <Button label="Reopen topic" kind="secondary" size="small" icon="lock-open-outline" onPress={() => run(() => chat.reopenTopic(chatId))} />
              ) : null}
            </View>
          ) : family && !hasAgreedPostingRules(me) ? (
            // Family chat: Family agree to the club rules for chats and posts here, before their first
            // message (members agree before the tabs open). Reading needs nothing.
            <View style={styles.rulesCard}>
              <Small>Read the club rules for chats and posts and agree once, and you can join in.</Small>
              <Button label="Read the club rules" icon="document-text-outline" size="small" onPress={() => navigation.navigate('PostingRules')} />
            </View>
          ) : (
          <>
          {replyTo ? (
            <View style={styles.replyBar}>
              <View style={{ flex: 1 }}>
                <ReplyQuote message={replyTo} author={`Replying to ${nameOf(replyTo.authorId)}`} />
              </View>
              <IconButton icon="close" label="Don’t reply" onPress={() => setReplyTo(null)} />
            </View>
          ) : null}
          {recording ? (
            <VoiceRecorderBar
              onSend={(r) => send(r)}
              onCancel={() => setRecording(false)}
              onError={(message) => {
                setRecording(false);
                setError(message);
              }}
              sending={sending}
            />
          ) : (
            <>
            <AttachmentStrip items={attachments} onRemove={(i) => setAttachments((a) => a.filter((_, j) => j !== i))} />
            {tagChoices.length ? (
              <View style={styles.tagList} accessibilityLiveRegion="polite">
                {tagChoices.map((t) => {
                  const who = t.id ? people.find((p) => p.id === t.id) : undefined;
                  return (
                    <Pressable
                      key={t.id ?? 'everyone'}
                      onPress={() => {
                        setDraft((d) => insertTag(d, t.name, Math.min(at, d.length)));
                        setCursor(null);
                        input.current?.focus();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t.id ? `Tag ${t.name}` : 'Tag everyone in this chat'}
                      style={({ pressed }) => [styles.tagRow, pressed && { backgroundColor: colors.steelHi }]}
                    >
                      {who ? <Avatar text={initials(who)} size={28} /> : <View style={styles.tagEveryone}><Ionicons name="megaphone-outline" size={16} color={colors.bone} /></View>}
                      <Text style={styles.tagName} numberOfLines={1}>@{t.name}</Text>
                      {t.id ? null : <Text style={styles.tagHint} numberOfLines={1}>rings everyone here</Text>}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <View style={styles.composer}>
              <IconButton icon="images-outline" label="Add photos or videos" onPress={() => pick('library')} disabled={attachments.length >= MAX_MEDIA} />
              {Platform.OS !== 'web' ? (
                <IconButton icon="camera-outline" label="Take a photo or video" onPress={() => pick('camera')} disabled={attachments.length >= MAX_MEDIA} />
              ) : null}
              <Pressable
                onPress={() => { setGifs((g) => !g); Keyboard.dismiss(); }}
                accessibilityRole="button"
                accessibilityLabel="GIFs"
                accessibilityState={{ selected: gifs }}
                style={({ pressed }) => [styles.gifBtn, gifs && { backgroundColor: colors.steelHi, borderColor: colors.bone }, pressed && { backgroundColor: colors.steel }]}
              >
                <Text style={styles.gifBtnText}>GIF</Text>
              </Pressable>
              <TextInput
                ref={input}
                value={draft}
                onChangeText={setDraft}
                onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
                onFocus={() => setGifs(false)}
                placeholder="Message"
                placeholderTextColor={colors.boneMute}
                multiline
                numberOfLines={Platform.OS === 'web' ? 1 : undefined}
                maxLength={4000}
                style={styles.input}
                accessibilityLabel="Message"
              />
              {hasContent ? (
                <Pressable
                  onPress={() => send()}
                  disabled={!canSend}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  accessibilityState={{ disabled: !canSend, busy: sending }}
                  style={({ pressed }) => [styles.send, pressed && { backgroundColor: colors.red }, !canSend && { opacity: 0.45 }]}
                >
                  <Ionicons name="send" size={18} color={colors.bone} />
                </Pressable>
              ) : (
                <Pressable
                  onPress={startRecording}
                  disabled={sending || !!voiceOff}
                  accessibilityRole="button"
                  accessibilityLabel="Record a voice note"
                  accessibilityHint={voiceOff ?? 'Starts recording straight away. Up to 2 minutes.'}
                  accessibilityState={{ disabled: sending || !!voiceOff }}
                  style={({ pressed }) => [styles.send, pressed && { backgroundColor: colors.red }, (sending || !!voiceOff) && { opacity: 0.45 }]}
                >
                  <Ionicons name="mic" size={20} color={colors.bone} />
                </Pressable>
              )}
            </View>
            {voiceOff && !hasContent ? <Text style={styles.voiceOff}>{voiceOff}</Text> : null}
            </>
          )}
          {gifs && !recording ? (
            <GifPicker
              onPick={(g) => {
                setAttachments((a) => [...a, g].slice(0, MAX_MEDIA));
                setGifs(false);
              }}
            />
          ) : null}
          </>
          )}
        </View>
      </View>
    </View>
  );
}

export function NewChatScreen({ navigation }: RootScreen<'NewChat'>) {
  const { me, data } = useClub();
  const chat = useChat();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const people = data.members
    .filter((m) => m.id !== me?.id && directProblem(me, m, chat.blocks) === null)
    .filter((m) => !q || `${m.fullName} ${m.roadName ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  return (
    <Screen>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Body>Pick someone to message. Only the two of you see a private chat.</Body>
      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Name or road name" autoCapitalize="none" returnKeyType="search" />
      {people.length === 0 ? (
        <Small>No one by that name.</Small>
      ) : (
        <Card style={{ padding: 0 }}>
          {people.map((m, i) => (
            <MemberRow
              key={m.id}
              member={m}
              data={data}
              last={i === people.length - 1}
              onPress={async () => {
                try {
                  const id = await chat.openDirect(m.id);
                  navigation.replace('Chat', { chatId: id });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

/** Who can go in a group: approved members FNG and up, not anyone blocked either way. */
function groupCandidates(me: Member | null, data: ReturnType<typeof useClub>['data'], blocks: ReturnType<typeof useChat>['blocks'], already: string[]) {
  if (!me) return [];
  return data.members
    .filter((m) => m.id !== me.id && !already.includes(m.id))
    .filter((m) => createGroupProblem(me, 'x', [m.id], data, blocks) === null)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

/** Board members and the NEC: name a new group and tick its people, or (with a chatId) add people to one. */
export function NewGroupScreen({ route, navigation }: RootScreen<'NewGroup'>) {
  const { me, data } = useClub();
  const chat = useChat();
  const chatId = route.params?.chatId;
  const conv = chatId ? chat.conversation(chatId) : undefined;
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const q = query.trim().toLowerCase();
  const everyone = groupCandidates(me, data, chat.blocks, conv?.memberIds ?? []);
  const shown = everyone.filter((m) => !q || `${m.fullName} ${m.roadName ?? ''}`.toLowerCase().includes(q));
  const nameError = tried && !chatId ? groupNameProblem(name) : null;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const count = picked.length;

  const go = async () => {
    setTried(true);
    const problem = chatId ? addToGroupProblem(me, conv, picked, data, chat.blocks) : createGroupProblem(me, name, picked, data, chat.blocks);
    if (problem) {
      // A name problem shows under the name field, not twice.
      setError(!chatId && problem === groupNameProblem(name) ? null : problem);
      return;
    }
    try {
      setBusy(true);
      setError(null);
      if (chatId) {
        await chat.addToGroup(chatId, picked);
        navigation.goBack();
      } else {
        const id = await chat.createGroup(name, picked);
        navigation.replace('Chat', { chatId: id });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {chatId ? (
        <Body>Tick who to add to {conv?.name ?? 'the group'}. They see the whole chat, older messages included.</Body>
      ) : (
        <>
          <Body>Only the people you tick see a group. You can add more later.</Body>
          <Field
            label="Group name"
            value={name}
            onChangeText={setName}
            placeholder="Big 4 crew"
            maxLength={MAX_GROUP_NAME + 10}
            error={nameError}
            hint={`Up to ${MAX_GROUP_NAME} characters.`}
          />
        </>
      )}
      {/* Above the list, so it's in reach without scrolling past the whole club. */}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        label={chatId ? (count ? `Add ${count === 1 ? '1 person' : `${count} people`}` : 'Add people') : count ? `Start group with ${count === 1 ? '1 person' : `${count} people`}` : 'Start group'}
        icon={chatId ? 'person-add' : 'people'}
        onPress={go}
        busy={busy}
        disabled={count === 0}
      />
      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Name or road name" autoCapitalize="none" returnKeyType="search" />
      {everyone.length === 0 ? (
        <Small>{chatId ? 'Everyone who can be in a group is in this one.' : 'No one can be added yet.'}</Small>
      ) : shown.length === 0 ? (
        <Small>No one by that name.</Small>
      ) : (
        <Card style={{ padding: 0 }}>
          {shown.map((m, i) => {
            const on = picked.includes(m.id);
            const chapter = data.chapters.find((c) => c.id === m.chapterId);
            return (
              <ListRow
                key={m.id}
                last={i === shown.length - 1}
                checked={on}
                accessibilityLabel={`${displayName(m)}${chapter ? `, ${chapter.name}` : ''}`}
                left={<Avatar text={initials(m)} />}
                title={displayName(m)}
                subtitle={[m.roadName ? m.fullName : null, chapter?.name].filter(Boolean).join(' · ')}
                right={<Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={on ? colors.redBright : colors.boneMute} />}
                onPress={() => toggle(m.id)}
              />
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

/** A group's people. Everyone can leave; board members and the NEC add people, rename it and take people out. */
export function GroupInfoScreen({ route, navigation }: RootScreen<'GroupInfo'>) {
  const { chatId } = route.params;
  const { me, data } = useClub();
  const chat = useChat();
  const conv = chat.conversation(chatId);
  const runner = canRunGroups(me, data);
  const [name, setName] = useState(conv?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Renamed by someone else while this is open: show the new name.
  const [shownName, setShownName] = useState(conv?.name ?? '');
  if ((conv?.name ?? '') !== shownName) {
    setShownName(conv?.name ?? '');
    setName(conv?.name ?? '');
  }
  if (!conv || conv.kind !== 'group' || !me || !conv.memberIds.includes(me.id)) {
    return (
      <Screen>
        <Notice title="Not in this group">You’re not in this group any more.</Notice>
      </Screen>
    );
  }
  // Someone the member list doesn't hold (left the club, say) still counts and can be taken out.
  const missing = conv.memberIds.filter((id) => !data.members.some((m) => m.id === id));
  const people = conv.memberIds
    .map((id) => data.members.find((m) => m.id === id))
    .filter((m): m is Member => !!m)
    .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : displayName(a).localeCompare(displayName(b))));
  const starter = conv.createdBy ? data.members.find((m) => m.id === conv.createdBy) : undefined;
  const run = async (job: () => Promise<void>) => {
    try {
      setError(null);
      setBusy(true);
      await job();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nameProblem = groupNameProblem(name);
  const renamed = trimWords(name) !== (conv.name ?? '');

  return (
    <Screen>
      {runner ? (
        <Stack gap={space.sm}>
          <Field
            label="Group name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              setSaved(false);
            }}
            maxLength={MAX_GROUP_NAME + 10}
            error={renamed ? nameProblem : null}
          />
          {renamed ? (
            <Button
              label="Save name"
              kind="secondary"
              icon="checkmark"
              busy={busy}
              disabled={!!nameProblem}
              onPress={() => run(async () => {
                await chat.renameGroup(chatId, name);
                setSaved(true);
              })}
            />
          ) : saved ? (
            <Small>Name saved.</Small>
          ) : null}
        </Stack>
      ) : (
        <Text style={type.h2}>{conv.name}</Text>
      )}
      {starter ? <Small>Started by {starter.id === me.id ? 'you' : displayName(starter)}. Only the people here see it.</Small> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <SectionTitle
        title={conv.memberIds.length === 1 ? '1 person' : `${conv.memberIds.length} people`}
        action={runner ? <Button label="Add people" kind="secondary" size="small" icon="person-add" onPress={() => navigation.navigate('NewGroup', { chatId })} /> : undefined}
      />
      <Card style={{ padding: 0 }}>
        {people.map((m, i) => (
          <MemberRow
            key={m.id}
            member={m}
            data={data}
            last={i === people.length - 1 && missing.length === 0}
            extra={
              runner && m.id !== me.id ? (
                <ConfirmButton
                  label="Take out"
                  confirmLabel="Yes, take out"
                  disabled={busy}
                  size="small"
                  accessibilityLabel={`Take ${displayName(m)} out of the group`}
                  confirmAccessibilityLabel={`Yes, take ${displayName(m)} out`}
                  onConfirm={() => run(() => chat.removeFromGroup(chatId, m.id))}
                />
              ) : m.id === me.id ? (
                <Small>You</Small>
              ) : null
            }
          />
        ))}
        {missing.map((id, i) => (
          <ListRow
            key={id}
            last={i === missing.length - 1}
            left={<Avatar text="?" />}
            title={FORMER_MEMBER}
            right={
              runner ? (
                <ConfirmButton
                  label="Take out"
                  confirmLabel="Yes, take out"
                  disabled={busy}
                  size="small"
                  accessibilityLabel="Take a former member out of the group"
                  onConfirm={() => run(() => chat.removeFromGroup(chatId, id))}
                />
              ) : undefined
            }
          />
        ))}
      </Card>
      <ConfirmButton
        label="Leave group"
        confirmLabel="Yes, leave"
        icon="exit-outline"
        confirmNote="You stop seeing this group. Someone on a board would need to add you back."
        onConfirm={() => run(async () => {
          await chat.leaveGroup(chatId);
          navigation.popToTop();
        })}
      />
    </Screen>
  );
}

export function ChatReportsScreen({ navigation }: RootScreen<'ChatReports'>) {
  const { data } = useClub();
  const chat = useChat();
  // A report's chat opens for the board unless it's private: a private chat, a group, or a topic in one.
  const openable = (c: ReportView['conversation']): boolean => {
    const kind = c.kind === 'topic' ? chat.conversation(c.parentId ?? '')?.kind : c.kind;
    return !!kind && kind !== 'direct' && kind !== 'group';
  };
  const social = useSocial();
  const [reports, setReports] = useState<ReportView[] | null>(null);
  // Member content rules: reports of listings, build updates, nominations, workshops and profiles
  const [posts, setPosts] = useState<ContentReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      Promise.all([chat.reports(), social.contentReports().catch(() => [] as ContentReport[])]).then(
        ([a, b]) => {
          setReports(a);
          setPosts(b);
        },
        (e: Error) => setError(e.message),
      ),
    [chat, social.contentReports], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    let live = true;
    Promise.all([chat.reports(), social.contentReports().catch(() => [] as ContentReport[])]).then(
      ([a, b]) => {
        if (!live) return;
        setReports(a);
        setPosts(b);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => displayName(data.members.find((m) => m.id === id) ?? { roadName: null, fullName: 'Former member' });
  const deal = async (id: string, remove: boolean) => {
    try {
      await chat.resolveReport(id, remove);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const dealPost = async (id: string, remove: boolean) => {
    try {
      await social.resolveContentReport(id, remove);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // Where Open goes for a reported post: the listing, the build, the award, the workshop or the member.
  const openPost = (r: ContentReport): (() => void) | null => {
    if (r.kind === 'listing') return () => navigation.navigate('Listing', { listingId: r.targetId });
    if (r.kind === 'mechanic') return () => navigation.navigate('Mechanic', { mechanicId: r.targetId });
    if (r.kind === 'profile') return () => navigation.navigate('MemberDetail', { memberId: r.targetId });
    if (r.kind === 'build_update') {
      const u = social.buildUpdates.find((x) => x.id === r.targetId);
      return u ? () => navigation.navigate('BuildThread', { bikeId: u.bikeId }) : null;
    }
    const n = social.nominations.find((x) => x.id === r.targetId);
    return n ? () => navigation.navigate('Award', { awardId: n.awardId }) : null;
  };
  const loaded = reports !== null && posts !== null;
  return (
    <Screen onRefresh={load}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!loaded ? <Small>Loading…</Small> : null}
      {loaded && reports.length === 0 && posts.length === 0 ? <Notice tone="ok" title="All clear">No reports waiting.</Notice> : null}
      {posts?.map((r) => {
        const open = openPost(r);
        const what = r.kind === 'profile' ? 'Profile' : REPORT_KIND_LABEL[r.kind];
        return (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={type.name}>{what}</Text>
              <Small>{formatAuDate(melbourneDate(r.createdAt))}</Small>
            </Row>
            <Stack gap={4}>
              <Small>{r.kind === 'profile' ? `${name(r.authorId)}’s profile` : `${name(r.authorId)} posted`}</Small>
              <Body style={{ color: colors.bone }}>{r.snapshot || '(nothing)'}</Body>
            </Stack>
            <Small>
              Reported by {name(r.reporterId)}
              {r.reason ? `: “${r.reason}”` : ''}
            </Small>
            <ConfirmButton
              label="Remove it"
              confirmLabel="Yes, remove it"
              icon="trash-outline"
              confirmNote={r.kind === 'profile' ? 'Clears their bio. Suspending their access is under Manage member.' : 'Takes it down for everyone.'}
              onConfirm={() => dealPost(r.id, true)}
            />
            <Button label="Leave it up" kind="secondary" onPress={() => dealPost(r.id, false)} />
            {open ? <Button label={`Open the ${what.toLowerCase()}`} kind="quiet" icon="open-outline" onPress={open} /> : null}
          </Card>
        );
      })}
      {reports?.map((r) => {
        const title = chat.list.find((s) => s.conversation.id === r.conversation.id)?.title ?? 'Private chat';
        return (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={type.name}>{title}</Text>
              <Small>{formatAuDate(melbourneDate(r.createdAt))}</Small>
            </Row>
            <Stack gap={4}>
              <Small>{name(r.message.authorId)} wrote</Small>
              {r.message.voice ? (
                <VoiceNote media={r.message.voice} width={260} />
              ) : (
                <Body style={{ color: colors.bone }}>{r.message.body || (r.message.mediaCount ? `${r.message.mediaCount} photo(s)` : '(nothing)')}</Body>
              )}
            </Stack>
            <Small>
              Reported by {name(r.reporterId)}
              {r.reason ? `: “${r.reason}”` : ''}
            </Small>
            <ConfirmButton label="Remove the message" confirmLabel="Yes, remove it" icon="trash-outline" onConfirm={() => deal(r.id, true)} />
            <Button label="Leave it up" kind="secondary" onPress={() => deal(r.id, false)} />
            {/* The board dealing with a private chat or group (or a group's topic) isn't in it. */}
            {openable(r.conversation) ? (
              <Button label="Open the chat" kind="quiet" icon="chatbubbles-outline" onPress={() => navigation.navigate('Chat', { chatId: r.conversation.id })} />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

// Your own bubble is steelHi, where the quiet bone is only 3.99:1; this steps up to the next colour that reads.
/** Under my newest message: who has seen it. A tap opens the list, except in a private chat, where the line says it all. */
function SeenLine({ message, kind, reads, nameOf, today, onOpen }: {
  message: Message; kind: Conversation['kind']; reads: SeenRead[]; nameOf: (id: string) => string; today: string; onOpen: () => void;
}) {
  const line = seenLine(seenBy(message, reads), kind, nameOf, today);
  if (!line) return null;
  const words = (
    <View style={styles.seenRow}>
      <Ionicons name={line === 'Not seen yet' ? 'eye-off-outline' : 'eye-outline'} size={14} color={colors.boneMute} />
      <Text style={styles.seenText}>{line}</Text>
    </View>
  );
  if (kind === 'direct') return <View style={styles.seen}>{words}</View>;
  return (
    <Pressable
      onPress={onOpen}
      hitSlop={{ top: 12, bottom: 12 }}
      style={({ pressed }) => [styles.seen, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={line}
      accessibilityHint="Shows who has seen it and who hasn’t yet"
    >
      {words}
    </Pressable>
  );
}

const TAGS_SHOWN = 6;

/** Messenger-style: the initials of everyone whose last look stops at this message, latest first. A tap opens Seen by. */
function SeenTags({ ids, people, nameOf, onOpen }: { ids: string[]; people: Member[]; nameOf: (id: string) => string; onOpen: () => void }) {
  const shown = ids.slice(0, TAGS_SHOWN);
  const more = ids.length - shown.length;
  const names = ids.map(nameOf);
  const spoken = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  return (
    <Pressable
      onPress={onOpen}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={({ pressed }) => [styles.tags, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`Seen up to here by ${spoken}`}
      accessibilityHint="Shows who has seen this message and who hasn’t yet"
    >
      {shown.map((id) => {
        const p = people.find((x) => x.id === id);
        return <Avatar key={id} text={p ? initials(p) : '?'} size={22} />;
      })}
      {more > 0 ? <Text style={styles.tagsMore}>+{more}</Text> : null}
    </Pressable>
  );
}

const MINE_META_COLOR = pickReadable([colors.boneMute, colors.boneDim], colors.steelHi);

const styles = StyleSheet.create({
  listTime: { ...type.small, fontFamily: fonts.stencil, fontSize: 12, marginTop: 2 },
  unread: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.redBright,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { fontFamily: fonts.stencil, fontSize: 12, color: colors.bone },
  // The line above the first message I haven't seen: the brand red, so it's found at a glance.
  newLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.md },
  newRule: { flex: 1, height: 1, backgroundColor: colors.redBright },
  newText: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.6, color: colors.redText, textTransform: 'uppercase' },
  toNewest: {
    position: 'absolute', right: space.lg, bottom: space.md, width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.steelHi, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center',
  },
  day: {
    alignSelf: 'center', marginVertical: space.md, fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.6,
    color: colors.boneMute, textTransform: 'uppercase',
  },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: 3 },
  msgRowMine: { justifyContent: 'flex-end' },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, gap: 6 },
  // A message's bubble: the shell draws it, and its two buttons (name, message) carry the padding so together they cover it.
  bubbleShell: { borderRadius: radius.md },
  // Each button rounds its outer corners like the bubble, so a keyboard focus ring on the web follows the bubble.
  bubbleName: { minHeight: 44 + space.sm, paddingTop: space.sm, paddingHorizontal: space.md, justifyContent: 'center', borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  bubbleBody: { paddingHorizontal: space.md, paddingVertical: space.sm, gap: 6, borderRadius: radius.md },
  // Under the name button: 6 of space below the name, and square top corners where it meets the name.
  bubbleBodyUnderName: { paddingTop: 6, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  // A name that opens no page is part of the message, so a tap on it selects the message.
  bubbleNameText: { minHeight: 44, justifyContent: 'center' },
  bubbleTheirs: { backgroundColor: colors.ink2, borderWidth: 1, borderColor: colors.line },
  bubbleMine: { backgroundColor: colors.steelHi },
  bubbleSelected: { borderWidth: 1, borderColor: colors.bone },
  removed: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
  time: { ...type.small },
  under: { marginTop: 4 },
  seen: { alignSelf: 'flex-end', minHeight: 20, justifyContent: 'center', marginTop: 2 },
  seenRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tags: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 4, minHeight: 20, minWidth: 44 },
  tagsMore: { fontFamily: fonts.stencil, fontSize: 12, letterSpacing: 0.5, color: colors.boneMute, marginLeft: 2 },
  seenText: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.5, color: colors.boneMute },
  actions: { gap: space.sm, marginTop: space.sm, marginBottom: space.sm },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pinned: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.ink2,
  },
  banner: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  catchBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.lg,
    borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.steelHi,
  },
  catchBarText: { flex: 1, fontFamily: fonts.stencil, fontSize: 15, letterSpacing: 0.6, color: colors.bone, textTransform: 'uppercase' },
  catchError: { paddingHorizontal: space.lg, paddingTop: space.sm },
  topicsBar: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.lg,
    borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.ink2,
  },
  topicsBarText: { flex: 1, fontFamily: fonts.stencil, fontSize: 15, letterSpacing: 0.6, color: colors.bone, textTransform: 'uppercase' },
  closedChip: {
    fontFamily: fonts.stencil, fontSize: 12, letterSpacing: 0.6, color: colors.boneDim, textTransform: 'uppercase',
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2,
  },
  catchCard: {
    gap: space.sm, padding: space.lg, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.ink2,
  },
  catchHeading: { fontFamily: fonts.stencil, fontSize: 18, letterSpacing: 0.8, color: colors.bone, textTransform: 'uppercase' },
  catchScroll: { maxHeight: 280 },
  consentScroll: { flexGrow: 0, flexShrink: 0, maxHeight: '60%', borderBottomWidth: 1, borderBottomColor: colors.line },
  consentWrap: { padding: space.md },
  composerWrap: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.ink2 },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingTop: space.sm },
  rulesCard: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingHorizontal: space.sm, paddingTop: space.sm },
  tagList: { marginHorizontal: space.sm, marginTop: space.sm, borderRadius: radius.sm, backgroundColor: colors.steel, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.md },
  tagEveryone: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.red },
  tagName: { fontFamily: fonts.stencil, fontSize: 16, letterSpacing: 0.5, color: colors.bone, flexShrink: 1 },
  tagHint: { ...type.small, color: colors.boneMute, flexShrink: 1 },
  gifBtn: {
    width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  gifBtnText: { fontFamily: fonts.stencil, fontSize: 14, color: colors.boneDim, letterSpacing: 0.5 },
  voiceOff: { fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.5, color: colors.boneMute, textAlign: 'right', paddingHorizontal: space.sm, paddingTop: space.xs },
  input: {
    ...type.body, color: colors.bone, flex: 1, minHeight: 44, maxHeight: 132, paddingHorizontal: space.md,
    paddingTop: 11, paddingBottom: 11, borderRadius: radius.sm, backgroundColor: colors.steel, borderWidth: 1, borderColor: colors.line,
    marginHorizontal: 4,
  },
  send: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redBright },
});

// ---------------------------------------------------------------------------
// Ways into the chats from other screens
// ---------------------------------------------------------------------------

/** On a ride: its chat and its wall of photos. */
export function RideChatRows({ rideId, onOpenChat, onOpenWall }: { rideId: string; onOpenChat: (chatId: string) => void; onOpenWall: () => void }) {
  const chat = useChat();
  const [error, setError] = useState<string | null>(null);
  return (
    <Stack gap={space.sm}>
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          left={<IconBadge icon="chatbubbles-outline" />}
          title="Ride chat"
          subtitle="Plans, running late, who’s got room."
          onPress={() =>
            chat.rideChat(rideId).then(onOpenChat, (e: Error) => setError(e.message))
          }
        />
        <ListRow last left={<IconBadge icon="images-outline" />} title="Ride wall" subtitle="Photos from this ride’s chat." onPress={onOpenWall} />
      </Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Stack>
  );
}

/** On someone else's member screen: message them, and block or unblock them. */
export function MemberChatButtons({ member, onOpenChat }: { member: Member; onOpenChat: (chatId: string) => void }) {
  const { me } = useClub();
  const chat = useChat();
  const [error, setError] = useState<string | null>(null);
  if (!me || member.id === me.id || me.approval !== 'approved') return null;
  const blocked = chat.blocks.some((b) => b.blockedId === member.id);
  const why = directProblem(me, member, chat.blocks);
  const name = displayName(member);
  const act = (job: () => Promise<unknown>) => job().catch((e: Error) => setError(e.message));
  return (
    <Stack gap={space.sm}>
      {why === null ? (
        <Button label={`Message ${name}`} kind="secondary" icon="chatbubble-outline" onPress={() => act(() => chat.openDirect(member.id).then(onOpenChat))} />
      ) : null}
      {blocked ? (
        <Button label={`Unblock ${name}`} kind="quiet" icon="eye-outline" onPress={() => act(() => chat.setBlock(member.id, false))} />
      ) : (
        <ConfirmButton
          label={`Block ${name}`}
          confirmLabel={`Yes, block ${name}`}
          kind="quiet"
          icon="eye-off-outline"
          onConfirm={() => act(() => chat.setBlock(member.id, true))}
        />
      )}
      {blocked ? <Small>You won’t see {name}’s messages or photos, and neither of you can message the other. Only you know.</Small> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Stack>
  );
}
