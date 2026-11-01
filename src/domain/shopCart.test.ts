import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addToCart, cartCount, emptyCart, newClientRef, removeFromCart, setCartQty } from './shopCart';
import { PICK_COLOUR, PICK_SIZE, QTY, TOO_MANY_LINES, NOT_ON_SALE } from './shop';
import type { ClubData, ShopGarment } from './types';

const garment = (id: string, over: Partial<ShopGarment> = {}): ShopGarment => ({
  id, designId: 'd1', name: id, priceCents: 1000, sizes: ['M', 'L'], colours: ['Black'], sort: 0, onSale: true, ...over,
});
const data = {
  shopGarments: [garment('g1'), garment('cap', { sizes: [], colours: [] }), garment('off', { onSale: false })],
} as unknown as ClubData;

const ref = 'c0ffee00-0000-4000-8000-000000000000';

test('a new client reference is a version 4 uuid, different every time', () => {
  const a = newClientRef();
  const b = newClientRef();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test('adding merges the same garment, size and colour, and counts items', () => {
  let cart = emptyCart('m1', ref);
  const one = addToCart(cart, { garmentId: 'g1', size: 'L', colour: 'Black', qty: 1 }, data);
  assert.ok('cart' in one);
  cart = one.cart;
  const two = addToCart(cart, { garmentId: 'g1', size: 'L', colour: 'Black', qty: 2 }, data);
  assert.ok('cart' in two);
  cart = two.cart;
  const three = addToCart(cart, { garmentId: 'cap', size: null, colour: null, qty: 1 }, data);
  assert.ok('cart' in three);
  assert.deepEqual(three.cart.lines, [
    { garmentId: 'g1', size: 'L', colour: 'Black', qty: 3 },
    { garmentId: 'cap', size: null, colour: null, qty: 1 },
  ]);
  assert.notEqual(three.cart.clientRef, ref, 'a changed cart is a new order');
  assert.equal(cartCount(three.cart), 4);
});

test('adding refuses with the shop’s own words', () => {
  const cart = emptyCart('m1', ref);
  const no = (line: Parameters<typeof addToCart>[1], c = cart) => {
    const r = addToCart(c, line, data);
    return 'problem' in r ? r.problem : null;
  };
  assert.equal(no({ garmentId: 'g1', size: null, colour: 'Black', qty: 1 }), PICK_SIZE);
  assert.equal(no({ garmentId: 'g1', size: 'XS', colour: 'Black', qty: 1 }), PICK_SIZE);
  assert.equal(no({ garmentId: 'g1', size: 'M', colour: null, qty: 1 }), PICK_COLOUR);
  assert.equal(no({ garmentId: 'g1', size: 'M', colour: 'Black', qty: 0 }), QTY);
  assert.equal(no({ garmentId: 'off', size: 'M', colour: 'Black', qty: 1 }), NOT_ON_SALE);
  assert.equal(no({ garmentId: 'gone', size: null, colour: null, qty: 1 }), NOT_ON_SALE);
  // Merging past 10 of one line
  const nine = { ...cart, lines: [{ garmentId: 'g1', size: 'M', colour: 'Black', qty: 9 }] };
  assert.equal(no({ garmentId: 'g1', size: 'M', colour: 'Black', qty: 2 }, nine), QTY);
  // An eleventh line
  const ten = { ...cart, lines: Array.from({ length: 10 }, (_, i) => ({ garmentId: `x${i}`, size: null, colour: null, qty: 1 })) };
  assert.equal(no({ garmentId: 'cap', size: null, colour: null, qty: 1 }, ten), TOO_MANY_LINES);
});

test('changing a quantity keeps it 1 to 10; removing drops the line', () => {
  const cart = { ...emptyCart('m1', ref), lines: [{ garmentId: 'g1', size: 'M', colour: 'Black', qty: 2 }, { garmentId: 'cap', size: null, colour: null, qty: 1 }] };
  assert.equal(setCartQty(cart, 0, 5).lines[0].qty, 5);
  assert.equal(setCartQty(cart, 0, 0).lines[0].qty, 1);
  assert.equal(setCartQty(cart, 0, 12).lines[0].qty, 10);
  assert.deepEqual(removeFromCart(cart, 0).lines, [{ garmentId: 'cap', size: null, colour: null, qty: 1 }]);
  assert.notEqual(removeFromCart(cart, 0).clientRef, ref);
  assert.notEqual(setCartQty(cart, 0, 5).clientRef, ref);
});
