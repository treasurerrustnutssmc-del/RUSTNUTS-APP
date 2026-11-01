import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDRESS, AMOUNT, BAD_EMAIL, CANT_CANCEL, DAILY, EMPTY_CART, FAMILY_ONLY, HAND_OVER_NEEDS_PAID, LEGACY, LONG_PHONE,
  NAMERS_ONLY, NO_ORDER, NOT_ON_SALE, ONLY_BUYER_OR_SHOP, OWN_PAYMENT, PAID_DAY, PATCHED_ONLY, PAY_NEEDS_SENT, PICK_COLOUR,
  PICK_SIZE, PICK_STATE, POSTCODE, QTY, RESEND_HELD_ONLY, RUNS_SHOP_ONLY, TOO_MANY_LINES,
  cancelShopOrderProblem, cartSubtotal, designProblem, handOverShopOrderProblem, mergeLines, nameShopRunnerProblem,
  orderableDesigns, orderTotalCents, payShopOrderProblem, placeShopOrderProblem, resendShopOrderProblem, runsShop,
  saveDeliveryAddressProblem, seesShopOrder, setShopDesignProblem, setShopGarmentProblem, setShopShippingProblem,
  shippingCents, shopLedgerDescription, shopOrderRef, unnameShopRunnerProblem, visibleShopOrders,
  type CartLine, type PlaceOrderInput,
} from './shop';
import { KEEPS_ONLY } from './ledger';
import { club, member } from './stage4.testkit';
import type { ClubData, ShopDesign, ShopGarment, ShopOrder, ShopOrderLine } from './types';

const TODAY = '2026-11-01';
const AT = '2026-10-20T00:00:00.000Z';

const design = (id: string, over: Partial<ShopDesign> = {}): ShopDesign => ({
  id, name: id, eligibility: 'any', blurb: '', sort: 0, onSale: true, updatedBy: null, updatedAt: AT, ...over,
});
const garment = (id: string, designId: string, over: Partial<ShopGarment> = {}): ShopGarment => ({
  id, designId, name: `${id} garment`, priceCents: 4500, sizes: ['S', 'M', 'L'], colours: ['Black'], sort: 0, onSale: true, ...over,
});
const line = (over: Partial<ShopOrderLine> = {}): ShopOrderLine => ({
  id: 'l1', orderId: 'o1', garmentId: 'member-tee', designName: 'Member', garmentName: 'Tee', size: 'M', colour: 'Black', qty: 1,
  unitCents: 4500, ...over,
});
const order = (over: Partial<ShopOrder> = {}): ShopOrder => ({
  id: 'o1', memberId: 'rider', clientRef: 'c-1', buyerName: 'rider Rider', roadName: null, email: 'rider@example.com', phone: null,
  delivery: 'ship', street: '1 Main St', suburb: 'Sunshine', state: 'VIC', postcode: '3020', shippingMethod: 'standard',
  subtotalCents: 4500, shippingCents: 1200, status: 'sent', makeSentAt: AT, makeError: null, paidOn: null, paidCents: null,
  ledgerEntryId: null, handedOverOn: null, cancelledAt: null, cancelledBy: null, orderedAt: AT, lines: [line()], ...over,
});

const data = (over: Partial<ClubData> = {}): ClubData => {
  const base = club();
  return {
    ...base,
    members: [
      ...base.members,
      member('fam', { status: 'family' }),
      member('nomad', { status: 'nomad' }),
      member('pres'),
      member('runner'), // named to run the shop, holds no seat
      member('supp', { status: 'supporter' }),
    ],
    positions: [...base.positions, { id: 'p-pres', memberId: 'pres', chapterId: 'west', role: 'president', startedOn: '2025-01-01', endedOn: null }],
    privates: [{ memberId: 'rider', email: 'rider@example.com', phone: null, licenceClass: null, licenceExpiry: null, firstAidExpiry: null, introducedBy: null, applicationNote: null }],
    shopDesigns: [
      design('member', { eligibility: 'patched' }),
      design('family', { eligibility: 'family' }),
      design('ruok'),
      design('retired', { onSale: false }),
    ],
    shopGarments: [
      garment('member-tee', 'member'),
      garment('member-hoodie', 'member', { priceCents: 7500, colours: ['Black', 'Grey'] }),
      garment('family-tee', 'family'),
      garment('ruok-tee', 'ruok', { sizes: [], colours: [] }),
      garment('old-tee', 'ruok', { onSale: false }),
      garment('retired-cap', 'retired'),
    ],
    shopShipping: [
      { state: 'VIC', method: 'standard', cents: 1200 },
      { state: 'VIC', method: 'express', cents: 1800 },
    ],
    shopRunners: [{ memberId: 'runner', namedBy: 'pres', namedOn: '2026-10-01' }],
    shopOrders: [],
    ...over,
  };
};
const who = (d: ClubData, id: string) => d.members.find((m) => m.id === id) ?? null;

