import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import {
  addFeeProblem, approveBudgetProblem, approveProblem, approvesFor, bankedLate, BUDGET_VOTE, budgetLines, budgetProblem,
  creditProblem, debitProblem, feesToAdd, fundBalance, keepsBooks, KEEPS_ONLY, monthReport, NEEDS_TWO, PAYEE_CANT_APPROVE,
  BUDGET_BOARD, BUDGET_STALE_VOTE, PAID_BEFORE_APPROVED, payProblem, presentProblem, reopenBudgetProblem, seesLedger, seesReports, updatedSince, voidProblem, workingDaysBetween,
} from './ledger';
import type { ClubData, LedgerEntry, Vote } from './types';

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
