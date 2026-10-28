import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import { KEEPS_ONLY } from './ledger';
import {
  bankCents, defaultPeriod, deleteMeetingProblem, figuresFor, meetingChecks, meetingFigures, meetingLines, meetingProblem,
  monthRowLabel, MR_FUTURE, MR_LOCKED, MR_NOTES, MR_ONE_YEAR, MR_ORDER, MR_RANGE, preparedBy, presentMeetingProblem,
  readOut, readsEveryFund,
} from './meetingReport';
import type { ClubData, LedgerEntry, MeetingReport } from './types';

let n = 0;
function line(over: Partial<LedgerEntry>): LedgerEntry {
  n += 1;
  return {
    id: `e-${n}`, chapterId: null, code: 'CR-005', description: 'Line', amountCents: 100, receivedOn: null,
    entryOn: '2026-08-10', payeeMemberId: null, payeeName: null, paymentId: null, state: 'paid', recordedBy: 'm-sparks',
    recordedAt: '2026-08-10T01:00:00.000Z', updatedAt: '2026-08-10T01:00:00.000Z', voidReason: null, voidedBy: null, approvals: [],
    ...over,
  };
}

const data: ClubData = {
  ...DEMO_DATA,
  fundOpenings: [
    { chapterId: null, fy: 2025, amountCents: 1 },
    { chapterId: null, fy: 2026, amountCents: 100000 },
    { chapterId: 'ch-west', fy: 2026, amountCents: 20000 },
    { chapterId: 'ch-north', fy: 2026, amountCents: 0 },
  ],
  cashFloats: [{ fy: 2026, amountCents: 40000 }],
  ledger: [
    line({ chapterId: null, code: 'CR-005', amountCents: 77777, entryOn: '2026-06-20' }), // last year
    line({ chapterId: 'ch-west', code: 'CR-001', description: 'Member fees (Bear)', amountCents: 36000, entryOn: '2026-07-20' }),
    line({ chapterId: null, code: 'DB-004', description: 'Transaction fees', amountCents: 40, entryOn: '2026-08-01' }),
    line({ chapterId: 'ch-west', code: 'CR-001', description: 'Member fees (Tigs)', amountCents: 36000, entryOn: '2026-08-10' }),
    line({ chapterId: null, code: 'CR-005', description: 'Merch order', amountCents: 5000, entryOn: '2026-09-05' }),
    line({ chapterId: null, code: 'DB-001', description: 'Accommodation <Princetown>', amountCents: 10000, entryOn: '2026-09-17', updatedAt: '2026-09-18T01:00:00.000Z' }),
    line({ chapterId: 'ch-north', code: 'CR-001', description: 'Member fees (Dysco)', amountCents: 36000, entryOn: '2026-10-04' }),
    line({ chapterId: null, code: 'DB-005', description: 'Dawn Studios', amountCents: 2000, entryOn: '2026-10-21' }),
    line({ chapterId: null, code: 'CR-005', amountCents: 999, entryOn: '2026-10-25' }), // after the period
    line({ chapterId: 'ch-west', code: 'DB-003', amountCents: 1200, entryOn: '2026-09-01', state: 'void' }),
    line({ chapterId: 'ch-west', code: 'DB-001', amountCents: 5000, entryOn: null, state: 'awaiting' }),
  ],
  meetingReports: [],
};
const me = (id: string) => data.members.find((m) => m.id === id)!;
const TODAY = '2026-10-28';

test('the figures for a period: cash position, funds, codes and months', () => {
  const f = meetingFigures('2026-08-01', '2026-10-21', data);
  assert.equal(f.openingCents, 156000);
  assert.equal(f.receiptsCents, 77000);
  assert.equal(f.paymentsCents, 12040);
  assert.equal(f.closingCents, 220960);
  assert.equal(f.floatCents, 40000);
  assert.equal(bankCents(f, 'opening'), 116000);
  assert.equal(bankCents(f, 'closing'), 180960);
  assert.deepEqual(f.funds.club, { openingCents: 100000, receiptsCents: 5000, paymentsCents: 12040, closingCents: 92960 });
  assert.deepEqual(f.funds['ch-west'], { openingCents: 56000, receiptsCents: 36000, paymentsCents: 0, closingCents: 92000 });
  assert.deepEqual(f.funds['ch-north'], { openingCents: 0, receiptsCents: 36000, paymentsCents: 0, closingCents: 36000 });
  assert.deepEqual(f.credits.filter((c) => c.cents > 0), [{ code: 'CR-001', cents: 72000 }, { code: 'CR-005', cents: 5000 }]);
  assert.deepEqual(f.debits.filter((c) => c.cents > 0), [
    { code: 'DB-001', cents: 10000 }, { code: 'DB-004', cents: 40 }, { code: 'DB-005', cents: 2000 },
  ]);
  assert.deepEqual(f.months, [
    { month: '2026-08-01', from: '2026-08-01', to: '2026-08-31', receiptsCents: 36000, paymentsCents: 40 },
    { month: '2026-09-01', from: '2026-09-01', to: '2026-09-30', receiptsCents: 5000, paymentsCents: 10000 },
    { month: '2026-10-01', from: '2026-10-01', to: '2026-10-21', receiptsCents: 36000, paymentsCents: 2000 },
  ]);
  assert.equal(f.lineCount, 6);
  assert.equal(f.lastChangeAt, '2026-09-18T01:00:00.000Z');
});

