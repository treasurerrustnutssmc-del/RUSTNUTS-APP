import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useClub } from '../data/ClubStore';
import {
  actingCap, actingDefaultUntil, actingWarnings, appointActingProblem, appointProblem, appointWarnings, auditorSeat, decidedNoticeFor, endTermProblem, hasCarriedAuditorVote, hasCarriedReinstateVote, hasCarriedSeatVote, isBoardOf, isChairman, isStepDown, pendingFor, renewAuditorProblem, requestActingProblem, restoreAccessProblem, setActingUntilProblem, statusChangeProblem, suspendAccessProblem, WHY_MAX, WHY_NEEDED,
} from '../domain/access';
import { heldPositions, heldRows, isActing } from '../domain/acting';
import {
  actingSeatOptions, appointChoices, arrangeCover, backNote, boardVoteStep, changeDateLatest, confirmText, coverLine, doneMessage, endVoteBlock, pageRequests,
  PROPOSED_MESSAGE, replaceNote, stintNote, TERM_ACTION, termActionsFor, termLine, untilHint, WHY_HINT, whyLabel, type AppointKind,
} from '../domain/actingCopy';
import { formatAuDate, formatLongDate, monthsBetween } from '../domain/dates';
import { runsScope } from '../domain/meetings';
import { signoffSummary } from '../domain/roadRules';
import { melbourneDate } from '../domain/rides';
import {
  ACTING_END_SHAPE, actingVoteQuestion, auditorVoteFor, nineMonthsAfter, patchVoteFor, patchVoteTooEarly, REINSTATABLE, reinstateVoteFor, removalVoteFor, seatVoteFor,
} from '../domain/votes';
import { APPROVE_AS, BOARD_ROLES, CLUB_ROLES, NATIONAL_ROLES, RESULT_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_ORDER, TITLE_ROLES } from '../domain/labels';
import { boardWatchList, displayName, expiryAlerts, initials, nextFngReview } from '../domain/profile';
import type { ActingRequest, Member, MemberStatus, Position, PositionRole, Votes } from '../domain/types';
import type { RootScreen, TabScreen } from '../navigation/types';
import { colors, fonts, space, type } from '../theme';
// Stage 4
import { approveAsHint, fngDue } from '../domain/joining';
import {
  boardGroups, boardRequests, boardScope, closeRequestNote, NEED_GROUP, needsYou, needsYouTarget, requestActions, requestConfirmNote, requestLine, requestNext,
  scopeText, vpFallbackLine, type BoardGroupId, type NeedsYou, type NeedsYouKind,
} from '../domain/boardLayout';
import { useJump } from '../ui/useJump';
import { settleOpen } from '../domain/groupOpen';
import { BoardCheckins } from './checkin';
import { BoardAttendance } from './attendance';
import { termState } from '../domain/terms';
import { seatTitle } from '../domain/home';
import { BoardFees } from './fees';
import { TreasuryRow } from './treasury';
import { BoardAdminCard } from './adminRows'; // Stage 5D
import { BoardAuditRow } from './audit'; // National Auditor
import { DocumentsBoardRow } from './documents'; // Stage 5C
import { WebsiteAppRow } from './websiteApp'; // Website and app, its own page
import { seesAnyLedger } from '../domain/ledger';
import { IntroProgressCard, VotesFields } from './fng';
import { DateField, useDate } from './adminBits';
import { sortedPositions } from '../ui/MemberBits';
import {
  Avatar,
  Body,
  Button,
  Card,
  Chip,
  Choices,
  ConfirmButton,
  Disclosure,
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
  const hint = approveAsHint(applicant.status, status);

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
      {hint ? <Notice tone="info">{hint}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Small>
        {status === 'full'
          ? 'Approving lets them in as a Full member. Only for someone already patched who signed up with a different email. Their patch date starts as today.'
          : `Approving lets them in as ${STATUS_LABEL[status]}.`}
      </Small>
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
        confirmNote={`Declining tells ${applicant.fullName.split(' ')[0]}. It can’t be undone.`}
        kind="quiet"
        onConfirm={() => act(() => decideApplication(applicant.id, null, votes, note), `Declined ${applicant.fullName}.`)}
      />
    </Card>
  );
}

