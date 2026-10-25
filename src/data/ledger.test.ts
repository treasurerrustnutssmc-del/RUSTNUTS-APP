import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from './demoData';
import * as act from './ledgerActions';
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
