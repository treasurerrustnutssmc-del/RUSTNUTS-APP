import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardOf } from './card';
import { club, member } from './stage4.testkit';
import type { Charge, Payment } from './types';

const charge = (over: Partial<Charge> = {}): Charge => ({
  id: 'c1', memberId: 'm', chapterId: 'west', fy: 2026, kind: 'annual', description: null, amountCents: 36000,
  dueOn: '2026-12-31', createdAt: '2026-08-01T00:00:00Z', waivedAt: null, ...over,
});
const paid = (amountCents: number, state: Payment['state'] = 'confirmed'): Payment =>
  ({ id: 'pay', chargeId: 'c1', amountCents, state } as Payment);

test('the card shows the disc only for Full and Nomad members', () => {
  const data = club();
  assert.equal(cardOf(member('m'), data, '2026-10-24').showDisc, true);
  assert.equal(cardOf(member('m', { status: 'nomad' }), data, '2026-10-24').showDisc, true);
  assert.equal(cardOf(member('m', { status: 'fng' }), data, '2026-10-24').showDisc, false);
  assert.equal(cardOf(member('m', { status: 'supporter' }), data, '2026-10-24').showDisc, false);
  assert.equal(cardOf(member('m', { status: 'legacy' }), data, '2026-10-24').showDisc, false);
});

test('the card names the club year and whether this year’s dues are paid', () => {
  const m = member('m');
  assert.equal(cardOf(m, club(), '2026-10-24').clubYear, '2026–27');
  assert.equal(cardOf(m, club(), '2026-07-24').clubYear, '2025–26');
  assert.equal(cardOf(m, club(), '2026-10-24').dues, null);
  assert.deepEqual(cardOf(m, club({ charges: [charge()] }), '2026-10-24').dues, { state: 'due', dueOn: '2026-12-31' });
  assert.deepEqual(cardOf(m, club({ charges: [charge()], payments: [paid(10000)] }), '2026-10-24').dues, { state: 'due', dueOn: '2026-12-31' });
  assert.deepEqual(cardOf(m, club({ charges: [charge()], payments: [paid(36000)] }), '2026-10-24').dues, { state: 'paid' });
  assert.deepEqual(cardOf(m, club({ charges: [charge()], payments: [paid(36000, 'claimed')] }), '2026-10-24').dues, { state: 'due', dueOn: '2026-12-31' });
  assert.deepEqual(cardOf(m, club({ charges: [charge({ waivedAt: '2026-09-01T00:00:00Z' })] }), '2026-10-24').dues, { state: 'paid' });
  // Last year's or someone else's charge isn't this year's dues.
  assert.equal(cardOf(m, club({ charges: [charge({ fy: 2025 }), charge({ memberId: 'x' })] }), '2026-10-24').dues, null);
  assert.equal(cardOf(m, club({ charges: [charge({ kind: 'continuation' })] }), '2026-10-24').dues, null);
});