const cart = (over: Partial<CartLine> = {}): CartLine => ({ garmentId: 'member-tee', size: 'M', colour: 'Black', qty: 1, ...over });
const input = (over: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  clientRef: 'c-9', lines: [cart()], email: '', phone: '', delivery: 'collect', street: '', suburb: '', state: '', postcode: '',
  shippingMethod: null, saveAddress: false, ...over,
});

test('who runs the shop: NEC Chair and Secretary, Presidents, Treasurers and named runners, not the Auditor', () => {
  const d = data();
  assert.equal(runsShop(who(d, 'chair'), d), true);
  assert.equal(runsShop(who(d, 'pres'), d), true);
  assert.equal(runsShop(who(d, 'tre'), d), true);
  assert.equal(runsShop(who(d, 'runner'), d), true);
  assert.equal(runsShop(who(d, 'sec'), d), false, 'a chapter secretary does not run the shop');
  assert.equal(runsShop(who(d, 'auditor'), d), false);
  assert.equal(runsShop(who(d, 'rider'), d), false);
  assert.equal(runsShop(null, d), false);
});

test('eligibility per design (ruling 2)', () => {
  const d = data();
  const member = d.shopDesigns![0];
  const family = d.shopDesigns![1];
  const ruok = d.shopDesigns![2];
  const retired = d.shopDesigns![3];
  assert.equal(designProblem(who(d, 'rider'), member, d), null);
  assert.equal(designProblem(who(d, 'nomad'), member, d), null);
  assert.equal(designProblem(who(d, 'fng'), member, d), PATCHED_ONLY);
  assert.equal(designProblem(who(d, 'fam'), family, d), 'Only approved members can do that.', 'the family view has no shop today');
  assert.equal(designProblem(who(d, 'rider'), family, d), null);
  assert.equal(designProblem(who(d, 'fng'), family, d), FAMILY_ONLY);
  assert.equal(designProblem(who(d, 'supp'), family, d), FAMILY_ONLY);
  assert.equal(designProblem(who(d, 'fng'), ruok, d), null);
  assert.equal(designProblem(who(d, 'supp'), ruok, d), null);
  assert.equal(designProblem(who(d, 'legacy'), ruok, d), LEGACY);
  assert.equal(designProblem(who(d, 'rider'), retired, d), NOT_ON_SALE);
  assert.equal(designProblem(who(d, 'applicant'), ruok, d), 'Only approved members can do that.');
  assert.equal(designProblem(null, ruok, d), 'Sign in first.');
  assert.deepEqual(orderableDesigns(who(d, 'fng'), d).map((x) => x.id), ['ruok']);
  assert.deepEqual(orderableDesigns(who(d, 'rider'), d).map((x) => x.id), ['member', 'family', 'ruok']);
  assert.deepEqual(orderableDesigns(who(d, 'legacy'), d), []);
});

