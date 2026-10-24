import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageFees,
  canSeeFees,
  chargeBalance,
  claimProblem,
  continuationFeeProblem,
  decidePaymentProblem,
  dueState,
  feeRateProblem,
  formatCents,
  fyLabel,
  fyOf,
  MONEY_ONLY,
  parseDollars,
  paymentDetailsProblem,
  paymentReference,
  raiseChargeProblem,
  raiseFeesProblem,
  SET_FEES_ONLY,
  paysFees,
  nextReceiptNo,
  receiptNo,
  recordPaymentProblem,
  waiveProblem,
} from './fees';
import { club, member, who } from './stage4.testkit';
import type { Charge, Payment } from './types';

const today = '2026-10-24';

const charge = (over: Partial<Charge> = {}): Charge => ({
  id: 'c1', memberId: 'rider', chapterId: 'west', fy: 2026, kind: 'annual', description: null, amountCents: 25000,
  dueOn: '2026-07-31', createdAt: '2026-07-01T00:00:00.000Z', waivedAt: null, ...over,
});

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'pay1', chargeId: 'c1', amountCents: 10000, paidOn: '2026-07-10', method: 'payid', reference: 'RIDER FEES',
  state: 'confirmed', claimedBy: 'rider', receiptNo: 'W26-0001', decidedAt: '2026-07-11T00:00:00.000Z', ...over,
});

test('financial years run July to June', () => {
  assert.equal(fyOf('2026-07-01'), 2026);
  assert.equal(fyOf('2027-06-30'), 2026);
  assert.equal(fyOf('2026-06-30'), 2025);
  assert.equal(fyLabel(2026), 'FY26–27');
  assert.equal(fyLabel(2099), 'FY99–00');
});

test('money is whole cents, shown in dollars', () => {
  assert.equal(formatCents(25000), '$250.00');
  assert.equal(formatCents(125000), '$1,250.00');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(parseDollars('250'), 25000);
  assert.equal(parseDollars('$12.5'), 1250);
  assert.equal(parseDollars(' 1,250.00 '), 125000);
  assert.equal(parseDollars('12.345'), null);
  assert.equal(parseDollars('abc'), null);
  assert.equal(parseDollars(''), null);
});

test('a charge’s balance counts confirmed payments only', () => {
  const c = charge();
  assert.deepEqual(chargeBalance(c, []), { paidCents: 0, owingCents: 25000, state: 'owing' });
  assert.deepEqual(chargeBalance(c, [payment(), payment({ id: 'p2', state: 'claimed', receiptNo: null }), payment({ id: 'p3', state: 'rejected', receiptNo: null })]),
    { paidCents: 10000, owingCents: 15000, state: 'part' });
  assert.deepEqual(chargeBalance(c, [payment({ amountCents: 25000 })]), { paidCents: 25000, owingCents: 0, state: 'paid' });
  assert.deepEqual(chargeBalance(c, [payment({ chargeId: 'other' })]).owingCents, 25000);
  assert.equal(chargeBalance(charge({ waivedAt: '2026-08-01T00:00:00.000Z' }), []).state, 'waived');
  assert.equal(chargeBalance(charge({ waivedAt: '2026-08-01T00:00:00.000Z' }), []).owingCents, 0);
});

test('when a charge is due', () => {
  const c = charge({ dueOn: '2026-11-10' });
  assert.equal(dueState(c, chargeBalance(c, []), today), 'soon');
  assert.equal(dueState(charge({ dueOn: '2026-12-31' }), chargeBalance(c, []), today), 'later');
  assert.equal(dueState(charge({ dueOn: '2026-10-23' }), chargeBalance(c, []), today), 'overdue');
  assert.equal(dueState(c, chargeBalance(c, [payment({ amountCents: 25000 })]), today), 'settled');
});

test('receipt numbers and payment references', () => {
  assert.equal(receiptNo('west', 2026, 1), 'W26-0001');
  assert.equal(receiptNo('north', 2027, 42), 'N27-0042');
  assert.equal(paymentReference(member('a', { roadName: 'Bam Bam' })), 'BAM BAM FEES');
  assert.equal(paymentReference(member('b', { roadName: null, fullName: 'Tim Marlin Perry' })), 'PERRY FEES');
  assert.equal(paymentReference(member('c', { roadName: 'Extraordinarily Long Name' })), 'EXTRAORDINARILY LO FEES');
});

