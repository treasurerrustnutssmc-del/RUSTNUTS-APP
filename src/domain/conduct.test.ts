import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appealBy,
  appealOpen,
  conductFor,
  deleteOn,
  hearingProblem,
  holdProblem,
  isFormal,
  isKept,
  lodgeProblem,
  outcomeLabel,
  outcomeProblem,
  recordConductProblem,
  removeConductProblem,
  visibleConduct,
  withdrawProblem,
  type ConductInput,
} from './conduct';
import { club } from './stage4.testkit';
import type { ClubData, ConductAppeal, ConductRecord } from './types';

const TODAY = '2026-10-28';

const record = (over: Partial<ConductRecord> = {}): ConductRecord => ({
  id: 'c1', memberId: 'rider', chapterId: 'west', kind: 'vest', summary: 'Wore a helmet cover on the Big 4.', rule: '6.1',
  decidedOn: '2026-10-20', noticeOn: '2026-10-21', suspendedUntil: null, recordedBy: 'sec', recordedAt: '2026-10-21T00:00:00.000Z',
  holdUntil: null, holdReason: '', appeal: null, ...over,
});

const appeal = (over: Partial<ConductAppeal> = {}): ConductAppeal => ({
  lodgedOn: '2026-10-25', lodgedBy: 'rider', grounds: 'It was a rain cover.', panelIds: [], hearingOn: null,
  outcome: null, outcomeNote: '', decidedOn: null, decidedBy: null, withdrawnOn: null, ...over,
});

const data = (records: ConductRecord[] = [record()]): ClubData => club({ conduct: records });
const who = (d: ClubData, id: string) => d.members.find((m) => m.id === id) ?? null;

const input = (over: Partial<ConductInput> = {}): ConductInput => ({
  memberId: 'rider', kind: 'vest', summary: 'Wore a helmet cover.', rule: '6.1', decidedOn: '2026-10-20', noticeOn: '2026-10-20',
  suspendedUntil: null, ...over,
});

// ---------------------------------------------------------------------------------------------
// Keeping and deleting (6.9)

test('a record is kept for 12 months from the decision, then it is gone', () => {
  const r = record({ decidedOn: '2025-11-03' });
  assert.equal(deleteOn(r), '2026-11-03');
  assert.equal(isKept(r, '2026-11-02'), true);
  assert.equal(isKept(r, '2026-11-03'), false);
});

test('a suspension is kept for 12 months after it ends', () => {
  const r = record({ kind: 'suspension', decidedOn: '2026-01-10', suspendedUntil: '2026-04-10' });
  assert.equal(deleteOn(r), '2027-04-10');
});

test('a hold keeps it through the hold date, but never shortens the 12 months', () => {
  assert.equal(deleteOn(record({ decidedOn: '2025-11-03', holdUntil: '2027-02-01', holdReason: 'Grievance' })), '2027-02-02');
  assert.equal(deleteOn(record({ decidedOn: '2026-10-20', holdUntil: '2026-12-01', holdReason: 'Grievance' })), '2027-10-20');
});

test('an open review keeps the record past its day; a settled one does not', () => {
  const old = record({ decidedOn: '2025-10-01', appeal: appeal() });
  assert.equal(appealOpen(old), true);
  assert.equal(isKept(old, TODAY), true);
  assert.equal(isKept({ ...old, appeal: appeal({ outcome: 'confirmed', decidedOn: '2025-10-20' }) }, TODAY), false);
  assert.equal(isKept({ ...old, appeal: appeal({ withdrawnOn: '2025-10-20' }) }, TODAY), false);
});

test('reads leave out records past their day', () => {
  const d = data([record({ id: 'old', decidedOn: '2025-10-01' }), record({ id: 'new' })]);
  assert.deepEqual(visibleConduct(who(d, 'sec'), d, TODAY).map((r) => r.id), ['new']);
});

// ---------------------------------------------------------------------------------------------
// Who sees one