test('the cart: lines, quantities, sizes and colours', () => {
  const d = data();
  const me = who(d, 'rider');
  assert.equal(placeShopOrderProblem(me, input(), d, TODAY), null);
  assert.equal(placeShopOrderProblem(me, input({ lines: [] }), d, TODAY), EMPTY_CART);
  const twelve: CartLine[] = [
    ...['S', 'M', 'L'].map((size) => cart({ size })),
    ...['S', 'M', 'L'].flatMap((size) => ['Black', 'Grey'].map((colour) => cart({ garmentId: 'member-hoodie', size, colour }))),
    ...['S', 'M', 'L'].map((size) => cart({ garmentId: 'family-tee', size })),
  ];
  assert.equal(placeShopOrderProblem(me, input({ lines: twelve }), d, TODAY), TOO_MANY_LINES);
  assert.equal(placeShopOrderProblem(me, input({ lines: twelve.slice(0, 10) }), d, TODAY), null);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ qty: 0 })] }), d, TODAY), QTY);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ qty: 11 })] }), d, TODAY), QTY);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ qty: 1.5 })] }), d, TODAY), QTY);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ size: 'XL' })] }), d, TODAY), PICK_SIZE);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ size: null })] }), d, TODAY), PICK_SIZE);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ colour: 'Pink' })] }), d, TODAY), PICK_COLOUR);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ colour: null })] }), d, TODAY), PICK_COLOUR);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ garmentId: 'ruok-tee', size: null, colour: null })] }), d, TODAY), null, 'no size or colour to pick');
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ garmentId: 'ruok-tee', size: 'M', colour: null })] }), d, TODAY), PICK_SIZE, 'a size on a one-size garment');
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ garmentId: 'old-tee' })] }), d, TODAY), NOT_ON_SALE);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ garmentId: 'retired-cap' })] }), d, TODAY), NOT_ON_SALE);
  assert.equal(placeShopOrderProblem(me, input({ lines: [cart({ garmentId: 'nope' })] }), d, TODAY), NOT_ON_SALE);
  assert.equal(placeShopOrderProblem(who(d, 'fng'), input(), d, TODAY), PATCHED_ONLY);
  assert.equal(placeShopOrderProblem(who(d, 'fam'), input({ lines: [cart({ garmentId: 'family-tee' })], email: 'fam@example.com' }), d, TODAY), 'Only approved members can do that.');
  assert.equal(placeShopOrderProblem(who(d, 'nomad'), input({ lines: [cart({ garmentId: 'family-tee' })], email: 'n@example.com' }), d, TODAY), null);
  assert.equal(placeShopOrderProblem(who(d, 'legacy'), input({ lines: [cart({ garmentId: 'ruok-tee', size: null, colour: null })] }), d, TODAY), LEGACY);
  assert.equal(placeShopOrderProblem(who(d, 'applicant'), input(), d, TODAY), 'Only approved members can do that.');
  assert.equal(placeShopOrderProblem(null, input(), d, TODAY), 'Sign in first.');
  // The same garment, size and colour twice merges rather than refusing.
  assert.deepEqual(mergeLines([cart(), cart({ qty: 2 }), cart({ size: 'L' })]), [cart({ qty: 3 }), cart({ size: 'L' })]);
  assert.equal(cartSubtotal([cart({ qty: 2 }), cart({ garmentId: 'member-hoodie', qty: 1 })], d), 2 * 4500 + 7500);
});

test('checkout: email, phone and delivery', () => {
  const d = data();
  const me = who(d, 'rider');
  const ship = { delivery: 'ship' as const, street: '1 Main St', suburb: 'Sunshine', state: 'VIC', postcode: '3020', shippingMethod: 'standard' as const };
  assert.equal(placeShopOrderProblem(me, input(ship), d, TODAY), null);
  assert.equal(placeShopOrderProblem(me, input({ ...ship, street: ' ' }), d, TODAY), ADDRESS);
  assert.equal(placeShopOrderProblem(me, input({ ...ship, suburb: '' }), d, TODAY), ADDRESS);
  assert.equal(placeShopOrderProblem(me, input({ ...ship, street: 'x'.repeat(121) }), d, TODAY), ADDRESS);
  assert.equal(placeShopOrderProblem(me, input({ ...ship, suburb: 'x'.repeat(61) }), d, TODAY), ADDRESS);
  assert.equal(placeShopOrderProblem(me, input({ ...ship, state: 'Victoria' }), d, TODAY), PICK_STATE);
  assert.equal(placeShopOrderProblem(me, input({ ...ship, state: 'vic' }), d, TODAY), null, 'case does not matter');
  assert.equal(placeShopOrderProblem(me, input({ ...ship, postcode: '30' }), d, TODAY), POSTCODE);
  assert.equal(placeShopOrderProblem(me, input({ ...ship, postcode: '3020a' }), d, TODAY), POSTCODE);
  assert.equal(placeShopOrderProblem(me, input({ ...ship, shippingMethod: null }), d, TODAY), 'Pick Standard or Express.');
  assert.equal(placeShopOrderProblem(me, input({ ...ship, shippingMethod: 'express' }), d, TODAY), null);
  assert.equal(placeShopOrderProblem(me, input({ delivery: 'collect' }), d, TODAY), null, 'collect needs no address');
  assert.equal(placeShopOrderProblem(me, input({ delivery: 'pigeon' as never }), d, TODAY), 'Pick ship or collect.');
  assert.equal(placeShopOrderProblem(me, input({ email: 'nope' }), d, TODAY), BAD_EMAIL);
  assert.equal(placeShopOrderProblem(me, input({ email: 'other@example.com' }), d, TODAY), null, 'an email typed for this order');
  assert.equal(placeShopOrderProblem(who(d, 'nomad'), input(), d, TODAY), BAD_EMAIL, 'no saved email and none typed');
  assert.equal(placeShopOrderProblem(who(d, 'nomad'), input({ email: 'nomad@example.com' }), d, TODAY), null);
  assert.equal(placeShopOrderProblem(me, input({ phone: 'x'.repeat(31) }), d, TODAY), LONG_PHONE);
  assert.equal(placeShopOrderProblem(me, input({ phone: '0400 000 000' }), d, TODAY), null);
  // Shipping from the app's table; 0 when the table has no row (the invoice wins).
  assert.equal(shippingCents({ ...ship }, d), 1200);
  assert.equal(shippingCents({ ...ship, shippingMethod: 'express' }, d), 1800);
  assert.equal(shippingCents({ ...ship, state: 'NSW' }, d), 0);
  assert.equal(shippingCents({ ...ship, delivery: 'collect' }, d), 0);
});

