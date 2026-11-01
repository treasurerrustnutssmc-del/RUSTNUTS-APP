// Ask the club: a member asks about the club's rules, rides and the Rusty Bus in plain words, and
// can ask it to do things. Anything it would do shows as a card first, checked with the app's own
// rules, and only happens when the member taps Confirm.
// Spec: docs/superpowers/specs/2026-10-31-club-assistant-design.md ("The screen")

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_TURNS, type ApiMessage } from '../../supabase/functions/_shared/askClub';
import { useAssistantApi, type AssistantStatus } from '../data/assistantApi';
import { runAction } from '../data/assistantRun';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import { isApprovedMember } from '../domain/access';
import { STARTERS, buildSnapshot, cardFor, nextMessages, withReply, type ActionCard, type ActionPlan, type ChatChoice } from '../domain/assistant';
import { postProblem } from '../domain/chat';
import type { RootScreen } from '../navigation/types';
import { colors, MAX_CONTENT_WIDTH, radius, space, type } from '../theme';
import { Body, Button, Card, H2, IconBadge, ListRow, Notice, Row, Skull, Small } from '../ui/primitives';
import { useKeyboardHeight } from './chat';
import { openLink } from '../ui/openLink';

const FINE_PRINT =
  'Answers come from the constitution, the Road Rules and what you can see in the app. It can get things wrong: check anything that matters. Nothing happens until you tap Confirm.';
const MAX_QUESTION = 2000;

type CardState = 'open' | 'busy' | 'done' | 'failed' | 'declined';
type Item =
  | { key: string; kind: 'me'; text: string }
  | { key: string; kind: 'club'; text: string; note: string | null }
  | { key: string; kind: 'card'; card: ActionCard; state: CardState; said: string | null };