test('the member, their board, the NEC and the panel see a record; other members do not', () => {
  const d = data([record({ appeal: appeal({ panelIds: ['northsec', 'tre', 'fng'], hearingOn: '2026-11-01' }) })]);
  for (const id of ['rider', 'sec', 'chair', 'northsec', 'fng']) {
    assert.equal(visibleConduct(who(d, id), d, TODAY).length, 1, id);
  }
  const plain = data();
  assert.equal(visibleConduct(who(plain, 'northsec'), plain, TODAY).length, 0);
  assert.equal(visibleConduct(who(plain, 'fng'), plain, TODAY).length, 0);
  assert.equal(visibleConduct(null, plain, TODAY).length, 0);
});

test('a record follows the member to their new chapter (12.4)', () => {
  const moved = data();
  moved.members = moved.members.map((m) => (m.id === 'rider' ? { ...m, chapterId: 'north' } : m));
  assert.equal(visibleConduct(who(moved, 'northsec'), moved, TODAY).length, 1, 'the new board sees it');
  assert.equal(visibleConduct(who(moved, 'sec'), moved, TODAY).length, 0, 'the old board no longer does');
  assert.equal(holdProblem(who(moved, 'sec'), 'c1', '2027-12-01', 'Grievance', moved, TODAY), 'No such record.');
});

test('conductFor lists a member’s records, newest first', () => {
  const d = data([record({ id: 'a', decidedOn: '2026-09-01' }), record({ id: 'b', decidedOn: '2026-10-01' }), record({ id: 'c', memberId: 'fng' })]);
  assert.deepEqual(conductFor('rider', who(d, 'sec'), d, TODAY).map((r) => r.id), ['b', 'a']);
});

// ---------------------------------------------------------------------------------------------
// Recording

test('the board records a record; the refusals come in order', () => {
  const d = data([]);
  const sec = who(d, 'sec');
  assert.equal(recordConductProblem(sec, input(), d, TODAY), null);
  assert.equal(recordConductProblem(null, input(), d, TODAY), 'Sign in first.');
  assert.equal(recordConductProblem(who(d, 'applicant'), input(), d, TODAY), 'Only approved members can do that.');
  assert.equal(recordConductProblem(sec, input({ memberId: 'applicant' }), d, TODAY), 'Pick an approved member.');
  assert.equal(recordConductProblem(sec, input({ memberId: 'nobody' }), d, TODAY), 'Pick an approved member.');
  assert.equal(recordConductProblem(sec, input({ memberId: 'sec' }), d, TODAY), 'You can’t record one about yourself.');
  assert.equal(recordConductProblem(who(d, 'northsec'), input(), d, TODAY), 'Only that member’s chapter board can do that.');
  assert.equal(recordConductProblem(who(d, 'rider'), input({ memberId: 'fng' }), d, TODAY), 'Only that member’s chapter board can do that.');
  assert.equal(recordConductProblem(who(d, 'chair'), input(), d, TODAY), 'Only that member’s chapter board can do that.', 'no West seat');
  assert.equal(recordConductProblem(sec, input({ kind: null }), d, TODAY), 'Pick what kind of record it is.');
  assert.equal(recordConductProblem(sec, input({ summary: '   ' }), d, TODAY), 'Say what happened.');
  assert.equal(recordConductProblem(sec, input({ summary: 'x'.repeat(1001) }), d, TODAY), 'Keep what happened to 1000 characters at most.');
  assert.equal(recordConductProblem(sec, input({ summary: ` ${'x'.repeat(1000)} ` }), d, TODAY), null);
  assert.equal(recordConductProblem(sec, input({ rule: 'x'.repeat(201) }), d, TODAY), 'Keep the rule to 200 characters at most.');
  assert.equal(recordConductProblem(sec, input({ decidedOn: '' }), d, TODAY), 'Pick the date of the decision.');
  assert.equal(recordConductProblem(sec, input({ decidedOn: '2026-02-30' }), d, TODAY), 'Pick the date of the decision.');
  assert.equal(recordConductProblem(sec, input({ decidedOn: '2026-10-29', noticeOn: '2026-10-29' }), d, TODAY), 'The decision can’t be in the future.');
  assert.equal(
    recordConductProblem(sec, input({ decidedOn: '2025-10-28', noticeOn: '2025-10-28' }), d, TODAY),
    'That decision is more than 12 months old, so it isn’t kept.',
  );
  assert.equal(recordConductProblem(sec, input({ decidedOn: '2025-10-29', noticeOn: '2025-10-29' }), d, TODAY), null);
  assert.equal(recordConductProblem(sec, input({ noticeOn: '2026-10-19' }), d, TODAY), 'Written notice can’t come before the decision.');
  assert.equal(recordConductProblem(sec, input({ noticeOn: '2026-10-29' }), d, TODAY), 'Written notice can’t be in the future.');
  assert.equal(recordConductProblem(sec, input({ noticeOn: '' }), d, TODAY), 'Pick when written notice was given.');
});