test('a period starting 1 July opens on the new year’s openings', () => {
  const f = meetingFigures('2026-07-01', '2026-07-31', data);
  assert.equal(f.openingCents, 120000, 'not last year’s running balance');
  assert.equal(f.closingCents, 156000);
  assert.equal(f.months.length, 1);
});

test('the checks all pass on the books, and fail on figures that don’t add up', () => {
  const f = meetingFigures('2026-08-01', '2026-10-21', data);
  assert.ok(meetingChecks(f).every((c) => c.ok));
  assert.equal(meetingChecks(f).length, 3);
  const off = { ...f, funds: { ...f.funds, club: { ...f.funds.club, closingCents: 1 } } };
  assert.ok(meetingChecks(off).some((c) => !c.ok));
});

test('month rows say when they’re cut to the period', () => {
  const f = meetingFigures('2026-08-05', '2026-10-21', data);
  assert.equal(monthRowLabel(f.months[0]), 'August (from 05/08/2026)');
  assert.equal(monthRowLabel(f.months[1]), 'September');
  assert.equal(monthRowLabel(f.months[2]), 'October (to 21/10/2026)');
  assert.equal(monthRowLabel({ month: '2026-08-01', from: '2026-08-05', to: '2026-08-21', receiptsCents: 0, paymentsCents: 0 }),
    'August (05/08/2026 to 21/08/2026)');
});

test('the meeting read-out', () => {
  const f = meetingFigures('2026-08-01', '2026-10-21', data);
  assert.equal(readOut(f),
    'At 21/10/2026, the club had $1,809.60 in the bank and a recorded cash float of $400, giving total recorded cash funds of $2,209.60. '
    + 'Since 01/08/2026, we received $770 and paid $120.40, a net increase of $649.60. '
    + 'In October to 21/10/2026, the club received $360 and paid $20, increasing the bank balance by $340.');
  const sept = meetingFigures('2026-09-01', '2026-09-30', data);
  assert.equal(readOut(sept),
    'At 30/09/2026, the club had $1,469.60 in the bank and a recorded cash float of $400, giving total recorded cash funds of $1,869.60. '
    + 'Since 01/09/2026, we received $50 and paid $100, a net decrease of $50.', 'one month needs no month sentence');
  const noFloat = meetingFigures('2026-08-01', '2026-08-31', { ...data, cashFloats: [] });
  assert.match(readOut(noFloat), /^At 31\/08\/2026, the club had \$1,919\.60 in the bank\. Since/);
  const quiet = meetingFigures('2026-10-22', '2026-10-24', data);
  assert.match(readOut(quiet), /we received \$0 and paid \$0, so the bank balance didn’t change\.$/);
});

test('each line under its code, for whoever reads the lines', () => {
  const lines = meetingLines('2026-08-01', '2026-10-21', data);
  assert.deepEqual(lines['CR-001']?.map((l) => l.description), ['Member fees (Tigs)', 'Member fees (Dysco)']);
  assert.equal(lines['DB-003'], undefined, 'void lines are left out');
  assert.equal(lines['CR-005']?.length, 1);
});

test('the rules for saving a report', () => {
  const ok = { fromOn: '2026-08-01', toOn: '2026-10-21', notes: 'Bear and Tigs paid.' };
  assert.equal(meetingProblem(me('m-sparks'), null, ok, data, TODAY), null, 'any treasurer keeps the Club fund');
  assert.equal(meetingProblem(me('m-rusty'), null, ok, data, TODAY), null);
  assert.equal(meetingProblem(me('m-torque'), null, ok, data, TODAY), KEEPS_ONLY);
  assert.equal(meetingProblem(me('m-sparks'), null, { ...ok, fromOn: '' }, data, TODAY), MR_RANGE);
  assert.equal(meetingProblem(me('m-sparks'), null, { ...ok, fromOn: '2026-10-22' }, data, TODAY), MR_ORDER);
  assert.equal(meetingProblem(me('m-sparks'), null, { ...ok, toOn: '2026-10-29' }, data, TODAY), MR_FUTURE);
  assert.equal(meetingProblem(me('m-sparks'), null, { ...ok, fromOn: '2026-06-30' }, data, TODAY), MR_ONE_YEAR);
  assert.equal(meetingProblem(me('m-sparks'), null, { ...ok, notes: 'x'.repeat(4001) }, data, TODAY), MR_NOTES);
  assert.equal(meetingProblem(me('m-sparks'), null, { ...ok, notes: '🏍'.repeat(4000) }, data, TODAY), null, 'characters, not UTF-16 units');
  assert.equal(meetingProblem(me('m-sparks'), null, { ...ok, fromOn: '2026-10-21' }, data, TODAY), null, 'one day is fine');
});

