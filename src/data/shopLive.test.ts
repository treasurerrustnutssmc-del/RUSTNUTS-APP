import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOrderBody, shopFunctionWords, toShop, SHOP_NEEDS_SIGNAL, SHOP_CANT_SEND } from './shopLive';

const T = '2026-11-01T02:00:00+00:00';
const Z = '2026-11-01T02:00:00.000Z';

test('anything but the shop reads reads as an empty shop', () => {
  for (const odd of [[], 'x', 1, null, undefined, { designs: 'x' }] as unknown[]) {
    const s = toShop(odd as never, odd as never);
    assert.deepEqual([s.shopDesigns, s.shopGarments, s.shopShipping, s.shopRunners, s.shopOrders], [[], [], [], [], []]);
    assert.equal(s.runsShop, false);
    assert.equal(s.address, null);
  }
});

test('merch_catalogue() becomes designs, garments, shipping, runners and the saved address', () => {
  const s = toShop(
    {
      designs: [{
        id: 'd1', name: 'Member', eligibility: 'patched', blurb: '', sort: 1, on_sale: true, updated_by: 'm1', updated_at: T,
        problem: null,
        garments: [
          { id: 'g1', design_id: 'd1', name: 'Hoodie', price_cents: '6500', sizes: ['M', 'L'], colours: ['Black'], sort: 0, on_sale: true },
          { id: 'g2', design_id: 'd1', name: 'Cap', price_cents: 3000, sizes: null, colours: null, sort: 1, on_sale: false },
        ],
      }],
      shipping: [{ state: 'VIC', method: 'standard', cents: 1200 }],
      address: { street: '1 Main St', suburb: 'Footscray', state: 'VIC', postcode: '3011' },
      runners: [{ member_id: 'm9', named_by: 'm1', named_on: '2026-11-01' }],
      runs_shop: true,
    },
    [],
  );
  assert.deepEqual(s.shopDesigns, [{
    id: 'd1', name: 'Member', eligibility: 'patched', blurb: '', sort: 1, onSale: true, updatedBy: 'm1', updatedAt: Z,
  }]);
  assert.deepEqual(s.shopGarments, [
    { id: 'g1', designId: 'd1', name: 'Hoodie', priceCents: 6500, sizes: ['M', 'L'], colours: ['Black'], sort: 0, onSale: true },
    { id: 'g2', designId: 'd1', name: 'Cap', priceCents: 3000, sizes: [], colours: [], sort: 1, onSale: false },
  ]);
  assert.deepEqual(s.shopShipping, [{ state: 'VIC', method: 'standard', cents: 1200 }]);
  assert.deepEqual(s.shopRunners, [{ memberId: 'm9', namedBy: 'm1', namedOn: '2026-11-01' }]);
  assert.deepEqual(s.address, { street: '1 Main St', suburb: 'Footscray', state: 'VIC', postcode: '3011' });
  assert.equal(s.runsShop, true);
});

test('shop_orders() becomes orders with their lines', () => {
  const s = toShop(null, [{
    id: 'o1', member_id: 'm1', client_ref: 'c1', buyer_name: 'Gary Kowalski', road_name: 'Rusty', email: 'g@x.au', phone: null,
    delivery: 'ship', street: '1 Main St', suburb: 'Footscray', state: 'VIC', postcode: '3011', shipping_method: 'standard',
    subtotal_cents: 6500, shipping_cents: '1200', status: 'sent', make_sent_at: T, make_error: null, paid_on: null, paid_cents: null,
    ledger_entry_id: null, handed_over_on: null, cancelled_at: null, cancelled_by: null, ordered_at: T,
    lines: [{
      id: 'l1', order_id: 'o1', garment_id: 'g1', design_name: 'Member', garment_name: 'Hoodie', size: 'L', colour: 'Black', qty: 1,
      unit_cents: 6500,
    }],
  }]);
  assert.deepEqual(s.shopOrders, [{
    id: 'o1', memberId: 'm1', clientRef: 'c1', buyerName: 'Gary Kowalski', roadName: 'Rusty', email: 'g@x.au', phone: null,
    delivery: 'ship', street: '1 Main St', suburb: 'Footscray', state: 'VIC', postcode: '3011', shippingMethod: 'standard',
    subtotalCents: 6500, shippingCents: 1200, status: 'sent', makeSentAt: Z, makeError: null, paidOn: null, paidCents: null,
    ledgerEntryId: null, handedOverOn: null, cancelledAt: null, cancelledBy: null, orderedAt: Z,
    lines: [{
      id: 'l1', orderId: 'o1', garmentId: 'g1', designName: 'Member', garmentName: 'Hoodie', size: 'L', colour: 'Black', qty: 1,
      unitCents: 6500,
    }],
  }]);
});

test('the body the shop-order function takes, trimmed, with no address for a collect order', () => {
  const lines = [{ garmentId: 'g1', size: 'L', colour: null, qty: 2 }];
  assert.deepEqual(
    placeOrderBody({
      clientRef: 'c1', lines, email: ' g@x.au ', phone: ' 0400 ', delivery: 'collect', street: '1 Main', suburb: 'X', state: 'VIC',
      postcode: '3011', shippingMethod: 'standard', saveAddress: true,
    }),
    {
      clientRef: 'c1', lines, email: 'g@x.au', phone: '0400', delivery: 'collect', street: '', suburb: '', state: '', postcode: '',
      shippingMethod: null, saveAddress: false,
    },
  );
  assert.deepEqual(
    placeOrderBody({
      clientRef: 'c1', lines, email: '', phone: '', delivery: 'ship', street: ' 1 Main St ', suburb: ' Footscray ', state: 'vic',
      postcode: ' 3011 ', shippingMethod: 'express', saveAddress: true,
    }),
    {
      clientRef: 'c1', lines, email: '', phone: '', delivery: 'ship', street: '1 Main St', suburb: 'Footscray', state: 'VIC',
      postcode: '3011', shippingMethod: 'express', saveAddress: true,
    },
  );
});

const said = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status }) });

test('a refused order shows the function’s words; no signal and a broken answer have their own', async () => {
  assert.equal(await shopFunctionWords(said(400, { error: 'Pick a size.' })), 'Pick a size.');
  assert.equal(await shopFunctionWords({ name: 'FunctionsFetchError' }), SHOP_NEEDS_SIGNAL);
  assert.equal(await shopFunctionWords({ name: 'FunctionsRelayError' }), SHOP_NEEDS_SIGNAL);
  assert.equal(await shopFunctionWords({ name: 'FunctionsHttpError', context: new Response('oops', { status: 500 }) }), SHOP_CANT_SEND);
  assert.equal(await shopFunctionWords(said(401, { message: 'Invalid JWT' })), SHOP_CANT_SEND);
});
