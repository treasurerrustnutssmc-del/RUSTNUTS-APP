import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_LABEL, HELD_MESSAGE, NOT_SWITCHED_ON, SENT_MESSAGE, SHIPPING_LABEL, START_AGAIN, handleShopOrder, makeOrder, makePayload,
  splitName, type OrderRow, type PlaceBody, type ShopOrderDeps,
} from '../../supabase/functions/_shared/shopOrder';

const ORDER: OrderRow = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001', member_id: 'm1', client_ref: '11111111-1111-4111-8111-111111111111',
  buyer_name: 'Chris Dyson', road_name: 'Dysco', email: 'chris@example.com', phone: '0400 000 000', delivery: 'ship',
  street: '1 Main St', suburb: 'Sunshine', state: 'VIC', postcode: '3020', shipping_method: 'standard', subtotal_cents: 16500,
  shipping_cents: 1200, status: 'held', make_sent_at: null, make_error: null,
  lines: [
    { id: 'l1', order_id: 'o', garment_id: 'g1', design_name: 'Member', garment_name: 'Hoodie', size: 'L', colour: 'Grey', qty: 1, unit_cents: 7500 },
    { id: 'l2', order_id: 'o', garment_id: 'g2', design_name: 'Member', garment_name: 'Tee', size: 'M', colour: 'Black', qty: 2, unit_cents: 4500 },
  ],
};
const CART: PlaceBody = {
  clientRef: ORDER.client_ref, lines: [{ garmentId: 'g1', size: 'L', colour: 'Grey', qty: 1 }], delivery: 'collect',
};
const ENV = { MAKE_WEBHOOK_MEMBER_URL: 'https://hook.example.com/abc' };

function deps(over: Partial<ShopOrderDeps> = {}) {
  const calls = { place: [] as PlaceBody[], resend: [] as string[], post: [] as { url: string; payload: { rawRequest: string } }[], sent: [] as unknown[] };
  const d: ShopOrderDeps = {
    placeOrder: async (b) => { calls.place.push(b); return ORDER; },
    resend: async (id) => { calls.resend.push(id); return ORDER; },
    post: async (url, payload) => { calls.post.push({ url, payload }); return { ok: true, status: 200, text: 'Accepted' }; },
    sent: async (id, ok, error) => { calls.sent.push([id, ok, error]); },
    ...over,
  };
  return { d, calls };
}

test('the payload is the bot’s Jotform shape, wrapped as rawRequest', () => {
  const o = makeOrder(ORDER);
  assert.deepEqual(o.q3_name, { first: 'Chris', last: 'Dyson' });
  assert.equal(o.q4_email, 'chris@example.com');
  assert.equal(o.q17_roadName, 'Dysco');
  assert.deepEqual(o.q15_phoneNumber, { area: '', phone: '0400 000 000' });
  assert.deepEqual(o.q11_myProducts, {
    products: [
      { productName: 'Member Hoodie', quantity: 1, productOptions: ['L', 'Grey'] },
      { productName: 'Member Tee', quantity: 2, productOptions: ['M', 'Black'] },
    ],
    totalInfo: { totalSum: 165 },
  });
  assert.equal(o.q16_deliveryMethod, DELIVERY_LABEL.ship);
  assert.equal(o.q18_streetAddress, '1 Main St');
  assert.equal(o.q19_suburb, 'Sunshine');
  assert.equal(o.q20_state, 'VIC');
  assert.equal(o.q21_postcode, '3020');
  assert.equal(o.q22_shippingMethod, SHIPPING_LABEL.standard);
  // Make parses the string (module 2); the app never sets shipping cost or the order number.
  const payload = makePayload(ORDER);
  assert.deepEqual(Object.keys(payload), ['rawRequest']);
  assert.deepEqual(JSON.parse(payload.rawRequest), o);
  assert.ok(!payload.rawRequest.includes('shipping_cents'));
});

test('collect orders send the bot’s collect wording and no address', () => {
  const o = makeOrder({ ...ORDER, delivery: 'collect', street: null, suburb: null, state: null, postcode: null, shipping_method: null, shipping_cents: 0 });
  assert.equal(o.q16_deliveryMethod, 'Collect at next club meeting');
  assert.deepEqual([o.q18_streetAddress, o.q19_suburb, o.q20_state, o.q21_postcode, o.q22_shippingMethod], ['', '', '', '', '']);
});

