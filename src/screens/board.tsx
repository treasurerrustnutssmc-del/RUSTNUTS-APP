import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useClub } from '../data/ClubStore';
import {
  appointProblem, appointWarnings, auditorSeat, decidedNoticeFor, endTermProblem, hasCarriedAuditorVote, hasCarriedReinstateVote, hasCarriedSeatVote, holdsBoardSeat, isBoardOf, isChairman, isStepDown, pendingFor, renewAuditorProblem, restoreAccessProblem, statusChangeProblem, suspendAccessProblem,
} from '../domain/access';
import { formatAuDate, formatLongDate, monthsBetween } from '../domain/dates';
import { runsScope } from '../domain/meetings';
import { signoffSummary } from '../domain/roadRules';
import { melbourneDate } from '../domain/rides';
import { auditorVoteFor, nineMonthsAfter, patchVoteFor, patchVoteTooEarly, REINSTATABLE, reinstateVoteFor, removalVoteFor, seatVoteFor } from '../domain/votes';
import { APPROVE_AS, BOARD_ROLES, CLUB_ROLES, NATIONAL_ROLES, RESULT_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_ORDER, TITLE_ROLES } from '../domain/labels';
import { boardWatchList, displayName, expiryAlerts, initials, nextFngReview } from '../domain/profile';
import type { Member, MemberStatus, Position, PositionRole, Votes } from '../domain/types';
import type { RootScreen, TabScreen } from '../navigation/types';
import { colors, fonts, space, type } from '../theme';
// Stage 4
import { fngDue } from '../domain/joining';
import { BoardCheckins } from './checkin';
import { BoardAttendance } from './attendance';
import { WebsiteEnquiries } from './enquiries';
import { WebsiteNews } from './siteNews'; // club news for the website
import { AppFeedbackSection } from './feedback'; // Feedback & issues
import { termEndsOn, termState } from '../domain/terms';
import { seatTitle } from '../domain/home';
import { BoardFees } from './fees';
import { TreasuryRow } from './treasury';
import { BoardAdminCard } from './adminRows'; // Stage 5D
import { BoardAuditRow } from './audit'; // National Auditor
import { DocumentsBoardRow } from './documents'; // Stage 5C
import { seesAnyLedger } from '../domain/ledger';
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
  Toggle,
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
  const books = seesAnyLedger(me, data);
  // National roles see every chapter's board; they act only where they hold a seat (8.2, 12.3).
  const seatNames = data.chapters.filter((c) => holdsBoardSeat(me.id, c.id, data.positions)).map((c) => c.name).join(' and ');

  return (
    <Screen onRefresh={isDemo ? undefined : refresh}>
      <Stack gap={space.sm}>
        <Chip label={national ? 'All chapters' : `${chapter?.name} chapter`} tone="redOutline" />
        <Small>
          {national
            ? `You sit on the NEC, so you see every chapter’s board records. ${seatNames ? `You act for ${seatNames}.` : 'Acting is each chapter board’s.'}`
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
          last={signoffs === null && !books}
        />
        {signoffs !== null ? (
          <ListRow
            left={<IconBadge icon="document-text-outline" />}
            title="Road Rules sign-off"
            subtitle={<Text style={styles.rowMeta}>{signoffs}</Text>}
            onPress={() => navigation.navigate('RoadRulesSignoffs')}
            last={!books}
          />
        ) : null}
        {/* Stage 5B: treasurer */}
        <TreasuryRow />
        {/* Stage 5C: document library */}
        <DocumentsBoardRow last />
      </Card>

      {/* Stage 5D: conduct records, merch, national */}
      <BoardAdminCard />
      {/* The National Auditor's requests and reports */}
      <BoardAuditRow />

      <SectionTitle title="Waiting for approval" action={<Small>{pending.length}</Small>} />
      {pending.length === 0 ? (
        <Card>
          <Small>Nobody waiting. New requests show up here and on your home screen.</Small>
        </Card>
      ) : (
        pending.map((a) => <ApplicantCard key={a.id} applicant={a} onDone={setDone} />)
      )}

      {/* People who asked through the club website's Ride With Us form */}
      <WebsiteEnquiries onDone={setDone} />
      <WebsiteNews onDone={setDone} />
      <AppFeedbackSection onDone={setDone} />

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
      {/* Attendance rules and terms */}
      <BoardAttendance chapterId={national ? null : me.chapterId} />
      <BoardCheckins chapterId={national ? null : me.chapterId} />
      <BoardFees />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Manage one member: status and positions
// ---------------------------------------------------------------------------

export function ManageMemberScreen({ route, navigation }: RootScreen<'ManageMember'>) {
  const { me, data, today, setMemberStatus, appoint, renewAuditor, suspendAccess, restoreAccess } = useClub();
  const member = data.members.find((m) => m.id === route.params.memberId);
  const [status, setStatus] = useState<MemberStatus | null>(member?.status ?? null);
  const [byRequest, setByRequest] = useState(false);
  const [role, setRole] = useState<PositionRole | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  if (!member || !me) return null;
  const chapter = data.chapters.find((c) => c.id === member.chapterId);
  const positions = sortedPositions(member.id, data);
  // Only the roles this person could actually fill right now (seat free, allowed to appoint it).
  const roleOptions = [...BOARD_ROLES, ...CLUB_ROLES, ...NATIONAL_ROLES].filter(
    (r) => appointProblem(me, member, member.chapterId, r, data, today) === null,
  );
  const statusBlock = status && status !== member.status ? statusChangeProblem(me, member, status, data, today, byRequest) : null;
  // Moving an FNG, Full Member or Nomad down to Supporter, Legacy or FNG follows a decided 5.5 notice, unless it's at
  // their request (L2). The toggle shows only when the request is what stands between the board and the move.
  const stepDown =
    status !== null && isStepDown(member.status, status) && isBoardOf(me, member.chapterId, data.positions)
    && statusChangeProblem(me, member, status, data, today, true) === null;
  const decidedNotice = stepDown ? decidedNoticeFor(member.id, data, today) : null;
  const history = (data.statusChanges ?? []).filter((c) => c.memberId === member.id).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const warnings = role ? appointWarnings(member, role, data, today) : [];
  const holdsNothing = member.status !== 'full' && member.status !== 'nomad';
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
  // Coming back to Full or Nomad: the NEC's vote (5.6), which the NEC starts.
  const reinstatable = REINSTATABLE.includes(member.status) && member.approval === 'approved';
  const reinstateVote = reinstatable ? reinstateVoteFor(member.id, data.votes ?? []) : null;
  const reinstateOpen = reinstateVote !== null && reinstateVote.closedAt === null;
  const necSaidYes = hasCarriedReinstateVote(member.id, data, today);
  const canStartReinstateVote = reinstatable && !reinstateOpen && !necSaidYes && runsScope(me, null, data.positions);
  // The National Auditor: a two-thirds NEC vote first, then the Chairman appoints or renews (11.8).
  const seat = auditorSeat(data);
  const sitting = seat?.memberId === member.id;
  const auditorVote = member.status === 'full' ? auditorVoteFor(member.id, data.votes ?? []) : null;
  const auditorVoteOpen = auditorVote !== null && auditorVote.closedAt === null;
  const auditorYes = hasCarriedAuditorVote(member.id, data, today);
  const apart = positions.some((p) => p.endedOn === null && (p.role === 'president' || p.role === 'treasurer'));
  const seatFree = !seat || (sitting && termState(seat, today) !== 'running');
  const canStartAuditorVote =
    member.status === 'full' && member.approval === 'approved' && !apart && seatFree && !auditorVoteOpen && !auditorYes &&
    runsScope(me, null, data.positions);
  const canRenew = sitting && renewAuditorProblem(me, data, today) === null;
  // The National Secretary: a two-thirds NEC vote first, then the Chairman appoints (11.6). The vote
  // can open while a Secretary sits (their successor's); only the appointment needs the seat free.
  const secretarySeat = data.positions.find((p) => p.role === 'nec_secretary' && p.endedOn === null) ?? null;
  const secretaryVote = member.status === 'full' ? seatVoteFor(member.id, data.votes ?? [], 'nec_secretary') : null;
  const secretaryVoteOpen = secretaryVote !== null && secretaryVote.closedAt === null;
  const secretaryYes = hasCarriedSeatVote(member.id, 'nec_secretary', data, today);
  const onNec = positions.some((p) => p.endedOn === null && (p.role === 'nec_chair' || p.role === 'nec_secretary' || p.role === 'nec_auditor'));
  const canStartSecretaryVote =
    member.status === 'full' && member.approval === 'approved' && !onNec && !secretaryVoteOpen && !secretaryYes &&
    runsScope(me, null, data.positions);

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
          onChange={(s) => { setStatus(s); setByRequest(false); }}
        />
        {stepDown && status ? (
          <Toggle
            label="At the member’s request"
            description={`They asked to step down to ${STATUS_LABEL[status]}, so no 5.5 notice is needed. The record says so.`}
            value={byRequest}
            onChange={setByRequest}
          />
        ) : null}
        {stepDown && status && decidedNotice && !byRequest ? (
          <Small>{`Their 5.5 notice was decided on ${formatAuDate(decidedNotice.closedOn!)}, so the board can move them to ${STATUS_LABEL[status]}.`}</Small>
        ) : null}
        {statusBlock ? (
          <Small style={{ color: colors.warn }}>{statusBlock}</Small>
        ) : member.status === 'fng' ? (
          <Small>An FNG becomes Full once their patch vote carries: a yes from every Full Member of the chapter (4.9).</Small>
        ) : null}
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
        {reinstatable && !statusBlock ? (
          <Small>
            {necSaidYes
              ? 'The NEC voted yes, so the NEC can bring them back to Full or Nomad (5.6).'
              : reinstateVote?.result === 'carried'
                ? 'The NEC’s yes is more than 90 days old, so it needs a new vote (5.6).'
                : 'Coming back to Full or Nomad needs a yes vote from the NEC first (5.6).'}
          </Small>
        ) : null}
        {reinstateVote && !reinstateOpen ? (
          <Small>
            {`NEC vote closed ${formatAuDate(melbourneDate(reinstateVote.closedAt!))}: ${RESULT_LABEL[reinstateVote.result!]}.`}
          </Small>
        ) : null}
        {reinstateVote ? (
          <Button
            label={reinstateOpen ? 'See the NEC vote' : 'See the NEC result'}
            kind="secondary"
            onPress={() => navigation.navigate('Vote', { voteId: reinstateVote.id })}
          />
        ) : null}
        {canStartReinstateVote ? (
          <Button
            label="Start NEC vote"
            kind="secondary"
            onPress={() => navigation.navigate('NewVote', { subjectMemberId: member.id })}
          />
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
          disabled={!status || status === member.status || statusBlock !== null}
          onPress={() => status && run(async () => {
            await setMemberStatus(member.id, status, stepDown && byRequest);
            setByRequest(false);
          }, `${displayName(member)} is now ${STATUS_LABEL[status]}.`)}
        />
        {history.length ? (
          <Stack gap={2}>
            <Label>Status changes</Label>
            {history.slice(0, 5).map((c) => {
              const by = c.changedBy ? data.members.find((m) => m.id === c.changedBy) : undefined;
              const how = c.byRequest ? ' at their request' : c.noticeId ? ' after a 5.5 notice' : '';
              return (
                <Small key={c.id}>
                  {`${formatAuDate(c.changedOn)}: ${STATUS_LABEL[c.fromStatus]} to ${STATUS_LABEL[c.toStatus]}${how}${by ? `, by ${displayName(by)}` : ''}.`}
                </Small>
              );
            })}
          </Stack>
        ) : null}
      </Card>

      <Card style={{ gap: space.md }}>
        <H2>Positions</H2>
        {positions.length === 0 ? <Small>No positions held.</Small> : null}
        {positions.map((p) => (
          <View key={p.id} style={{ gap: space.sm }}>
            <KeyValue label={seatTitle(p, data.chapters, ROLE_LABEL)} value={`Since ${formatLongDate(p.startedOn)}`} />
            {termEndsOn(p) ? (
              <KeyValue
                label="Term"
                value={`${termState(p, today) === 'ended' ? 'Ended' : 'Ends'} ${formatAuDate(termEndsOn(p))}`}
                tone={termState(p, today) === 'running' ? undefined : 'warn'}
              />
            ) : null}
            <TermActions position={p} member={member} />
          </View>
        ))}
        {/* The National Auditor (11.8) */}
        {sitting && termState(seat!, today) !== 'running' && isChairman(me.id, data.positions) ? (
          <Small>
            {auditorYes
              ? 'The NEC voted to keep them on, so you can renew them for another twelve months.'
              : 'Their twelve months are up or nearly up. Renewing needs a fresh two-thirds NEC vote (11.8).'}
          </Small>
        ) : !seat && auditorYes ? (
          <Small>The NEC voted by two-thirds to appoint them National Auditor (11.8).</Small>
        ) : null}
        {auditorVote ? (
          <Button
            label={auditorVoteOpen ? 'See the Auditor vote' : 'See the Auditor vote result'}
            kind="secondary"
            onPress={() => navigation.navigate('Vote', { voteId: auditorVote.id })}
          />
        ) : null}
        {canStartAuditorVote ? (
          <Button
            label={sitting ? 'Start NEC vote to renew as Auditor' : 'Start NEC vote for National Auditor'}
            kind="secondary"
            onPress={() => navigation.navigate('NewVote', { subjectMemberId: member.id, subjectRole: 'nec_auditor' })}
          />
        ) : null}
        {/* The National Secretary (11.6) */}
        {!secretarySeat && secretaryYes ? <Small>The NEC voted by two-thirds to appoint them National Secretary (11.6).</Small> : null}
        {secretaryVote ? (
          <Button
            label={secretaryVoteOpen ? 'See the Secretary vote' : 'See the Secretary vote result'}
            kind="secondary"
            onPress={() => navigation.navigate('Vote', { voteId: secretaryVote.id })}
          />
        ) : null}
        {canStartSecretaryVote ? (
          <Button
            label="Start NEC vote for National Secretary"
            kind="secondary"
            onPress={() => navigation.navigate('NewVote', { subjectMemberId: member.id, subjectRole: 'nec_secretary' })}
          />
        ) : null}
        {canRenew ? (
          <ConfirmButton
            label="Renew as National Auditor"
            confirmLabel="Renew for twelve months"
            kind="secondary"
            confirmNote="Their current term ends today and a new twelve-month term starts today."
            onConfirm={() => run(() => renewAuditor(), `${displayName(member)} is National Auditor for another twelve months.`)}
          />
        ) : null}
        {roleOptions.length > 0 ? (
          <>
            <Label>Appoint to</Label>
            <Choices<PositionRole>
              options={roleOptions.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
              value={role}
              onChange={setRole}
            />
            {warnings.map((w) => (
              <Small key={w} style={{ color: colors.warn }}>{w}</Small>
            ))}
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
          <Small>
            {holdsNothing
              ? 'Only Full and Nomad members hold Club positions (4.6, 5.8).'
              : `No open roles you can fill for ${displayName(member)}. Seats that are taken free up when the current term ends.`}
          </Small>
        )}
      </Card>

      {/* Member content rules: the chapter board can pause a member's app access on the spot */}
      {suspendAccessProblem(me, member, data.positions) === null ? (
        <Card>
          <H2>App access</H2>
          <Small>
            Suspending cuts {displayName(member)} off from the chats, posts, directory and records at once, until the board
            restores it. It doesn’t change their membership: record the conduct and follow the constitution separately.
          </Small>
          <ConfirmButton
            label="Suspend app access"
            confirmLabel="Yes, suspend their access"
            icon="hand-left-outline"
            confirmNote="They’ll see a note that their chapter board has paused their access. Nothing they posted is removed by this."
            onConfirm={() => run(() => suspendAccess(member.id), `${displayName(member)}’s app access is suspended.`)}
          />
        </Card>
      ) : null}
      {restoreAccessProblem(me, member, data.positions) === null ? (
        <Card>
          <H2>App access</H2>
          <Notice tone="warn">Their app access is suspended. They see only a note to talk to the chapter board.</Notice>
          <ConfirmButton
            label="Restore app access"
            confirmLabel="Yes, restore their access"
            kind="secondary"
            icon="hand-right-outline"
            onConfirm={() => run(() => restoreAccess(member.id), `${displayName(member)}’s app access is back.`)}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

/**
 * What `me` can do about one term on the Manage member screen: step down from their own, end it after
 * a carried removal vote, or start that vote (9.3). The vote's shape follows the role: two-thirds of
 * the chapter's Full Members for a board seat, a majority of the chapter board otherwise.
 */
function TermActions({ position: p, member }: { position: Position; member: Member }) {
  const { me, data, today, endPosition } = useClub();
  const navigation = useNavigation<RootScreen<'ManageMember'>['navigation']>();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const own = p.memberId === me.id;
  const problem = endTermProblem(me, p, data, today);
  const role = seatTitle(p, data.chapters, ROLE_LABEL);
  const end = () => endPosition(p.id).then(() => setError(null), (e: Error) => setError(e.message));
  if (problem === null) {
    return (
      <>
        {error ? <Small style={{ color: colors.warn }}>{error}</Small> : null}
        <ConfirmButton
          label={own ? `Step down as ${role}` : `End ${role} term`}
          confirmLabel={own ? 'Yes, step down' : 'Yes, end term'}
          confirmAccessibilityLabel={own ? `Yes, step down as ${role}` : `Yes, end ${role} term`}
          kind="secondary"
          size="small"
          onConfirm={end}
        />
      </>
    );
  }
  // A chapter role someone else holds: the chapter board can start, or follow, the removal vote.
  if (own || p.chapterId === null || TITLE_ROLES.includes(p.role) || !runsScope(me, p.chapterId, data.positions)) return null;
  const vote = removalVoteFor(p, data.votes ?? []);
  const open = vote !== null && vote.closedAt === null;
  const boardSeat = BOARD_ROLES.includes(p.role);
  return (
    <>
      <Small>
        {vote && !open
          ? `Removal vote closed ${formatAuDate(melbourneDate(vote.closedAt!))}: ${RESULT_LABEL[vote.result!]}.`
          : boardSeat
            ? 'Removing a board member takes a two-thirds vote of the chapter’s Full Members (9.3).'
            : 'Ending someone’s chapter role takes a majority vote of the chapter board (9.3).'}
      </Small>
      {vote ? (
        <Button label={open ? 'See the removal vote' : 'See the result'} kind="secondary" onPress={() => navigation.navigate('Vote', { voteId: vote.id })} />
      ) : null}
      {!open ? (
        <Button
          label="Start removal vote"
          kind="secondary"
          onPress={() => navigation.navigate('NewVote', { chapterId: p.chapterId, subjectMemberId: member.id, subjectRole: p.role })}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // Counts on rows are stencil, as on Who's signed.
  rowMeta: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
});
