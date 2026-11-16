// The National Auditor's requests, findings reports and checks (constitution v4, 11.8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerRequestProblem, answersRequest, auditChecks, auditSeatRows, closeRequestProblem, deleteReportProblem, issueReportProblem,
  raiseRequestProblem, saveReportProblem, seesReport, seesRequest, vpFallbackFor, type RequestInput, type ReportInput,
} from './audit';
import { DEMO_DATA } from '../data/demoStory.testkit';
import { club, member, session, who } from './stage4.testkit';
import { standingOf } from './standing';
import type { AuditReport, AuditRequest, ClubData, LedgerEntry, Meeting, Position } from './types';

const TODAY = '2026-10-29';
const NOW = '2026-10-29T01:00:00.000Z';

function auditClub(over: Partial<ClubData> = {}): ClubData {
  const base = club();
  return club({
    members: [...base.members, member('pres', { patchedOn: '2020-01-01' }), member('npres', { chapterId: 'north', patchedOn: '2020-01-01' })],
    positions: [
      ...base.positions,
      { id: 'p-pres', memberId: 'pres', chapterId: 'west', role: 'president', startedOn: '2025-08-01', endedOn: null },
      { id: 'p-npres', memberId: 'npres', chapterId: 'north', role: 'president', startedOn: '2025-08-01', endedOn: null },
    ],
    ...over,
  });
}

const request = (over: Partial<AuditRequest> = {}): AuditRequest => ({
  id: 'ar-1', chapterId: 'west', kind: 'correction', area: 'transactions', title: 'Second approval missing',
  details: 'The Bunnings payment was paid with one approval.', dueOn: null, ledgerEntryId: null,
  raisedBy: 'auditor', raisedAt: NOW, answer: null, answeredBy: null, answeredAt: null,
  closedAt: null, closedBy: null, closeNote: null, ...over,
});

const report = (over: Partial<AuditReport> = {}): AuditReport => ({
  id: 'rep-1', title: 'First half review', fromOn: '2026-07-01', toOn: '2026-09-30', findings: 'Books are in order.',
  recommendations: null, writtenBy: 'auditor', savedAt: NOW, issuedAt: null, ...over,
});

const reqInput = (over: Partial<RequestInput> = {}): RequestInput => ({
  chapterId: 'west', kind: 'information', area: 'bank', title: 'September statement',
  details: 'Please send the bank statement for September.', dueOn: '2026-11-12', ledgerEntryId: null, ...over,
});

// Requests -----------------------------------------------------------------------------------------

