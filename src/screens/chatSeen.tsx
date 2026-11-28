// Seen by: who has seen a message (anyone's) and who hasn't yet (src/domain/chatSeen.ts). Opened from
// the line under my newest message, the Seen tags under any message, or Seen by in a message's actions.

import React, { useEffect, useMemo } from 'react';
import { AppState, Text } from 'react-native';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import { isFamily } from '../domain/access';
import { mediaSummary } from '../domain/chat';
import { seenBy, seenWhen } from '../domain/chatSeen';
import { displayName } from '../domain/profile';
import type { Member } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, fonts } from '../theme';
import { MemberRow } from '../ui/MemberBits';
import { Avatar, Card, ListRow, Notice, Screen, SectionTitle, Small } from '../ui/primitives';

const REFRESH_MS = 30_000;

export function SeenByScreen({ route, navigation }: RootScreen<'SeenBy'>) {
  const { chatId, messageId } = route.params;
  const { me, data, today } = useClub();
  const chat = useChat();
  const message = chat.messages(chatId).find((m) => m.id === messageId);
  const reads = chat.seenReads(chatId);
  const people = useMemo(() => [...data.members, ...(data.chatPeople ?? [])], [data.members, data.chatPeople]);
  const family = isFamily(me);

  // Someone else opening the chat sends nothing here, so look again now and then while it's open.
  useEffect(() => {
    void chat.loadSeen(chatId);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void chat.loadSeen(chatId);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!message || !me || message.removedAt) {
    return (
      <Screen>
        <Notice tone="warn" title="Message not found">It may have been removed.</Notice>
      </Screen>
    );
  }
  if (!reads) {
    return (
      <Screen>
        <Notice title="Not available yet">Seen by isn’t switched on for the club yet. Try again later.</Notice>
      </Screen>
    );
  }

  const s = seenBy(message, reads);
  const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b));
  const nameOf = (id: string) => {
    const p = people.find((m) => m.id === id);
    return p ? displayName(p) : 'Member';
  };
  const words = message.body ?? (mediaSummary(message.media.length, message.media[0]?.kind === 'voice') || 'Photo');
  const row = (id: string, last: boolean, right?: React.ReactNode) => {
    const p = people.find((m) => m.id === id);
    if (!p) return <ListRow key={id} last={last} left={<Avatar text="?" />} title="Member" right={right} />;
    return (
      <MemberRow
        key={id}
        member={p as Member}
        data={data}
        last={last}
        onPress={family ? undefined : () => navigation.navigate('MemberDetail', { memberId: id })}
        extra={right}
      />
    );
  };

  return (
    <Screen>
      <Small numberOfLines={2}>{message.authorId === me.id ? 'Your message' : `${nameOf(message.authorId)}’s message`}, {seenWhen(message.createdAt, today)}: “{words}”</Small>
      <SectionTitle title={`Seen (${s.seen.length})`} />
      {s.seen.length ? (
        <Card style={{ padding: 0 }}>
          {s.seen.map((r, i) =>
            row(r.memberId, i === s.seen.length - 1, <Text style={{ fontFamily: fonts.stencil, fontSize: 13, color: colors.boneDim }}>Last in the chat {seenWhen(r.at, today)}</Text>),
          )}
        </Card>
      ) : (
        <Small>Nobody has opened the chat since it was sent.</Small>
      )}
      <SectionTitle title={`Not seen yet (${s.notYet.length})`} />
      {s.notYet.length ? (
        <Card style={{ padding: 0 }}>{[...s.notYet].sort(byName).map((id, i) => row(id, i === s.notYet.length - 1))}</Card>
      ) : (
        <Small>Everyone in this chat has seen it.</Small>
      )}
      <Small>Seen means they’ve opened this chat since you sent it. It doesn’t mean they read every word.</Small>
    </Screen>
  );
}