test('a formal outcome ignores the notice date; a suspension needs its end', () => {
  const d = data([]);
  const sec = who(d, 'sec');
  assert.equal(recordConductProblem(sec, input({ kind: 'reprimand', noticeOn: '' }), d, TODAY), null);
  assert.equal(recordConductProblem(sec, input({ kind: 'suspension', suspendedUntil: null }), d, TODAY), 'Pick when the suspension ends.');
  assert.equal(recordConductProblem(sec, input({ kind: 'suspension', suspendedUntil: '2026-10-20' }), d, TODAY), 'Pick when the suspension ends.');
  assert.equal(recordConductProblem(sec, input({ kind: 'suspension', suspendedUntil: '2026-12-20' }), d, TODAY), null);
  // An old suspension that only just ended is still kept.
  assert.equal(
    recordConductProblem(sec, input({ kind: 'suspension', decidedOn: '2025-06-01', suspendedUntil: '2026-01-01' }), d, TODAY),
    null,
  );
});

test('formal kinds are the reprimand, suspension and expulsion', () => {
  assert.deepEqual(
    (['vest', 'ride_safety', 'attendance', 'other', 'reprimand', 'suspension', 'expulsion'] as const).filter(isFormal),
    ['reprimand', 'suspension', 'expulsion'],
  );
});

// ---------------------------------------------------------------------------------------------
// Holding and removing

test('the board holds a record for an active matter, up to 7 years', () => {
  const d = data();
  const sec = who(d, 'sec');
  assert.equal(holdProblem(sec, 'c1', '2027-12-01', 'Grievance under 14.9', d, TODAY), null);
  assert.equal(holdProblem(sec, 'nope', '2027-12-01', 'x', d, TODAY), 'No such record.');
  assert.equal(holdProblem(who(d, 'northsec'), 'c1', '2027-12-01', 'x', d, TODAY), 'No such record.');
  assert.equal(holdProblem(who(d, 'rider'), 'c1', '2027-12-01', 'x', d, TODAY), 'Only that member’s chapter board can do that.');
  assert.equal(holdProblem(sec, 'c1', '2027-12-01', '  ', d, TODAY), 'Say which matter needs it kept.');
  assert.equal(holdProblem(sec, 'c1', '2027-12-01', 'x'.repeat(301), d, TODAY), 'Keep the reason to 300 characters at most.');
  assert.equal(holdProblem(sec, 'c1', TODAY, 'x', d, TODAY), 'Pick a date after today.');
  assert.equal(holdProblem(sec, 'c1', '', 'x', d, TODAY), 'Pick a date after today.');
  assert.equal(holdProblem(sec, 'c1', '2033-10-28', 'x', d, TODAY), null);
  assert.equal(holdProblem(sec, 'c1', '2033-10-29', 'x', d, TODAY), 'Hold it at most 7 years.');
  // Letting go of a hold needs no reason or date.
  assert.equal(holdProblem(sec, 'c1', null, '', d, TODAY), null);
});

test('nobody holds or removes a record about themselves', () => {
  const d = data([record({ memberId: 'tre' })]);
  assert.equal(holdProblem(who(d, 'tre'), 'c1', '2027-12-01', 'x', d, TODAY), 'You can’t record one about yourself.');
  assert.equal(removeConductProblem(who(d, 'tre'), 'c1', d, TODAY), 'You can’t record one about yourself.');
  assert.equal(removeConductProblem(who(d, 'sec'), 'c1', d, TODAY), null);
});