test('five orders a day', () => {
  const todays = Array.from({ length: 5 }, (_, i) => order({ id: `t${i}`, clientRef: `t${i}`, orderedAt: `${TODAY}T01:00:00.000Z` }));
  const d = data({ shopOrders: todays });
  assert.equal(placeShopOrderProblem(who(d, 'rider'), input(), d, TODAY), DAILY);
  const four = data({ shopOrders: todays.slice(1) });
  assert.equal(placeShopOrderProblem(who(four, 'rider'), input(), four, TODAY), null);
  const yesterday = data({ shopOrders: todays.map((o) => ({ ...o, orderedAt: '2026-10-31T01:00:00.000Z' })) });
  assert.equal(placeShopOrderProblem(who(yesterday, 'rider'), input(), yesterday, TODAY), null);
  // A repeat of a cart already sent is the same order, never a sixth.
  assert.equal(placeShopOrderProblem(who(d, 'rider'), input({ clientRef: 't0' }), d, TODAY), null);
});

test('who sees an order: the buyer, the shop runners and the books-keepers', () => {
  const d = data({ shopOrders: [order()] });
  const o = d.shopOrders![0];
  for (const id of ['rider', 'chair', 'pres', 'tre', 'runner']) assert.equal(seesShopOrder(who(d, id), o, d), true, id);
  for (const id of ['sec', 'northsec', 'auditor', 'nomad', 'legacy', 'applicant', 'fam']) assert.equal(seesShopOrder(who(d, id), o, d), false, id);
  assert.equal(seesShopOrder(null, o, d), false);
  assert.equal(visibleShopOrders(who(d, 'nomad'), d).length, 0);
  assert.equal(visibleShopOrders(who(d, 'runner'), d).length, 1);
});