test('who handles and who sees a chapter’s fees', () => {
  const data = club();
  const p = data.positions;
  assert.equal(canManageFees(who(data, 'tre'), 'west', p), true);
  assert.equal(canManageFees(who(data, 'tre'), 'north', p), false);
  assert.equal(canManageFees(who(data, 'chair'), 'west', p), true);
  assert.equal(canManageFees(who(data, 'auditor'), 'west', p), false);
  assert.equal(canManageFees(who(data, 'sec'), 'west', p), false);
  assert.equal(canSeeFees(who(data, 'sec'), 'west', p), true);
  assert.equal(canSeeFees(who(data, 'auditor'), 'west', p), true);
  assert.equal(canSeeFees(who(data, 'northsec'), 'west', p), false);
  assert.equal(canSeeFees(who(data, 'rider'), 'west', p), false);
});

test('setting fees', () => {
  const data = club();
  const tre = who(data, 'tre');
  assert.equal(feeRateProblem(tre, 'west', 'full', 25000, data), null);
  // The chapter's board sets its fees; the treasurer collects them.
  assert.equal(feeRateProblem(who(data, 'sec'), 'west', 'full', 25000, data), null);
  assert.equal(feeRateProblem(who(data, 'chair'), 'west', 'full', 25000, data), null);
  assert.equal(feeRateProblem(who(data, 'northsec'), 'west', 'full', 25000, data), SET_FEES_ONLY);
  assert.equal(feeRateProblem(who(data, 'auditor'), 'west', 'full', 25000, data), SET_FEES_ONLY);
  assert.equal(feeRateProblem(who(data, 'rider'), 'west', 'full', 25000, data), SET_FEES_ONLY);
  assert.equal(feeRateProblem(null, 'west', 'full', 25000, data), SET_FEES_ONLY);
  assert.equal(continuationFeeProblem(who(data, 'sec'), 'west', 5000, data), null);
  assert.equal(feeRateProblem(tre, 'west', 'legacy', 25000, data), 'That status doesn’t pay fees.');
  assert.equal(feeRateProblem(tre, 'west', 'introduced', 25000, data), 'That status doesn’t pay fees.');
  assert.equal(feeRateProblem(tre, 'west', 'full', 0, data), 'Enter an amount over $0.');
  assert.equal(feeRateProblem(tre, 'west', 'full', 12.5, data), 'Enter an amount over $0.');
  assert.equal(continuationFeeProblem(tre, 'west', 5000, data), null);
  assert.equal(continuationFeeProblem(tre, 'west', -1, data), 'Enter an amount over $0.');
  assert.equal(continuationFeeProblem(who(data, 'rider'), 'west', 5000, data), SET_FEES_ONLY);
  assert.equal(paymentDetailsProblem(tre, 'west', data), null);
  assert.equal(paymentDetailsProblem(who(data, 'northsec'), 'west', data), MONEY_ONLY);
});

test('raising fees and one-off charges', () => {
  const rated = club({ feeRates: [{ chapterId: 'west', fy: 2026, status: 'full', amountCents: 25000, dueOn: '2026-07-31' }] });
  const tre = who(rated, 'tre');
  assert.equal(raiseFeesProblem(tre, 'west', 2026, rated), null);
  assert.equal(raiseFeesProblem(tre, 'west', 2027, rated), 'Set this year’s fees first.');
  assert.equal(raiseFeesProblem(who(rated, 'sec'), 'west', 2026, rated), MONEY_ONLY);
  const rider = who(rated, 'rider');
  assert.equal(raiseChargeProblem(tre, rider, 'Patches', 14750, rated), null);
  assert.equal(raiseChargeProblem(tre, rider, '  ', 14750, rated), 'Add what it’s for.');
  assert.equal(raiseChargeProblem(tre, rider, 'Patches', 0, rated), 'Enter an amount over $0.');
  assert.equal(raiseChargeProblem(tre, who(rated, 'applicant'), 'Patches', 100, rated), 'Approve them first.');
  assert.equal(raiseChargeProblem(who(rated, 'northsec'), rider, 'Patches', 100, rated), MONEY_ONLY);
});

