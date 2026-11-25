import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoStory.testkit';
import { recordDebit } from '../data/ledgerActions';
import { settleActing } from './acting';
import {
  addFeeProblem, approvalConflict, approveBudgetProblem, approveProblem, approvesFor, APPROVERS_ONLY, bankedLate, BUDGET_VOTE, budgetLines, budgetProblem,
  creditProblem, debitProblem, feesToAdd, fundBalance, keepsBooks, KEEPS_ONLY, monthReport, NEEDS_TWO, PAYEE_CANT_APPROVE, PAYEE_TIED,
  BUDGET_BOARD, BUDGET_STALE_VOTE, PAID_BEFORE_APPROVED, payProblem, presentProblem, reopenBudgetProblem, seesLedger, seesReports, updatedSince, voidProblem, workingDaysBetween,
} from './ledger';
import type { ActingRequest, ClubData, LedgerCode, LedgerEntry, Position, PositionRole, Vote } from './types';

const base: ClubData = {
  ...DEMO_DATA,
  ledger: [],
  fundOpenings: [],
  cashFloats: [],
  budgets: [],
  treasurerReports: [],
  // A National Auditor, who reads every fund and changes nothing.
  positions: [...DEMO_DATA.positions, { id: 'p-aud', memberId: 'm-ace', chapterId: null, role: 'nec_auditor', startedOn: '2025-08-16', endedOn: null }],
};
const me = (id: string) => base.members.find((m) => m.id === id)!;
const P = base.positions;
const TODAY = '2026-10-25';

let n = 0;
function entry(over: Partial<LedgerEntry>): LedgerEntry {
  n += 1;
  return {
    id: `e-${n}`, chapterId: 'ch-west', code: 'CR-001', description: 'Fees', amountCents: 10000, receivedOn: null,
    entryOn: '2026-08-10', payeeMemberId: null, payeeName: null, paymentId: null, state: 'paid', recordedBy: 'm-sparks',
    recordedAt: '2026-08-10T01:00:00.000Z', updatedAt: '2026-08-10T01:00:00.000Z', voidReason: null, voidedBy: null, approvals: [],
    ...over,
  };
}

test('who keeps, approves and reads each fund', () => {
  // m-sparks: West treasurer. m-rusty: West President and National Chairman. m-smokey: North President.
  assert.ok(keepsBooks(me('m-sparks'), 'ch-west', P));
  assert.ok(!keepsBooks(me('m-sparks'), 'ch-north', P), 'not another chapter’s books');
  assert.ok(keepsBooks(me('m-sparks'), null, P), 'any treasurer keeps the Club fund (inferred)');
  assert.ok(keepsBooks(me('m-rusty'), 'ch-north', P), 'the National Chairman keeps every fund');
  assert.ok(!keepsBooks(me('m-torque'), 'ch-west', P), 'a Secretary doesn’t keep books');

  assert.ok(approvesFor(me('m-torque'), 'ch-west', P), 'a board seat approves its chapter’s spending');
  assert.ok(!approvesFor(me('m-torque'), null, P), 'but not the Club fund’s');
  assert.ok(approvesFor(me('m-smokey'), null, P), 'a sitting President approves the Club fund’s');
  assert.ok(!approvesFor(me('m-smokey'), 'ch-west', P));
  assert.ok(!approvesFor(me('m-ace'), 'ch-north', P), 'the Auditor never approves (11.8)');
  assert.ok(!approvesFor(me('m-spanner'), 'ch-west', P), 'a Tail Gunner isn’t on the board');

  assert.ok(seesLedger(me('m-ace'), 'ch-west', P), 'the Auditor reads every fund');
  assert.ok(seesLedger(me('m-torque'), 'ch-west', P));
  assert.ok(!seesLedger(me('m-spanner'), 'ch-west', P), 'members read presented reports, not lines');
  assert.ok(seesReports(me('m-spanner')));
  assert.ok(!seesReports(me('m-rooster')), 'Legacy members have left');
});

