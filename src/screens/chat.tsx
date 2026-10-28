// The club's chats: the list of your chats, one chat with its messages and composer, starting a
// private chat, and the reports a moderator looks at.

import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import type { Attachment, ChatSummary, ReportView, VoiceRecording } from '../data/chat/chatContext';
import { pickMedia } from '../data/chat/media';
import {
  canModerate,
  chatTitle,
  directProblem,
  findLinks,
  groupMessages,
  MAX_MEDIA,
  mediaSummary,
  removeProblem,
  type Message,
} from '../domain/chat';
import { formatAuDate } from '../domain/dates';
import { displayName, initials } from '../domain/profile';
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
  Small,
  Stack,
  type IconName,
} from '../ui/primitives';
import { VoiceNote, VoiceRecorderBar } from '../ui/VoiceBits';

const KIND_ICON: Record<string, IconName> = {
  club: 'people',
  chapter: 'flag',
  board: 'shield',
  nec: 'star',
  committee: 'construct',
  ride: 'speedometer',
};

/** "7:30 am" today, "Yesterday", or the date. */
function when(iso: string, today: string): string {
  const day = melbourneDate(iso);
  if (day === today) return melbourneTime(iso);
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
  return formatAuDate(day);
}

function preview(s: ChatSummary, me: Member | null, members: Member[]): string {
  const last = s.last;
  if (!last) return s.conversation.kind === 'direct' ? 'Say g’day.' : 'Nothing yet.';
  const who = last.authorId === me?.id ? 'You' : displayName(members.find((m) => m.id === last.authorId) ?? { roadName: null, fullName: 'Someone' });
  const what = last.removed ? 'Message removed' : last.body ?? (mediaSummary(last.mediaCount, last.voice) || 'Photo');
  return s.conversation.kind === 'direct' && who !== 'You' ? what : `${who}: ${what}`;
}