test('waiving a charge', () => {
  const data = club({ charges: [charge()], payments: [] });
  const tre = who(data, 'tre');
  assert.equal(waiveProblem(tre, charge(), data), null);
  assert.equal(waiveProblem(who(data, 'rider'), charge(), data), MONEY_ONLY);
  assert.equal(waiveProblem(tre, charge({ waivedAt: '2026-08-01T00:00:00.000Z' }), data), 'That charge is already waived.');
  const paid = club({ charges: [charge()], payments: [payment({ amountCents: 25000 })] });
  assert.equal(waiveProblem(tre, charge(), paid), 'That charge is already paid.');
});

test('saying you’ve paid', () => {
  const data = club({ charges: [charge()], payments: [payment()] }); // $100 of $250 confirmed
  const rider = who(data, 'rider');
  assert.equal(claimProblem(rider, charge(), 15000, today, 'payid', data, today), null);
  assert.equal(claimProblem(rider, charge(), 15001, today, 'payid', data, today), 'That’s more than you owe.');
  assert.equal(claimProblem(rider, charge(), 0, today, 'payid', data, today), 'Enter an amount over $0.');
  assert.equal(claimProblem(who(data, 'tre'), charge(), 100, today, 'payid', data, today), 'You can only pay your own fees.');
  assert.equal(claimProblem(null, charge(), 100, today, 'payid', data, today), 'You can only pay your own fees.');
  assert.equal(claimProblem(rider, charge({ waivedAt: '2026-08-01T00:00:00.000Z' }), 100, today, 'payid', data, today), 'That charge was waived.');
  const paid = club({ charges: [charge()], payments: [payment({ amountCents: 25000 })] });
  assert.equal(claimProblem(rider, charge(), 100, today, 'payid', paid, today), 'That’s already paid.');
  assert.equal(claimProblem(rider, charge(), 100, '2026-10-25', 'payid', data, today), 'The payment date can’t be in the future.');
  assert.equal(claimProblem(rider, charge(), 100, today, 'card', data, today), 'Card payments aren’t set up yet.');
});

test('recording a payment and deciding a claim', () => {
  const claim = payment({ id: 'claim', amountCents: 15000, state: 'claimed', receiptNo: null, decidedAt: null });
  const data = club({ charges: [charge()], payments: [payment(), claim] });
  const tre = who(data, 'tre');
  assert.equal(recordPaymentProblem(tre, charge(), 15000, today, 'cash', data, today), null);
  assert.equal(recordPaymentProblem(tre, charge(), 15001, today, 'cash', data, today), 'That’s more than they owe.');
  assert.equal(recordPaymentProblem(who(data, 'rider'), charge(), 100, today, 'cash', data, today), MONEY_ONLY);
  assert.equal(recordPaymentProblem(tre, charge(), 100, today, 'card', data, today), 'Card payments aren’t set up yet.');
  assert.equal(decidePaymentProblem(tre, claim, 'confirm', data), null);
  assert.equal(decidePaymentProblem(tre, claim, 'reject', data), null);
  assert.equal(decidePaymentProblem(who(data, 'sec'), claim, 'confirm', data), MONEY_ONLY);
  assert.equal(decidePaymentProblem(tre, payment(), 'confirm', data), 'That payment has already been dealt with.');
  // A direct payment covered the rest after they claimed: confirming the claim now would overpay.
  const covered = club({ charges: [charge()], payments: [payment({ amountCents: 25000 }), claim] });
  assert.equal(decidePaymentProblem(tre, claim, 'confirm', covered), 'That’s more than they owe.');
  assert.equal(decidePaymentProblem(tre, claim, 'reject', covered), null);
});

test('who pays the yearly fee: approved, a paying status, and not on hiatus', () => {
  assert.equal(paysFees(member('a', { status: 'full' })), true);
  assert.equal(paysFees(member('a', { status: 'supporter' })), true);
  assert.equal(paysFees(member('a', { status: 'full', onHiatus: true })), false);
  assert.equal(paysFees(member('a', { status: 'legacy' })), false);
  assert.equal(paysFees(member('a', { status: 'introduced', approval: 'pending' })), false);
});

test('the next receipt follows the highest issued, so a gap never repeats a number', () => {
  assert.equal(nextReceiptNo('west', 2026, []), 'W26-0001');
  assert.equal(nextReceiptNo('west', 2026, ['W26-0001', 'W26-0002']), 'W26-0003');
  assert.equal(nextReceiptNo('west', 2026, ['W26-0002']), 'W26-0003', 'one went missing');
  assert.equal(nextReceiptNo('west', 2026, ['W25-0009', 'N26-0004']), 'W26-0001', 'other years and chapters');
});