test('recording money in and money out', () => {
  const credit = { chapterId: 'ch-west', code: 'CR-002' as const, description: 'Raffle', amountCents: 5000, receivedOn: null, entryOn: '2026-10-20' };
  assert.equal(creditProblem(me('m-sparks'), credit, base, TODAY), null);
  assert.equal(creditProblem(me('m-torque'), credit, base, TODAY), KEEPS_ONLY);
  assert.equal(creditProblem(me('m-sparks'), { ...credit, code: 'DB-001' }, base, TODAY), 'Pick a money-in code.');
  assert.equal(creditProblem(me('m-sparks'), { ...credit, amountCents: 0 }, base, TODAY), 'Enter an amount over $0.');
  assert.equal(creditProblem(me('m-sparks'), { ...credit, entryOn: '2026-10-26' }, base, TODAY), 'That date hasn’t happened yet.');
  assert.equal(creditProblem(me('m-sparks'), { ...credit, receivedOn: '2026-10-21' }, base, TODAY), 'It can’t be banked before it came in.');
  assert.equal(creditProblem(me('m-sparks'), { ...credit, description: ' ' }, base, TODAY), 'Say what it’s for.');

  const debit = { chapterId: 'ch-west', code: 'DB-001' as const, description: 'Patches', amountCents: 30000, payeeMemberId: null, payeeName: 'Embroidery Co', paidOn: null };
  assert.equal(debitProblem(me('m-sparks'), debit, base, TODAY), null);
  assert.equal(debitProblem(me('m-sparks'), { ...debit, payeeName: ' ' }, base, TODAY), 'Say who’s being paid.');
  assert.equal(debitProblem(me('m-sparks'), { ...debit, code: 'CR-001' }, base, TODAY), 'Pick a money-out code.');
  assert.equal(debitProblem(me('m-sparks'), { ...debit, code: 'DB-004', payeeName: null }, base, TODAY), 'Pick the date the bank took it.');
  assert.equal(debitProblem(me('m-sparks'), { ...debit, code: 'DB-004', payeeName: null, paidOn: '2026-10-01' }, base, TODAY), null, 'bank fees need no payee');
});

test('two approvers, neither the payee, before it’s paid (13.3)', () => {
  const awaiting = entry({ code: 'DB-006', state: 'awaiting', entryOn: null, payeeMemberId: 'm-torque', approvals: [{ memberId: 'm-sparks', approvedAt: '2026-10-20T01:00:00.000Z' }] });
  const data = { ...base, ledger: [awaiting] };
  assert.equal(approveProblem(me('m-torque'), awaiting.id, data), PAYEE_CANT_APPROVE);
  assert.equal(approveProblem(me('m-sparks'), awaiting.id, data), 'You’ve already approved this.');
  assert.equal(approveProblem(me('m-spanner'), awaiting.id, data), 'You can’t approve spending from this fund.');
  assert.equal(approveProblem(me('m-ace'), awaiting.id, data), 'You can’t approve spending from this fund.');
  assert.equal(approveProblem(me('m-gravel'), awaiting.id, data), null);
  assert.equal(payProblem(me('m-sparks'), awaiting.id, '2026-10-24', data, TODAY), NEEDS_TWO);

  const ready = { ...awaiting, state: 'approved' as const };
  const data2 = { ...base, ledger: [ready] };
  assert.equal(approveProblem(me('m-gravel'), ready.id, data2), 'That isn’t waiting for approval.');
  assert.equal(payProblem(me('m-sparks'), ready.id, '2026-10-24', data2, TODAY), null);
  assert.equal(payProblem(me('m-sparks'), ready.id, '2026-10-26', data2, TODAY), 'That date hasn’t happened yet.');
  assert.equal(payProblem(me('m-torque'), ready.id, '2026-10-24', data2, TODAY), KEEPS_ONLY);
});

test('voiding keeps the line and needs a reason', () => {
  const e = entry({});
  const data = { ...base, ledger: [e, entry({ state: 'void' })] };
  assert.equal(voidProblem(me('m-sparks'), e.id, ' ', data), 'Say why it’s being voided.');
  assert.equal(voidProblem(me('m-sparks'), e.id, 'Entered twice', data), null);
  assert.equal(voidProblem(me('m-sparks'), data.ledger[1].id, 'again', data), 'That’s already void.');
  assert.equal(voidProblem(me('m-gravel'), e.id, 'x', data), KEEPS_ONLY);
});

test('banked late is more than five working days (13.1)', () => {
  assert.equal(workingDaysBetween('2026-10-23', '2026-10-30'), 5, 'Fri to the next Fri');
  assert.ok(!bankedLate({ code: 'CR-001', receivedOn: '2026-10-23', entryOn: '2026-10-30' }));
  assert.ok(bankedLate({ code: 'CR-001', receivedOn: '2026-10-23', entryOn: '2026-11-02' }));
  assert.ok(!bankedLate({ code: 'CR-001', receivedOn: null, entryOn: '2026-11-02' }));
});

