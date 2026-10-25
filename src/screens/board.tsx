import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { appointProblem, endTermProblem, pendingFor } from '../domain/access';
import { formatAuDate, formatLongDate, monthsBetween } from '../domain/dates';
import { runsScope } from '../domain/meetings';
import { signoffSummary } from '../domain/roadRules';
import { melbourneDate } from '../domain/rides';
import { nineMonthsAfter, patchVoteFor, patchVoteTooEarly } from '../domain/votes';
import { APPROVE_AS, BOARD_ROLES, CLUB_ROLES, NATIONAL_ROLES, RESULT_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_ORDER } from '../domain/labels';
import { boardWatchList, displayName, expiryAlerts, initials, nextFngReview } from '../domain/profile';
import type { Member, MemberStatus, PositionRole, Votes } from '../domain/types';
import type { RootScreen, TabScreen } from '../navigation/types';
import { colors, fonts, space, type } from '../theme';
// Stage 4
import { fngDue } from '../domain/joining';
import { BoardCheckins } from './checkin';
import { BoardFees } from './fees';
import { IntroProgressCard, VotesFields } from './fng';
import { sortedPositions } from '../ui/MemberBits';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Field,
  H1,
  H2,
  IconBadge,
  KeyValue,
  Label,
  ListRow,
  Notice,
  Row,
  Screen,
  SectionTitle,
  Small,
  Stack,
  StatusChip,
} from '../ui/primitives';


function ApplicantCard({ applicant, onDone }: { applicant: Member; onDone: (msg: string) => void }) {
  const { data, decideApplication } = useClub();
  const [status, setStatus] = useState<MemberStatus>(applicant.status);
  const [votes, setVotes] = useState<Votes>({ for: null, against: null, abstained: null });
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const priv = data.privates.find((p) => p.memberId === applicant.id);
  const chapter = data.chapters.find((c) => c.id === applicant.chapterId);
  const bikes = data.bikes.filter((b) => b.memberId === applicant.id);

  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(msg);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
        <Avatar text={initials(applicant)} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.name}>
            {applicant.fullName}
            {applicant.roadName ? ` · ${applicant.roadName}` : ''}
          </Text>
          <Small>
            {chapter?.name} · asked {formatLongDate(applicant.appliedOn)} · as{' '}
            {applicant.status === 'introduced' ? 'a rider' : STATUS_LABEL[applicant.status].toLowerCase()}
          </Small>
        </View>
      </Row>
      <Stack gap={2}>
        {priv?.introducedBy ? <KeyValue label="Introduced by" value={priv.introducedBy} /> : null}
        {priv?.phone ? <KeyValue label="Mobile" value={priv.phone} /> : null}
        {priv?.email ? <KeyValue label="Email" value={priv.email} /> : null}
        {bikes.map((b) => (
          <KeyValue key={b.id} label="Bike" value={`${b.year ?? ''} ${b.make} ${b.model}`.trim()} />
        ))}
      </Stack>
      {priv?.applicationNote ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: colors.lineStrong, paddingLeft: space.md }}>
          <Body>“{priv.applicationNote}”</Body>
        </View>
      ) : null}
      {applicant.status === 'introduced' ? <IntroProgressCard member={applicant} bare /> : null}
      <VotesFields onChange={setVotes} />
      <Field label="Note for the board" value={note} onChangeText={setNote} multiline maxLength={500} hint="Only the board sees this." />
      <Choices<MemberStatus>
        label="Let them in as"
        options={APPROVE_AS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        value={status}
        onChange={setStatus}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Row style={{ gap: space.sm }}>
        <Button
          label="Approve"
          icon="checkmark"
          busy={busy}
          style={{ flex: 1 }}
          onPress={() => act(() => decideApplication(applicant.id, status, votes, note), `${applicant.fullName} is in as ${STATUS_LABEL[status]}.`)}
        />
      </Row>
      <ConfirmButton
        label="Decline"
        confirmLabel={`Decline ${applicant.fullName.split(' ')[0]}`}
        kind="quiet"
        onConfirm={() => act(() => decideApplication(applicant.id, null, votes, note), `Declined ${applicant.fullName}.`)}
      />
    </Card>
  );
}

