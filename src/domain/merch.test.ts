import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelOrderProblem,
  closeMerchProblem,
  decideMerchProblem,
  decideOrderProblem,
  handOverProblem,
  orderProblem,
  orderTotal,
  ordersToAct,
  payOrderProblem,
  proposeMerchProblem,
  visibleItems,
  visibleOrders,
  type MerchInput,
} from './merch';
import { club, member } from './stage4.testkit';
import type { ClubData, MerchItem, MerchOrder } from './types';

const TODAY = '2026-10-28';

const item = (over: Partial<MerchItem> = {}): MerchItem => ({
  id: 'tee', chapterId: 'west', name: 'Rust Till Dust tee', details: 'Black, white print.', sizes: ['S', 'M', 'L', 'XL'],
  priceCents: 3500, patchedOnly: false, status: 'on_sale', proposedBy: 'sec', proposedAt: '2026-10-01T00:00:00.000Z',
  decidedBy: 'tre', decidedAt: '2026-10-02T00:00:00.000Z', declineReason: '', ...over,
});

const order = (over: Partial<MerchOrder> = {}): MerchOrder => ({
  id: 'o1', itemId: 'tee', memberId: 'rider', size: 'L', qty: 2, unitCents: 3500, note: '', status: 'waiting',
  orderedAt: '2026-10-20T00:00:00.000Z', decidedBy: null, decidedAt: null, declineReason: '', paidOn: null, ledgerEntryId: null,
  handedOverOn: null, ...over,
});

const data = (items: MerchItem[] = [item()], orders: MerchOrder[] = []): ClubData => {
  const base = club({ merchItems: items, merchOrders: orders });
  // A West board member who is also a plain orderer, and a supporter.
  return { ...base, members: [...base.members, member('supp', { status: 'supporter' })] };
};
const who = (d: ClubData, id: string) => d.members.find((m) => m.id === id) ?? null;

const input = (over: Partial<MerchInput> = {}): MerchInput => ({
  chapterId: 'west', name: 'Patch hoodie', details: '', sizes: ['M', 'L'], priceCents: 6500, patchedOnly: true, ...over,
});

test('the chapter board puts an item up; the NEC for club-wide ones', () => {
  const d = data();
  assert.equal(proposeMerchProblem(who(d, 'sec'), input(), d), null);
  assert.equal(proposeMerchProblem(who(d, 'chair'), input(), d), null);
  assert.equal(proposeMerchProblem(who(d, 'chair'), input({ chapterId: null }), d), null);
  assert.equal(proposeMerchProblem(null, input(), d), 'Sign in first.');
  assert.equal(proposeMerchProblem(who(d, 'rider'), input(), d), 'Only that chapter’s board can do that.');
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ chapterId: null }), d), 'Only the NEC can do that.');
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ chapterId: 'east' }), d), 'No such chapter.');
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ name: ' ' }), d), 'Name it.');
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ name: 'x'.repeat(81) }), d), 'Keep the name to 80 characters at most.');
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ details: 'x'.repeat(501) }), d), 'Keep the details to 500 characters at most.');
  const sizes = 'Keep sizes to 10 characters, no repeats, 12 at most.';
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ sizes: [] }), d), null);
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ sizes: ['M', ' M '] }), d), sizes);
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ sizes: ['M', ''] }), d), sizes);
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ sizes: ['x'.repeat(11)] }), d), sizes);
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ sizes: Array.from({ length: 13 }, (_, i) => `S${i}`) }), d), sizes);
  const price = 'Enter a price from $0.01 to $1,000.';
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ priceCents: 0 }), d), price);
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ priceCents: 100001 }), d), price);
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ priceCents: 12.5 }), d), price);
  assert.equal(proposeMerchProblem(who(d, 'sec'), input({ priceCents: 100000 }), d), null);
});

test('someone else on the board approves the design (15.1)', () => {
  const d = data([item({ status: 'proposed', decidedBy: null, decidedAt: null })]);
  assert.equal(decideMerchProblem(who(d, 'tre'), 'tee', true, '', d), null);
  assert.equal(decideMerchProblem(who(d, 'sec'), 'tee', true, '', d), 'Someone other than whoever put it up approves it (15.1).');
  assert.equal(decideMerchProblem(who(d, 'sec'), 'tee', false, 'Changed my mind.', d), null);
  assert.equal(decideMerchProblem(who(d, 'rider'), 'tee', true, '', d), 'No such item.');
  assert.equal(decideMerchProblem(who(d, 'northsec'), 'tee', true, '', d), 'No such item.');
  assert.equal(decideMerchProblem(who(d, 'tre'), 'tee', false, 'x'.repeat(301), d), 'Keep the reason to 300 characters at most.');
  const done = data();
  assert.equal(decideMerchProblem(who(done, 'tre'), 'tee', true, '', done), 'That item has already been decided.');
});