test('fee payments go in once, by whoever keeps that chapter’s books', () => {
  // DEMO pay-1 is a confirmed West payment; pay-4 is only claimed.
  assert.equal(addFeeProblem(me('m-sparks'), 'pay-1', base), null);
  assert.equal(addFeeProblem(me('m-sparks'), 'pay-5', base), KEEPS_ONLY, 'a North payment');
  assert.equal(addFeeProblem(me('m-sparks'), 'pay-4', base), 'Only a confirmed payment goes in the ledger.');
  const data = { ...base, ledger: [entry({ paymentId: 'pay-1' })] };
  assert.equal(addFeeProblem(me('m-sparks'), 'pay-1', data), 'That payment is already in the ledger.');
  assert.deepEqual(feesToAdd(me('m-sparks'), data).map((f) => f.payment.id), ['pay-2', 'pay-3']);
  assert.equal(feesToAdd(me('m-rusty'), data).length, 3, 'the Chairman sees North’s too');
});

test('the monthly report: openings, codes, funds, float and July', () => {
  const data: ClubData = {
    ...base,
    fundOpenings: [
      { chapterId: null, fy: 2026, amountCents: 500000 },
      { chapterId: 'ch-west', fy: 2026, amountCents: 300000 },
      { chapterId: 'ch-north', fy: 2026, amountCents: 100000 },
    ],
    cashFloats: [{ fy: 2025, amountCents: 40000 }],
    ledger: [
      entry({ entryOn: '2026-07-20', amountCents: 25000 }),
      entry({ entryOn: '2026-08-02', amountCents: 130000, updatedAt: '2026-09-03T00:00:00.000Z' }),
      entry({ entryOn: '2026-08-10', chapterId: null, code: 'DB-005', amountCents: 61100 }),
      entry({ entryOn: '2026-08-11', chapterId: null, code: 'DB-004', amountCents: 40 }),
      entry({ entryOn: '2026-08-12', code: 'DB-001', amountCents: 9999, state: 'void' }),
      entry({ entryOn: null, code: 'DB-001', amountCents: 5000, state: 'approved' }),
      entry({ entryOn: '2026-06-30', amountCents: 77700 }), // last year, before the openings
    ],
  };
  const aug = monthReport('2026-08-01', data);
  assert.equal(aug.openingCents, 900000 + 25000);
  assert.equal(aug.credits.find((c) => c.code === 'CR-001')!.cents, 130000);
  assert.equal(aug.credits.length, 7, 'every code shows, even at $0');
  assert.equal(aug.creditTotal, 130000);
  assert.equal(aug.debitTotal, 61140, 'void and unpaid don’t count');
  assert.deepEqual(aug.funds, { club: 500000 - 61140, 'ch-west': 300000 + 25000 + 130000, 'ch-north': 100000 });
  assert.equal(aug.totalCents, 925000 + 130000 - 61140);
  assert.equal(aug.floatCents, 40000, 'last year’s float carries on');
  assert.equal(aug.bankCents, aug.totalCents - 40000);
  assert.equal(aug.lastChangeAt, '2026-09-03T00:00:00.000Z');
  assert.ok(updatedSince(aug, '2026-09-01T00:00:00.000Z'));
  assert.ok(!updatedSince(aug, '2026-09-04T00:00:00.000Z'));

  const july = monthReport('2026-07-01', data);
  assert.equal(july.openingCents, 900000, 'July opens from the new year’s openings, not June’s balance');
  assert.equal(fundBalance('ch-west', '2026-06-30', data), 77700, 'before any opening, it counts from nothing');
});