function UnreadBadge({ n }: { n: number }) {
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
  const [reportCount, setReportCount] = useState(0);
  // Someone who might join gets no private chats until they're an FNG.
  const mayMessage = !!me && me.approval === 'approved' && me.status !== 'introduced';

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Row style={{ gap: 2, marginRight: space.sm }}>
          <IconButton icon="images-outline" label="Photos and ride walls" onPress={() => navigation.navigate('Photos')} />
          {mayMessage ? <IconButton icon="create-outline" label="New private chat" onPress={() => navigation.navigate('NewChat')} /> : null}
        </Row>
      ),
    });
  }, [navigation, mayMessage]);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      chat.reports().then((r) => live && setReportCount(r.length), () => undefined);
      return () => {
        live = false;
      };
    }, [chat.reports]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <Screen onRefresh={chat.refresh}>
      {reportCount ? (
        <Card style={{ padding: 0 }}>
          <ListRow
            last
            left={<IconBadge icon="flag-outline" />}
            title={`Reports to look at (${reportCount})`}
            subtitle="Messages members flagged in chats you look after."
            onPress={() => navigation.navigate('ChatReports')}
          />
        </Card>
      ) : null}
      {!chat.ready ? (
        <Small>Loading your chats…</Small>
      ) : chat.list.length === 0 ? (
        <Notice title="No chats yet">Chats open up once the board approves you.</Notice>
      ) : (
        <Card style={{ padding: 0 }}>
          {chat.list.map((s, i) => {
            const other = s.conversation.kind === 'direct' ? data.members.find((m) => s.conversation.memberIds.includes(m.id) && m.id !== me?.id) : null;
            return (
              <ListRow
                key={s.conversation.id}
                last={i === chat.list.length - 1}
                left={other ? <Avatar text={initials(other)} /> : <IconBadge icon={KIND_ICON[s.conversation.kind] ?? 'chatbubbles'} />}
                title={
                  <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
                    <Text numberOfLines={1} style={[type.name, { flex: 1 }]}>{s.title}</Text>
                    {s.last ? <Text style={styles.listTime}>{when(s.last.createdAt, today)}</Text> : null}
                  </Row>
                }
                subtitle={
                  <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
                    <Small numberOfLines={1} style={[{ flex: 1 }, s.unread ? { color: colors.boneDim } : null]}>{preview(s, me, data.members)}</Small>
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

type Item = { key: string; kind: 'day'; label: string } | { key: string; kind: 'message'; message: Message; first: boolean; last: boolean };

/** Phones only: how far the keyboard covers the screen, so the composer sits on top of it. */
function useKeyboardHeight() {
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
  const { me, data, today } = useClub();
  const chat = useChat();
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
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState<string | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const sendingNow = useRef(false); // two quick taps land before the state catches up

  // Only the chat on screen is marked read; one under the photo viewer or a member's page isn't.
  useFocusEffect(useCallback(() => chat.open(chatId), [chatId])); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    // A chat opened from a ride, photo or report may not be in the list, so its name is worked out here.
    const title = summary?.title ?? (conv && me ? chatTitle(conv, me, data, data.rides.find((r) => r.id === conv.rideId) ?? null) : 'Chat');
    navigation.setOptions({ title });
  }, [navigation, summary?.title, conv, me, data]);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const day of groupMessages(messages, today)) {
      out.push({ key: `day-${day.day}-${day.runs[0]?.messages[0]?.id}`, kind: 'day', label: day.day });
      for (const run of day.runs) {
        run.messages.forEach((m, i) => out.push({ key: m.id, kind: 'message', message: m, first: i === 0, last: i === run.messages.length - 1 }));
      }
    }
    return out.reverse(); // newest at the bottom of an upside-down list
  }, [messages, today]);

  const pinned = conv?.pinnedMessageId ? messages.find((m) => m.id === conv.pinnedMessageId) : undefined;
  const moderator = !!conv && canModerate(me, conv, data);
  const nameOf = (id: string) => (id === me?.id ? 'You' : displayName(data.members.find((m) => m.id === id) ?? { roadName: null, fullName: 'Former member' }));

  const run = async (job: () => Promise<void>) => {
    try {
      setError(null);
      await job();
    } catch (e) {
      setError((e as Error).message);
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
    const author = data.members.find((x) => x.id === m.authorId);
    const isSelected = selected === m.id;
    const showAuthor = first && !mine && conv.kind !== 'direct';
    const firstLink = m.body ? findLinks(m.body).find((p) => p.url)?.url : undefined;
    const replied = m.replyToId ? messages.find((x) => x.id === m.replyToId) : undefined;
    const removable = removeProblem(me, conv, m, data) === null;
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
          <Pressable
            onPress={() => {
              setSelected(isSelected ? null : m.id);
              setReporting(null);
            }}
            accessibilityRole="button"
            accessibilityHint="Shows reactions and what you can do with this message"
            style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, { maxWidth: bubbleWidth }, isSelected && styles.bubbleSelected]}
          >
            {showAuthor ? <AuthorLine member={author} data={data} /> : null}
            {m.replyToId ? <ReplyQuote message={replied} author={replied ? nameOf(replied.authorId) : ''} /> : null}
            {m.media[0]?.kind === 'voice' ? (
              <VoiceNote media={m.media[0]} width={Math.min(bubbleWidth - space.md * 2, 260)} />
            ) : m.media.length ? (
              <MediaGrid
                media={m.media}
                width={bubbleWidth - space.md * 2}
                onOpen={(index) => {
                  const items = feedItemsOf(m);
                  const shown = m.media[index];
                  if (shown.kind === 'gif') return setSelected(isSelected ? null : m.id);
                  navigation.navigate('MediaViewer', { items, index: Math.max(0, items.findIndex((x) => x.id === shown.id)) });
                }}
              />
            ) : null}
            {m.body ? <MessageText body={m.body} /> : null}
            {firstLink ? <LinkCard url={firstLink} /> : null}
            {last || isSelected ? <Text style={[styles.time, mine && { textAlign: 'right' }]}>{melbourneTime(m.createdAt)}</Text> : null}
          </Pressable>
        </View>
        <View style={[styles.under, mine ? { alignItems: 'flex-end' } : { paddingLeft: conv.kind !== 'direct' ? 40 : 0 }]}>
          <ReactionPills message={m} meId={me.id} onToggle={(e) => run(() => chat.react(m.id, e))} />
        </View>
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
              {!mine ? <ActionChip label="Report" icon="flag-outline" onPress={() => { setReporting(m.id); setReason(''); }} /> : null}
            </View>
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
        {pinned && !pinned.removedAt ? (
          <View style={styles.pinned}>
            <Ionicons name="pin" size={16} color={colors.boneDim} />
            <Small numberOfLines={2} style={{ flex: 1, color: colors.boneDim }}>
              {nameOf(pinned.authorId)}: {pinned.body || mediaSummary(pinned.media.length, pinned.media.some((x) => x.kind === 'voice')) || 'Photo'}
            </Small>
          </View>
        ) : null}
        <FlatList
          data={items}
          inverted
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
            ) : (
              renderMessage(item.message, item.first, item.last)
            )
          }
        />
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
      <View style={[styles.composerWrap, { paddingBottom: keyboard ? keyboard + space.sm : insets.bottom + space.sm }]}>
        <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
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
                  disabled={sending}
                  accessibilityRole="button"
                  accessibilityLabel="Record a voice note"
                  accessibilityHint="Starts recording straight away. Up to 2 minutes."
                  style={({ pressed }) => [styles.send, pressed && { backgroundColor: colors.red }, sending && { opacity: 0.45 }]}
                >
                  <Ionicons name="mic" size={20} color={colors.bone} />
                </Pressable>
              )}
            </View>
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

