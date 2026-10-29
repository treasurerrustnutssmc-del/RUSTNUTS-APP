// The National Auditor (11.8): the checks over the books and records, written requests to a board
// or the NEC and their answers, findings reports, and the members' records, read only. Boards and
// the NEC reach the same requests and reports from the Board screen.

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { isAuditor, reviewsChapter } from '../domain/access';
import {
  AREA_LABEL, AUDIT_AREAS, auditChecks, answersRequest, KIND_LABEL, requestState, scopeName, visibleReports, visibleRequests,
  type AuditCheck, type RequestState,
} from '../domain/audit';
import { formatAuDate } from '../domain/dates';
import { ROLE_LABEL } from '../domain/labels';
import { displayName } from '../domain/profile';
import { melbourneDate } from '../domain/rides';
import { standingOf } from '../domain/standing';
import { termEndsOn, termState } from '../domain/terms';
import type { AuditArea, AuditReport, AuditRequest, AuditRequestKind, Member } from '../domain/types';
import type { RootParams, RootScreen } from '../navigation/types';
import { space, type } from '../theme';
import {
  Body, Button, Card, Chip, Choices, ConfirmButton, Field, H1, IconBadge, Label, ListRow, Notice, Screen, SectionTitle, Small, Stack,
  StatusChip,
} from '../ui/primitives';
import { ActionWithReason, DateField, Fact, styles, useDate, useRun } from './adminBits';

type Tone = 'ok' | 'warn' | 'danger' | 'steel';
const STATE_LABEL: Record<RequestState, string> = { waiting: 'Waiting', overdue: 'Overdue', answered: 'Answered', closed: 'Closed' };
const STATE_TONE: Record<RequestState, Tone> = { waiting: 'warn', overdue: 'danger', answered: 'ok', closed: 'steel' };
const NOT_AN_AUDIT = 'This review is an internal compliance role. It doesn’t replace an audit the law or the Registered Rules require, or members’ own right to inspect the records (11.8, 13.8).';

function nameOf(id: string | null, members: Member[]): string {
  const m = id ? members.find((x) => x.id === id) : undefined;
  return m ? displayName(m) : 'A former member';
}

const dayOf = (instant: string) => formatAuDate(melbourneDate(instant));
const SCOPE_NEC = 'nec';

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