test('names, phones and options with gaps', () => {
  assert.deepEqual(splitName('Cher'), { first: 'Cher', last: '' });
  assert.deepEqual(splitName('  Mary Jane  Watson '), { first: 'Mary', last: 'Jane Watson' });
  assert.deepEqual(splitName(''), { first: '', last: '' });
  const o = makeOrder({
    ...ORDER, road_name: null, phone: null, subtotal_cents: 4000,
    lines: [{ id: 'l', order_id: 'o', garment_id: null, design_name: 'R U OK', garment_name: 'Tee', size: null, colour: null, qty: 1, unit_cents: 4000 }],
  });
  assert.equal(o.q17_roadName, '');
  assert.equal(o.q15_phoneNumber.phone, '');
  assert.deepEqual(o.q11_myProducts.products[0].productOptions, []);
  assert.equal(o.q11_myProducts.totalInfo.totalSum, 40);
});

test('a cart is placed as the member, posted to Make and marked sent', async () => {
  const { d, calls } = deps();
  const got = await handleShopOrder(ENV, CART, d);
  assert.deepEqual(got, { status: 200, body: { orderId: ORDER.id, status: 'sent', message: SENT_MESSAGE } });
  assert.equal(calls.place.length, 1);
  assert.equal(calls.post[0].url, ENV.MAKE_WEBHOOK_MEMBER_URL);
  assert.deepEqual(calls.post[0].payload, makePayload(ORDER));
  assert.deepEqual(calls.sent, [[ORDER.id, true, null]]);
});

test('the database’s refusal comes back as 400 in its own words, with nothing posted', async () => {
  const { d, calls } = deps({ placeOrder: async () => { throw new Error('That design is for Full and Nomad members.'); } });
  const got = await handleShopOrder(ENV, CART, d);
  assert.deepEqual(got, { status: 400, body: { error: 'That design is for Full and Nomad members.' } });
  assert.equal(calls.post.length, 0);
  assert.equal(calls.sent.length, 0);
});

test('a repeat clientRef already sent comes straight back, not posted twice', async () => {
  const { d, calls } = deps({ placeOrder: async () => ({ ...ORDER, status: 'sent' }) });
  const got = await handleShopOrder(ENV, CART, d);
  assert.deepEqual(got, { status: 200, body: { orderId: ORDER.id, status: 'sent' } });
  assert.equal(calls.post.length, 0);
  assert.equal(calls.sent.length, 0);
});

test('Make saying no keeps the order held with the reason (weak spot 1 fixed)', async () => {
  const { d, calls } = deps({ post: async () => ({ ok: false, status: 500, text: 'Scenario is inactive' }) });
  const got = await handleShopOrder(ENV, CART, d);
  assert.deepEqual(got, { status: 200, body: { orderId: ORDER.id, status: 'held', message: HELD_MESSAGE } });
  assert.deepEqual(calls.sent, [[ORDER.id, false, 'Make answered 500: Scenario is inactive']]);
});

test('Make unreachable keeps the order held too', async () => {
  const { d, calls } = deps({ post: async () => { throw new Error('fetch failed'); } });
  const got = await handleShopOrder(ENV, CART, d);
  assert.equal(got.body.status, 'held');
  assert.deepEqual(calls.sent, [[ORDER.id, false, 'Make unreachable: fetch failed']]);
});

test('no webhook secret: the order is kept held and nothing is posted', async () => {
  const { d, calls } = deps();
  const got = await handleShopOrder({}, CART, d);
  assert.deepEqual(got, { status: 200, body: { orderId: ORDER.id, status: 'held', message: HELD_MESSAGE } });
  assert.equal(calls.post.length, 0);
  assert.deepEqual(calls.sent, [[ORDER.id, false, NOT_SWITCHED_ON]]);
});

test('a resend goes through resend_shop_order (the database checks who and what)', async () => {
  const { d, calls } = deps();
  const got = await handleShopOrder(ENV, { resend: ORDER.id }, d);
  assert.equal(got.body.status, 'sent');
  assert.deepEqual(calls.resend, [ORDER.id]);
  assert.equal(calls.place.length, 0);
  const refused = deps({ resend: async () => { throw new Error('Only a held order can be resent.'); } });
  assert.deepEqual(await handleShopOrder(ENV, { resend: ORDER.id }, refused.d), { status: 400, body: { error: 'Only a held order can be resent.' } });
  assert.deepEqual(await handleShopOrder(ENV, { resend: 'nope' }, d), { status: 400, body: { error: 'No such order.' } });
});

test('a body that is not a cart or a resend is refused before the database', async () => {
  const { d, calls } = deps();
  for (const body of [null, {}, { lines: [] }, { clientRef: 'not-a-uuid', lines: [], delivery: 'collect' }, 'text']) {
    assert.deepEqual(await handleShopOrder(ENV, body, d), { status: 400, body: { error: START_AGAIN } });
  }
  assert.equal(calls.place.length, 0);
});