test('mark paid: a books-keeper, once sent, not the buyer, a real day and amount', () => {
  const d = data({ shopOrders: [order(), order({ id: 'held', clientRef: 'h', status: 'held', makeSentAt: null }), order({ id: 'mine', clientRef: 'm', memberId: 'chair' })] });
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'o1', TODAY, 5700, d, TODAY), null);
  assert.equal(payShopOrderProblem(who(d, 'tre'), 'o1', TODAY, 5700, d, TODAY), null, 'any treasurer keeps the Club fund');
  assert.equal(payShopOrderProblem(who(d, 'pres'), 'o1', TODAY, 5700, d, TODAY), KEEPS_ONLY);
  assert.equal(payShopOrderProblem(who(d, 'runner'), 'o1', TODAY, 5700, d, TODAY), KEEPS_ONLY);
  assert.equal(payShopOrderProblem(who(d, 'auditor'), 'o1', TODAY, 5700, d, TODAY), NO_ORDER);
  assert.equal(payShopOrderProblem(who(d, 'rider'), 'o1', TODAY, 5700, d, TODAY), KEEPS_ONLY);
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'held', TODAY, 5700, d, TODAY), PAY_NEEDS_SENT);
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'mine', TODAY, 5700, d, TODAY), OWN_PAYMENT);
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'o1', '2026-11-02', 5700, d, TODAY), PAID_DAY);
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'o1', '2026-10-19', 5700, d, TODAY), PAID_DAY, 'before the order');
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'o1', '2026-10-20', 5700, d, TODAY), null, 'the day it was ordered');
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'o1', 'nope', 5700, d, TODAY), PAID_DAY);
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'o1', TODAY, 0, d, TODAY), AMOUNT);
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'o1', TODAY, 1000001, d, TODAY), AMOUNT);
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'o1', TODAY, 12.5, d, TODAY), AMOUNT);
  assert.equal(payShopOrderProblem(who(d, 'chair'), 'nope', TODAY, 5700, d, TODAY), NO_ORDER);
  assert.equal(payShopOrderProblem(null, 'o1', TODAY, 5700, d, TODAY), 'Sign in first.');
  const paid = data({ shopOrders: [order({ status: 'paid' })] });
  assert.equal(payShopOrderProblem(who(paid, 'chair'), 'o1', TODAY, 5700, paid, TODAY), PAY_NEEDS_SENT);
});

test('mark posted or collected: a shop runner, once paid', () => {
  const d = data({ shopOrders: [order({ status: 'paid' }), order({ id: 'sent', clientRef: 's' })] });
  assert.equal(handOverShopOrderProblem(who(d, 'pres'), 'o1', d), null);
  assert.equal(handOverShopOrderProblem(who(d, 'runner'), 'o1', d), null);
  assert.equal(handOverShopOrderProblem(who(d, 'chair'), 'o1', d), null);
  assert.equal(handOverShopOrderProblem(who(d, 'rider'), 'o1', d), RUNS_SHOP_ONLY, 'the buyer sees it but does not run the shop');
  assert.equal(handOverShopOrderProblem(who(d, 'nomad'), 'o1', d), NO_ORDER);
  assert.equal(handOverShopOrderProblem(who(d, 'pres'), 'sent', d), HAND_OVER_NEEDS_PAID);
});

test('cancel: the buyer or a shop runner, before it is paid', () => {
  const d = data({
    shopOrders: [order(), order({ id: 'held', clientRef: 'h', status: 'held', makeSentAt: null }), order({ id: 'paid', clientRef: 'p', status: 'paid' })],
  });
  assert.equal(cancelShopOrderProblem(who(d, 'rider'), 'o1', d), null);
  assert.equal(cancelShopOrderProblem(who(d, 'rider'), 'held', d), null);
  assert.equal(cancelShopOrderProblem(who(d, 'rider'), 'paid', d), CANT_CANCEL);
  assert.equal(cancelShopOrderProblem(who(d, 'pres'), 'o1', d), null);
  assert.equal(cancelShopOrderProblem(who(d, 'runner'), 'paid', d), CANT_CANCEL);
  assert.equal(cancelShopOrderProblem(who(d, 'tre'), 'o1', d), null, 'a treasurer runs the shop too');
  assert.equal(cancelShopOrderProblem(who(d, 'nomad'), 'o1', d), NO_ORDER);
  const keeperOnly = data({ shopOrders: [order()], positions: data().positions.filter((p) => p.id !== 'p-tre') });
  // Lou-style: a books-keeper who holds no shop seat sees it but can't cancel it.
  const nec = { ...keeperOnly, positions: [...keeperOnly.positions, { id: 'p-necsec', memberId: 'northsec', chapterId: null, role: 'nec_secretary' as const, startedOn: '2025-01-01', endedOn: null }] };
  assert.equal(cancelShopOrderProblem(who(nec, 'northsec'), 'o1', nec), null, 'the NEC Secretary runs the shop');
  const cancelled = data({ shopOrders: [order({ status: 'cancelled' })] });
  assert.equal(cancelShopOrderProblem(who(cancelled, 'rider'), 'o1', cancelled), CANT_CANCEL);
  assert.equal(ONLY_BUYER_OR_SHOP.length > 0, true);
});