test('removing a mistake: the board only', () => {
  const d = data();
  assert.equal(removeConductProblem(who(d, 'sec'), 'c1', d, TODAY), null);
  assert.equal(removeConductProblem(who(d, 'chair'), 'c1', d, TODAY), 'Only that member’s chapter board can do that.');
  assert.equal(removeConductProblem(who(d, 'rider'), 'c1', d, TODAY), 'Only that member’s chapter board can do that.');
  assert.equal(removeConductProblem(who(d, 'sec'), 'gone', d, TODAY), 'No such record.');
});

// ---------------------------------------------------------------------------------------------
// Lodging a review or appeal (14.4B, 14.6A)

test('an internal review is due within 14 days of written notice; a formal appeal 7 days after the vote', () => {
  assert.equal(appealBy(record({ decidedOn: '2026-10-20', noticeOn: '2026-10-21' })), '2026-11-04');
  assert.equal(appealBy(record({ kind: 'expulsion', decidedOn: '2026-10-20', noticeOn: '2026-10-20' })), '2026-10-27');
});

test('the member or their board lodges in time, once', () => {
  const d = data();
  assert.equal(lodgeProblem(who(d, 'rider'), 'c1', 'It was a rain cover.', d, TODAY), null);
  assert.equal(lodgeProblem(who(d, 'sec'), 'c1', 'On their behalf.', d, TODAY), null);
  assert.equal(lodgeProblem(who(d, 'fng'), 'c1', 'x', d, TODAY), 'No such record.');
  const panel = data([record({ appeal: appeal({ panelIds: ['fng', 'northsec', 'tre'], hearingOn: '2026-11-01' }) })]);
  assert.equal(lodgeProblem(who(panel, 'fng'), 'c1', 'x', panel, TODAY), 'Only the member or their board can lodge this.');
  assert.equal(lodgeProblem(who(panel, 'rider'), 'c1', 'x', panel, TODAY), 'A review or appeal has already been lodged.');
  assert.equal(lodgeProblem(who(d, 'rider'), 'c1', ' ', d, TODAY), 'Say why.');
  assert.equal(lodgeProblem(who(d, 'rider'), 'c1', 'x'.repeat(1001), d, TODAY), 'Keep it to 1000 characters at most.');
  assert.equal(lodgeProblem(who(d, 'rider'), 'c1', 'x', d, '2026-11-04'), null);
  assert.equal(lodgeProblem(who(d, 'rider'), 'c1', 'x', d, '2026-11-05'), 'The window closed on 04/11/2026.');
  const formal = data([record({ kind: 'reprimand', noticeOn: '2026-10-20' })]);
  assert.equal(lodgeProblem(who(formal, 'rider'), 'c1', 'x', formal, TODAY), 'The window closed on 27/10/2026.');
});

// ---------------------------------------------------------------------------------------------
// The hearing (14.3, 14.6, 14.6B)

const lodged = (over: Partial<ConductAppeal> = {}) => data([record({ appeal: appeal(over) })]);

