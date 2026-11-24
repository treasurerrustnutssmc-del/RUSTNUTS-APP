// Topics inside board, committee and group chats (docs/superpowers/specs/2026-11-24-chat-topics-design.md):
// the list of a chat's topics with New topic, and a topic's info page (rename, close, reopen).

import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import { topicsOf } from '../data/chat/chatList';
import type { ChatSummary } from '../data/chat/chatContext';
import {
  canRunTopic,
  chatTitle,
  hasTopics,
  MAX_OPEN_TOPICS,
  MAX_TOPIC_NAME,
  startTopicProblem,
  topicNameProblem,
  topicParentTitle,
  trimWords,
} from '../domain/chat';
import { formatAuDate } from '../domain/dates';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import type { RootScreen } from '../navigation/types';
import { colors, fonts, space, type } from '../theme';
import { Button, Card, ConfirmButton, Field, IconBadge, ListRow, Notice, Row, Screen, SectionTitle, Small, Stack } from '../ui/primitives';
import { preview, UnreadBadge, when } from './chat';

const timeStyle = { ...type.small, fontFamily: fonts.stencil, fontSize: 12, marginTop: 2 } as const;

function TopicRow({ s, last, onPress }: { s: ChatSummary; last: boolean; onPress: () => void }) {
  const { me, data, today } = useClub();
  const people = useMemo(() => [...data.members, ...(data.chatPeople ?? [])], [data.members, data.chatPeople]);
  const closed = !!s.conversation.closedAt;
  return (
    <ListRow
      last={last}
      left={<IconBadge icon={closed ? 'lock-closed-outline' : 'chatbox-ellipses-outline'} />}
      title={
        <Row style={{ gap: space.sm, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <Text numberOfLines={2} style={[type.name, { flex: 1 }, closed && { color: colors.boneDim }]}>{s.title}</Text>
          {s.last ? <Text style={timeStyle}>{when(s.last.createdAt, today)}</Text> : null}
        </Row>
      }
      subtitle={
        <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
          <Small numberOfLines={1} style={[{ flex: 1 }, s.unread ? { color: colors.boneDim } : null]}>{preview(s, me, people)}</Small>
          <UnreadBadge n={s.unread} />
        </Row>
      }
      onPress={onPress}
    />
  );
}

export function TopicsScreen({ route, navigation }: RootScreen<'Topics'>) {
  const { chatId } = route.params;
  const { me, data } = useClub();
  const chat = useChat();
  const conv = chat.conversation(chatId);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const topics = useMemo(() => topicsOf(chat.list, chatId), [chat.list, chatId]);
  const open = topics.filter((t) => !t.conversation.closedAt);
  const closed = topics.filter((t) => t.conversation.closedAt);
  const chatName = conv && me ? chatTitle(conv, me, data) : 'this chat';

  useLayoutEffect(() => {
    navigation.setOptions({ title: `${chatName} topics` });
  }, [navigation, chatName]);

  if (!conv || !me || !hasTopics(conv)) {
    return (
      <Screen>
        <Notice tone="warn" title="Chat not found">It may have closed, or it isn’t one of yours.</Notice>
      </Screen>
    );
  }

  const typed = trimWords(name).length > 0;
  const problem = startTopicProblem(me, conv, name, data, open.length);
  const start = async () => {
    if (busy) return;
    try {
      setError(null);
      setBusy(true);
      const id = await chat.startTopic(chatId, name);
      setName('');
      navigation.navigate('Chat', { chatId: id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Small>Give each subject its own chat, so it doesn’t get lost. Everyone in {chatName} sees its topics.</Small>
      <Stack gap={space.sm}>
        <Field
          label="New topic"
          placeholder="Christmas party, insurance, merch…"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setError(null);
          }}
          maxLength={MAX_TOPIC_NAME + 10}
          returnKeyType="go"
          onSubmitEditing={() => typed && !problem && start()}
          error={typed ? topicNameProblem(name) : null}
        />
        {open.length >= MAX_OPEN_TOPICS ? <Notice tone="warn">This chat has 50 open topics. Close one first.</Notice> : null}
        <Button label="Start topic" icon="add" busy={busy} disabled={!typed || !!problem} onPress={start} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Stack>
      <SectionTitle title={open.length === 1 ? '1 open topic' : `${open.length} open topics`} />
      {open.length ? (
        <Card style={{ padding: 0 }}>
          {open.map((s, i) => (
            <TopicRow key={s.conversation.id} s={s} last={i === open.length - 1} onPress={() => navigation.navigate('Chat', { chatId: s.conversation.id })} />
          ))}
        </Card>
      ) : (
        <Small>No open topics yet. Start one above.</Small>
      )}
      {closed.length ? (
        <>
          <SectionTitle title={closed.length === 1 ? '1 closed topic' : `${closed.length} closed topics`} />
          <Card style={{ padding: 0 }}>
            {closed.map((s, i) => (
              <TopicRow key={s.conversation.id} s={s} last={i === closed.length - 1} onPress={() => navigation.navigate('Chat', { chatId: s.conversation.id })} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

export function TopicInfoScreen({ route, navigation }: RootScreen<'TopicInfo'>) {
  const { chatId } = route.params;
  const { me, data } = useClub();
  const chat = useChat();
  const conv = chat.conversation(chatId);
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
  if (!conv || conv.kind !== 'topic' || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Topic not found">It may have gone, or it isn’t one of yours.</Notice>
      </Screen>
    );
  }
  const runner = canRunTopic(me, conv, data);
  const parentName = topicParentTitle(conv, me, data);
  const person = (id: string | null | undefined) => {
    if (!id) return null;
    if (id === me.id) return 'you';
    const m = data.members.find((x) => x.id === id);
    return m ? displayName(m) : 'a former member';
  };
  const starter = person(conv.createdBy);
  const closer = person(conv.closedBy);
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
  const nameProblem = topicNameProblem(name);
  const renamed = trimWords(name) !== (conv.name ?? '');

  return (
    <Screen>
      {runner ? (
        <Stack gap={space.sm}>
          <Field
            label="Topic name"
            value={name}
            onChangeText={(t) => {
              setName(t);
              setSaved(false);
            }}
            maxLength={MAX_TOPIC_NAME + 10}
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
                await chat.renameTopic(chatId, name);
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
      <View style={{ gap: space.xs }}>
        <Small>A topic in {parentName}. Everyone in {parentName} sees it.</Small>
        {starter ? <Small>Started by {starter}.</Small> : null}
        {conv.closedAt ? <Small>Closed {formatAuDate(melbourneDate(conv.closedAt))}{closer ? ` by ${closer}` : ''}. Nobody can post until it’s reopened.</Small> : null}
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {runner ? (
        conv.closedAt ? (
          <Button label="Reopen topic" kind="secondary" icon="lock-open-outline" busy={busy} onPress={() => run(() => chat.reopenTopic(chatId))} />
        ) : (
          <ConfirmButton
            label="Close topic"
            confirmLabel="Yes, close it"
            icon="lock-closed-outline"
            disabled={busy}
            confirmNote="Nobody can post in it until it’s reopened. Everything said stays there to read."
            onConfirm={() => run(async () => {
              await chat.closeTopic(chatId);
              navigation.goBack();
            })}
          />
        )
      ) : (
        <Small>Whoever started it, or a board member, can rename or close it.</Small>
      )}
    </Screen>
  );
}