test('resend to Make: a shop runner, held orders only', () => {
  const d = data({ shopOrders: [order(), order({ id: 'held', clientRef: 'h', status: 'held', makeSentAt: null, makeError: 'HTTP 500' })] });
  assert.equal(resendShopOrderProblem(who(d, 'pres'), 'held', d), null);
  assert.equal(resendShopOrderProblem(who(d, 'runner'), 'held', d), null);
  assert.equal(resendShopOrderProblem(who(d, 'pres'), 'o1', d), RESEND_HELD_ONLY);
  assert.equal(resendShopOrderProblem(who(d, 'rider'), 'held', d), RUNS_SHOP_ONLY);
  assert.equal(resendShopOrderProblem(who(d, 'nomad'), 'held', d), NO_ORDER);
});

test('the catalogue: designs, garments and the shipping table, by the people who run the shop', () => {
  const d = data();
  const des = { id: null, name: 'Supporter', eligibility: 'any' as const, blurb: '', sort: 5, onSale: true };
  assert.equal(setShopDesignProblem(who(d, 'pres'), des, d), null);
  assert.equal(setShopDesignProblem(who(d, 'runner'), des, d), null);
  assert.equal(setShopDesignProblem(who(d, 'chair'), { ...des, id: 'member' }, d), null);
  assert.equal(setShopDesignProblem(who(d, 'rider'), des, d), RUNS_SHOP_ONLY);
  assert.equal(setShopDesignProblem(who(d, 'auditor'), des, d), RUNS_SHOP_ONLY);
  assert.equal(setShopDesignProblem(null, des, d), 'Sign in first.');
  assert.equal(setShopDesignProblem(who(d, 'pres'), { ...des, id: 'nope' }, d), 'No such design.');
  assert.equal(setShopDesignProblem(who(d, 'pres'), { ...des, name: ' ' }, d), 'Name it.');
  assert.equal(setShopDesignProblem(who(d, 'pres'), { ...des, name: 'x'.repeat(61) }, d), 'Keep the name to 60 characters at most.');
  assert.equal(setShopDesignProblem(who(d, 'pres'), { ...des, eligibility: 'vip' as never }, d), 'Pick who the design is for.');
  assert.equal(setShopDesignProblem(who(d, 'pres'), { ...des, blurb: 'x'.repeat(301) }, d), 'Keep the blurb to 300 characters at most.');
  assert.equal(setShopDesignProblem(who(d, 'pres'), { ...des, sort: 1.5 }, d), 'Sort order is a whole number.');

  const gar = { id: null, designId: 'member', name: 'Cap', priceCents: 2500, sizes: [], colours: ['Black'], sort: 0, onSale: true };
  assert.equal(setShopGarmentProblem(who(d, 'pres'), gar, d), null);
  assert.equal(setShopGarmentProblem(who(d, 'rider'), gar, d), RUNS_SHOP_ONLY);
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, designId: 'nope' }, d), 'No such design.');
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, id: 'nope' }, d), 'No such garment.');
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, id: 'member-tee' }, d), null);
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, id: 'family-tee' }, d), 'No such garment.', 'a garment under another design');
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, name: '' }, d), 'Name it.');
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, name: 'x'.repeat(61) }, d), 'Keep the name to 60 characters at most.');
  const price = 'Enter a price from $0.01 to $1,000.';
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, priceCents: 0 }, d), price);
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, priceCents: 100001 }, d), price);
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, priceCents: 12.5 }, d), price);
  const sizes = 'Keep sizes to 10 characters, no repeats, 12 at most.';
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, sizes: ['M', ' M '] }, d), sizes);
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, sizes: ['x'.repeat(11)] }, d), sizes);
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, sizes: Array.from({ length: 13 }, (_, i) => `S${i}`) }, d), sizes);
  const colours = 'Keep colours to 20 characters, no repeats, 12 at most.';
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, colours: ['Black', 'black '] }, d), null, 'case counts as different');
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, colours: ['Black', ' Black'] }, d), colours);
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, colours: ['x'.repeat(21)] }, d), colours);
  assert.equal(setShopGarmentProblem(who(d, 'pres'), { ...gar, colours: [''] }, d), colours);

  assert.equal(setShopShippingProblem(who(d, 'pres'), { state: 'NSW', method: 'standard', cents: 1500 }, d), null);
  assert.equal(setShopShippingProblem(who(d, 'pres'), { state: 'nsw', method: 'standard', cents: 1500 }, d), null);
  assert.equal(setShopShippingProblem(who(d, 'rider'), { state: 'NSW', method: 'standard', cents: 1500 }, d), RUNS_SHOP_ONLY);
  assert.equal(setShopShippingProblem(who(d, 'pres'), { state: 'NZ', method: 'standard', cents: 1500 }, d), PICK_STATE);
  assert.equal(setShopShippingProblem(who(d, 'pres'), { state: 'NSW', method: 'drone' as never, cents: 1500 }, d), 'Pick Standard or Express.');
  const cost = 'Enter a shipping cost from $0 to $1,000.';
  assert.equal(setShopShippingProblem(who(d, 'pres'), { state: 'NSW', method: 'standard', cents: -1 }, d), cost);
  assert.equal(setShopShippingProblem(who(d, 'pres'), { state: 'NSW', method: 'standard', cents: 0 }, d), null);
  assert.equal(setShopShippingProblem(who(d, 'pres'), { state: 'NSW', method: 'standard', cents: 100001 }, d), cost);
});