export function BoardScreen({ navigation, route }: TabScreen<'Board'>) {
  const { me, data, today, isDemo, refresh } = useClub();
  const [done, setDone] = useState<string | null>(null);
  // Which groups the person has opened or closed themselves; the rest follow what is waiting.
  const [chosen, setChosen] = useState<Partial<Record<BoardGroupId, boolean>>>({});
  // Each Needs-you row can scroll the Board to the list it stands for.
  const { scroller, mark, jump } = useJump<NeedsYouKind | BoardGroupId>();
  const showList = (kind: NeedsYouKind) => {
    setChosen((c) => ({ ...c, [NEED_GROUP[kind]]: true }));
    // The list itself, or the group around it if the list isn't there (the count changed meanwhile).
    jump(kind, NEED_GROUP[kind]);
  };
  // Home's board rows open the Board at the matching list.
  const focus = route.params?.focus;
  if (focus && !chosen[NEED_GROUP[focus]]) setChosen((c) => ({ ...c, [NEED_GROUP[focus]]: true }));
  useEffect(() => {
    if (!focus) return;
    jump(focus, NEED_GROUP[focus]);
    navigation.setParams({ focus: undefined });
  }, [focus, jump, navigation]);
  if (!me) return null;
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  // Every chapter only for someone who sees every chapter: an Acting President is on the NEC but sees North's board alone.
  const scopeChapter = boardScope(me, data.positions);
  const national = scopeChapter === null;
  const scope = boardWatchList(data.members, scopeChapter);
  const pending = pendingFor(me, data);
  const alerts = expiryAlerts(scope, data, today);
  const noContact = scope.filter(
    (m) => m.status !== 'family' && !data.emergencyContacts.some((c) => c.memberId === m.id),
  );
  const fngs = scope
    .filter((m) => m.status === 'fng' && m.fngStartedOn)
    .map((m) => ({ m, review: nextFngReview(m.fngStartedOn!, today), due: fngDue(m, data.decisions ?? [], today) }))
    .sort((a, b) => (a.due?.date ?? a.review.date).localeCompare(b.due?.date ?? b.review.date));

  const counts = { pending: pending.length, alerts: alerts.length, noContact: noContact.length, fngs: fngs.length };
  const memberIds: Record<NeedsYouKind, string[]> = {
    pending: pending.map((m) => m.id),
    alerts: alerts.map((a) => a.memberId),
    noContact: noContact.map((m) => m.id),
    fngs: fngs.map((f) => f.m.id),
  };
  // A Needs-you row opens the place it gets dealt with: the one member or FNG review, or the list here.
  const openNeed = (n: NeedsYou) => {
    const target = needsYouTarget(n.kind, memberIds[n.kind]);
    if (target.to === 'member') navigation.navigate('MemberDetail', { memberId: target.memberId, focus: target.focus });
    else if (target.to === 'fng') navigation.navigate('FngReview', { memberId: target.memberId });
    else showList(target.kind);
  };
  const attention = needsYou(counts);
  const groups = boardGroups(counts);
  // A group that needs the board opens, and stays open once the thing that opened it is dealt with.
  const settled = settleOpen(chosen, groups);
  if (settled !== chosen) setChosen(settled);

  const memberName = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? displayName(m) : '';
  };
  // Road Rules: who's signed, for anyone who can open that list (the NEC and the chapter boards).
  const signoffs = signoffSummary(me, data, today);
  const books = seesAnyLedger(me, data);
  // Open acting requests with a step for me, and the 11.2 line wherever my chapter's VP casts the NEC vote through the fallback.
  const requests = boardRequests(me, data, new Date().toISOString());
  const fallbacks = data.chapters.filter((c) => vpFallbackLine(c.id, me, data, today) !== null).map((c) => c.id);
  const nothingNeedsYou = attention.length === 0 && requests.length === 0 && fallbacks.length === 0;

  return (
    <Screen onRefresh={isDemo ? undefined : refresh} scroller={scroller}>
      <Stack gap={space.sm}>
        <Chip label={national ? 'All chapters' : `${chapter?.name} chapter`} tone="redOutline" />
        {/* National roles see every chapter's board; they decide only where they hold a seat (8.2, 12.3). */}
        <Small>{scopeText(me, data)}</Small>
      </Stack>

      {done ? (
        <Notice tone="ok" title="Done">
          {done}
        </Notice>
      ) : null}

      <SectionTitle title="Needs you" />
      {nothingNeedsYou ? (
        <Card style={{ padding: 0, gap: 0 }}>
          <View style={{ padding: space.lg }}>
            <Small>Nothing needs you right now.</Small>
          </View>
        </Card>
      ) : null}
      {attention.length > 0 ? (
        <Card style={{ padding: 0, gap: 0 }}>
          {attention.map((n, i) => (
            <ListRow
              key={n.text}
              last={i === attention.length - 1}
              left={<IconBadge icon="alert-circle-outline" tone="red" />}
              title={n.text}
              lines="all"
              onPress={() => openNeed(n)}
            />
          ))}
        </Card>
      ) : null}
      {fallbacks.map((c) => (
        <VpFallback key={c} chapterId={c} onDone={setDone} />
      ))}
      {requests.map((r) => (
        <BoardRequest key={r.id} request={r} onDone={setDone} />
      ))}

      {/* Club admin, one card (Jeff, 21 Nov 2026: simplify the Board page): documents, the Auditor,
          conduct, merch, National, and the website and app on their own page */}
      <Card style={{ padding: 0, gap: 0 }}>
        <DocumentsBoardRow />
        <BoardAuditRow bare />
        <BoardAdminCard bare />
        <WebsiteAppRow last />
      </Card>

      {groups.map((g) => {
        const isOpen = chosen[g.id] ?? true;
        return (
          <View key={g.id} ref={mark(g.id)} collapsable={false}>
          <Disclosure title={g.title} summary={g.summary} open={isOpen} onToggle={() => setChosen((c) => ({ ...c, [g.id]: !isOpen }))}>
            {g.id === 'approvals' ? (
              pending.length === 0 ? (
                <Card>
                  <Small>Nobody waiting. New requests show up here and on your home screen.</Small>
                </Card>
              ) : (
                pending.map((a) => <ApplicantCard key={a.id} applicant={a} onDone={setDone} />)
              )
            ) : null}
            {g.id === 'people' ? (
              <>
                {signoffs !== null ? (
                  <Card style={{ padding: 0, gap: 0 }}>
                    <ListRow
                      left={<IconBadge icon="document-text-outline" />}
                      title="Road Rules sign-off"
                      subtitle={<Text style={styles.rowMeta}>{signoffs}</Text>}
                      onPress={() => navigation.navigate('RoadRulesSignoffs')}
                      last
                    />
                  </Card>
                ) : null}
                {alerts.length === 0 && noContact.length === 0 && fngs.length === 0 ? (
                  <Card>
                    <Small>No regos, licences or first aid certificates due in the next 30 days, and no FNG reviews.</Small>
                  </Card>
                ) : null}
                {alerts.length > 0 ? (
                  <>
                    <View ref={mark('alerts')} collapsable={false}>
                      <SectionTitle title="Needs attention" action={<Small>{alerts.length}</Small>} />
                    </View>
                    <Card style={{ padding: 0, gap: 0 }}>
                      {alerts.map((a, i) => (
                        <ListRow
                          key={`${a.memberId}-${a.label}`}
                          last={i === alerts.length - 1}
                          left={<IconBadge icon={a.kind === 'rego' ? 'speedometer' : a.kind === 'licence' ? 'card' : 'medkit'} />}
                          title={memberName(a.memberId)}
                          subtitle={
                            <View>
                              <Small numberOfLines={2}>{a.label}</Small>
                              <Text style={styles.rowMeta}>{a.description}</Text>
                            </View>
                          }
                          right={<Chip label={a.state === 'expired' ? 'Expired' : 'Due soon'} tone={a.state === 'expired' ? 'danger' : 'warn'} />}
                          onPress={() => navigation.navigate('MemberDetail', { memberId: a.memberId })}
                        />
                      ))}
                    </Card>
                  </>
                ) : null}
                {noContact.length > 0 ? (
                  <>
                    <View ref={mark('noContact')} collapsable={false}>
                      <SectionTitle title="No emergency contact" action={<Small>{noContact.length}</Small>} />
                    </View>
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
                {fngs.length > 0 ? (
                  <>
                    <View ref={mark('fngs')} collapsable={false}>
                      <SectionTitle title="FNG reviews" action={<Small>{fngs.length}</Small>} />
                    </View>
                    <Card style={{ padding: 0, gap: 0 }}>
                      {fngs.map(({ m, review, due }, i) => (
                        <ListRow
                          key={m.id}
                          last={i === fngs.length - 1}
                          left={<Avatar text={initials(m)} size={40} />}
                          title={displayName(m)}
                          lines="all"
                          subtitle={`${monthsBetween(m.fngStartedOn!, today)} months in · ${due?.atMonths ?? review.atMonths}-month review ${formatLongDate(due?.date ?? review.date)}`}
                          right={due?.overdue ? <Chip label="Overdue" tone="warn" /> : review.overdue12 ? <Chip label="Past 12 months" tone="warn" /> : undefined}
                          onPress={() => navigation.navigate('FngReview', { memberId: m.id })}
                        />
                      ))}
                    </Card>
                  </>
                ) : null}
              </>
            ) : null}
            {g.id === 'meetings' ? (
              <>
                {/* Stage 5: meetings and votes */}
                <Card style={{ padding: 0, gap: 0 }}>
                  <ListRow
                    left={<IconBadge icon="hammer" />}
                    title="Meetings and votes"
                    subtitle="Agendas, minutes, action items and votes"
                    onPress={() => navigation.navigate('Business')}
                    last
                  />
                </Card>
                <BoardAttendance chapterId={scopeChapter} />
                <BoardCheckins chapterId={scopeChapter} />
              </>
            ) : null}
            {g.id === 'money' ? (
              <>
                {/* Stage 5B: the treasurer's books (only for those who keep or read them) */}
                {books ? (
                  <Card style={{ padding: 0, gap: 0 }}>
                    <TreasuryRow last />
                  </Card>
                ) : null}
                <BoardFees />
              </>
            ) : null}
          </Disclosure>
          </View>
        );
      })}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The Board tab's acting lines: open requests, and the 11.2 VP fallback
// ---------------------------------------------------------------------------

/**
 * An open request on the Board tab: what was asked, then `me`'s one next step (Confirm cover or
 * Confirm acting where the rules allow it, or the board vote to start or follow), then Withdraw
 * request or Decline for those who may close it.
 */
function BoardRequest({ request, onDone }: { request: ActingRequest; onDone: (text: string) => void }) {
  const { me, data, today, confirmActing, withdrawActingRequest, openActingVote } = useClub();
  const navigation = useNavigation<RootScreen<'ManageMember'>['navigation']>();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const next = requestNext(request, me, data, new Date().toISOString());
  const actions = requestActions(request, me, data, today);
  const standIn = data.members.find((m) => m.id === request.memberId);
  // Several requests can sit here at once, so each button says which one it acts on.
  const about = `${standIn ? displayName(standIn) : 'Someone'} as ${ROLE_LABEL[request.role]}`;
  const settle = (work: Promise<unknown>, text: string) => work.then(() => { setError(null); onDone(text); }, (e: Error) => setError(e.message));
  return (
    <Card style={{ gap: space.sm }}>
      <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <IconBadge icon="swap-horizontal" tone="red" />
        <Body style={{ flex: 1 }}>{requestLine(request, data)}</Body>
      </Row>
      {next?.kind === 'start' && next.last ? <Small>{next.last}</Small> : null}
      {error ? <Small style={{ color: colors.danger }}>{error}</Small> : null}
      {next?.kind === 'confirm' ? (
        <ConfirmButton
          label={next.label}
          accessibilityLabel={`${next.label}: ${about}`}
          confirmLabel="Yes, confirm"
          confirmAccessibilityLabel={`Yes, ${next.label.toLowerCase()}: ${about}`}
          kind="secondary"
          confirmNote={requestConfirmNote(request, data, today)}
          onConfirm={() => settle(confirmActing(request.id), standIn ? doneMessage(standIn, request.role, request.until) : 'Confirmed.')}
        />
      ) : next?.kind === 'start' ? (
        <ConfirmButton
          label={next.label}
          accessibilityLabel={`${next.label}: ${about}`}
          confirmLabel="Yes, start it"
          confirmAccessibilityLabel={`Yes, start the vote: ${about}`}
          kind="secondary"
          confirmNote={next.note}
          onConfirm={() =>
            openActingVote(request.id, next.quorum, next.closesAt, null).then(
              (voteId) => navigation.navigate('Vote', { voteId }),
              (e: Error) => setError(e.message),
            )
          }
        />
      ) : next?.kind === 'see' ? (
        <Button
          label={next.label}
          accessibilityLabel={`${next.label}: ${about}`}
          kind="secondary"
          onPress={() => navigation.navigate('Vote', { voteId: next.voteId })}
        />
      ) : null}
      {actions.map((a) => (
        <ConfirmButton
          key={a}
          label={a}
          accessibilityLabel={`${a}: ${about}`}
          confirmLabel={a === 'Decline' ? 'Yes, decline' : 'Yes, withdraw'}
          confirmNote={closeRequestNote(request, data)}
          kind="quiet"
          onConfirm={() => settle(withdrawActingRequest(request.id), a === 'Decline' ? 'Declined. The request is closed.' : 'Request withdrawn.')}
        />
      ))}
    </Card>
  );
}

/**
 * The 11.2 line for a chapter's board while its VP casts the NEC vote with the President seat
 * empty, and "Make Jet Acting President" where `me` could record it: Until and Why open in place,
 * checked as typed, and the confirm repeats the warnings, as Appoint does on Manage member.
 */
function VpFallback({ chapterId, onDone }: { chapterId: string; onDone: (text: string) => void }) {
  const { me, data, today, appointActing } = useClub();
  const [open, setOpen] = useState(false);
  const until = useDate(null);
  const [why, setWhy] = useState('');
  const [error, setError] = useState<string | null>(null);
  // While the confirm is armed its note repeats the warnings and it has its own Cancel.
  const [armed, setArmed] = useState(false);
  if (!me) return null;
  const line = vpFallbackLine(chapterId, me, data, today);
  const target = line ? data.members.find((m) => m.id === line.memberId) : undefined;
  if (!line || !target) return null;
  const block = appointActingProblem(me, target, chapterId, 'president', until.iso, why, data, today);
  // The Why is required: say nothing about it until something is typed, and the button stays off.
  const blockShown = block === WHY_NEEDED && !why.trim() ? null : block;
  const warnings = until.iso ? actingWarnings(target, chapterId, 'president', null, until.iso, data, today) : [];
  const close = () => { setOpen(false); setWhy(''); setError(null); };
  return (
    <Card style={{ gap: space.sm }}>
      <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <IconBadge icon="alert-circle-outline" tone="red" />
        <Body style={{ flex: 1 }}>{line.text}</Body>
      </Row>
      {line.button && !open ? (
        <Button
          label={line.button}
          kind="secondary"
          onPress={() => {
            setOpen(true);
            until.setText(formatAuDate(actingDefaultUntil(chapterId, 'president', false, today, data)));
          }}
        />
      ) : null}
      {line.button && open ? (
        <View style={styles.coverForm}>
          <DateField label="Until" date={until} hint={untilHint(actingCap(chapterId, 'president', false, today, data))} />
          <Field label={whyLabel(target, chapterId, 'president', data)} value={why} onChangeText={setWhy} maxLength={WHY_MAX} hint={WHY_HINT} />
          {armed ? null : warnings.map((w) => (
            <Small key={w} style={{ color: colors.warn }}>{w}</Small>
          ))}
          {/* The reason the button is off reads apart from the advisory warnings above it. */}
          {blockShown ? <Small style={{ color: colors.danger }}>{blockShown}</Small> : null}
          {error ? <Small style={{ color: colors.danger }}>{error}</Small> : null}
          <ConfirmButton
            label="Appoint"
            confirmLabel="Yes, appoint"
            confirmAccessibilityLabel={`Yes, make ${displayName(target)} Acting President`}
            kind="secondary"
            disabled={block !== null}
            onArmedChange={setArmed}
            confirmNote={confirmText({ route: 'record', target, chapterId, role: 'president', until: until.iso }, data, today)}
            onConfirm={() => {
              const last = until.iso;
              appointActing(target.id, chapterId, 'president', last, why.trim()).then(
                () => { onDone(doneMessage(target, 'president', last)); close(); },
                (e: Error) => setError(e.message),
              );
            }}
          />
          {armed ? null : <Button label="Cancel" kind="quiet" size="small" onPress={close} />}
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Manage one member: status and positions
// ---------------------------------------------------------------------------

export function ManageMemberScreen({ route, navigation }: RootScreen<'ManageMember'>) {
  const { me, data, today, setMemberStatus, appoint, renewAuditor, suspendAccess, restoreAccess, appointActing, requestActing } = useClub();
  const member = data.members.find((m) => m.id === route.params.memberId);
  const [status, setStatus] = useState<MemberStatus | null>(member?.status ?? null);
  const [byRequest, setByRequest] = useState(false);
  const [kind, setKind] = useState<AppointKind | null>(null);
  const [role, setRole] = useState<PositionRole | null>(null);
  const until = useDate(null);
  const [why, setWhy] = useState('');
  // While the acting confirm is armed its note repeats the warnings, so the warn lines step aside.
  const [actingArmed, setActingArmed] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  if (!member || !me) return null;
  const chapter = data.chapters.find((c) => c.id === member.chapterId);
  const positions = sortedPositions(member.id, data);
  // Only the roles this person could actually fill right now (seat free, allowed to appoint it).
  const roleOptions = [...BOARD_ROLES, ...CLUB_ROLES, ...NATIONAL_ROLES].filter(
    (r) => appointProblem(me, member, member.chapterId, r, data, today) === null,
  );
  // Appoint is acting until a date (route 1, or a board vote first for a President who isn't the
  // sitting VP) or a full term; acting is the default for a board seat (9.8).
  const actingSeats = actingSeatOptions(me, member, data, today);
  const kinds = appointChoices({ acting: actingSeats.map((s) => s.role), full: roleOptions });
  const appointKind = kind !== null && kinds.options.some((o) => o.value === kind) ? kind : kinds.initial;
  const seatChoices = appointKind === 'acting'
    ? actingSeats.map((s) => ({ value: s.role, label: s.label }))
    : roleOptions.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const picked = role !== null && seatChoices.some((o) => o.value === role) ? role : null;
  const actingSeat = appointKind === 'acting' && picked ? actingSeats.find((s) => s.role === picked) ?? null : null;
  const pickRole = (r: PositionRole) => {
    setRole(r);
    if (appointKind === 'acting') until.setText(formatAuDate(actingDefaultUntil(member.chapterId, r, false, today, data)));
  };
  const actingBlock = actingSeat
    ? actingSeat.needsVote
      ? requestActingProblem(me, member, member.chapterId, actingSeat.role, null, until.iso, why, data, today)
      : appointActingProblem(me, member, member.chapterId, actingSeat.role, until.iso, why, data, today)
    : null;
  // The Why is required: say nothing about it until something is typed, and the button stays off.
  const actingBlockShown = actingBlock === WHY_NEEDED && !why.trim() ? null : actingBlock;
  const actingNotes = actingSeat && until.iso
    ? actingWarnings(member, member.chapterId, actingSeat.role, null, until.iso, data, today, actingSeat.needsVote ? true : undefined)
    : [];
  const replacing = appointKind === 'full' && picked ? replaceNote(member, member.chapterId, picked, data) : null;
  const statusBlock = status && status !== member.status ? statusChangeProblem(me, member, status, data, today, byRequest) : null;
  // Moving an FNG, Full Member or Nomad down to Supporter, Legacy or FNG follows a decided 5.5 notice, unless it's at
  // their request (L2). The toggle shows only when the request is what stands between the board and the move.
  const stepDown =
    status !== null && isStepDown(member.status, status) && isBoardOf(me, member.chapterId, data.positions)
    && statusChangeProblem(me, member, status, data, today, true) === null;
  const decidedNotice = stepDown ? decidedNoticeFor(member.id, data, today) : null;
  const history = (data.statusChanges ?? []).filter((c) => c.memberId === member.id).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const warnings = appointKind === 'full' && picked ? appointWarnings(member, picked, data, today) : actingNotes;
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
  const apart = heldPositions(member.id, data.positions).some((p) => p.role === 'president' || p.role === 'treasurer');
  const seatFree = !seat || (sitting && termState(seat, today) !== 'running');
  const canStartAuditorVote =
    member.status === 'full' && member.approval === 'approved' && !apart && seatFree && !auditorVoteOpen && !auditorYes &&
    runsScope(me, null, data.positions);
  const canRenew = sitting && renewAuditorProblem(me, data, today) === null;
  // The National Secretary: a two-thirds NEC vote first, then the Chairman appoints (11.6). The vote
  // can open while a Secretary sits (their successor's); only the appointment needs the seat free.
  const secretarySeat = heldRows(data.positions).find((p) => p.role === 'nec_secretary') ?? null;
  const secretaryVote = member.status === 'full' ? seatVoteFor(member.id, data.votes ?? [], 'nec_secretary') : null;
  const secretaryVoteOpen = secretaryVote !== null && secretaryVote.closedAt === null;
  const secretaryYes = hasCarriedSeatVote(member.id, 'nec_secretary', data, today);
  const onNec = heldPositions(member.id, data.positions).some((p) => p.role === 'nec_chair' || p.role === 'nec_secretary' || p.role === 'nec_auditor');
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
        {positions.map((p) => {
          const line = termLine(p, today);
          const note = stintNote(p, data);
          const cover = coverLine(p, data);
          return (
            <View key={p.id} style={{ gap: space.sm }}>
              <KeyValue label={seatTitle(p, data.chapters, ROLE_LABEL)} value={`Since ${formatLongDate(p.startedOn)}`} />
              {line ? <KeyValue label={line.label} value={line.value} tone={line.tone} /> : null}
              {note ? <Small>{note}</Small> : null}
              {cover ? <Small>{cover}</Small> : null}
              {isActing(p) ? <ActingActions position={p} /> : <TermActions position={p} member={member} />}
              <ArrangeCover seat={p} onDone={(text) => setMsg({ tone: 'ok', text })} />
            </View>
          );
        })}
        {pageRequests(member, data).map((r) => (
          <RequestStep key={r.id} request={r} />
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
        {kinds.options.length > 0 && seatChoices.length > 0 ? (
          <>
            {/* Two kinds to choose between, or a plain line naming the only one. */}
            {kinds.options.length > 1 ? (
              <Choices<AppointKind>
                label="Appoint"
                options={kinds.options}
                value={appointKind}
                onChange={(k) => { setKind(k); setRole(null); }}
              />
            ) : (
              <View style={{ gap: space.xs }}>
                <Label>Appoint</Label>
                <Body>{kinds.options[0].label}</Body>
              </View>
            )}
            <Choices<PositionRole>
              label={appointKind === 'acting' ? 'Act as' : 'Appoint to'}
              options={seatChoices}
              value={picked}
              onChange={pickRole}
            />
            {actingSeat ? (
              <>
                <DateField label="Until" date={until} hint={untilHint(actingCap(member.chapterId, actingSeat.role, false, today, data))} />
                <Field
                  label={whyLabel(member, member.chapterId, actingSeat.role, data)}
                  value={why}
                  onChangeText={setWhy}
                  maxLength={WHY_MAX}
                  hint={WHY_HINT}
                />
              </>
            ) : null}
            {actingArmed ? null : warnings.map((w) => (
              <Small key={w} style={{ color: colors.warn }}>{w}</Small>
            ))}
            {actingSeat ? (
              <>
                {/* The reason the button is off reads apart from the advisory warnings above it. */}
                {actingBlockShown ? <Small style={{ color: colors.danger }}>{actingBlockShown}</Small> : null}
                <ConfirmButton
                  label={actingSeat.needsVote ? 'Ask the board to vote' : 'Appoint'}
                  confirmLabel={actingSeat.needsVote ? 'Yes, ask' : 'Yes, appoint'}
                  confirmAccessibilityLabel={actingSeat.needsVote
                    ? `Yes, ask the board to vote on ${displayName(member)} acting as ${ROLE_LABEL[actingSeat.role]}`
                    : `Yes, appoint ${displayName(member)} as Acting ${ROLE_LABEL[actingSeat.role]}`}
                  kind="secondary"
                  disabled={actingBlock !== null}
                  onArmedChange={setActingArmed}
                  confirmNote={confirmText(
                    actingSeat.needsVote
                      ? { route: 'propose', target: member, chapterId: member.chapterId, role: actingSeat.role, covers: null, until: until.iso }
                      : { route: 'record', target: member, chapterId: member.chapterId, role: actingSeat.role, until: until.iso },
                    data,
                    today,
                  )}
                  onConfirm={() => {
                    const { role: r, needsVote } = actingSeat;
                    const last = until.iso;
                    run(async () => {
                      if (needsVote) await requestActing(member.id, member.chapterId, r, null, last, why.trim());
                      else await appointActing(member.id, member.chapterId, r, last, why.trim());
                      setRole(null);
                      setWhy('');
                    }, needsVote ? PROPOSED_MESSAGE : doneMessage(member, r, last));
                  }}
                />
              </>
            ) : replacing && picked ? (
              <ConfirmButton
                label="Appoint"
                confirmLabel="Yes, appoint"
                confirmAccessibilityLabel={`Yes, appoint ${displayName(member)} as ${ROLE_LABEL[picked]}`}
                kind="secondary"
                confirmNote={replacing}
                onConfirm={() => run(async () => {
                  await appoint(member.id, member.chapterId, picked);
                  setRole(null);
                }, `${displayName(member)} is now ${ROLE_LABEL[picked]}.`)}
              />
            ) : (
              <Button
                label="Appoint"
                kind="secondary"
                disabled={!picked}
                onPress={() =>
                  picked &&
                  run(async () => {
                    await appoint(member.id, member.chapterId, picked);
                    setRole(null);
                  }, `${displayName(member)} is now ${ROLE_LABEL[picked]}.`)
                }
              />
            )}
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
        {error ? <Small style={{ color: colors.danger }}>{error}</Small> : null}
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

/**
 * What `me` can do about an acting seat (termActionsFor): Change date (a DD/MM/YYYY field, saved
 * through setActingUntil), Step down from acting, I’m back for the covered holder, and for the rest
 * of the chapter's board the vote to end acting, a board majority (9.3), never a removal vote.
 */
function ActingActions({ position: p }: { position: Position }) {
  const { me, data, today, endPosition, setActingUntil } = useClub();
  const navigation = useNavigation<RootScreen<'ManageMember'>['navigation']>();
  const [changing, setChanging] = useState(false);
  const until = useDate(p.actingUntil ?? null);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const actions = termActionsFor(p, me, data, today);
  if (actions.length === 0) return null;
  const title = seatTitle(p, data.chapters, ROLE_LABEL);
  const latest = changeDateLatest(p, me, data, today);
  // Nothing to say until a new date is typed: the field starts on the current one.
  const dateBlock = until.iso && until.iso !== p.actingUntil ? setActingUntilProblem(me, p, until.iso, data, today) : null;
  const vote = removalVoteFor(p, data.votes ?? []);
  const endBlock = endVoteBlock(p, data, today);
  const settle = (work: Promise<void>, after?: () => void) => work.then(() => { setError(null); after?.(); }, (e: Error) => setError(e.message));
  const voteLine = (
    <Small key="vote-line">
      {vote && vote.closedAt !== null && vote.result !== 'carried'
        ? `Vote to end acting closed ${formatAuDate(melbourneDate(vote.closedAt))}: ${RESULT_LABEL[vote.result!]}.`
        : ACTING_END_SHAPE}
    </Small>
  );
  return (
    <>
      {error ? <Small style={{ color: colors.danger }}>{error}</Small> : null}
      {changing && latest ? (
        <>
          <DateField label="Until" date={until} hint={untilHint(latest)} />
          {dateBlock ? <Small style={{ color: colors.danger }}>{dateBlock}</Small> : null}
          <Row style={{ gap: space.sm }}>
            <Button
              label="Save date"
              kind="secondary"
              size="small"
              disabled={!until.iso || until.iso === p.actingUntil || dateBlock !== null}
              onPress={() => settle(setActingUntil(p.id, until.iso), () => setChanging(false))}
            />
            <Button label="Cancel" kind="quiet" size="small" onPress={() => { setChanging(false); until.setText(formatAuDate(p.actingUntil)); }} />
          </Row>
        </>
      ) : null}
      {actions.map((a) => {
        switch (a) {
          case TERM_ACTION.changeDate:
            return changing ? null : (
              <Button key={a} label={a} kind="secondary" size="small" accessibilityLabel={`Change the date ${title} ends`} onPress={() => setChanging(true)} />
            );
          case TERM_ACTION.stepDown:
            return (
              <ConfirmButton
                key={a}
                label={a}
                confirmLabel="Yes, step down"
                confirmAccessibilityLabel={`Yes, step down as ${title}`}
                kind="secondary"
                size="small"
                onConfirm={() => settle(endPosition(p.id))}
              />
            );
          case TERM_ACTION.back:
            return (
              <ConfirmButton
                key={a}
                label={a}
                confirmLabel="Yes, I’m back"
                confirmNote={backNote(p, data)}
                kind="secondary"
                size="small"
                onConfirm={() => settle(endPosition(p.id))}
              />
            );
          case TERM_ACTION.endActing:
            return (
              <ConfirmButton
                key={a}
                label={a}
                confirmLabel="Yes, end acting"
                confirmAccessibilityLabel={`Yes, end acting as ${title}`}
                confirmNote="The board’s vote to end it carried, so it ends today."
                kind="secondary"
                size="small"
                onConfirm={() => settle(endPosition(p.id))}
              />
            );
          case TERM_ACTION.seeEndVote:
            return vote ? (
              <React.Fragment key={a}>
                {voteLine}
                <Button label={a} kind="secondary" size="small" onPress={() => navigation.navigate('Vote', { voteId: vote.id })} />
              </React.Fragment>
            ) : null;
          case TERM_ACTION.startEndVote:
            // On a board too small to decide it, the button stays, off, with the reason under it.
            return (
              <React.Fragment key={a}>
                {voteLine}
                <Button
                  label={a}
                  kind="secondary"
                  size="small"
                  disabled={endBlock !== null}
                  onPress={() => navigation.navigate('NewVote', { chapterId: p.chapterId, subjectMemberId: p.memberId, subjectRole: p.role })}
                />
                {endBlock ? <Small style={{ color: colors.danger }}>{endBlock}</Small> : null}
              </React.Fragment>
            );
        }
      })}
    </>
  );
}

/**
 * On an away holder's page, for another member of that chapter's board: "Arrange cover (board
 * vote)" proposes a stand-in from the board (route 3), when the holder can't be asked. Nothing moves
 * until the board votes yes and a board member confirms it; the confirm text repeats the warnings.
 */
function ArrangeCover({ seat, onDone }: { seat: Position; onDone: (text: string) => void }) {
  const { me, data, today, requestActing } = useClub();
  const [open, setOpen] = useState(false);
  const [standIn, setStandIn] = useState<string | null>(null);
  const until = useDate(null);
  const [why, setWhy] = useState('');
  const [error, setError] = useState<string | null>(null);
  // While the confirm is armed its note repeats the warnings and it has its own Cancel.
  const [armed, setArmed] = useState(false);
  if (!me || seat.chapterId === null) return null;
  const state = arrangeCover(me, seat, data, today);
  if (!state) return null;
  const chapterId = seat.chapterId;
  const title = seatTitle(seat, data.chapters, ROLE_LABEL);
  if (!open || state.blocked !== null) {
    // When nobody can cover (a board too small to vote, say), the button stays, off, with the reason under it.
    return (
      <>
        <Button
          label="Arrange cover (board vote)"
          kind="secondary"
          size="small"
          disabled={state.blocked !== null}
          accessibilityLabel={`Arrange cover of ${title} (board vote)`}
          onPress={() => {
            setOpen(true);
            until.setText(formatAuDate(actingDefaultUntil(chapterId, seat.role, true, today, data)));
          }}
        />
        {state.blocked ? <Small style={{ color: colors.danger }}>{state.blocked}</Small> : null}
      </>
    );
  }
  const target = standIn ? data.members.find((m) => m.id === standIn) : undefined;
  const block = target ? requestActingProblem(me, target, chapterId, seat.role, seat, until.iso, why, data, today) : null;
  const blockShown = block === WHY_NEEDED && !why.trim() ? null : block;
  const warnings = target && until.iso ? actingWarnings(target, chapterId, seat.role, seat, until.iso, data, today, true) : [];
  const close = () => { setOpen(false); setStandIn(null); setWhy(''); setError(null); };
  return (
    <View style={styles.coverForm}>
      <Label>{`Cover ${title}`}</Label>
      <Choices<string> label="Who stands in" options={state.standIns} value={standIn} onChange={setStandIn} />
      <DateField label="Until" date={until} hint={untilHint(actingCap(chapterId, seat.role, true, today, data))} />
      <Field
        label={target ? whyLabel(target, chapterId, seat.role, data) : 'Why'}
        value={why}
        onChangeText={setWhy}
        maxLength={WHY_MAX}
        hint={WHY_HINT}
      />
      {armed ? null : warnings.map((w) => (
        <Small key={w} style={{ color: colors.warn }}>{w}</Small>
      ))}
      {/* The reason the button is off reads apart from the advisory warnings above it. */}
      {blockShown ? <Small style={{ color: colors.danger }}>{blockShown}</Small> : null}
      {error ? <Small style={{ color: colors.danger }}>{error}</Small> : null}
      <ConfirmButton
        label="Ask the board to vote"
        confirmLabel="Yes, ask"
        confirmAccessibilityLabel={target ? `Yes, ask the board to vote on ${displayName(target)} covering as ${title}` : undefined}
        kind="secondary"
        disabled={!target || block !== null}
        onArmedChange={setArmed}
        confirmNote={target ? confirmText({ route: 'propose', target, chapterId, role: seat.role, covers: seat, until: until.iso }, data, today) : undefined}
        onConfirm={() => {
          if (!target) return;
          requestActing(target.id, chapterId, seat.role, seat.id, until.iso, why.trim()).then(
            () => { close(); onDone(PROPOSED_MESSAGE); },
            (e: Error) => setError(e.message),
          );
        }}
      />
      {armed ? null : <Button label="Cancel" kind="quiet" size="small" onPress={close} />}
    </View>
  );
}

/**
 * An open request about this member (as the stand-in, or for their seat): what was asked, then the
 * board vote's next step: start it, a week long with the least quorum, or follow it. Confirming
 * happens on the Board tab.
 */
function RequestStep({ request }: { request: ActingRequest }) {
  const { me, data, openActingVote } = useClub();
  const navigation = useNavigation<RootScreen<'ManageMember'>['navigation']>();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const step = boardVoteStep(me, request, data, new Date().toISOString());
  const standIn = data.members.find((m) => m.id === request.memberId);
  const about = `${standIn ? displayName(standIn) : 'Someone'} as ${ROLE_LABEL[request.role]}`;
  return (
    <View style={{ gap: space.sm }}>
      <Label>Asked for</Label>
      <Body>{actingVoteQuestion(request, data)}</Body>
      {error ? <Small style={{ color: colors.danger }}>{error}</Small> : null}
      {step?.kind === 'start' && step.last ? <Small>{step.last}</Small> : null}
      {step?.kind === 'start' ? (
        <ConfirmButton
          label="Start the board vote"
          confirmLabel="Yes, start it"
          confirmAccessibilityLabel={`Yes, start the vote: ${about}`}
          kind="secondary"
          size="small"
          confirmNote={step.note}
          onConfirm={() =>
            openActingVote(request.id, step.quorum, step.closesAt, null).then(
              (voteId) => navigation.navigate('Vote', { voteId }),
              (e: Error) => setError(e.message),
            )
          }
        />
      ) : step?.kind === 'see' ? (
        <Button label="See the board vote" kind="secondary" size="small" onPress={() => navigation.navigate('Vote', { voteId: step.voteId })} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Counts on rows are stencil, as on Who's signed.
  rowMeta: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
  // Arrange cover opens in place under its seat, set off by a hairline rather than a nested card.
  coverForm: { gap: space.sm, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.lineStrong },
});
