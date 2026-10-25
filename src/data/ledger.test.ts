import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from './demoData';
import * as act from './ledgerActions';
import { toLedger } from './ledgerLive';
import type { DemoCtx } from './demoActions';
import type { ClubData } from '../domain/types';

const blank: ClubData = { ...DEMO_DATA, ledger: [], fundOpenings: [], cashFloats: [], budgets: [], treasurerReports: [] };
const me = (id: string) => blank.members.find((m) => m.id === id)!;
const NOW = '2026-10-25T01:00:00.000Z';
const ctx = (who: string, data: ClubData = blank): DemoCtx => ({ data, me: me(who), today: '2026-10-25', now: NOW });

test('a debit: the recorder approves first, a second approver makes it payable, then it’s paid', () => {
  const r = act.recordDebit(ctx('m-sparks'), {
    chapterId: 'ch-west', code: 'DB-001', description: ' Patches ', amountCents: 30000, payeeMemberId: null, payeeName: ' Embroidery Co ', paidOn: null,
  });
  const e = () => data.ledger!.find((x) => x.id === r.id)!;
  let data = r.data;
  assert.equal(e().state, 'awaiting');
  assert.equal(e().description, 'Patches');
  assert.equal(e().payeeName, 'Embroidery Co');
  assert.deepEqual(e().approvals.map((a) => a.memberId), ['m-sparks'], 'the treasurer sits on the board, so they count');
  assert.throws(() => act.payDebit(ctx('m-sparks', data), r.id, '2026-10-24'), /two approvals/);
  data = act.approveDebit(ctx('m-gravel', data), r.id);
  assert.equal(e().state, 'approved');
  data = act.payDebit(ctx('m-sparks', data), r.id, '2026-10-24');
  assert.deepEqual([e().state, e().entryOn], ['paid', '2026-10-24']);
});

test('a payee who records their own payment doesn’t count as an approver', () => {
  const r = act.recordDebit(ctx('m-sparks'), {
    chapterId: 'ch-west', code: 'DB-006', description: 'Refund', amountCents: 5000, payeeMemberId: 'm-sparks', payeeName: null, paidOn: null,
  });
  assert.deepEqual(r.data.ledger!.find((x) => x.id === r.id)!.approvals, []);
  assert.throws(() => act.approveDebit(ctx('m-sparks', r.data), r.id), /payee can’t approve/);
});

test('bank fees are paid when recorded; money in is banked when recorded', () => {
  const fees = act.recordDebit(ctx('m-sparks'), {
    chapterId: null, code: 'DB-004', description: 'Account fee', amountCents: 40, payeeMemberId: null, payeeName: null, paidOn: '2026-10-01',
  });
  const f = fees.data.ledger!.find((x) => x.id === fees.id)!;
  assert.deepEqual([f.state, f.entryOn, f.payeeName, f.approvals.length], ['paid', '2026-10-01', 'Bank', 0]);
  const cr = act.recordCredit(ctx('m-sparks'), { chapterId: 'ch-west', code: 'CR-002', description: 'Raffle', amountCents: 5000, receivedOn: null, entryOn: '2026-10-20' });
  const c = cr.data.ledger!.find((x) => x.id === cr.id)!;
  assert.deepEqual([c.state, c.receivedOn], ['paid', '2026-10-20'], 'received defaults to the banked date');
});

test('void keeps the line; a fee payment goes in once', () => {
  const added = act.addFeePayment(ctx('m-sparks'), 'pay-1');
  const e = added.data.ledger!.find((x) => x.id === added.id)!;
  assert.deepEqual([e.code, e.chapterId, e.amountCents, e.entryOn, e.description], ['CR-001', 'ch-west', 25000, DEMO_DATA.payments![0].paidOn, 'Member fees: Rusty']);
  assert.throws(() => act.addFeePayment(ctx('m-sparks', added.data), 'pay-1'), /already in the ledger/);
  const voided = act.voidEntry(ctx('m-sparks', added.data), added.id, ' Wrong year ');
  const v = voided.ledger!.find((x) => x.id === added.id)!;
  assert.deepEqual([v.state, v.voidReason, v.voidedBy, voided.ledger!.length], ['void', 'Wrong year', 'm-sparks', 1]);
});

