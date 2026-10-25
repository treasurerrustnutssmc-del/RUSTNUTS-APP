// The way in: an applicant's introduction phase, the board's vote tally, and FNG reviews.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { attendanceCount } from '../domain/attendance';
import { formatAuDate, monthsBetween } from '../domain/dates';
import { continuationFeeFor, formatCents, fyOf } from '../domain/fees';
import { INTRO, REVIEW_EARLY_DAYS, fngDue, fngOutcomeStatus, fngReviewProblem, fngReviews, introProgress, type FngOutcome } from '../domain/joining';
import { STATUS_LABEL } from '../domain/labels';
import { displayName, initials } from '../domain/profile';
import type { Member, MemberDecision, Votes } from '../domain/types';
import type { RootScreen } from '../navigation/types';
import { colors, space, type } from '../theme';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Choices,
  Field,
  H1,
  H2,
  Ionicons,
  KeyValue,
  Label,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  StatusChip,
} from '../ui/primitives';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Step({ done, title, detail }: { done: boolean; title: string; detail: string }) {
  return (
    <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <Ionicons
        name={done ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={done ? colors.ok : colors.boneMute}
        accessibilityLabel={done ? 'Done' : 'Not yet'}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.name}>{title}</Text>
        <Small>{detail}</Small>
      </View>
    </Row>
  );
}

function BareBox({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line }}>{children}</View>;
}

/** The three things an introduced applicant needs before the board votes (constitution v4 4.2). */
export function IntroProgressCard({ member, self, bare }: { member: Member; self?: boolean; bare?: boolean }) {
  const { data, today } = useClub();
  const p = introProgress(member, data, today);
  // Inside another card (the board's applicant card) it sits flat instead of nesting a card.
  const Box = bare ? BareBox : Card;
  return (
    <Box>
      <Row style={{ justifyContent: 'space-between' }}>
        <H2>{self ? 'Your introduction' : 'Introduction'}</H2>
        {p.ready ? <Chip label="Ready for the vote" tone="ok" /> : null}
      </Row>
      <Step
        done={p.timeDone}
        title={`${INTRO.months} months`}
        detail={p.timeDone ? `Since ${formatAuDate(p.startedOn)}` : `${plural(p.daysLeft, 'day', 'days')} to go · ends ${formatAuDate(p.endsOn)}`}
      />
      <Step
        done={p.meetingsDone}
        title={`${INTRO.meetings} club meetings`}
        detail={`${p.meetings} of ${INTRO.meetings} so far`}
      />
      <Step done={p.ridesDone} title="A ride with members" detail={`${p.rides} of ${INTRO.rides} so far`} />
      {self && !p.ready ? <Small>Check in at each meeting and ride so they count.</Small> : null}
      {!self && !p.ready ? <Small>Not finished yet. The board can still vote early if it wants to.</Small> : null}
    </Box>
  );
}

const asCount = (text: string): number | null => (text.trim() === '' ? null : Number(text.trim()));

/** For, against and abstained, each optional. */
export function VotesFields({ onChange }: { onChange: (v: Votes) => void }) {
  const [text, setText] = useState({ for: '', against: '', abstained: '' });
  const set = (key: keyof typeof text) => (t: string) => {
    const next = { ...text, [key]: t.replace(/[^0-9]/g, '') };
    setText(next);
    onChange({ for: asCount(next.for), against: asCount(next.against), abstained: asCount(next.abstained) });
  };
  return (
    <View style={{ gap: space.sm }}>
      <Label>The vote</Label>
      <Row style={{ gap: space.sm, flexWrap: 'nowrap' }}>
        {(['for', 'against', 'abstained'] as const).map((k) => (
          <View key={k} style={{ flex: 1 }}>
            <Field
              label={k === 'for' ? 'For' : k === 'against' ? 'Against' : 'Abstained'}
              value={text[k]}
              onChangeText={set(k)}
              keyboardType="number-pad"
              maxLength={3}
              placeholder="–"
            />
          </View>
        ))}
      </Row>
    </View>
  );
}

const OUTCOME_LABEL: Record<FngOutcome, string> = {
  continue: 'Carry on as FNG',
  patch: 'Patch them in',
  not_continuing: 'Not continuing',
};