test('only the Auditor raises a request, to a chapter board or the NEC (11.8)', () => {
  const d = auditClub();
  const aud = who(d, 'auditor');
  assert.equal(raiseRequestProblem(aud, reqInput(), d, TODAY), null);
  assert.equal(raiseRequestProblem(aud, reqInput({ chapterId: null, kind: 'correction' }), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(who(d, 'chair'), reqInput(), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(who(d, 'tre'), reqInput(), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(aud, reqInput({ chapterId: 'nowhere' }), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(aud, reqInput({ title: '  ' }), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(aud, reqInput({ title: 'x'.repeat(121) }), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(aud, reqInput({ details: '' }), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(aud, reqInput({ dueOn: '2026-10-28' }), d, TODAY), null);
  assert.equal(raiseRequestProblem(aud, reqInput({ dueOn: null }), d, TODAY), null);
});

test('a request can name a ledger line in that fund', () => {
  const line = { id: 'le-1', chapterId: 'west' } as LedgerEntry;
  const d = auditClub({ ledger: [line] });
  const aud = who(d, 'auditor');
  assert.equal(raiseRequestProblem(aud, reqInput({ ledgerEntryId: 'le-1' }), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(aud, reqInput({ ledgerEntryId: 'le-1', chapterId: 'north' }), d, TODAY), null);
  assert.notEqual(raiseRequestProblem(aud, reqInput({ ledgerEntryId: 'nope' }), d, TODAY), null);
});

test('the board answers its requests, the NEC answers national ones; members never see them', () => {
  const d = auditClub({ auditRequests: [request(), request({ id: 'ar-nat', chapterId: null })] });
  const [west, nat] = d.auditRequests!;
  assert.equal(answersRequest(who(d, 'sec'), west, d.positions), true);
  assert.equal(answersRequest(who(d, 'northsec'), west, d.positions), false);
  assert.equal(answersRequest(who(d, 'sec'), nat, d.positions), false);
  assert.equal(answersRequest(who(d, 'pres'), nat, d.positions), true);
  assert.equal(answersRequest(who(d, 'chair'), west, d.positions), false, 'no West seat');
  assert.equal(answersRequest(who(d, 'auditor'), west, d.positions), false);
  assert.equal(seesRequest(who(d, 'auditor'), west, d), true);
  assert.equal(seesRequest(who(d, 'npres'), west, d), true, 'the NEC sees every request');
  assert.equal(seesRequest(who(d, 'northsec'), west, d), false);
  assert.equal(seesRequest(who(d, 'rider'), west, d), false);
  assert.equal(answerRequestProblem(who(d, 'sec'), 'ar-1', 'Fixed, second approval added.', d), null);
  assert.notEqual(answerRequestProblem(who(d, 'sec'), 'ar-1', '  ', d), null);
  assert.notEqual(answerRequestProblem(who(d, 'rider'), 'ar-1', 'Hi', d), null);
  assert.notEqual(answerRequestProblem(who(d, 'sec'), 'nope', 'Hi', d), null);
});

test('the Auditor closes a request with a note; closed is final', () => {
  const d = auditClub({ auditRequests: [request(), request({ id: 'ar-done', closedAt: NOW, closedBy: 'auditor', closeNote: 'Sorted' })] });
  assert.equal(closeRequestProblem(who(d, 'auditor'), 'ar-1', 'Satisfied.', d), null);
  assert.notEqual(closeRequestProblem(who(d, 'auditor'), 'ar-1', ' ', d), null);
  assert.notEqual(closeRequestProblem(who(d, 'sec'), 'ar-1', 'Done', d), null);
  assert.notEqual(closeRequestProblem(who(d, 'auditor'), 'ar-done', 'Again', d), null);
  assert.notEqual(answerRequestProblem(who(d, 'sec'), 'ar-done', 'Late answer', d), null);
});

// Reports ------------------------------------------------------------------------------------------

const repInput = (over: Partial<ReportInput> = {}): ReportInput => ({
  id: null, title: 'First half review', fromOn: '2026-07-01', toOn: '2026-09-30', findings: 'In order.', recommendations: null, ...over,
});

test('the Auditor drafts and issues findings reports; issued is final', () => {
  const d = auditClub({ auditReports: [report(), report({ id: 'rep-out', issuedAt: NOW })] });
  const aud = who(d, 'auditor');
  assert.equal(saveReportProblem(aud, repInput(), d, TODAY), null);
  assert.equal(saveReportProblem(aud, repInput({ id: 'rep-1' }), d, TODAY), null);
  assert.notEqual(saveReportProblem(aud, repInput({ id: 'rep-out' }), d, TODAY), null);
  assert.notEqual(saveReportProblem(aud, repInput({ id: 'nope' }), d, TODAY), null);
  assert.notEqual(saveReportProblem(who(d, 'chair'), repInput(), d, TODAY), null);
  assert.notEqual(saveReportProblem(aud, repInput({ title: '' }), d, TODAY), null);
  assert.notEqual(saveReportProblem(aud, repInput({ fromOn: '2026-10-01', toOn: '2026-09-30' }), d, TODAY), null);
  assert.notEqual(saveReportProblem(aud, repInput({ toOn: '2026-10-30' }), d, TODAY), null);
  assert.notEqual(saveReportProblem(aud, repInput({ findings: ' ' }), d, TODAY), null);
  assert.equal(issueReportProblem(aud, 'rep-1', d), null);
  assert.notEqual(issueReportProblem(aud, 'rep-out', d), null);
  assert.notEqual(issueReportProblem(who(d, 'chair'), 'rep-1', d), null);
  assert.equal(deleteReportProblem(aud, 'rep-1', d), null);
  assert.notEqual(deleteReportProblem(aud, 'rep-out', d), null);
});

test('drafts stay with the Auditor; issued reports go to the NEC and every board', () => {
  const d = auditClub();
  const draft = report();
  const issued = report({ issuedAt: NOW });
  assert.equal(seesReport(who(d, 'auditor'), draft, d.positions), true);
  assert.equal(seesReport(who(d, 'chair'), draft, d.positions), false);
  assert.equal(seesReport(who(d, 'chair'), issued, d.positions), true);
  assert.equal(seesReport(who(d, 'northsec'), issued, d.positions), true);
  assert.equal(seesReport(who(d, 'rider'), issued, d.positions), false);
});

// Checks -------------------------------------------------------------------------------------------

const line = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'le', chapterId: 'west', code: 'DB-001', description: 'Bunnings', amountCents: 5000, receivedOn: null,
  entryOn: '2026-10-10', payeeMemberId: null, payeeName: 'Bunnings', paymentId: null, state: 'paid', recordedBy: 'tre',
  recordedAt: NOW, updatedAt: NOW, voidReason: null, voidedBy: null,
  approvals: [{ memberId: 'sec', approvedAt: NOW }, { memberId: 'pres', approvedAt: NOW }], ...over,
});

const keys = (d: ClubData) => auditChecks(d, NOW).map((c) => c.key);

test('the checks find payments short of two approvals and payees who approved themselves (13.3)', () => {
  const d = auditClub({
    ledger: [
      line({ id: 'ok' }),
      line({ id: 'one', approvals: [{ memberId: 'sec', approvedAt: NOW }] }),
      line({ id: 'fees', code: 'DB-004', approvals: [] }),
      line({ id: 'self', payeeMemberId: 'sec', payeeName: null }),
      line({ id: 'void', state: 'void', approvals: [] }),
    ],
    treasurerReports: [{ month: '2026-10-01', presentedAt: NOW, presentedBy: 'tre' }],
  });
  const k = keys(d);
  assert.ok(k.includes('one-approval:one'));
  assert.ok(k.includes('payee-approved:self'));
  assert.ok(!k.some((x) => x.endsWith(':ok') || x.endsWith(':fees') || x.endsWith(':void')));
});

test('the checks find money banked late (13.1)', () => {
  const d = auditClub({
    ledger: [
      line({ id: 'late', code: 'CR-002', receivedOn: '2026-09-28', entryOn: '2026-10-10', approvals: [] }),
      line({ id: 'quick', code: 'CR-002', receivedOn: '2026-10-08', entryOn: '2026-10-10', approvals: [] }),
    ],
    treasurerReports: [{ month: '2026-10-01', presentedAt: NOW, presentedBy: 'tre' }],
  });
  const k = keys(d);
  assert.ok(k.includes('banked-late:late'));
  assert.ok(!k.includes('banked-late:quick'));
});

test('the checks find a past month that was never presented, and funds with no approved budget', () => {
  const d = auditClub({
    ledger: [line({ id: 'sep', entryOn: '2026-09-10' }), line({ id: 'oct', entryOn: '2026-10-10' })],
    treasurerReports: [],
    budgets: [{ chapterId: 'west', fy: 2026, lines: {}, approvedVoteId: 'v', approvedAt: NOW, approvedBy: 'pres', updatedAt: NOW }],
  });
  const k = keys(d);
  assert.ok(k.includes('not-presented:2026-09-01'));
  assert.equal(auditChecks(d, NOW).find((c) => c.key === 'not-presented:2026-09-01')!.detail, 'September 2026 has lines in the books');
  assert.ok(!k.includes('not-presented:2026-10-01'), 'this month is still running');
  assert.ok(k.includes('no-budget:club'));
  assert.ok(k.includes('no-budget:north'));
  assert.ok(!k.includes('no-budget:west'));
});

test('the checks find confirmed fee payments that never reached the books', () => {
  const d = auditClub({
    charges: [{ id: 'ch-1', memberId: 'rider', chapterId: 'west', description: 'Fees', amountCents: 36000, dueOn: '2026-08-01', fy: 2026 } as never],
    payments: [{ id: 'pay-1', chargeId: 'ch-1', amountCents: 36000, paidOn: '2026-08-02', state: 'confirmed' } as never],
  });
  assert.ok(keys(d).includes('fee-not-in-books:pay-1'));
});

test('the checks find terms past their end and minutes overdue (10.8)', () => {
  const old: Position = { id: 'p-old', memberId: 'auditor', chapterId: null, role: 'nec_auditor', startedOn: '2025-01-01', endedOn: null };
  const meeting = (id: string, startsAt: string, over: Partial<Meeting> = {}): Meeting => ({
    id, chapterId: 'west', kind: 'board', title: 'Board', startsAt, location: null, agenda: [], minutes: null,
    minutesSharedAt: null, minutesApprovedAt: null, minutesApprovedBy: null, cancelledAt: null, createdBy: 'sec', ...over,
  });
  const base = auditClub();
  const d = {
    ...base,
    positions: [...base.positions.filter((p) => p.role !== 'nec_auditor'), old],
    meetings: [
      meeting('late', '2026-10-01T08:00:00.000Z'),
      meeting('fresh', '2026-10-27T08:00:00.000Z'),
      meeting('shared', '2026-10-01T08:00:00.000Z', { minutesSharedAt: NOW }),
      meeting('off', '2026-10-01T08:00:00.000Z', { cancelledAt: NOW }),
    ],
  };
  const k = keys(d);
  assert.ok(k.includes('term-ended:p-old'));
  assert.ok(k.includes('minutes-overdue:late'));
  assert.ok(!k.includes('minutes-overdue:fresh'));
  assert.ok(!k.includes('minutes-overdue:shared'));
  assert.ok(!k.includes('minutes-overdue:off'));
});

test('every check names its area and, for money, its fund', () => {
  const d = auditClub({ ledger: [line({ id: 'one', approvals: [] })] });
  const c = auditChecks(d, NOW).find((x) => x.key === 'one-approval:one')!;
  assert.equal(c.area, 'controls');
  assert.equal(c.chapterId, 'west');
  assert.equal(c.ledgerEntryId, 'one');
  assert.ok(c.title.length > 0 && c.detail.length > 0);
});

test('the checks count members behind on attendance, per chapter', () => {
  const held = ['2026-09-05', '2026-09-19', '2026-10-03', '2026-10-17'].map((day, i) => session(`s-${i}`, { heldOn: day, closedAt: NOW }));
  const d = auditClub({ checkinSessions: held, attendance: [] });
  const behind = d.members.filter((m) => m.chapterId === 'west' && standingOf(m, d, TODAY)?.lines.some((l) => l.state === 'behind'));
  assert.ok(behind.length > 0, 'nobody came, so someone is behind');
  const c = auditChecks(d, NOW).find((x) => x.key === 'attendance-behind:west')!;
  assert.equal(c.detail, `${behind.length} in West`);
  assert.ok(!keys(d).includes('attendance-behind:north'));
});

// Acting ---------------------------------------------------------------------------------------------

// North: Smokey is President, Jet the VP and Crank the Road Captain. TODAY is 29/10/2026.
function actingClub(positions: Position[], over: Partial<ClubData> = {}): ClubData {
  const base = auditClub();
  return {
    ...base,
    members: [
      ...base.members,
      member('smokey', { chapterId: 'north', roadName: 'Smokey', patchedOn: '2020-01-01' }),
      member('jet', { chapterId: 'north', roadName: 'Jet', patchedOn: '2020-01-01' }),
      member('crank', { chapterId: 'north', roadName: 'Crank', patchedOn: '2020-01-01' }),
      member('spanner', { roadName: 'Spanner', patchedOn: '2020-01-01' }),
    ],
    positions: [...base.positions.filter((p) => p.chapterId !== 'north'), ...positions],
    ...over,
  };
}
const nseat = (id: string, memberId: string, role: Position['role'], over: Partial<Position> = {}): Position => ({
  id, memberId, chapterId: 'north', role, startedOn: '2025-08-16', endedOn: null, ...over,
});
const smokeyPres = nseat('smokey-pres', 'smokey', 'president');
const jetVp = nseat('jet-vp', 'jet', 'vice_president');
const crankRc = nseat('crank-rc', 'crank', 'road_captain');
const crankTre = nseat('crank-tre', 'crank', 'treasurer', { startedOn: '2026-10-01', actingUntil: '2027-02-20', actingWhy: 'No Treasurer since the ACM', appointedBy: 'smokey' });
const agm = (id: string, startsAt: string, over: Partial<Meeting> = {}): Meeting => ({
  id, chapterId: 'north', kind: 'agm', title: 'ACM', startsAt, location: null, agenda: [], minutes: null,
  minutesSharedAt: null, minutesApprovedAt: null, minutesApprovedBy: null, cancelledAt: null, createdBy: 'smokey', ...over,
});
const checkOf = (d: ClubData, key: string) => auditChecks(d, NOW).find((c) => c.key === key);

test('a covered holder still sees issued reports: board membership reads held rows', () => {
  const jetCovers = nseat('jet-covers', 'jet', 'president', { startedOn: '2026-10-20', actingUntil: '2026-11-20', covers: 'smokey-pres', actingWhy: 'Smokey overseas' });
  const d = actingClub([smokeyPres, jetVp, jetCovers]);
  assert.equal(seesReport(who(d, 'smokey'), report({ issuedAt: NOW }), d.positions), true);
});

test('the term-ended check leaves acting rows out, lapsed or not', () => {
  const lapsed = nseat('crank-old', 'crank', 'treasurer', { startedOn: '2026-09-01', actingUntil: '2026-10-20', actingWhy: 'No Treasurer since the ACM' });
  const d = actingClub([smokeyPres, jetVp, crankRc, lapsed]);
  assert.ok(!keys(d).includes('term-ended:crank-old'), 'its until date has passed, but it was never a term');
  assert.ok(keys(d).includes('term-ended:p-auditor'), 'a full term past its end still shows');
});

test('no election scheduled while someone acts in an empty board seat (9.8)', () => {
  const d = actingClub([smokeyPres, jetVp, crankRc, crankTre]);
  const c = checkOf(d, 'acting-no-election:crank-tre')!;
  assert.equal(c.title, 'No election scheduled while Crank acts (9.8)');
  assert.equal(c.area, 'membership');
  assert.equal(c.chapterId, 'north');
  assert.equal(c.detail, 'Crank · Acting Treasurer (North) until 20/02/2027');
  const scheduled = actingClub([smokeyPres, jetVp, crankRc, crankTre], { meetings: [agm('acm', '2027-03-01T08:00:00.000Z')] });
  assert.equal(checkOf(scheduled, 'acting-no-election:crank-tre'), undefined, 'an ACM is saved');
  const cancelled = actingClub([smokeyPres, jetVp, crankRc, crankTre], { meetings: [agm('acm', '2027-03-01T08:00:00.000Z', { cancelledAt: NOW }), agm('gm', '2027-03-01T08:00:00.000Z', { kind: 'general' })] });
  assert.ok(checkOf(cancelled, 'acting-no-election:crank-tre'), 'a cancelled ACM or another meeting doesn’t count');
  const tg = nseat('crank-tg', 'crank', 'tail_gunner', { startedOn: '2026-10-01', actingUntil: '2026-12-20', actingWhy: 'Short of Tail Gunners' });
  assert.equal(checkOf(actingClub([smokeyPres, jetVp, crankRc, tg]), 'acting-no-election:crank-tg'), undefined, 'a non-board role has no election to wait for');
});

test('acting that runs past the chapter’s ACM is flagged (9.8)', () => {
  const d = actingClub([smokeyPres, jetVp, crankRc, crankTre], { meetings: [agm('acm', '2027-02-14T08:00:00.000Z')] });
  assert.equal(checkOf(d, 'acting-past-acm:crank-tre')?.title, 'Crank’s acting runs past North’s ACM on 14/02 (9.8)');
  const onTheDay = actingClub([smokeyPres, jetVp, crankRc, { ...crankTre, actingUntil: '2027-02-14' }], { meetings: [agm('acm', '2027-02-14T08:00:00.000Z')] });
  assert.equal(checkOf(onTheDay, 'acting-past-acm:crank-tre'), undefined, 'up to the ACM is fine');
  const before = actingClub([smokeyPres, jetVp, crankRc, crankTre], { meetings: [agm('old', '2026-08-14T08:00:00.000Z'), agm('acm', '2027-03-01T08:00:00.000Z')] });
  assert.equal(checkOf(before, 'acting-past-acm:crank-tre'), undefined, 'an ACM before the stint began isn’t its ACM');
});

test('a seat covered for more than three months in a row is flagged for review (9.5)', () => {
  const first = nseat('jet-c1', 'jet', 'president', { startedOn: '2026-06-01', actingUntil: '2026-08-31', endedOn: '2026-09-01', endedReason: 'lapsed', covers: 'smokey-pres', actingWhy: 'Smokey overseas' });
  const second = nseat('jet-c2', 'jet', 'president', { startedOn: '2026-09-01', actingUntil: '2026-11-30', covers: 'smokey-pres', actingWhy: 'Still overseas' });
  const d = actingClub([smokeyPres, jetVp, crankRc, first, second]);
  const c = checkOf(d, 'cover-over-3-months:smokey-pres')!;
  assert.equal(c.title, 'Smokey’s seat has been covered for more than three months in a row (9.5 review)');
  assert.equal(c.detail, 'Smokey · President (North) · covered since 01/06/2026');
  assert.equal(checkOf(actingClub([smokeyPres, jetVp, crankRc, second]), 'cover-over-3-months:smokey-pres'), undefined, 'one cover, under three months');
  const gap = { ...second, startedOn: '2026-09-05' };
  assert.equal(checkOf(actingClub([smokeyPres, jetVp, crankRc, first, gap]), 'cover-over-3-months:smokey-pres'), undefined, 'Smokey was back in between');
});

// Membership records › Positions (src/screens/audit.tsx draws these rows).
test('Membership records list the seats in role order, a cover under the seat it covers', () => {
  const jetCovers = nseat('jet-covers', 'jet', 'president', { startedOn: '2026-11-05', actingUntil: '2026-12-13', covers: 'smokey-pres', actingWhy: 'Smokey overseas' });
  const oldTerm = nseat('crank-old-rc', 'crank', 'road_captain', { startedOn: '2024-07-01' });
  const lapsed = nseat('crank-lapsed', 'crank', 'tail_gunner', { startedOn: '2026-09-01', actingUntil: '2026-10-20', actingWhy: 'Short of Tail Gunners' });
  const d = actingClub([crankTre, jetCovers, oldTerm, jetVp, smokeyPres, lapsed]);
  const north = auditSeatRows('north', d, '2026-11-15').filter((r) => d.positions.find((p) => p.id === r.id)?.chapterId === 'north');
  assert.deepEqual(north, [
    { id: 'smokey-pres', title: 'President', line: 'Smokey · since 16/08/2025 · ends 01/08/2028', chip: null },
    // A stint shows who it covers and its until date, its last acting day, never a term end.
    { id: 'jet-covers', title: 'President', line: 'Jet for Smokey · since 05/11/2026 · until 13/12/2026', chip: { label: 'Acting', tone: 'bone' } },
    { id: 'jet-vp', title: 'Vice President', line: 'Jet · since 16/08/2025 · ends 01/08/2028', chip: null },
    { id: 'crank-tre', title: 'Treasurer', line: 'Crank · since 01/10/2026 · until 20/02/2027', chip: { label: 'Acting', tone: 'bone' } },
    { id: 'crank-old-rc', title: 'Road Captain', line: 'Crank · since 01/07/2024 · ends 01/08/2028', chip: null },
  ], 'a lapsed stint isn’t held, so it isn’t listed');
  // A term near or past its end says so.
  const ending = actingClub([nseat('smokey-pres', 'smokey', 'president', { startedOn: '2026-08-01' })]);
  assert.deepEqual(auditSeatRows('north', ending, '2028-07-01').find((r) => r.id === 'smokey-pres')?.chip, { label: 'Ending', tone: 'warn' });
  const past = auditSeatRows('north', ending, '2028-08-02').find((r) => r.id === 'smokey-pres')!;
  assert.equal(past.line, 'Smokey · since 01/08/2026 · ended 01/08/2028');
  assert.deepEqual(past.chip, { label: 'Past term', tone: 'danger' });
});

// The Auditor's screen gives this finding no button (src/screens/actingScreens.test.ts).
test('a VP casting the NEC vote for an empty President seat is flagged (11.2)', () => {
  const ended = { ...smokeyPres, endedOn: '2026-09-01', endedReason: 'stepped_down' as const };
  const d = actingClub([ended, jetVp, crankRc]);
  const c = checkOf(d, 'vp-fallback:north')!;
  assert.equal(c.title, 'Jet casts North’s NEC vote without being formally Acting President (11.2)');
  assert.equal(c.chapterId, 'north');
  assert.deepEqual(vpFallbackFor('north', d), { memberId: 'jet' });
  const jetActing = nseat('jet-acting', 'jet', 'president', { startedOn: '2026-10-01', actingUntil: '2026-12-20', actingWhy: 'No President since the ACM' });
  const formal = actingClub([ended, jetVp, crankRc, jetActing]);
  assert.equal(checkOf(formal, 'vp-fallback:north'), undefined, 'formally Acting President');
  assert.equal(vpFallbackFor('north', formal), null);
  assert.equal(vpFallbackFor('north', actingClub([smokeyPres, jetVp, crankRc])), null, 'a sitting President');
});

test('the 11.2 finding doesn’t fire when the Chair is a President (the demo’s Rusty)', () => {
  const spannerVp: Position = { id: 'spanner-vp', memberId: 'm-spanner', chapterId: 'ch-west', role: 'vice_president', startedOn: '2025-08-16', endedOn: null };
  const demo = { ...DEMO_DATA, positions: [...DEMO_DATA.positions, spannerVp] };
  assert.ok(!auditChecks(demo, NOW).some((c) => c.key.startsWith('vp-fallback:')));
  assert.equal(vpFallbackFor('ch-west', demo), null);
});
