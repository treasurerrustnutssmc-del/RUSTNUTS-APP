// The 5.5 notice: the board gives a member the record, the proposed consequence and at least 14 days
// to respond; the member reads and replies; the board withdraws it or, after the date, records that
// it has decided (the decision itself is a conduct record and a status change, made where they live).

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { isBoardOf } from '../domain/access';
import { addDays, formatAuDate } from '../domain/dates';
import {
  ABOUT_LABEL, MAX_OUTCOME_NOTE, MAX_PROPOSAL, MAX_RECORD, MAX_RESPONSE, NOTICE_DAYS, closeNoticeProblem, giveNoticeProblem, isOpen,
  noticeOf, noticeRecordFrom, openNoticesOf, respondProblem,
} from '../domain/notices';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import { standingOf } from '../domain/standing';
import type { NoticeAbout, NoticeOutcome, StatusNotice } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import { DateField, useDate } from './adminBits';
import {
  Body, Button, Card, Chip, Choices, ConfirmButton, Field, H1, IconBadge, KeyValue, ListRow, Notice, Screen, SectionTitle, Small, Stack,
} from '../ui/primitives';

/** "Reply by 12/11/2026", or "Closed" / "Board can decide" once that's passed. */
function noticeState(n: StatusNotice, today: string): { label: string; tone: 'warn' | 'bone' | 'steel' } {
  if (n.outcome === 'withdrawn') return { label: 'Withdrawn', tone: 'steel' };
  if (n.outcome === 'decided') return { label: 'Decided', tone: 'steel' };
  if (today > n.respondBy) return { label: 'Board can decide', tone: 'warn' };
  return { label: `Reply by ${formatAuDate(n.respondBy)}`, tone: 'bone' };
}

/** On Me: your open notices, each opening the notice. Nothing when there are none. */
export function MyNotices() {
  const { me, data } = useClub();
  const navigation = useNavigation<NavigationProp<RootParams>>();
  if (!me) return null;
  const open = openNoticesOf(me.id, data);
  if (open.length === 0) return null;
  return (
    <>
      <SectionTitle title="Notice from your board" />
      <Card style={{ padding: 0, gap: 0 }}>
        {open.map((n, i) => (
          <ListRow
            key={n.id}
            left={<IconBadge icon="document-text-outline" tone="red" />}
            title={`${ABOUT_LABEL[n.about]} (5.5)`}
            subtitle={n.response ? 'You’ve replied. You can change it until the board decides.' : `Read it and reply by ${formatAuDate(n.respondBy)}.`}
            onPress={() => navigation.navigate('StatusNotice', { noticeId: n.id })}
            last={i === open.length - 1}
          />
        ))}
      </Card>
    </>
  );
}