export function ChatReportsScreen({ navigation }: RootScreen<'ChatReports'>) {
  const { data } = useClub();
  const chat = useChat();
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => chat.reports().then(setReports, (e: Error) => setError(e.message)), [chat]);
  useEffect(() => {
    let live = true;
    chat.reports().then((r) => live && setReports(r), (e: Error) => live && setError(e.message));
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
  return (
    <Screen onRefresh={load}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {reports === null ? <Small>Loading…</Small> : null}
      {reports?.length === 0 ? <Notice tone="ok" title="All clear">No reports waiting.</Notice> : null}
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
              <Body style={{ color: colors.bone }}>{r.message.body || (r.message.mediaCount ? `${r.message.mediaCount} photo(s)` : '(nothing)')}</Body>
            </Stack>
            <Small>
              Reported by {name(r.reporterId)}
              {r.reason ? `: “${r.reason}”` : ''}
            </Small>
            <ConfirmButton label="Remove the message" confirmLabel="Yes, remove it" icon="trash-outline" onConfirm={() => deal(r.id, true)} />
            <Button label="Leave it up" kind="secondary" onPress={() => deal(r.id, false)} />
            {r.conversation.kind !== 'direct' ? (
              <Button label="Open the chat" kind="quiet" icon="chatbubbles-outline" onPress={() => navigation.navigate('Chat', { chatId: r.conversation.id })} />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listTime: { ...type.small, fontFamily: fonts.stencil, fontSize: 12 },
  unread: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.redBright,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { fontFamily: fonts.stencil, fontSize: 12, color: colors.bone },
  day: {
    alignSelf: 'center', marginVertical: space.md, fontFamily: fonts.stencil, fontSize: 13, letterSpacing: 0.6,
    color: colors.boneMute, textTransform: 'uppercase',
  },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: 3 },
  msgRowMine: { justifyContent: 'flex-end' },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, gap: 6 },
  bubbleTheirs: { backgroundColor: colors.ink2, borderWidth: 1, borderColor: colors.line },
  bubbleMine: { backgroundColor: colors.steelHi },
  bubbleSelected: { borderWidth: 1, borderColor: colors.bone },
  removed: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
  time: { ...type.small, fontSize: 12 },
  under: { marginTop: 4 },
  actions: { gap: space.sm, marginTop: space.sm, marginBottom: space.sm },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pinned: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm,
    borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.ink2,
  },
  banner: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  composerWrap: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.ink2 },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingTop: space.sm },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingHorizontal: space.sm, paddingTop: space.sm },
  gifBtn: {
    width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent',
  },
  gifBtnText: { fontFamily: fonts.stencil, fontSize: 14, color: colors.boneDim, letterSpacing: 0.5 },
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
