import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELIGIBILITY_LABEL, listFromText, shopQueues, seesShopAdmin } from './shopAdmin';
import type { ClubData, Member, Position, ShopOrder, ShopOrderStatus } from './types';

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'c1', fullName: `Name ${id}`, roadName: id, status: 'full', approval: 'approved', joinedOn: '2020-01-01', patchedOn: null,
  fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null, onHiatus: false, ...over,
} as Member);
const seat = (memberId: string, role: Position['role'], chapterId: string | null = 'c1'): Position =>
  ({ id: `${memberId}-${role}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null });
const order = (id: string, status: ShopOrderStatus, orderedAt: string, memberId = 'buyer'): ShopOrder => ({
  id, memberId, clientRef: id, buyerName: 'B', roadName: null, email: 'b@x.au', phone: null, delivery: 'collect', street: null, suburb: null,
  state: null, postcode: null, shippingMethod: null, subtotalCents: 1000, shippingCents: 0, status, makeSentAt: null, makeError: null,
  paidOn: null, paidCents: null, ledgerEntryId: null, handedOverOn: null, cancelledAt: null, cancelledBy: null, orderedAt, lines: [],
});

const data = (positions: Position[], runners: string[] = [], orders: ShopOrder[] = []): ClubData => ({
  members: [member('pres'), member('treas'), member('chris'), member('plain'), member('buyer')],
  positions, shopRunners: runners.map((r) => ({ memberId: r, namedBy: null, namedOn: '2026-11-01' })), shopOrders: orders,
} as unknown as ClubData);

test('the shop’s admin screen is for the people who run the shop and the books-keepers', () => {
  const d = data([seat('pres', 'president'), seat('treas', 'treasurer')], ['chris']);
  const m = (id: string) => d.members.find((x) => x.id === id)!;
  assert.equal(seesShopAdmin(m('pres'), d), true);
  assert.equal(seesShopAdmin(m('treas'), d), true);
  assert.equal(seesShopAdmin(m('chris'), d), true);
  assert.equal(seesShopAdmin(m('plain'), d), false);
  assert.equal(seesShopAdmin(null, d), false);
});

test('orders sort into held, waiting for payment, to hand over and done, oldest first while open', () => {
  const orders = [
    order('a', 'sent', '2026-10-03T00:00:00Z'), order('b', 'held', '2026-10-02T00:00:00Z'), order('c', 'paid', '2026-10-01T00:00:00Z'),
    order('d', 'sent', '2026-10-01T00:00:00Z'), order('e', 'posted', '2026-09-01T00:00:00Z'), order('f', 'cancelled', '2026-10-05T00:00:00Z'),
    order('g', 'collected', '2026-10-04T00:00:00Z'),
  ];
  const q = shopQueues(orders);
  assert.deepEqual(q.held.map((o) => o.id), ['b']);
  assert.deepEqual(q.awaitingPayment.map((o) => o.id), ['d', 'a']);
  assert.deepEqual(q.toHandOver.map((o) => o.id), ['c']);
  assert.deepEqual(q.done.map((o) => o.id), ['f', 'g', 'e']);
});

test('sizes and colours typed with commas, trimmed, blanks dropped', () => {
  assert.deepEqual(listFromText(' S, M ,, L ,'), ['S', 'M', 'L']);
  assert.deepEqual(listFromText('   '), []);
});

test('who each eligibility is for, in words', () => {
  assert.deepEqual(Object.keys(ELIGIBILITY_LABEL).sort(), ['any', 'family', 'patched']);
});