/** On Attendance: a chapter's open notices. */
export function ChapterNotices({ chapterId }: { chapterId: string }) {
  const { data, today } = useClub();
  const navigation = useNavigation<NavigationProp<RootParams>>();
  const open = (data.statusNotices ?? []).filter((n) => n.chapterId === chapterId && isOpen(n)).sort((a, b) => a.respondBy.localeCompare(b.respondBy));
  if (open.length === 0) return null;
  return (
    <>
      <SectionTitle title="Open notices (5.5)" action={<Text style={[type.name, { color: colors.boneMute }]}>{open.length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {open.map((n, i) => {
          const m = data.members.find((x) => x.id === n.memberId);
          const state = noticeState(n, today);
          return (
            <ListRow
              key={n.id}
              left={<IconBadge icon="document-text-outline" tone={state.tone === 'warn' ? 'red' : 'steel'} />}
              title={`${m ? displayName(m) : 'Someone'} · ${ABOUT_LABEL[n.about]}`}
              subtitle={`${n.response ? 'Replied' : 'No reply yet'} · reply by ${formatAuDate(n.respondBy)}`}
              right={state.tone === 'warn' ? <Chip label="Decide" tone="warn" /> : undefined}
              onPress={() => navigation.navigate('StatusNotice', { noticeId: n.id })}
              last={i === open.length - 1}
            />
          );
        })}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Giving notice
// ---------------------------------------------------------------------------

export function GiveNoticeScreen({ route, navigation }: RootScreen<'GiveNotice'>) {
  const { me, data, today, giveStatusNotice } = useClub();
  const member = data.members.find((m) => m.id === route.params.memberId);
  const standing = member ? standingOf(member, data, today) : null;
  const [about, setAbout] = useState<NoticeAbout>('attendance');
  const fromStanding = standing && standing.lines.length > 0 ? noticeRecordFrom(standing) : '';
  const [record, setRecord] = useState(fromStanding);
  const [proposal, setProposal] = useState('');
  const respondBy = useDate(addDays(today, NOTICE_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!member || !me || !isBoardOf(me, member.chapterId, data.positions)) {
    return (
      <Screen>
        <Notice tone="warn" title="Board only">Only the member’s chapter board gives a 5.5 notice.</Notice>
      </Screen>
    );
  }
  const input = { about, record, proposal, respondBy: respondBy.iso };
  const give = async () => {
    setError(null);
    const problem = giveNoticeProblem(me, member.id, input, data, today);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const id = await giveStatusNotice(member.id, input);
      navigation.replace('StatusNotice', { noticeId: id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>{`Notice to ${displayName(member)}`}</H1>
        <Body>
          Before the board proposes any change to their status, they get the record, what’s proposed and at least 14 days to explain,
          correct an error, or ask for an exemption or a payment arrangement (5.5). They’ll see it on their Me screen and can reply there.
        </Body>
      </Stack>
      <Choices<NoticeAbout>
        label="About"
        options={[{ value: 'attendance', label: 'Attendance' }, { value: 'dues', label: 'Dues' }]}
        value={about}
        onChange={(a) => {
          setAbout(a);
          // The attendance record filled in for them doesn't fit dues, and back again, unless it's been edited.
          if (a === 'dues' && record === fromStanding) setRecord('');
          if (a === 'attendance' && record === '') setRecord(fromStanding);
        }}
      />
      <Field
        label="The record"
        value={record}
        onChangeText={setRecord}
        multiline
        maxLength={MAX_RECORD}
        hint="What the attendance or dues records show. Check it before you send it."
      />
      <Field
        label="What’s proposed"
        value={proposal}
        onChangeText={setProposal}
        multiline
        maxLength={MAX_PROPOSAL}
        placeholder="For example: move to Supporter status from the next meeting"
      />
      <DateField label="Reply by" date={respondBy} hint={`At least ${NOTICE_DAYS} days from today.`} />
      <Small>The app doesn’t send a notification yet. Let them know it’s there.</Small>
      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
      <Button label="Give notice" icon="document-text-outline" busy={busy} onPress={give} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One notice: the member replies; the board withdraws it or records it decided
// ---------------------------------------------------------------------------

export function StatusNoticeScreen({ route, navigation }: RootScreen<'StatusNotice'>) {
  const { me, data, today, respondToNotice, closeStatusNotice } = useClub();
  const n = noticeOf(route.params.noticeId, data);
  const [reply, setReply] = useState(n?.response ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!n || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Notice not found">It may have been removed, or it isn’t yours to see.</Notice>
      </Screen>
    );
  }
  const member = data.members.find((m) => m.id === n.memberId);
  const giver = data.members.find((m) => m.id === n.givenBy);
  const closer = data.members.find((m) => m.id === n.closedBy);
  const mine = n.memberId === me.id;
  const board = !mine && isBoardOf(me, n.chapterId, data.positions);
  const state = noticeState(n, today);

  const run = async (f: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sendReply = () => {
    const problem = respondProblem(me, n.id, reply, data);
    if (problem) return setError(problem);
    run(() => respondToNotice(n.id, reply));
  };
  const close = (outcome: NoticeOutcome) => {
    const problem = closeNoticeProblem(me, n.id, outcome, note, data, today);
    if (problem) return setError(problem);
    run(() => closeStatusNotice(n.id, outcome, note));
  };
  // The board decides only after the reply-by date (5.5).
  const tooSoon = today <= n.respondBy;

  return (
    <Screen>
      <Stack gap={space.sm}>
        <Chip label={state.label} tone={state.tone} />
        <H1>{`${ABOUT_LABEL[n.about]} notice`}</H1>
        <Body>
          {mine
            ? 'Before your board proposes any change to your status, you get the record, what’s proposed and at least 14 days to respond (5.5). An absence on its own isn’t misconduct.'
            : `${member ? displayName(member) : 'The member'} has at least 14 days to explain, correct an error, or ask for an exemption or a payment arrangement (5.5).`}
        </Body>
      </Stack>

      <Card>
        <KeyValue label="Given" value={`${formatAuDate(n.givenOn)}${giver ? ` by ${displayName(giver)}` : ''}`} />
        <KeyValue label="Reply by" value={formatAuDate(n.respondBy)} />
        {n.closedOn ? (
          <KeyValue label={n.outcome === 'decided' ? 'Decided' : 'Withdrawn'} value={`${formatAuDate(n.closedOn)}${closer ? ` by ${displayName(closer)}` : ''}`} />
        ) : null}
      </Card>

      <SectionTitle title="The record" />
      <Card>
        <Body selectable>{n.record}</Body>
      </Card>
      <SectionTitle title="What’s proposed" />
      <Card>
        <Body selectable>{n.proposal}</Body>
      </Card>

      <SectionTitle title={mine ? 'Your reply' : 'Their reply'} />
      {mine && isOpen(n) ? (
        <Stack gap={space.sm}>
          <Field
            label="Reply"
            value={reply}
            onChangeText={setReply}
            multiline
            maxLength={MAX_RESPONSE}
            hint={n.response ? 'Sending again replaces your last reply.' : 'Explain, point out an error, or ask for an exemption or a payment arrangement.'}
          />
          <Button label={n.response ? 'Update reply' : 'Send reply'} icon="send" busy={busy} onPress={sendReply} />
          {n.respondedAt ? <Small>{`Last sent ${formatAuDate(melbourneDate(n.respondedAt))}.`}</Small> : null}
        </Stack>
      ) : (
        <Card>
          {n.response ? <Body selectable>{n.response}</Body> : <Small>No reply.</Small>}
        </Card>
      )}

      {n.outcomeNote ? (
        <>
          <SectionTitle title="Board’s note" />
          <Card>
            <Body selectable>{n.outcomeNote}</Body>
          </Card>
        </>
      ) : null}

      {board && isOpen(n) ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Board" />
          <Field label="Note (optional)" value={note} onChangeText={setNote} multiline maxLength={MAX_OUTCOME_NOTE} />
          <ConfirmButton
            label="Withdraw the notice"
            confirmLabel="Withdraw it"
            kind="secondary"
            disabled={busy}
            confirmNote="Nothing changes for them. Use this for an exemption, a payment arrangement or a corrected record."
            onConfirm={() => close('withdrawn')}
          />
          <ConfirmButton
            label="The board has decided"
            confirmLabel="Record it"
            kind="secondary"
            disabled={busy || tooSoon}
            confirmNote="Only once the board has decided by a majority at a quorate meeting, with written reasons and the effective date."
            onConfirm={() => close('decided')}
          />
          {tooSoon ? <Small>{`The board decides after ${formatAuDate(n.respondBy)}.`}</Small> : null}
        </Stack>
      ) : null}

      {board && n.outcome === 'decided' && member ? (
        <Stack gap={space.sm}>
          <Small>Record the decision as an Attendance conduct record, which gives them 14 days to ask for a review (14.6A), then change their status.</Small>
          <Button label="Record the decision" icon="create-outline" kind="secondary" onPress={() => navigation.navigate('RecordConduct', { memberId: member.id })} />
          <Button label="Manage member" icon="person-outline" kind="quiet" onPress={() => navigation.navigate('ManageMember', { memberId: member.id })} />
        </Stack>
      ) : null}

      <View accessibilityLiveRegion="polite" role="alert">
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
    </Screen>
  );
}