test('budgets: book-keepers edit, a carried board vote approves, then it’s locked (13.4)', () => {
  assert.equal(budgetProblem(me('m-sparks'), 'ch-west', 2026, { 'DB-001': 50000 }, base), null);
  assert.equal(budgetProblem(me('m-sparks'), 'ch-west', 2026, { 'DB-001': -1 }, base), 'Budget amounts must be $0 or more.');
  assert.equal(budgetProblem(me('m-sparks'), 'ch-west', 2026, { 'XX-1': 1 }, base), 'Pick a payment code.');
  assert.equal(budgetProblem(me('m-gravel'), 'ch-west', 2026, {}, base), KEEPS_ONLY);

  const vote = (over: Partial<Vote>): Vote => ({ ...DEMO_DATA.votes![0], id: 'v-b', chapterId: 'ch-west', electorate: 'chapter_board', result: 'carried', closedAt: '2026-07-08T00:00:00.000Z', ...over });
  const budget = { chapterId: 'ch-west', fy: 2026, lines: { 'DB-001': 50000 }, approvedVoteId: null, approvedAt: null, approvedBy: null, updatedAt: '2026-07-01T00:00:00.000Z' };
  const data = (v: Vote) => ({ ...base, budgets: [budget], votes: [v] });
  assert.equal(approveBudgetProblem(me('m-gravel'), 'ch-west', 2026, 'v-b', data(vote({}))), null, 'any board seat');
  assert.equal(approveBudgetProblem(me('m-gravel'), 'ch-west', 2026, 'v-b', data(vote({ result: 'lost' }))), BUDGET_VOTE);
  assert.equal(approveBudgetProblem(me('m-gravel'), 'ch-west', 2026, 'v-b', data(vote({ electorate: 'chapter_patched' }))), BUDGET_VOTE, 'no member budget vote (13.4)');
  assert.equal(approveBudgetProblem(me('m-gravel'), 'ch-west', 2026, 'v-b', data(vote({ chapterId: 'ch-north' }))), BUDGET_VOTE);
  assert.equal(approveBudgetProblem(me('m-spanner'), 'ch-west', 2026, 'v-b', data(vote({}))), BUDGET_BOARD);
  assert.equal(approveBudgetProblem(me('m-gravel'), 'ch-west', 2027, 'v-b', data(vote({}))), 'Save the budget first.');

  const locked = { ...base, budgets: [{ ...budget, approvedAt: '2026-08-01T00:00:00Z', approvedVoteId: 'v-b', approvedBy: 'm-gravel' }] };
  assert.equal(budgetProblem(me('m-sparks'), 'ch-west', 2026, {}, locked), 'That budget is approved and locked. Reopen it to change it.');
  assert.equal(reopenBudgetProblem(me('m-gravel'), 'ch-west', 2026, locked), null);
  assert.equal(reopenBudgetProblem(me('m-gravel'), 'ch-west', 2026, base), 'That budget isn’t approved.');
});

test('budget against actual', () => {
  const data: ClubData = {
    ...base,
    budgets: [{ chapterId: 'ch-west', fy: 2026, lines: { 'DB-001': 50000, 'CR-001': 500000 }, approvedVoteId: null, approvedAt: null, approvedBy: null }],
    ledger: [
      entry({ code: 'DB-001', amountCents: 12000, entryOn: '2026-09-01' }),
      entry({ code: 'DB-005', amountCents: 3000, entryOn: '2026-09-01' }),
      entry({ code: 'DB-001', amountCents: 999, entryOn: '2027-07-01' }), // next year
    ],
  };
  assert.deepEqual(budgetLines('ch-west', 2026, data), [
    { code: 'CR-001', budgetCents: 500000, actualCents: 0, leftCents: 500000 },
    { code: 'DB-001', budgetCents: 50000, actualCents: 12000, leftCents: 38000 },
    { code: 'DB-005', budgetCents: null, actualCents: 3000, leftCents: null },
  ]);
});

test('presenting a month: the Club fund’s book-keepers, once it’s over', () => {
  assert.equal(presentProblem(me('m-sparks'), '2026-09-01', base, TODAY), null);
  assert.equal(presentProblem(me('m-sparks'), '2026-10-01', base, TODAY), 'Wait until the month is over.');
  assert.equal(presentProblem(me('m-torque'), '2026-09-01', base, TODAY), KEEPS_ONLY);
  const done = { ...base, treasurerReports: [{ month: '2026-09-01', presentedAt: 'x', presentedBy: 'm-sparks' }] };
  assert.equal(presentProblem(me('m-sparks'), '2026-09-01', done, TODAY), 'That month is already presented.');
});