test('closing an item on sale', () => {
  const d = data();
  assert.equal(closeMerchProblem(who(d, 'sec'), 'tee', d), null);
  assert.equal(closeMerchProblem(who(d, 'rider'), 'tee', d), 'Only that chapter’s board can do that.');
  const closed = data([item({ status: 'closed' })]);
  assert.equal(closeMerchProblem(who(closed, 'sec'), 'tee', closed), 'Only an item on sale can be closed.');
});

test('members see items on sale or closed; the board sees its proposals too', () => {
  const d = data([item(), item({ id: 'new', status: 'proposed' }), item({ id: 'no', status: 'declined' }), item({ id: 'old', status: 'closed' })]);
  assert.deepEqual(visibleItems(who(d, 'rider'), d).map((i) => i.id).sort(), ['old', 'tee']);
  assert.deepEqual(visibleItems(who(d, 'sec'), d).map((i) => i.id).sort(), ['new', 'no', 'old', 'tee']);
  assert.deepEqual(visibleItems(who(d, 'northsec'), d).map((i) => i.id).sort(), ['old', 'tee']);
  assert.deepEqual(visibleItems(null, d), []);
});

test('ordering: a size, 1 to 10, patched-only items for Full and Nomad members', () => {
  const d = data([item(), item({ id: 'patch', patchedOnly: true }), item({ id: 'cap', sizes: [] }), item({ id: 'new', status: 'proposed' })]);
  const o = (itemId: string, size: string | null, qty = 1, note = '') => ({ itemId, size, qty, note });
  assert.equal(orderProblem(who(d, 'rider'), o('tee', 'L'), d), null);
  assert.equal(orderProblem(who(d, 'northsec'), o('tee', 'L'), d), null);
  assert.equal(orderProblem(who(d, 'supp'), o('tee', 'L'), d), null);
  assert.equal(orderProblem(who(d, 'supp'), o('patch', 'L'), d), 'That item is for Full and Nomad members only.');
  assert.equal(orderProblem(who(d, 'fng'), o('patch', 'L'), d), 'That item is for Full and Nomad members only.');
  assert.equal(orderProblem(who(d, 'legacy'), o('tee', 'L'), d), 'Legacy members can’t order merch.');
  assert.equal(orderProblem(who(d, 'applicant'), o('tee', 'L'), d), 'Only approved members can do that.');
  assert.equal(orderProblem(who(d, 'rider'), o('new', 'L'), d), 'That item isn’t on sale.');
  assert.equal(orderProblem(who(d, 'sec'), o('new', 'L'), d), 'That item isn’t on sale.');
  assert.equal(orderProblem(who(d, 'rider'), o('tee', null), d), 'Pick a size.');
  assert.equal(orderProblem(who(d, 'rider'), o('tee', 'XXL'), d), 'Pick a size.');
  assert.equal(orderProblem(who(d, 'rider'), o('cap', null), d), null);
  assert.equal(orderProblem(who(d, 'rider'), o('cap', 'L'), d), null);
  assert.equal(orderProblem(who(d, 'rider'), o('tee', 'L', 0), d), 'Order 1 to 10.');
  assert.equal(orderProblem(who(d, 'rider'), o('tee', 'L', 11), d), 'Order 1 to 10.');
  assert.equal(orderProblem(who(d, 'rider'), o('tee', 'L', 1.5), d), 'Order 1 to 10.');
  assert.equal(orderProblem(who(d, 'rider'), o('tee', 'L', 1, 'x'.repeat(301)), d), 'Keep the note to 300 characters at most.');
});