const draft: MeetingReport = {
  id: 'mr-1', fromOn: '2026-08-01', toOn: '2026-10-21', notes: '', savedBy: 'm-sparks', savedAt: '2026-10-25T01:00:00.000Z',
  presentedBy: null, presentedAt: null,
};
const shown: MeetingReport = { ...draft, id: 'mr-0', fromOn: '2026-07-01', toOn: '2026-07-31', presentedBy: 'm-sparks', presentedAt: '2026-08-05T09:00:00.000Z' };
const withReports = { ...data, meetingReports: [shown, draft] };

test('presenting and deleting: drafts only, by a Club fund book-keeper', () => {
  assert.equal(presentMeetingProblem(me('m-sparks'), 'mr-1', withReports), null);
  assert.equal(presentMeetingProblem(me('m-sparks'), 'mr-0', withReports), 'That report is already presented.');
  assert.equal(presentMeetingProblem(me('m-torque'), 'mr-1', withReports), KEEPS_ONLY);
  assert.equal(presentMeetingProblem(me('m-sparks'), 'mr-9', withReports), 'No such report.');
  assert.equal(deleteMeetingProblem(me('m-sparks'), 'mr-1', withReports), null);
  assert.equal(deleteMeetingProblem(me('m-sparks'), 'mr-0', withReports), MR_LOCKED);
  const edit = { fromOn: '2026-07-01', toOn: '2026-07-31', notes: '' };
  assert.equal(meetingProblem(me('m-sparks'), 'mr-0', edit, withReports, TODAY), MR_LOCKED);
  assert.equal(meetingProblem(me('m-sparks'), 'mr-9', edit, withReports, TODAY), 'No such report.');
});

test('the default period runs on from the last presented report, inside this financial year', () => {
  assert.deepEqual(defaultPeriod(withReports, TODAY), { fromOn: '2026-08-01', toOn: TODAY });
  assert.deepEqual(defaultPeriod(data, TODAY), { fromOn: '2026-07-01', toOn: TODAY });
  const lastYear = { ...data, meetingReports: [{ ...shown, fromOn: '2026-05-01', toOn: '2026-05-31' }] };
  assert.deepEqual(defaultPeriod(lastYear, TODAY), { fromOn: '2026-07-01', toOn: TODAY });
  const upToToday = { ...data, meetingReports: [{ ...shown, toOn: TODAY }] };
  assert.deepEqual(defaultPeriod(upToToday, TODAY), { fromOn: TODAY, toOn: TODAY });
});

test('who builds one on screen, and whose figures they see', () => {
  assert.ok(readsEveryFund(me('m-rusty'), data), 'the National Chairman reads every fund');
  assert.ok(!readsEveryFund(me('m-sparks'), data), 'a West treasurer doesn’t read North’s lines');
  const live = { ...withReports, meetingTotals: [{ id: 'mr-1', ...meetingFigures('2026-08-01', '2026-08-31', data) }] };
  assert.equal(figuresFor(draft, live)?.to, '2026-08-31', 'the database’s figures when there are some');
  assert.equal(figuresFor(draft, withReports)?.to, '2026-10-21', 'else worked out here (the demo)');
  assert.equal(figuresFor(draft, { ...withReports, meetingTotals: [] }), null, 'live with none sent: nothing, not partial figures');
});

test('who prepared it', () => {
  assert.equal(preparedBy('m-sparks', data), 'Lisa Romano, Treasurer, West Chapter');
  assert.equal(preparedBy('m-rusty', data), 'Gary Kowalski, National Chairman');
  const both = { ...data, positions: [...data.positions, { id: 'p-x', memberId: 'm-sparks', chapterId: 'ch-north', role: 'treasurer' as const, startedOn: '2026-01-01', endedOn: null }] };
  assert.equal(preparedBy('m-sparks', both), 'Lisa Romano, Treasurer, West and North Chapters');
  assert.equal(preparedBy(null, data), 'the Treasurer');
});