test('review fixes: budget approvers, fresh votes and paying after approval', () => {
  const vote = (over: Partial<Vote>): Vote => ({
    id: 'v-b', chapterId: 'ch-west', meetingId: null, subjectMemberId: null, subjectRole: null, question: 'Budget', details: null,
    electorate: 'chapter_board', threshold: 'majority', secret: false, quorum: 3, openedAt: '2026-07-01T00:00:00.000Z',
    closesAt: '2026-07-08T00:00:00.000Z', closedAt: '2026-07-08T00:00:00.000Z', result: 'carried', castingVote: null,
    tally: null, electorIds: [], votedIds: [], ballots: [], createdBy: null, ...over,
  } as Vote);
  const draft = { chapterId: 'ch-west', fy: 2026, lines: {}, approvedVoteId: null, approvedAt: null, approvedBy: null, updatedAt: '2026-07-01T00:00:00.000Z' };
  const data: ClubData = { ...base, votes: [vote({})], budgets: [draft] };
  assert.equal(approveBudgetProblem(me('m-torque'), 'ch-west', 2026, 'v-b', data), null, 'a board seat approves its budget');
  assert.equal(approveBudgetProblem(me('m-ace'), 'ch-west', 2026, 'v-b', data), BUDGET_BOARD, 'the Auditor changes nothing (11.8)');
  assert.equal(approveBudgetProblem(me('m-smokey'), 'ch-west', 2026, 'v-b', data), BUDGET_BOARD, 'not another chapter’s President');
  const changed = { ...data, budgets: [{ ...draft, updatedAt: '2026-07-09T00:00:00.000Z' }] };
  assert.equal(approveBudgetProblem(me('m-torque'), 'ch-west', 2026, 'v-b', changed), BUDGET_STALE_VOTE, 'a vote from before the last change');
  const approved = { ...data, budgets: [{ ...draft, approvedVoteId: 'v-b', approvedAt: '2026-07-09T00:00:00.000Z', approvedBy: 'm-torque' }] };
  assert.equal(reopenBudgetProblem(me('m-ace'), 'ch-west', 2026, approved), BUDGET_BOARD);
  assert.equal(reopenBudgetProblem(me('m-torque'), 'ch-west', 2026, approved), null);

  const e = entry({ code: 'DB-001', state: 'approved', entryOn: null, payeeName: 'Bunnings',
    approvals: [{ memberId: 'm-torque', approvedAt: '2026-10-10T01:00:00.000Z' }, { memberId: 'm-rusty', approvedAt: '2026-10-12T01:00:00.000Z' }] });
  const paying = { ...base, ledger: [e] };
  assert.equal(payProblem(me('m-sparks'), e.id, '2026-10-11', paying, TODAY), PAID_BEFORE_APPROVED);
  assert.equal(payProblem(me('m-sparks'), e.id, '2026-10-12', paying, TODAY), null);
});

// ---------------------------------------------------------------------------
// Acting roles: the books and two independent approvers (13.3). The people are
// supabase/tests/acting_test.sql's: North has Smokey (President), Jet (VP), Crank (Road Captain),
// Lou (National Secretary), Ned and Gus (no seat); West has Rusty (President), Torque (Secretary),
// Penny (Treasurer), Spanner and Hal (no seat) and Kim (National Auditor).
// ---------------------------------------------------------------------------

const AT = '2026-11-15';
const UNTIL = '2026-12-13';
const AT_TIME = `${AT}T01:00:00.000Z`; // noon in Melbourne
const PEOPLE: [string, string][] = [
  ['smokey', 'north'], ['jet', 'north'], ['crank', 'north'], ['lou', 'north'], ['ned', 'north'], ['gus', 'north'],
  ['rusty', 'west'], ['torque', 'west'], ['penny', 'west'], ['spanner', 'west'], ['hal', 'west'], ['kim', 'west'],
];
const seat = (id: string, memberId: string, chapterId: string | null, role: PositionRole, over: Partial<Position> = {}): Position => ({
  id, memberId, chapterId, role, startedOn: '2026-08-01', endedOn: null, ...over,
});
/** A stint from today to UNTIL: in an empty seat, unless `covers`. */
const stint = (id: string, memberId: string, chapterId: string, role: PositionRole, over: Partial<Position> = {}): Position =>
  seat(id, memberId, chapterId, role, { startedOn: AT, actingUntil: UNTIL, actingWhy: 'No one since the ACM', ...over });