test('the board says yes or no to an order, never its own', () => {
  const d = data([item()], [order(), order({ id: 'mine', memberId: 'sec' })]);
  assert.equal(decideOrderProblem(who(d, 'sec'), 'o1', true, '', d), null);
  assert.equal(decideOrderProblem(who(d, 'chair'), 'o1', false, 'Out of L.', d), null);
  assert.equal(decideOrderProblem(who(d, 'rider'), 'o1', true, '', d), 'Only that chapter’s board can do that.');
  assert.equal(decideOrderProblem(who(d, 'northsec'), 'o1', true, '', d), 'No such order.');
  assert.equal(decideOrderProblem(who(d, 'sec'), 'mine', true, '', d), 'Someone else approves your own order.');
  assert.equal(decideOrderProblem(who(d, 'tre'), 'mine', true, '', d), null);
  assert.equal(decideOrderProblem(who(d, 'sec'), 'o1', false, 'x'.repeat(301), d), 'Keep the reason to 300 characters at most.');
  const done = data([item()], [order({ status: 'approved' })]);
  assert.equal(decideOrderProblem(who(done, 'sec'), 'o1', true, '', done), 'That order has already been decided.');
});

test('the fund’s book-keeper records the payment, which goes in the books', () => {
  const d = data([item()], [order({ status: 'approved' }), order({ id: 'w' }), order({ id: 'p', status: 'paid', paidOn: TODAY }), order({ id: 'mine', memberId: 'tre', status: 'approved' })]);
  assert.equal(payOrderProblem(who(d, 'tre'), 'o1', TODAY, d, TODAY), null);
  assert.equal(payOrderProblem(who(d, 'chair'), 'o1', '2026-10-20', d, TODAY), null);
  assert.equal(payOrderProblem(who(d, 'sec'), 'o1', TODAY, d, TODAY), 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.');
  assert.equal(payOrderProblem(who(d, 'tre'), 'w', TODAY, d, TODAY), 'Approve the order first.');
  assert.equal(payOrderProblem(who(d, 'tre'), 'p', TODAY, d, TODAY), 'That order is already paid.');
  assert.equal(payOrderProblem(who(d, 'tre'), 'mine', TODAY, d, TODAY), 'Someone else records your own payment.');
  assert.equal(payOrderProblem(who(d, 'tre'), 'o1', '2026-10-29', d, TODAY), 'Pick the day it was paid.');
  assert.equal(payOrderProblem(who(d, 'tre'), 'o1', '2026-10-19', d, TODAY), 'Pick the day it was paid.');
  assert.equal(payOrderProblem(who(d, 'tre'), 'o1', '', d, TODAY), 'Pick the day it was paid.');
});

test('handing over a paid order, and cancelling before it is paid', () => {
  const d = data([item()], [order({ status: 'paid', paidOn: TODAY }), order({ id: 'a', status: 'approved' }), order({ id: 'w' })]);
  assert.equal(handOverProblem(who(d, 'sec'), 'o1', d), null);
  assert.equal(handOverProblem(who(d, 'sec'), 'a', d), 'Mark it paid first.');
  assert.equal(handOverProblem(who(d, 'rider'), 'o1', d), 'Only that chapter’s board can do that.');
  assert.equal(cancelOrderProblem(who(d, 'rider'), 'w', d), null);
  assert.equal(cancelOrderProblem(who(d, 'rider'), 'a', d), null);
  assert.equal(cancelOrderProblem(who(d, 'sec'), 'a', d), null);
  assert.equal(cancelOrderProblem(who(d, 'rider'), 'o1', d), 'That order can’t be cancelled now.');
  const other = data([item()], [order({ memberId: 'fng' })]);
  assert.equal(cancelOrderProblem(who(other, 'rider'), 'o1', other), 'No such order.');
});

test('who sees orders, and what the board has to act on', () => {
  const d = data([item()], [order(), order({ id: 'a', memberId: 'fng', status: 'approved' }), order({ id: 'p', status: 'paid' })]);
  assert.deepEqual(visibleOrders(who(d, 'rider'), d).map((o) => o.id).sort(), ['o1', 'p']);
  assert.deepEqual(visibleOrders(who(d, 'tre'), d).map((o) => o.id).sort(), ['a', 'o1', 'p']);
  assert.deepEqual(visibleOrders(who(d, 'northsec'), d), []);
  assert.deepEqual(ordersToAct(who(d, 'sec'), d).map((o) => o.id).sort(), ['o1', 'p']);
  assert.deepEqual(ordersToAct(who(d, 'tre'), d).map((o) => o.id).sort(), ['a', 'o1', 'p']);
  assert.equal(orderTotal(order()), 7000);
});