test('openings and float replace that year’s value; budgets save, approve and reopen; months present', () => {
  let data = act.setOpening(ctx('m-sparks'), 'ch-west', 2026, 300000);
  data = act.setOpening(ctx('m-sparks', data), 'ch-west', 2026, 306000);
  assert.deepEqual(data.fundOpenings, [{ chapterId: 'ch-west', fy: 2026, amountCents: 306000 }]);
  data = act.setCashFloat(ctx('m-sparks', data), 2026, 40000);
  assert.deepEqual(data.cashFloats, [{ fy: 2026, amountCents: 40000 }]);

  data = act.saveBudget(ctx('m-sparks', data), 'ch-west', 2026, { 'DB-001': 50000 });
  const vote = { ...DEMO_DATA.votes![0], id: 'v-b', chapterId: 'ch-west', electorate: 'chapter_board' as const, result: 'carried' as const };
  data = act.approveBudget(ctx('m-gravel', { ...data, votes: [vote] }), 'ch-west', 2026, 'v-b');
  assert.deepEqual([data.budgets![0].approvedVoteId, data.budgets![0].approvedBy], ['v-b', 'm-gravel']);
  assert.throws(() => act.saveBudget(ctx('m-sparks', data), 'ch-west', 2026, {}), /locked/);
  data = act.reopenBudget(ctx('m-gravel', data), 'ch-west', 2026);
  assert.equal(data.budgets![0].approvedAt, null);
  assert.deepEqual(data.budgets![0].lines, { 'DB-001': 50000 }, 'reopening keeps the lines');

  data = act.presentReport(ctx('m-sparks', data), '2026-09-01');
  assert.deepEqual(data.treasurerReports, [{ month: '2026-09-01', presentedAt: NOW, presentedBy: 'm-sparks' }]);
});

test('the live ledger read becomes app records', () => {
  const l = toLedger({
    entries: [{
      id: 'e1', chapter_id: null, code: 'DB-001', description: 'Patches', amount_cents: 30000, received_on: null, entry_on: null,
      payee_member_id: null, payee_name: 'Co', payment_id: null, state: 'awaiting', recorded_by: 'm1',
      recorded_at: '2026-10-24T02:00:00+00:00', updated_at: '2026-10-24T02:00:00+00:00', void_reason: null, voided_by: null,
      approvals: [{ member_id: 'm1', approved_at: '2026-10-24T02:00:00+00:00' }],
    }],
    openings: [{ chapter_id: 'c1', fy: 2026, amount_cents: 100 }],
    floats: [{ fy: 2026, amount_cents: 40000 }],
    budgets: [{ chapter_id: 'c1', fy: 2026, lines: { 'DB-001': 5 }, approved_vote_id: null, approved_at: null, approved_by: null }],
    reports: [{ month: '2026-09-01', presented_at: '2026-10-03T00:00:00+00:00', presented_by: 'm1' }],
    report_totals: [{
      month: '2026-09-01', opening_cents: '800000' as unknown as number, credits: [{ code: 'CR-001', cents: 5 }], credit_total: 5,
      debits: [], debit_total: 0, funds: { club: '5' as unknown as number }, total_cents: 5, float_cents: 0, bank_cents: 5, last_change_at: null,
    }],
  });
  assert.equal(l.ledger[0].recordedAt, '2026-10-24T02:00:00.000Z');
  assert.deepEqual(l.ledger[0].approvals, [{ memberId: 'm1', approvedAt: '2026-10-24T02:00:00.000Z' }]);
  assert.deepEqual(l.fundOpenings, [{ chapterId: 'c1', fy: 2026, amountCents: 100 }]);
  assert.equal(l.treasurerReports[0].presentedAt, '2026-10-03T00:00:00.000Z');
  assert.equal(l.reportTotals[0].openingCents, 800000, 'big sums come back as numbers');
  assert.deepEqual(l.reportTotals[0].funds, { club: 5 });
  assert.deepEqual(toLedger(null).ledger, [], 'nothing back is nothing to show');
});