test('the board, apart from the recorder, sets up a panel of three', () => {
  const d = lodged();
  const panel = ['northsec', 'chair', 'fng'];
  const boardOnly = 'Only the board, apart from whoever recorded it, can set up the hearing.';
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', panel, '2026-11-05', d, TODAY), null);
  assert.equal(hearingProblem(who(d, 'sec'), 'c1', panel, '2026-11-05', d, TODAY), boardOnly, 'the recorder');
  assert.equal(hearingProblem(who(d, 'rider'), 'c1', panel, '2026-11-05', d, TODAY), boardOnly);
  assert.equal(hearingProblem(who(d, 'chair'), 'c1', panel, '2026-11-05', d, TODAY), boardOnly, 'the NEC holds no West seat');
  const none = data();
  assert.equal(hearingProblem(who(none, 'tre'), 'c1', panel, '2026-11-05', none, TODAY), 'No review or appeal is lodged.');
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', ['northsec', 'chair'], '2026-11-05', d, TODAY), 'Pick three different people.');
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', ['northsec', 'chair', 'chair'], '2026-11-05', d, TODAY), 'Pick three different people.');
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', ['northsec', 'chair', 'applicant'], '2026-11-05', d, TODAY), 'Pick approved members for the panel.');
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', ['northsec', 'chair', 'legacy'], '2026-11-05', d, TODAY), 'Pick approved members for the panel.');
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', ['northsec', 'chair', 'sec'], '2026-11-05', d, TODAY), 'The panel can’t include the member or whoever recorded it.');
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', ['northsec', 'chair', 'rider'], '2026-11-05', d, TODAY), 'The panel can’t include the member or whoever recorded it.');
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', panel, '', d, TODAY), 'Pick the hearing date.');
  assert.equal(hearingProblem(who(d, 'tre'), 'c1', panel, '2026-10-24', d, TODAY), 'Pick the hearing date.');
  const settled = lodged({ outcome: 'confirmed', decidedOn: '2026-10-27', panelIds: panel, hearingOn: '2026-10-26' });
  assert.equal(hearingProblem(who(settled, 'tre'), 'c1', panel, '2026-11-05', settled, TODAY), 'That one is settled.');
});

test('one of the panel records the outcome on or after the hearing', () => {
  const d = lodged({ panelIds: ['northsec', 'tre', 'fng'], hearingOn: '2026-10-27' });
  assert.equal(outcomeProblem(who(d, 'fng'), 'c1', 'confirmed', '', d, TODAY), null);
  assert.equal(outcomeProblem(who(d, 'fng'), 'c1', 'varied', 'A warning instead.', d, TODAY), null);
  assert.equal(outcomeProblem(who(d, 'fng'), 'c1', 'set_aside', '', d, TODAY), null);
  assert.equal(outcomeProblem(who(d, 'chair'), 'c1', 'confirmed', '', d, TODAY), 'Only the hearing panel can record the outcome.');
  assert.equal(outcomeProblem(who(d, 'fng'), 'c1', 'confirmed', '', d, '2026-10-26'), 'Wait until the hearing.');
  assert.equal(outcomeProblem(who(d, 'fng'), 'c1', 'varied', ' ', d, TODAY), 'Say how it was varied.');
  assert.equal(outcomeProblem(who(d, 'fng'), 'c1', 'confirmed', 'x'.repeat(1001), d, TODAY), 'Keep it to 1000 characters at most.');
  const formal = data([record({ kind: 'suspension', suspendedUntil: '2026-12-01', appeal: appeal({ panelIds: ['northsec', 'tre', 'fng'], hearingOn: '2026-10-27' }) })]);
  assert.equal(outcomeProblem(who(formal, 'fng'), 'c1', 'varied', 'x', formal, TODAY), 'A formal appeal is upheld or revoked (14.6).');
  const unset = lodged();
  assert.equal(outcomeProblem(who(unset, 'sec'), 'c1', 'confirmed', '', unset, TODAY), 'Only the hearing panel can record the outcome.');
});

test('the member withdraws while it is open', () => {
  const d = lodged();
  assert.equal(withdrawProblem(who(d, 'rider'), 'c1', d, TODAY), null);
  assert.equal(withdrawProblem(who(d, 'sec'), 'c1', d, TODAY), 'Only the member can withdraw it.');
  const gone = lodged({ withdrawnOn: '2026-10-26' });
  assert.equal(withdrawProblem(who(gone, 'rider'), 'c1', gone, TODAY), 'That one is settled.');
});

test('outcomes read as a review or an appeal', () => {
  assert.equal(outcomeLabel('vest', 'confirmed'), 'Confirmed');
  assert.equal(outcomeLabel('vest', 'set_aside'), 'Set aside');
  assert.equal(outcomeLabel('expulsion', 'confirmed'), 'Upheld');
  assert.equal(outcomeLabel('expulsion', 'set_aside'), 'Revoked');
});