export function BoardScreen({ navigation }: TabScreen<'Board'>) {
  const { me, data, level, today, isDemo, refresh } = useClub();
  const [done, setDone] = useState<string | null>(null);
  if (!me) return null;
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  const national = level === 'national';
  const scope = boardWatchList(data.members, national ? null : me.chapterId);
  const pending = pendingFor(me, data);
  const alerts = expiryAlerts(scope, data, today);
  const noContact = scope.filter(
    (m) => m.status !== 'family' && !data.emergencyContacts.some((c) => c.memberId === m.id),
  );
  const fngs = scope
    .filter((m) => m.status === 'fng' && m.fngStartedOn)
    .map((m) => ({ m, review: nextFngReview(m.fngStartedOn!, today), due: fngDue(m, data.decisions ?? [], today) }))
    .sort((a, b) => (a.due?.date ?? a.review.date).localeCompare(b.due?.date ?? b.review.date));

  const memberName = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? displayName(m) : '';
  };
  // Road Rules: who's signed, for anyone who can open that list (the NEC and the chapter boards).
  const signoffs = signoffSummary(me, data, today);

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Stack gap={space.sm}>
        <Chip label={national ? 'All chapters' : `${chapter?.name} chapter`} tone="redOutline" />
        <Small>
          {national
            ? 'You sit on the NEC, so you can act for every chapter.'
            : `You can act for the ${chapter?.name} chapter.`}
        </Small>
      </Stack>

      {done ? (
        <Notice tone="ok" title="Done">
          {done}
        </Notice>
      ) : null}

      {/* Stage 5: meetings and votes */}
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          left={<IconBadge icon="hammer" />}
          title="Meetings and votes"
          subtitle="Agendas, minutes, action items and votes"
          onPress={() => navigation.navigate('Business')}
          last={signoffs === null}
        />
        {signoffs !== null ? (
          <ListRow
            left={<IconBadge icon="document-text-outline" />}
            title="Road Rules sign-off"
            subtitle={<Text style={styles.rowMeta}>{signoffs}</Text>}
            onPress={() => navigation.navigate('RoadRulesSignoffs')}
            last
          />
        ) : null}
      </Card>

      <SectionTitle title="Waiting for approval" action={<Small>{pending.length}</Small>} />
      {pending.length === 0 ? (
        <Card>
          <Small>Nobody waiting. New requests show up here and on your home screen.</Small>
        </Card>
      ) : (
        pending.map((a) => <ApplicantCard key={a.id} applicant={a} onDone={setDone} />)
      )}

      <SectionTitle title="Needs attention" action={<Small>{alerts.length}</Small>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {alerts.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No regos, licences or first aid certificates due in the next 30 days.</Small>
          </View>
        ) : (
          alerts.map((a, i) => (
            <ListRow
              key={`${a.memberId}-${a.label}`}
              last={i === alerts.length - 1}
              left={<IconBadge icon={a.kind === 'rego' ? 'speedometer' : a.kind === 'licence' ? 'card' : 'medkit'} />}
              title={memberName(a.memberId)}
              subtitle={`${a.label} · ${a.description}`}
              right={<Chip label={a.state === 'expired' ? 'Expired' : 'Due soon'} tone={a.state === 'expired' ? 'danger' : 'warn'} />}
              onPress={() => navigation.navigate('MemberDetail', { memberId: a.memberId })}
            />
          ))
        )}
      </Card>

      {noContact.length > 0 ? (
        <>
          <SectionTitle title="No emergency contact" action={<Small>{noContact.length}</Small>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {noContact.map((m, i) => (
              <ListRow
                key={m.id}
                last={i === noContact.length - 1}
                left={<Avatar text={initials(m)} size={40} />}
                title={displayName(m)}
                subtitle="Ask them to add one before the next ride"
                onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title="FNG reviews" action={<Small>{fngs.length}</Small>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {fngs.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No FNGs at the moment.</Small>
          </View>
        ) : (
          fngs.map(({ m, review, due }, i) => (
            <ListRow
              key={m.id}
              last={i === fngs.length - 1}
              left={<Avatar text={initials(m)} size={40} />}
              title={displayName(m)}
              subtitle={`${monthsBetween(m.fngStartedOn!, today)} months in · ${due?.atMonths ?? review.atMonths}-month review ${formatLongDate(due?.date ?? review.date)}`}
              right={due?.overdue ? <Chip label="Overdue" tone="warn" /> : review.overdue12 ? <Chip label="Past 12 months" tone="warn" /> : undefined}
              onPress={() => navigation.navigate('FngReview', { memberId: m.id })}
            />
          ))
        )}
      </Card>

      {/* Stage 4: check-ins and fees */}
      <BoardCheckins chapterId={national ? null : me.chapterId} />
      <BoardFees />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Manage one member: status and positions
// ---------------------------------------------------------------------------

export function ManageMemberScreen({ route, navigation }: RootScreen<'ManageMember'>) {
  const { me, data, today, setMemberStatus, appoint, endPosition } = useClub();
  const member = data.members.find((m) => m.id === route.params.memberId);
  const [status, setStatus] = useState<MemberStatus | null>(member?.status ?? null);
  const [role, setRole] = useState<PositionRole | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  if (!member || !me) return null;
  const chapter = data.chapters.find((c) => c.id === member.chapterId);
  const positions = sortedPositions(member.id, data);
  // Only the roles this person could actually fill right now (seat free, allowed to appoint it).
  const roleOptions = [...BOARD_ROLES, ...CLUB_ROLES, ...NATIONAL_ROLES].filter(
    (r) => appointProblem(me, member, member.chapterId, r, data) === null,
  );
  // Stage 5: the patch vote on this FNG (open, or the latest result), or the chance to start one.
  const patchVote = patchVoteFor(member.id, data.votes ?? []);
  const patchOpen = patchVote !== null && patchVote.closedAt === null;
  const tooEarly = patchVoteTooEarly(member.fngStartedOn, today);
  const canStartPatchVote =
    !patchOpen &&
    !tooEarly &&
    patchVote?.result !== 'carried' &&
    member.status === 'fng' &&
    member.approval === 'approved' &&
    runsScope(me, member.chapterId, data.positions);

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'ok', text: ok });
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
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
            <Small>{chapter?.name} chapter</Small>
          </Row>
        </View>
      </Row>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card>
        <H2>Status</H2>
        <Choices<MemberStatus>
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          value={status}
          onChange={setStatus}
        />
        <Small>
          Record the outcome once the vote is done. Full membership needs a yes from every Full Member of the chapter (4.9).
        </Small>
        {/* Stage 5: patch votes */}
        {patchVote && !patchOpen ? (
          <Small>
            {`Patch vote closed ${formatAuDate(melbourneDate(patchVote.closedAt!))}: ${RESULT_LABEL[patchVote.result!]}.`}
          </Small>
        ) : null}
        {patchVote ? (
          <Button
            label={patchOpen ? 'See the patch vote' : 'See the result'}
            kind="secondary"
            onPress={() => navigation.navigate('Vote', { voteId: patchVote.id })}
          />
        ) : null}
        {!patchVote && tooEarly && member.status === 'fng' ? (
          <Small>{`A patch vote can open from ${formatAuDate(nineMonthsAfter(member.fngStartedOn!))}, nine months into the trial (4.7).`}</Small>
        ) : null}
        {canStartPatchVote ? (
          <Button
            label="Start patch vote"
            kind="secondary"
            onPress={() => navigation.navigate('NewVote', { subjectMemberId: member.id })}
          />
        ) : null}
        <Button
          label="Change status"
          disabled={!status || status === member.status}
          onPress={() => status && run(() => setMemberStatus(member.id, status), `${displayName(member)} is now ${STATUS_LABEL[status]}.`)}
        />
      </Card>

      <Card style={{ gap: space.md }}>
        <H2>Positions</H2>
        {positions.length === 0 ? <Small>No positions held.</Small> : null}
        {positions.map((p) => (
          <View key={p.id} style={{ gap: space.sm }}>
            <KeyValue label={ROLE_LABEL[p.role]} value={`Since ${formatLongDate(p.startedOn)}`} />
            {endTermProblem(me, p, data) === null ? (
              <ConfirmButton
                label="End term"
                confirmLabel={`End ${ROLE_LABEL[p.role]} term`}
                kind="quiet"
                onConfirm={() => run(() => endPosition(p.id), `${ROLE_LABEL[p.role]} term ended today.`)}
              />
            ) : null}
          </View>
        ))}
        {roleOptions.length > 0 ? (
          <>
            <Label>Appoint to</Label>
            <Choices<PositionRole>
              options={roleOptions.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
              value={role}
              onChange={setRole}
            />
            <Button
              label="Appoint"
              kind="secondary"
              disabled={!role}
              onPress={() =>
                role &&
                run(async () => {
                  await appoint(member.id, member.chapterId, role);
                  setRole(null);
                }, `${displayName(member)} is now ${ROLE_LABEL[role]}.`)
              }
            />
          </>
        ) : (
          <Small>No open roles you can fill for {displayName(member)}. Seats that are taken free up when the current term ends.</Small>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Counts on rows are stencil, as on Who's signed.
  rowMeta: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
});