function tally(d: MemberDecision) {
  const parts = [
    d.votesFor !== null ? `${d.votesFor} for` : null,
    d.votesAgainst !== null ? `${d.votesAgainst} against` : null,
    d.votesAbstained !== null ? `${d.votesAbstained} abstained` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No tally recorded';
}

export function FngReviewScreen({ route, navigation }: RootScreen<'FngReview'>) {
  const { me, data, today, recordFngReview } = useClub();
  const member = data.members.find((m) => m.id === route.params.memberId);
  const [outcome, setOutcome] = useState<FngOutcome | null>(null);
  const [votes, setVotes] = useState<Votes>({ for: null, against: null, abstained: null });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!member || !me) {
    return (
      <Screen>
        <Notice tone="warn" title="Member not found" />
      </Screen>
    );
  }

  const past = fngReviews(member.id, data.decisions ?? []);
  const due = fngDue(member, data.decisions ?? [], today);
  const fee = continuationFeeFor(member.chapterId, fyOf(today), data);
  const paidContinuation = (data.charges ?? []).some((c) => c.memberId === member.id && c.kind === 'continuation');
  const patchBlock = due ? fngReviewProblem(me, member, due.atMonths, 'patch', votes, data, today) : null;
  const since = member.fngStartedOn ? attendanceCount(member.id, data, member.fngStartedOn) : null;
  const tooEarly = due ? fngReviewProblem(me, member, due.atMonths, 'continue', { for: null, against: null, abstained: null }, data, today) === 'That review isn’t due yet.' : false;

  const save = async () => {
    if (!outcome || !due) return;
    setError(null);
    const problem = fngReviewProblem(me, member, due.atMonths, outcome, votes, data, today);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await recordFngReview(member.id, due.atMonths, outcome, votes, note);
      const now = STATUS_LABEL[fngOutcomeStatus(outcome)];
      setDone(outcome === 'continue' ? `${displayName(member)} carries on as an FNG.` : `${displayName(member)} is now ${now}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
        <Avatar text={initials(member)} size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <H1>{displayName(member)}</H1>
          <Row style={{ gap: 6 }}>
            <StatusChip status={member.status} />
            {member.fngStartedOn ? (
              <Text style={[type.name, { color: colors.boneMute }]}>{`${monthsBetween(member.fngStartedOn, today)} months in`}</Text>
            ) : null}
          </Row>
        </View>
      </Row>

      {done ? (
        <>
          <Notice tone="ok" title="Review recorded">
            {done}
          </Notice>
          <Button label="Back to the board" onPress={() => navigation.goBack()} />
        </>
      ) : due ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H2>{due.atMonths}-month review</H2>
            {due.overdue ? <Chip label="Overdue" tone="warn" /> : null}
          </Row>
          <KeyValue label="Due" value={formatAuDate(due.date)} tone={due.overdue ? 'warn' : undefined} />
          {since ? <KeyValue label="Since starting" value={`${plural(since.meetings, 'meeting', 'meetings')} · ${plural(since.rides, 'ride', 'rides')}`} /> : null}
          <Small>Reviews fall at 6, 9 and 12 months, then every 3 months.</Small>
          {tooEarly ? <Notice tone="info">{`This one can be recorded from ${REVIEW_EARLY_DAYS} days before it’s due.`}</Notice> : null}
          <Choices<FngOutcome>
            label="What the board decided"
            options={(Object.keys(OUTCOME_LABEL) as FngOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))}
            value={outcome}
            onChange={setOutcome}
          />
          {outcome === 'patch' ? (
            <Small style={patchBlock ? { color: colors.warn } : undefined}>
              {patchBlock ?? 'Their patch vote carried. Record the board’s count here too, if it took one.'}
            </Small>
          ) : outcome === 'not_continuing' ? (
            <Small>They stay with the club as a Supporter.</Small>
          ) : outcome === 'continue' && due.atMonths >= 12 && fee !== null && !paidContinuation && !member.onHiatus ? (
            <Small>{`Past twelve months, carrying on adds the one-off ${formatCents(fee)} continuation fee, half the FNG fee (4.11).`}</Small>
          ) : null}
          <VotesFields onChange={setVotes} />
          <Field label="Note for the board" value={note} onChangeText={setNote} multiline maxLength={500} hint="Only the board sees this." />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button label="Record the review" disabled={!outcome || tooEarly} busy={busy} onPress={save} />
        </Card>
      ) : (
        <Notice tone="info">{`${displayName(member)} isn’t an FNG any more.`}</Notice>
      )}

      {past.length > 0 ? (
        <>
          <SectionTitle title="Earlier reviews" />
          <Card style={{ gap: space.md }}>
            {past.map((d) => (
              <Stack key={d.id} gap={2}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={type.name}>{`${d.atMonths} months · ${formatAuDate(d.decidedOn)}`}</Text>
                  <Small>{OUTCOME_LABEL[d.outcome as FngOutcome] ?? d.outcome}</Small>
                </Row>
                <Small>{tally(d)}</Small>
                {d.note ? <Body>{d.note}</Body> : null}
              </Stack>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