test('naming shop runners: the office-bearers who run the shop, not a named runner', () => {
  const d = data();
  assert.equal(nameShopRunnerProblem(who(d, 'pres'), 'rider', d), null);
  assert.equal(nameShopRunnerProblem(who(d, 'chair'), 'rider', d), null);
  assert.equal(nameShopRunnerProblem(who(d, 'tre'), 'rider', d), null);
  assert.equal(nameShopRunnerProblem(who(d, 'runner'), 'rider', d), NAMERS_ONLY);
  assert.equal(nameShopRunnerProblem(who(d, 'sec'), 'rider', d), NAMERS_ONLY);
  assert.equal(nameShopRunnerProblem(who(d, 'rider'), 'rider', d), NAMERS_ONLY);
  assert.equal(nameShopRunnerProblem(who(d, 'pres'), 'runner', d), 'Already a shop runner.');
  assert.equal(nameShopRunnerProblem(who(d, 'pres'), 'nope', d), 'No such member.');
  assert.equal(nameShopRunnerProblem(who(d, 'pres'), 'applicant', d), 'No such member.', 'not approved');
  assert.equal(nameShopRunnerProblem(who(d, 'pres'), 'legacy', d), 'No such member.', 'Legacy members have left');
  assert.equal(unnameShopRunnerProblem(who(d, 'pres'), 'runner', d), null);
  assert.equal(unnameShopRunnerProblem(who(d, 'pres'), 'rider', d), 'Not a shop runner.');
  assert.equal(unnameShopRunnerProblem(who(d, 'runner'), 'runner', d), NAMERS_ONLY);
});

test('a saved delivery address: the member’s own, a whole one or none', () => {
  const d = data();
  const addr = { street: '1 Main St', suburb: 'Sunshine', state: 'VIC', postcode: '3020' };
  assert.equal(saveDeliveryAddressProblem(who(d, 'rider'), addr), null);
  assert.equal(saveDeliveryAddressProblem(who(d, 'fam'), addr), 'Only approved members can do that.');
  assert.equal(saveDeliveryAddressProblem(who(d, 'rider'), { street: '', suburb: '', state: '', postcode: '' }), null, 'clearing it');
  assert.equal(saveDeliveryAddressProblem(who(d, 'rider'), { ...addr, suburb: '' }), ADDRESS);
  assert.equal(saveDeliveryAddressProblem(who(d, 'rider'), { ...addr, state: 'Vic.' }), PICK_STATE);
  assert.equal(saveDeliveryAddressProblem(who(d, 'rider'), { ...addr, postcode: '302' }), POSTCODE);
  assert.equal(saveDeliveryAddressProblem(who(d, 'applicant'), addr), 'Only approved members can do that.');
  assert.equal(saveDeliveryAddressProblem(null, addr), 'Sign in first.');
});

test('the ledger line and the order reference', () => {
  const o = order({
    id: '0b6a9f1e-1111-2222-3333-444444444444',
    lines: [line(), line({ id: 'l2', garmentName: 'Hoodie', size: 'L', colour: null, qty: 2, unitCents: 7500 })],
  });
  assert.equal(shopOrderRef(o), '0B6A9F1E');
  assert.equal(shopLedgerDescription(o, 'Dysco'), 'Shop order 0B6A9F1E: Member Hoodie (L) ×2, Member Tee (M, Black) ×1 for Dysco', 'lines in the database’s order');
  assert.equal(orderTotalCents(o), 4500 + 1200);
});