const SEATS: Position[] = [
  seat('smokey-president', 'smokey', 'north', 'president'),
  seat('jet-vp', 'jet', 'north', 'vice_president'),
  seat('crank-rc', 'crank', 'north', 'road_captain'),
  seat('lou-nec-secretary', 'lou', null, 'nec_secretary'),
  seat('rusty-president', 'rusty', 'west', 'president'),
  seat('torque-secretary', 'torque', 'west', 'secretary'),
  seat('penny-treasurer', 'penny', 'west', 'treasurer'),
  seat('kim-auditor', 'kim', null, 'nec_auditor'),
];
const club = (extra: Position[] = [], over: Partial<ClubData> & { without?: string[] } = {}): ClubData => {
  const { without = [], ...rest } = over;
  return {
    ...base,
    chapters: [
      { id: 'north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
      { id: 'west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
    ],
    members: PEOPLE.map(([id, chapterId]) => ({
      ...base.members[0], id, chapterId, fullName: `${id[0].toUpperCase()}${id.slice(1)} Rider`, roadName: null, status: 'full',
      approval: 'approved', onHiatus: false,
    })),
    positions: [...SEATS, ...extra].filter((p) => !without.includes(p.id)),
    votes: [], actingRequests: [], actingChanges: [], ledger: [],
    ...rest,
  };
};
const person = (data: ClubData, id: string) => data.members.find((x) => x.id === id)!;
/** A West payment waiting for approval. */
const spend = (id: string, over: Partial<LedgerEntry> = {}): LedgerEntry =>
  entry({ id, chapterId: 'west', code: 'DB-001', description: 'Fuel for the bus', amountCents: 5000, state: 'awaiting', entryOn: null,
    recordedBy: 'penny', payeeName: 'Servo', recordedAt: AT_TIME, updatedAt: AT_TIME, ...over });
const approval = (memberId: string, approvedAt = AT_TIME) => ({ memberId, approvedAt });
// The independence refusals (Appendix A), word for word.
const seated = (name: string) => `You’re acting because ${name} put you there, so you can’t be the second approver on their entry (13.3).`;
const planted = (name: string) => `${name} is acting because you put them there, so you can’t be the second approver after them (13.3).`;
/** approveProblem and approvalConflict agree, and give `want`. */
function refuses(data: ClubData, memberId: string, entryId: string, want: string | null, why: string) {
  const e = data.ledger!.find((x) => x.id === entryId)!;
  assert.equal(approvalConflict(memberId, e, data), want, `${why} (approvalConflict)`);
  assert.equal(approveProblem(person(data, memberId), entryId, data), want, why);
}

test('the Acting Treasurer keeps only the chapter’s books', () => {
  // North's Treasurer seat is empty: Smokey records Ned as Acting Treasurer.
  const data = club([stint('ned-acting-treasurer', 'ned', 'north', 'treasurer', { appointedBy: 'smokey' })]);
  const ned = person(data, 'ned');
  assert.ok(keepsBooks(ned, 'north', data.positions), 'an Acting Treasurer keeps their chapter’s books');
  assert.ok(!keepsBooks(ned, 'west', data.positions), 'not another chapter’s');
  assert.ok(!keepsBooks(ned, null, data.positions), 'and never the Club fund’s');
  assert.equal(presentProblem(ned, '2026-09-01', data, AT), KEEPS_ONLY, 'so they don’t present the month’s report');
  // Torque covers Penny's Treasurer seat: the stand-in keeps West's books, and Penny pauses them.
  const covered = club([stint('torque-covers-penny', 'torque', 'west', 'treasurer', { covers: 'penny-treasurer', appointedBy: 'rusty' })]);
  assert.ok(keepsBooks(person(covered, 'torque'), 'west', covered.positions), 'the stand-in keeps the chapter’s books');
  assert.ok(!keepsBooks(person(covered, 'torque'), null, covered.positions), 'but not the Club fund’s');
  assert.ok(!keepsBooks(person(covered, 'penny'), 'west', covered.positions), 'the covered Treasurer pauses them');
  assert.ok(!keepsBooks(person(covered, 'penny'), null, covered.positions), 'and the Club fund’s');
  assert.ok(keepsBooks(person(club(), 'penny'), null, club().positions), 'a sitting Treasurer keeps the Club fund’s (inferred)');
  // Once the stint lapses, it keeps nothing.
  const lapsed = settleActing(data, '2026-12-14');
  assert.ok(!keepsBooks(person(lapsed, 'ned'), 'north', lapsed.positions), 'a lapsed stint keeps no books');
});

test('no acting row on the Club fund', () => {
  const spending = entry({ id: 'club-spend', chapterId: null, code: 'DB-002', state: 'awaiting', entryOn: null, recordedBy: 'lou', payeeName: 'Charity' });
  // Jet, North's VP, covers Smokey's President seat.
  const covered = club([stint('jet-covers-smokey', 'jet', 'north', 'president', { covers: 'smokey-president', appointedBy: 'crank' })], { ledger: [spending] });
  const jet = person(covered, 'jet');
  assert.ok(!approvesFor(jet, null, covered.positions), 'an Acting President doesn’t approve Club fund spending');
  assert.ok(!seesLedger(jet, null, covered.positions), 'or read its lines');
  assert.equal(approveProblem(jet, 'club-spend', covered), APPROVERS_ONLY);
  assert.ok(!approvesFor(person(covered, 'smokey'), null, covered.positions), 'the covered President pauses it');
  assert.ok(approvesFor(person(covered, 'smokey'), 'north', covered.positions), 'but still approves North’s spending (13.3)');
  assert.ok(approvesFor(person(covered, 'rusty'), null, covered.positions), 'a sitting President approves it');
  // Hal acts in West's empty President seat.
  const empty = club([stint('hal-acting-president', 'hal', 'west', 'president', { appointedBy: 'torque' })], { without: ['rusty-president'] });
  const hal = person(empty, 'hal');
  assert.ok(approvesFor(hal, 'west', empty.positions), 'acting in an empty board seat approves the chapter’s spending');
  assert.ok(!approvesFor(hal, null, empty.positions), 'but not the Club fund’s');
});

test('Penny’s appointee can’t be the second approver', () => {
  // Penny records Hal as Acting VP in West's empty VP seat.
  const hal = stint('hal-acting-vp', 'hal', 'west', 'vice_president', { appointedBy: 'penny' });
  const data = club([hal], {
    ledger: [
      spend('pennys', { approvals: [approval('penny')] }),
      spend('pennys-unapproved'),
      spend('lous', { recordedBy: 'lou', payeeName: null, payeeMemberId: 'lou', code: 'DB-006', approvals: [approval('penny')] }),
    ],
  });
  refuses(data, 'hal', 'pennys', seated('Penny'), 'Penny recorded it and approved it first');
  refuses(data, 'hal', 'pennys-unapproved', seated('Penny'), 'Penny only recorded it');
  refuses(data, 'hal', 'lous', seated('Penny'), 'Penny approved Lou’s reimbursement first');
  refuses(data, 'torque', 'lous', null, 'Torque can');
  // Rusty's appointee can be the second approver on Penny's entry.
  const rustys = club([{ ...hal, appointedBy: 'rusty' }], { ledger: [spend('pennys', { approvals: [approval('penny')] })] });
  refuses(rustys, 'hal', 'pennys', null, 'Hal, acting because Rusty put him there, can');
});

test('Rusty can’t approve after his own appointee', () => {
  // Rusty records Spanner as Acting VP; Spanner approves Penny's reimbursement first.
  const spanner = stint('spanner-acting-vp', 'spanner', 'west', 'vice_president', { appointedBy: 'rusty' });
  const reimbursement = spend('pennys', { payeeName: null, payeeMemberId: 'penny', approvals: [approval('spanner')] });
  const data = club([spanner], { ledger: [reimbursement] });
  refuses(data, 'rusty', 'pennys', planted('Spanner'), 'Rusty put Spanner there');
  refuses(data, 'torque', 'pennys', null, 'Torque can');
  // Nor once Spanner then stepped down: he stood only through acting the day he approved.
  const steppedDown = { ...data, positions: data.positions.map((p) => (p.id === spanner.id ? { ...p, endedOn: AT, endedReason: 'stepped_down' as const } : p)) };
  refuses(steppedDown, 'rusty', 'pennys', planted('Spanner'), 'after Spanner stepped down');
  // Nor once a stint that ran to yesterday lapsed, for an approval given yesterday.
  const yesterday = club([{ ...spanner, startedOn: '2026-11-05', actingUntil: '2026-11-14' }], {
    ledger: [{ ...reimbursement, approvals: [approval('spanner', '2026-11-14T01:00:00.000Z')] }],
  });
  refuses(settleActing(yesterday, AT), 'rusty', 'pennys', planted('Spanner'), 'after the stint lapsed');
  // A full board seat held all that day makes him independent.
  const captain = seat('spanner-rc', 'spanner', 'west', 'road_captain');
  refuses(club([spanner, captain], { ledger: [reimbursement] }), 'rusty', 'pennys', null, 'Spanner is Road Captain in full too');
  refuses(club([spanner, { ...captain, endedOn: AT, endedReason: 'stepped_down' }], { ledger: [reimbursement] }), 'rusty', 'pennys',
    planted('Spanner'), 'not when that seat ended on the day he approved');
  refuses(club([spanner, { ...captain, startedOn: AT }], { ledger: [reimbursement] }), 'rusty', 'pennys',
    planted('Spanner'), 'nor when it started that day');
});

test('a payee-requested Acting President can’t approve', () => {
  // West's President seat is empty. Penny asked for Hal; the board voted and Torque confirmed it.
  const request: ActingRequest = {
    id: 'ar-hal', chapterId: 'west', role: 'president', memberId: 'hal', covers: null, until: UNTIL, why: 'Rusty stood down',
    requestedBy: 'penny', createdAt: '2026-11-10T01:00:00.000Z', closedAt: AT_TIME, outcome: 'confirmed',
  };
  const hal = stint('hal-acting-president', 'hal', 'west', 'president', { appointedBy: 'torque', actingRequestId: 'ar-hal', actingVote: 'v-hal' });
  const data = club([hal, seat('spanner-rc', 'spanner', 'west', 'road_captain')], {
    without: ['rusty-president'], actingRequests: [request],
    ledger: [
      // Lou recorded it, so only the payee route ties it to Penny.
      spend('pennys', { recordedBy: 'lou', payeeName: null, payeeMemberId: 'penny' }),
      spend('lous', { recordedBy: 'lou', payeeName: null, payeeMemberId: 'lou', code: 'DB-006', approvals: [approval('hal')] }),
    ],
  });
  refuses(data, 'hal', 'pennys', PAYEE_TIED, 'Hal is acting because Penny asked for him, so he can’t approve her reimbursement');
  refuses(data, 'spanner', 'pennys', null, 'Spanner can');
  refuses(data, 'torque', 'pennys', null, 'and Torque');
  // The other order: Hal approved Lou's reimbursement first.
  refuses(data, 'penny', 'lous', planted('Hal'), 'Penny asked for Hal, so she can’t be second after him');
  refuses(data, 'torque', 'lous', planted('Hal'), 'Torque confirmed Hal, so neither can he');
  refuses(data, 'spanner', 'lous', null, 'Spanner can');
});

test('the payee’s stand-in can’t approve the refund', () => {
  // Rusty covers Torque's Secretary seat.
  const data = club([stint('rusty-covers-torque', 'rusty', 'west', 'secretary', { covers: 'torque-secretary', appointedBy: 'penny' })], {
    ledger: [
      spend('torques-refund', { code: 'DB-006', payeeName: null, payeeMemberId: 'torque', approvals: [approval('penny')] }),
      spend('other', { approvals: [approval('penny')] }),
      entry({ id: 'club-refund', chapterId: null, code: 'DB-006', state: 'awaiting', entryOn: null, recordedBy: 'lou', payeeMemberId: 'torque' }),
    ],
  });
  refuses(data, 'rusty', 'torques-refund', PAYEE_TIED, 'Rusty, covering Torque’s Secretary seat, can’t approve it');
  refuses(data, 'rusty', 'other', null, 'but approves other West spending');
  refuses(data, 'rusty', 'club-refund', PAYEE_TIED, 'and the Club fund’s refund to Torque goes to the other approvers too');
  refuses(data, 'smokey', 'club-refund', null, 'Smokey can');
});

test('recordDebit skips self-approval on a conflict', () => {
  // North's Treasurer seat is empty: Smokey records Ned as Acting Treasurer, who keeps North's books.
  const data = club([stint('ned-acting-treasurer', 'ned', 'north', 'treasurer', { appointedBy: 'smokey' })]);
  const ctx = (memberId: string, d: ClubData = data) => ({ data: d, me: person(d, memberId), today: AT, now: AT_TIME });
  const pay = (chapterId: string, payeeMemberId: string, code: LedgerCode = 'DB-001') =>
    ({ chapterId, code, description: 'Fuel for the bus', amountCents: 5000, payeeMemberId, payeeName: null, paidOn: null });
  const approvalsOf = (r: { data: ClubData; id: string }) => r.data.ledger!.find((e) => e.id === r.id)!.approvals.map((a) => a.memberId);
  assert.deepEqual(approvalsOf(recordDebit(ctx('ned'), pay('north', 'smokey'))), [], 'Ned records Smokey’s reimbursement, with no approval of his own and no error');
  assert.deepEqual(approvalsOf(recordDebit(ctx('ned'), pay('north', 'gus'))), ['ned'], 'a payment to Gus counts Ned’s approval as usual');
  // Penny covers Torque's Secretary seat, then records his refund.
  const cover = club([stint('penny-covers-torque', 'penny', 'west', 'secretary', { covers: 'torque-secretary', appointedBy: 'rusty' })]);
  assert.deepEqual(approvalsOf(recordDebit(ctx('penny', cover), pay('west', 'torque', 'DB-006'))), [], 'Penny, Torque’s stand-in, records his refund without approving it');
  assert.deepEqual(approvalsOf(recordDebit(ctx('penny', cover), pay('west', 'rusty'))), ['penny'], 'and approves Rusty’s as usual');
});