export function AuditScreen({ navigation }: RootScreen<'Audit'>) {
  const { me, data, today } = useClub();
  if (!me) return null;
  const auditor = isAuditor(me, data.positions);
  const requests = visibleRequests(me, data).sort((a, b) => {
    const open = (r: AuditRequest) => (r.closedAt === null ? 0 : 1);
    return open(a) - open(b) || b.raisedAt.localeCompare(a.raisedAt);
  });
  const reports = visibleReports(me, data);
  const checks = auditor ? auditChecks(data, new Date().toISOString()) : [];
  if (!auditor && requests.length === 0 && reports.length === 0) {
    return (
      <Screen>
        <Notice tone="info">The National Auditor’s requests and reports show here for the boards and the NEC (11.8).</Notice>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>National Auditor</H1>
        <Small>
          {auditor
            ? 'You review the club’s records and controls, ask the boards for information or corrections, and report what you find (11.8).'
            : 'The National Auditor’s requests to your board or the NEC, and the findings reports they’ve issued (11.8).'}
        </Small>
      </Stack>

      {auditor ? (
        <>
          <SectionTitle title="What the records show" action={<Text style={styles.count}>{checks.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {checks.length === 0 ? (
              <View style={{ padding: space.lg }}>
                <Small>Nothing to flag in the books or records today.</Small>
              </View>
            ) : (
              checks.map((c, i) => (
                <ListRow
                  key={c.key}
                  last={i === checks.length - 1}
                  left={<IconBadge icon="alert-circle-outline" tone={c.area === 'controls' || c.area === 'bank' ? 'red' : 'steel'} />}
                  title={<Text style={type.name} numberOfLines={3}>{c.title}</Text>}
                  subtitle={
                    <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                      <Text style={styles.meta}>{c.detail}</Text>
                      <Chip label={AREA_LABEL[c.area]} tone="steel" />
                    </View>
                  }
                  onPress={() => navigation.navigate('NewAuditRequest', { checkKey: c.key })}
                />
              ))
            )}
          </Card>
          {checks.length > 0 ? <Small>Tap one to ask the board about it.</Small> : null}
        </>
      ) : null}

      <SectionTitle title="Requests" action={<Text style={styles.count}>{requests.filter((r) => r.closedAt === null).length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {requests.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No requests yet.</Small>
          </View>
        ) : (
          requests.map((r, i) => {
            const state = requestState(r, today);
            return (
              <ListRow
                key={r.id}
                last={i === requests.length - 1}
                left={<IconBadge icon={r.kind === 'correction' ? 'create-outline' : 'help-circle-outline'} tone={state === 'overdue' ? 'red' : 'steel'} />}
                title={<Text style={type.name} numberOfLines={2}>{r.title}</Text>}
                subtitle={
                  <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                    <Text style={styles.meta}>{`${scopeName(r.chapterId, data)} · ${dayOf(r.raisedAt)}${r.dueOn ? ` · due ${formatAuDate(r.dueOn)}` : ''}`}</Text>
                    <Chip label={STATE_LABEL[state]} tone={STATE_TONE[state]} />
                  </View>
                }
                onPress={() => navigation.navigate('AuditRequest', { requestId: r.id })}
              />
            );
          })
        )}
      </Card>
      {auditor ? <Button label="New request" kind="secondary" icon="add" onPress={() => navigation.navigate('NewAuditRequest')} /> : null}

      <SectionTitle title="Findings reports" />
      <Card style={{ padding: 0, gap: 0 }}>
        {reports.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No reports yet.</Small>
          </View>
        ) : (
          reports.map((r, i) => (
            <ListRow
              key={r.id}
              last={i === reports.length - 1}
              left={<IconBadge icon="document-text-outline" />}
              title={<Text style={type.name} numberOfLines={2}>{r.title}</Text>}
              subtitle={
                <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                  <Text style={styles.meta}>{`${formatAuDate(r.fromOn)} to ${formatAuDate(r.toOn)}`}</Text>
                  <Chip label={r.issuedAt ? `Issued ${dayOf(r.issuedAt)}` : 'Draft'} tone={r.issuedAt ? 'ok' : 'warn'} />
                </View>
              }
              onPress={() => navigation.navigate('AuditReport', { reportId: r.id })}
            />
          ))
        )}
      </Card>
      {auditor ? <Button label="New report" kind="secondary" icon="add" onPress={() => navigation.navigate('AuditReport')} /> : null}

      {auditor ? (
        <>
          <SectionTitle title="The records" />
          <Card style={{ padding: 0, gap: 0 }}>
            <ListRow
              left={<IconBadge icon="cash-outline" />}
              title="Books"
              subtitle="Every fund’s lines, approvals, budgets and monthly reports"
              onPress={() => navigation.navigate('Treasury')}
            />
            <ListRow
              left={<IconBadge icon="people-outline" />}
              title="Membership and attendance"
              subtitle="Status, dates, positions and standing, by chapter"
              onPress={() => navigation.navigate('AuditRecords')}
            />
            <ListRow
              left={<IconBadge icon="calendar-outline" />}
              title="Meetings and votes"
              subtitle="Board and NEC meetings, minutes and results"
              onPress={() => navigation.navigate('Business')}
            />
            <ListRow
              last
              left={<IconBadge icon="library-outline" />}
              title="Documents"
              subtitle="The rules in force and who has signed them"
              onPress={() => navigation.navigate('Documents')}
            />
          </Card>
        </>
      ) : null}

      <Small>{NOT_AN_AUDIT}</Small>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Membership and attendance records, read only
// ---------------------------------------------------------------------------

export function AuditRecordsScreen({ navigation }: RootScreen<'AuditRecords'>) {
  const { me, data, today } = useClub();
  const [chapterId, setChapterId] = useState<string>(data.chapters[0]?.id ?? '');
  if (!me || !reviewsChapter(me, chapterId, data.positions)) {
    return (
      <Screen>
        <Notice tone="info">Only the chapter’s board, the NEC and the National Auditor read these records.</Notice>
      </Screen>
    );
  }
  const theirs = data.members.filter((m) => m.chapterId === chapterId).sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const applicants = theirs.filter((m) => m.approval === 'pending');
  const members = theirs.filter((m) => m.approval === 'approved' && m.status !== 'legacy');
  const seats = data.positions.filter((p) => p.endedOn === null && (p.chapterId === chapterId || (p.chapterId === null && theirs.some((m) => m.id === p.memberId))));

  const standingLine = (m: Member): { text: string; tone: Tone } | null => {
    const s = standingOf(m, data, today);
    if (!s) return null;
    if (s.onHiatus) return { text: 'On hiatus', tone: 'steel' };
    const counted = s.lines.filter((l) => l.state !== 'none');
    if (counted.length === 0) return null;
    const text = counted.map((l) => `${l.label.split(' · ')[0]} ${l.attended}/${l.needed}`).join(' · ');
    const tone: Tone = counted.some((l) => l.state === 'behind') ? 'danger' : counted.some((l) => l.state === 'to_go') ? 'warn' : 'ok';
    return { text, tone };
  };

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>Membership records</H1>
        <Small>Read only. Private details, conduct records and chats stay with the board.</Small>
      </Stack>
      {data.chapters.length > 1 ? (
        <Choices<string> label="Chapter" options={data.chapters.map((c) => ({ value: c.id, label: c.name }))} value={chapterId} onChange={setChapterId} />
      ) : null}

      <SectionTitle title="Positions" />
      <Card style={{ padding: 0, gap: 0 }}>
        {seats.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Small>No positions held.</Small>
          </View>
        ) : (
          seats.map((p, i) => {
            const state = termState(p, today);
            const ends = termEndsOn(p);
            return (
              <ListRow
                key={p.id}
                last={i === seats.length - 1}
                title={ROLE_LABEL[p.role]}
                subtitle={
                  <Text style={styles.meta}>
                    {`${nameOf(p.memberId, data.members)} · since ${formatAuDate(p.startedOn)}${ends ? ` · ${state === 'ended' ? 'ended' : 'ends'} ${formatAuDate(ends)}` : ''}`}
                  </Text>
                }
                right={state === 'ended' ? <Chip label="Past term" tone="danger" /> : state === 'ending' ? <Chip label="Ending" tone="warn" /> : undefined}
              />
            );
          })
        )}
      </Card>

      {applicants.length > 0 ? (
        <>
          <SectionTitle title="Applicants" action={<Text style={styles.count}>{applicants.length}</Text>} />
          <Card style={{ padding: 0, gap: 0 }}>
            {applicants.map((m, i) => (
              <ListRow
                key={m.id}
                last={i === applicants.length - 1}
                title={displayName(m)}
                subtitle={<Text style={styles.meta}>{m.appliedOn ? `Applied ${formatAuDate(m.appliedOn)}` : 'Applied'}</Text>}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Members" action={<Text style={styles.count}>{members.length}</Text>} />
      <Card style={{ padding: 0, gap: 0 }}>
        {members.map((m, i) => {
          const line = standingLine(m);
          const dates = [
            m.patchedOn ? `Patched ${formatAuDate(m.patchedOn)}` : null,
            m.status === 'fng' && m.fngStartedOn ? `FNG from ${formatAuDate(m.fngStartedOn)}` : null,
            !m.patchedOn && m.joinedOn ? `Joined ${formatAuDate(m.joinedOn)}` : null,
          ].filter(Boolean);
          return (
            <ListRow
              key={m.id}
              last={i === members.length - 1}
              title={displayName(m)}
              subtitle={
                <View style={{ gap: space.xs, alignItems: 'flex-start' }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                    <StatusChip status={m.status} />
                    {line ? <Chip label={line.text} tone={line.tone} /> : null}
                  </View>
                  {dates.length > 0 ? <Text style={styles.meta}>{dates.join(' · ')}</Text> : null}
                </View>
              }
              onPress={() => navigation.navigate('MemberDetail', { memberId: m.id })}
            />
          );
        })}
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// A new request
// ---------------------------------------------------------------------------

/** What a check prefills: the board, the kind, the area, a title and the facts. */
function fromCheck(check: AuditCheck | undefined) {
  if (!check) return null;
  return {
    scope: check.chapterId ?? SCOPE_NEC,
    kind: 'correction' as AuditRequestKind,
    area: check.area,
    title: check.title.replace(/ \([\d.]+\)$/, ''),
    details: `${check.title}: ${check.detail}. Please explain or correct it.`,
    ledgerEntryId: check.ledgerEntryId,
  };
}

export function NewAuditRequestScreen({ route, navigation }: RootScreen<'NewAuditRequest'>) {
  const { me, data, raiseAuditRequest } = useClub();
  const check = route.params?.checkKey ? auditChecks(data, new Date().toISOString()).find((c) => c.key === route.params?.checkKey) : undefined;
  const pre = fromCheck(check);
  const [scope, setScope] = useState<string>(pre?.scope ?? data.chapters[0]?.id ?? SCOPE_NEC);
  const [kind, setKind] = useState<AuditRequestKind>(pre?.kind ?? 'information');
  const [area, setArea] = useState<AuditArea>(pre?.area ?? 'bank');
  const [title, setTitle] = useState(pre?.title ?? '');
  const [details, setDetails] = useState(pre?.details ?? '');
  const due = useDate(null);
  const { busy, msg, run } = useRun();
  if (!me || !isAuditor(me, data.positions)) {
    return (
      <Screen>
        <Notice tone="info">Only the National Auditor can do that (11.8).</Notice>
      </Screen>
    );
  }
  const chapterId = scope === SCOPE_NEC ? null : scope;
  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>New request</H1>
        <Small>It goes to that board, or the NEC, who answer in writing.</Small>
      </Stack>
      <Choices<string>
        label="To"
        options={[...data.chapters.map((c) => ({ value: c.id, label: `${c.name} board` })), { value: SCOPE_NEC, label: 'NEC' }]}
        value={scope}
        onChange={setScope}
      />
      <Choices<AuditRequestKind>
        label="Kind"
        options={(['information', 'correction'] as AuditRequestKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        value={kind}
        onChange={setKind}
      />
      <Choices<AuditArea> label="About" options={AUDIT_AREAS.map((a) => ({ value: a, label: AREA_LABEL[a] }))} value={area} onChange={setArea} />
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={120} placeholder="September bank statement" />
      <Field
        label={kind === 'correction' ? 'What needs correcting' : 'What you need'}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={4000}
      />
      <DateField label="Answer by (optional)" date={due} />
      {pre?.ledgerEntryId && chapterId === check?.chapterId ? <Small>The line in the books goes with it.</Small> : null}
      <ActionWithReason
        label="Send request"
        icon="paper-plane-outline"
        big
        busy={busy === 'save'}
        reason={msg?.tone === 'danger' ? msg.text : due.error}
        onPress={() =>
          run('save', async () => {
            const id = await raiseAuditRequest({
              chapterId, kind, area, title, details, dueOn: due.iso || null,
              ledgerEntryId: pre?.ledgerEntryId && chapterId === check?.chapterId ? pre.ledgerEntryId : null,
            });
            navigation.replace('AuditRequest', { requestId: id });
          })
        }
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------

export function AuditRequestScreen({ route, navigation }: RootScreen<'AuditRequest'>) {
  const { me, data, today, answerAuditRequest, closeAuditRequest } = useClub();
  const r = (data.auditRequests ?? []).find((x) => x.id === route.params.requestId);
  const [answer, setAnswer] = useState(r?.answer ?? '');
  const [note, setNote] = useState('');
  const { busy, msg, run } = useRun();
  if (!me || !r) {
    return (
      <Screen>
        <Notice tone="info">That request isn’t there any more.</Notice>
      </Screen>
    );
  }
  const state = requestState(r, today);
  const answers = answersRequest(me, r, data.positions) && r.closedAt === null;
  const auditor = isAuditor(me, data.positions);
  const line = r.ledgerEntryId ? (data.ledger ?? []).find((e) => e.id === r.ledgerEntryId) : undefined;

  return (
    <Screen>
      <Stack gap={space.sm}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          <Chip label={KIND_LABEL[r.kind]} tone="redOutline" />
          <Chip label={STATE_LABEL[state]} tone={STATE_TONE[state]} />
        </View>
        <H1>{r.title}</H1>
      </Stack>
      <Stack gap={space.sm}>
        <Fact icon="people-outline" text={`To the ${scopeName(r.chapterId, data)}`} />
        <Fact icon="pricetag-outline" text={AREA_LABEL[r.area]} />
        <Fact icon="calendar-outline" text={`Sent ${dayOf(r.raisedAt)} by ${nameOf(r.raisedBy, data.members)}`} />
        {r.dueOn ? <Fact icon="time-outline" text={`Answer by ${formatAuDate(r.dueOn)}`} tone={state === 'overdue' ? 'danger' : undefined} /> : null}
      </Stack>
      <Card>
        <Body selectable>{r.details}</Body>
      </Card>
      {line ? (
        <ListRow
          left={<IconBadge icon="cash-outline" />}
          title={line.description}
          subtitle={<Text style={styles.meta}>The line in the books</Text>}
          onPress={() => navigation.navigate('LedgerEntry', { entryId: line.id })}
        />
      ) : null}

      <SectionTitle title="Answer" />
      {r.answer ? (
        <Card>
          <Body selectable>{r.answer}</Body>
          <Small>{`${nameOf(r.answeredBy, data.members)} · ${dayOf(r.answeredAt!)}`}</Small>
        </Card>
      ) : !answers ? (
        <Small>{r.closedAt ? 'Closed without an answer.' : `Waiting on the ${scopeName(r.chapterId, data)}.`}</Small>
      ) : null}
      {answers ? (
        <Stack gap={space.sm}>
          <Field label={r.answer ? 'Update the answer' : 'Your board’s answer'} value={answer} onChangeText={setAnswer} multiline maxLength={4000} />
          <ActionWithReason
            label={r.answer ? 'Update answer' : 'Send answer'}
            icon="paper-plane-outline"
            busy={busy === 'answer'}
            reason={msg?.tone === 'danger' ? msg.text : null}
            onPress={() => run('answer', () => answerAuditRequest(r.id, answer), 'Answer sent.')}
          />
        </Stack>
      ) : null}

      {r.closedAt ? (
        <>
          <SectionTitle title="Closed" />
          <Card>
            <Body selectable>{r.closeNote}</Body>
            <Small>{`${nameOf(r.closedBy, data.members)} · ${dayOf(r.closedAt)}`}</Small>
          </Card>
        </>
      ) : auditor ? (
        <Stack gap={space.sm}>
          <SectionTitle title="Close it" />
          <Field label="Why it’s closing" value={note} onChangeText={setNote} multiline maxLength={1000} placeholder="Satisfied with the answer." />
          <ConfirmButton
            label="Close request"
            confirmLabel="Close it for good"
            kind="secondary"
            confirmNote="Once closed, the board can’t change its answer."
            onConfirm={() => run('close', () => closeAuditRequest(r.id, note), 'Closed.')}
          />
          <View accessibilityLiveRegion="polite" role="alert">
            {msg?.tone === 'danger' && busy === null && !answers ? <Notice tone="danger">{msg.text}</Notice> : null}
          </View>
        </Stack>
      ) : null}
      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// A findings report
// ---------------------------------------------------------------------------

function ReportView({ report, data }: { report: AuditReport; data: { members: Member[] } }) {
  return (
    <>
      <Stack gap={space.sm}>
        <Chip label={report.issuedAt ? `Issued ${dayOf(report.issuedAt)}` : 'Draft'} tone={report.issuedAt ? 'ok' : 'warn'} />
        <H1>{report.title}</H1>
        <Fact icon="calendar-outline" text={`${formatAuDate(report.fromOn)} to ${formatAuDate(report.toOn)}`} />
        <Fact icon="person-outline" text={`National Auditor ${nameOf(report.writtenBy, data.members)}`} />
      </Stack>
      <SectionTitle title="Findings" />
      <Card>
        <Body selectable>{report.findings}</Body>
      </Card>
      {report.recommendations ? (
        <>
          <SectionTitle title="Recommendations" />
          <Card>
            <Body selectable>{report.recommendations}</Body>
          </Card>
        </>
      ) : null}
      <Small>{NOT_AN_AUDIT}</Small>
    </>
  );
}

export function AuditReportScreen({ route, navigation }: RootScreen<'AuditReport'>) {
  const { me, data, today, saveAuditReport, issueAuditReport, deleteAuditReport } = useClub();
  const id = route.params?.reportId ?? null;
  const report = id ? (data.auditReports ?? []).find((r) => r.id === id) : undefined;
  const [title, setTitle] = useState(report?.title ?? '');
  const from = useDate(report?.fromOn ?? null);
  const to = useDate(report?.toOn ?? today);
  const [findings, setFindings] = useState(report?.findings ?? '');
  const [recommendations, setRecommendations] = useState(report?.recommendations ?? '');
  const { busy, msg, run } = useRun();
  if (!me) return null;
  if (id && !report) {
    return (
      <Screen>
        <Notice tone="info">That report isn’t there any more.</Notice>
      </Screen>
    );
  }
  const auditor = isAuditor(me, data.positions);
  if (report && (report.issuedAt || !auditor)) {
    return (
      <Screen>
        <ReportView report={report} data={data} />
      </Screen>
    );
  }
  if (!auditor) {
    return (
      <Screen>
        <Notice tone="info">Only the National Auditor can do that (11.8).</Notice>
      </Screen>
    );
  }
  const save = () =>
    saveAuditReport({ id, title, fromOn: from.iso, toOn: to.iso, findings, recommendations: recommendations || null });

  return (
    <Screen>
      <Stack gap={space.xs}>
        <H1>{report ? 'Draft report' : 'New report'}</H1>
        <Small>Only you see a draft. Once issued, the NEC and every chapter board read it, and it can’t change.</Small>
      </Stack>
      <Field label="Title" value={title} onChangeText={setTitle} maxLength={120} placeholder="Review of the books, July to September 2026" />
      <DateField label="From" date={from} />
      <DateField label="To" date={to} />
      <Field label="Findings" value={findings} onChangeText={setFindings} multiline maxLength={20000} />
      <Field label="Recommendations (optional)" value={recommendations} onChangeText={setRecommendations} multiline maxLength={20000} />
      <ActionWithReason
        label="Save draft"
        icon="save-outline"
        kind="secondary"
        busy={busy === 'save'}
        reason={msg?.tone === 'danger' ? msg.text : null}
        onPress={() =>
          run('save', async () => {
            const saved = await save();
            if (!report) navigation.setParams({ reportId: saved });
          }, 'Draft saved.')
        }
      />
      {msg?.tone === 'ok' ? <Notice tone="ok">{msg.text}</Notice> : null}
      {report ? (
        <Stack gap={space.sm}>
          <Label>When it’s ready</Label>
          <ConfirmButton
            label="Issue report"
            confirmLabel="Issue it to the NEC and boards"
            kind="primary"
            icon="paper-plane-outline"
            confirmNote="This saves what’s on screen first. An issued report can’t be changed or taken back."
            onConfirm={() =>
              run('issue', async () => {
                await save();
                await issueAuditReport(report.id);
              }, 'Issued.')
            }
          />
          <ConfirmButton
            label="Delete draft"
            confirmLabel="Delete this draft"
            kind="quiet"
            onConfirm={() =>
              run('delete', async () => {
                await deleteAuditReport(report.id);
                navigation.goBack();
              })
            }
          />
        </Stack>
      ) : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Ways in: the Me screen (the Auditor) and the Board screen (boards and the NEC)
// ---------------------------------------------------------------------------

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function MeAuditSection() {
  const { me, data, today } = useClub();
  const navigation = useNavigation<NavigationProp<RootParams>>();
  if (!me || !isAuditor(me, data.positions)) return null;
  const checks = auditChecks(data, new Date().toISOString()).length;
  const answered = (data.auditRequests ?? []).filter((r) => r.closedAt === null && r.answer !== null).length;
  const overdue = (data.auditRequests ?? []).filter((r) => requestState(r, today) === 'overdue').length;
  const notes = [
    checks > 0 ? count(checks, 'thing', 'things') + ' to look at' : null,
    answered > 0 ? count(answered, 'answer') + ' in' : null,
    overdue > 0 ? `${overdue} overdue` : null,
  ].filter(Boolean);
  return (
    <>
      <SectionTitle title="National Auditor" />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow
          last
          left={<IconBadge icon="search-outline" tone={answered > 0 || overdue > 0 ? 'red' : 'steel'} />}
          title="Audit"
          subtitle={notes.length > 0 ? notes.join(' · ') : 'Checks, requests and reports'}
          onPress={() => navigation.navigate('Audit')}
        />
      </Card>
    </>
  );
}

export function BoardAuditRow() {
  const { me, data } = useClub();
  const navigation = useNavigation<NavigationProp<RootParams>>();
  if (!me || isAuditor(me, data.positions)) return null;
  const mine = visibleRequests(me, data);
  const reports = visibleReports(me, data);
  if (mine.length === 0 && reports.length === 0) return null;
  const toAnswer = mine.filter((r) => r.closedAt === null && r.answer === null && answersRequest(me, r, data.positions)).length;
  const open = mine.filter((r) => r.closedAt === null).length;
  return (
    <Card style={{ padding: 0, gap: 0 }}>
      <ListRow
        last
        left={<IconBadge icon="search-outline" tone={toAnswer > 0 ? 'red' : 'steel'} />}
        title="National Auditor"
        subtitle={toAnswer > 0 ? `${count(toAnswer, 'request')} to answer` : `${count(open, 'open request')} · ${count(reports.length, 'report')}`}
        onPress={() => navigation.navigate('Audit')}
      />
    </Card>
  );
}