/** What the member sees after a card's done (the assistant is told the same thing in its own words). */
const doneForMember = (plan: ActionPlan, line: string) => {
  if (plan.kind === 'open_calendar') return 'Opened in Google Calendar. It’s only on the calendar once you press Save there.';
  const rest = line.replace(/^Done: /, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

const leftLine = (s: AssistantStatus) => `${s.leftToday} ${s.leftToday === 1 ? 'question' : 'questions'} left today`;

/** Why the member can't ask right now, or null. */
function stopped(status: AssistantStatus | null, turns: number): string | null {
  if (status && !status.on) return 'Ask the club isn’t switched on yet.';
  if (status?.restingUntil) return `Ask the club is resting until ${status.restingUntil}: this month’s budget is used.`;
  if (status && status.leftToday <= 0) return `You’ve asked ${status.dailyLimit} today. More tomorrow.`;
  if (turns + 1 > MAX_TURNS) return 'That’s a long chat. Start a new one.';
  return null;
}

export function AskClubScreen(_: RootScreen<'AskClub'>) {
  const club = useClub();
  const { me, data } = club;
  const chat = useChat();
  const api = useAssistantApi();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const scroller = useRef<ScrollViewInstance>(null);

  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [history, setHistory] = useState<ApiMessage[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = useRef<Record<string, string>>({});
  const nextKey = useRef(0);
  const key = () => `i${(nextKey.current += 1)}`;

  const chats: ChatChoice[] = useMemo(
    () => chat.list
      .filter((s) => postProblem(me, s.conversation, 'x', 0, data, chat.blocks) === null)
      .map((s) => ({ id: s.conversation.id, title: s.title })),
    [chat.list, chat.blocks, me, data],
  );

  const loadStatus = useCallback(() => {
    api.status().then(
      (s) => { setStatus(s); setStatusError(null); },
      (e: Error) => setStatusError(e.message),
    );
  }, [api]);
  useEffect(loadStatus, [loadStatus]);

  if (!me || !isApprovedMember(me)) return null;
  const blocked = stopped(status, history.length);
  const question = draft.trim();
  // A card still running holds the next question, so its result goes with it.
  const running = items.some((i) => i.kind === 'card' && i.state === 'busy');
  const canSend = !thinking && !running && !blocked && question.length > 0;

  const ask = async (words: string) => {
    const text = words.trim().slice(0, MAX_QUESTION);
    if (!text || thinking || running || blocked) return;
    const before = items;
    const now = new Date().toISOString();
    const sent = nextMessages(history, results.current, text, history.length === 0 ? buildSnapshot(me, data, chats, now) : null);
    // A card left open when the next question goes is told back as not done, so it can't be confirmed after.
    setItems((all) => [...all.map((i) => (i.kind === 'card' && (i.state === 'open' || i.state === 'failed') ? { ...i, state: 'declined' as const } : i)), { key: key(), kind: 'me', text }]);
    setDraft('');
    setError(null);
    setThinking(true);
    try {
      const reply = await api.ask(sent);
      setHistory(withReply(history, sent, reply));
      const ctx = { me, data, chats, now: new Date().toISOString() };
      setItems((all) => [
        ...all,
        ...(reply.text || reply.note ? [{ key: key(), kind: 'club' as const, text: reply.text, note: reply.note }] : []),
        ...reply.proposals.map((p) => ({ key: key(), kind: 'card' as const, card: cardFor(p, ctx), state: 'open' as const, said: null })),
      ]);
    } catch (e) {
      // Nothing reached the conversation: take the question back so it can be asked again, and
      // reopen any card it closed.
      setItems(before);
      setDraft(text);
      setError((e as Error).message);
    } finally {
      setThinking(false);
      loadStatus();
    }
  };

  const setCard = (itemKey: string, state: CardState, said: string | null) =>
    setItems((all) => all.map((i) => (i.key === itemKey && i.kind === 'card' ? { ...i, state, said } : i)));

  const confirm = async (item: Extract<Item, { kind: 'card' }>) => {
    const plan = item.card.plan;
    if (!plan || item.state === 'busy') return;
    setCard(item.key, 'busy', null);
    try {
      const line = await runAction(plan, { club, chat, me, data, openUrl: (url) => openLink(url) });
      results.current[item.card.id] = line;
      setCard(item.key, 'done', doneForMember(plan, line));
    } catch (e) {
      const words = (e as Error).message || 'That didn’t work. Try again.';
      results.current[item.card.id] = `It didn’t work: ${words}`;
      setCard(item.key, 'failed', words);
    }
  };

  const decline = (item: Extract<Item, { kind: 'card' }>) => {
    delete results.current[item.card.id];
    setCard(item.key, 'declined', null);
  };

  const startAgain = () => {
    setHistory([]);
    setItems([]);
    setError(null);
    results.current = {};
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.column}>
          <Small>{FINE_PRINT}</Small>
          {status && status.on && !status.restingUntil ? <Text style={styles.left}>{leftLine(status)}</Text> : null}
          {statusError && !status ? <Notice tone="warn">{statusError}</Notice> : null}

          {items.length === 0 ? (
            <Card style={{ padding: 0, gap: 0 }}>
              {STARTERS.map((s, i) => (
                <ListRow
                  key={s}
                  left={<IconBadge icon="chatbubble-ellipses-outline" />}
                  title={s}
                  onPress={blocked || thinking ? undefined : () => ask(s)}
                  last={i === STARTERS.length - 1}
                />
              ))}
            </Card>
          ) : (
            <View style={{ gap: space.md }}>
              {items.map((item) =>
                item.kind === 'me' ? (
                  <View key={item.key} style={styles.mineRow}>
                    <View style={[styles.bubble, styles.mine]}>
                      <Body selectable style={{ color: colors.bone }}>{item.text}</Body>
                    </View>
                  </View>
                ) : item.kind === 'club' ? (
                  <View key={item.key} style={styles.clubRow} accessibilityLiveRegion="polite">
                    <View style={styles.skull}><Skull size={18} /></View>
                    <View style={[styles.bubble, styles.club]}>
                      {item.text ? <Body selectable style={{ color: colors.bone }}>{item.text}</Body> : null}
                      {item.note ? <Small style={{ fontStyle: 'italic' }}>{item.note}</Small> : null}
                    </View>
                  </View>
                ) : (
                  <ProposalCard key={item.key} item={item} onConfirm={() => confirm(item)} onDecline={() => decline(item)} />
                ),
              )}
            </View>
          )}

          {thinking ? (
            <View style={styles.thinking} accessibilityLiveRegion="polite">
              <Skull size={18} />
              <ActivityIndicator color={colors.redText} />
              <Small>Thinking…</Small>
            </View>
          ) : null}
          {error ? <Notice tone="warn">{error}</Notice> : null}
          {items.length > 0 && !thinking ? (
            <Button label="Start a new chat" kind="quiet" icon="refresh" size="small" onPress={startAgain} />
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.composerWrap, { paddingBottom: keyboard ? keyboard + space.sm : insets.bottom + space.sm }]}>
        {blocked ? (
          // Why it can't take a question, where the box would be, so it's seen at the end of a long chat too.
          <View style={styles.composer} accessibilityLiveRegion="polite">
            <View style={{ flex: 1 }}>
              <Notice tone="warn">{blocked}</Notice>
            </View>
          </View>
        ) : (
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask about the club"
              placeholderTextColor={colors.boneMute}
              multiline
              maxLength={MAX_QUESTION}
              style={styles.input}
              accessibilityLabel="Your question"
            />
            <Button label="Send" onPress={() => ask(draft)} disabled={!canSend} busy={thinking} style={styles.send} />
          </View>
        )}
      </View>
    </View>
  );
}

function ProposalCard({ item, onConfirm, onDecline }: { item: Extract<Item, { kind: 'card' }>; onConfirm: () => void; onDecline: () => void }) {
  const { card, state, said } = item;
  const plain = card.plan?.kind === 'post_message';
  return (
    <Card>
      <H2>{card.heading}</H2>
      {card.lines.length ? (
        <View style={{ gap: space.xs }}>
          {card.lines.map((line, i) =>
            i < 2 && !plain ? (
              <Text key={i} style={type.name}>{line}</Text>
            ) : (
              <Body key={i}>{line}</Body>
            ),
          )}
        </View>
      ) : null}
      {card.problem ? (
        <Notice tone="warn">{card.problem}</Notice>
      ) : state === 'done' ? (
        <Notice tone="ok" title="Done">{said ?? ''}</Notice>
      ) : state === 'declined' ? (
        <Small>Not done.</Small>
      ) : (
        <>
          {state === 'failed' && said ? <Notice tone="warn">{said}</Notice> : null}
          <Row style={{ gap: space.sm }}>
            <Button
              label={state === 'failed' ? 'Try again' : card.confirm}
              onPress={onConfirm}
              busy={state === 'busy'}
              style={{ flex: 1 }}
            />
            <Button label="Not that" kind="quiet" onPress={onDecline} disabled={state === 'busy'} />
          </Row>
        </>
      )}
    </Card>
  );
}

/** The way in from Home: approved members only, and in a live build only once it's switched on. */
export function AskClubHomeRow({ onOpen }: { onOpen: () => void }) {
  const { me, isDemo } = useClub();
  const api = useAssistantApi();
  const [on, setOn] = useState(isDemo);
  const member = isApprovedMember(me);
  useEffect(() => {
    if (isDemo || !member) return;
    let live = true;
    api.status().then((s) => live && setOn(s.on), () => undefined);
    return () => { live = false; };
  }, [api, isDemo, member]);
  if (!member || !on) return null;
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        left={<IconBadge icon="chatbubbles-outline" />}
        title="Ask the club"
        subtitle="The rules, the rides and the Rusty Bus, in plain words"
        onPress={onOpen}
        last
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  scroll: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xl },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: space.lg },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  left: { ...type.name, fontSize: 14, color: colors.boneDim },
  mineRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingLeft: space.xxl },
  clubRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingRight: space.xl },
  skull: { width: 24, alignItems: 'center', paddingBottom: 4 },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, gap: 6, flexShrink: 1 },
  mine: { backgroundColor: colors.steelHi },
  club: { backgroundColor: colors.ink2, borderWidth: 1, borderColor: colors.line },
  composerWrap: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.ink2 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm,
    width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center',
  },
  input: {
    ...type.body, color: colors.bone, flex: 1, minHeight: 48, maxHeight: 132, paddingHorizontal: space.md,
    paddingTop: 13, paddingBottom: 13, borderRadius: radius.sm, backgroundColor: colors.steel, borderWidth: 1, borderColor: colors.line,
  },
  send: { minWidth: 88 },
});
