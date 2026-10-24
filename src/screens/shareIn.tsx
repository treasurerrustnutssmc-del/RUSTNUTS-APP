// Lane E: share in. "Share to the club": what came across from another app, and the chats it can go
// to. Picking one opens that chat with it in the message box; nothing goes until Send is pressed.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useChat } from '../data/chat/ChatProvider';
import type { ChatSummary } from '../data/chat/chatContext';
import { NOTHING_TO_SHARE } from '../domain/shareIn';
import type { RootScreen } from '../navigation/types';
import { space, type } from '../theme';
import { AttachmentStrip } from '../ui/ChatBits';
import { Body, Button, Card, IconBadge, ListRow, Notice, Screen, SectionTitle, Small, type IconName } from '../ui/primitives';

const KIND_ICON: Record<string, IconName> = {
  club: 'people',
  chapter: 'flag',
  board: 'shield',
  nec: 'star',
  committee: 'construct',
  ride: 'speedometer',
  direct: 'person',
};

/** Whole club first (it's the feed), then the chat list's own order. */
export function shareTargets(list: ChatSummary[]): ChatSummary[] {
  return [...list.filter((s) => s.conversation.kind === 'club'), ...list.filter((s) => s.conversation.kind !== 'club')];
}

export function ShareInScreen({ route, navigation }: RootScreen<'ShareIn'>) {
  const { text, notes } = route.params;
  const [media, setMedia] = useState(route.params.media);
  // A second share while this is open arrives as new params on the same screen: start again from it.
  const [shownParams, setShownParams] = useState(route.params);
  if (shownParams !== route.params) {
    setShownParams(route.params);
    setMedia(route.params.media);
  }
  const chat = useChat();
  const cameAcross = !!text || route.params.media.length > 0;
  const nothing = !text && media.length === 0;
  const targets = shareTargets(chat.list);

  return (
    <Screen>
      {notes.map((n) => (
        <Notice key={n}>{n}</Notice>
      ))}
      {nothing ? (
        <>
          {/* Said only when nothing came across: not after the member takes every photo out, and not on top of "couldn't be opened". */}
          {!cameAcross && notes.length === 0 ? <Notice title="Nothing to share">{NOTHING_TO_SHARE}</Notice> : null}
          <Button label="Back to the app" kind="secondary" onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs', { screen: 'Home' }))} />
        </>
      ) : (
        <>
          <Card style={{ gap: space.sm }}>
            {text ? <Body numberOfLines={6}>{text}</Body> : null}
            {/* The strip brings the composer's side padding; the card already has its own. */}
            <View style={{ marginHorizontal: -space.md, marginTop: -space.sm }}>
              <AttachmentStrip items={media} onRemove={(i) => setMedia((m) => m.filter((_, j) => j !== i))} />
            </View>
            <Small>You can add to it before it goes.</Small>
          </Card>
          <SectionTitle title="Send to" />
          {!chat.ready ? (
            <Small>Loading your chats…</Small>
          ) : targets.length === 0 ? (
            <Notice title="No chats yet">Chats open up once the board approves you.</Notice>
          ) : (
            <Card style={{ padding: 0 }}>
              {targets.map((s, i) => (
                <ListRow
                  key={s.conversation.id}
                  last={i === targets.length - 1}
                  left={<IconBadge icon={KIND_ICON[s.conversation.kind] ?? 'chatbubbles'} />}
                  title={<Text numberOfLines={1} style={type.name}>{s.title}</Text>}
                  subtitle={s.conversation.kind === 'club' ? 'Photos here show in Photos too.' : undefined}
                  onPress={() => navigation.replace('Chat', { chatId: s.conversation.id, shared: { text, media } })}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
