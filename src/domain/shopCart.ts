// The member's cart in the club shop: lines picked on the design screens, kept until the order is
// sent. One client reference per cart, so sending the same cart twice (a double tap, a retry with
// poor signal) gets the first order back instead of a second one (spec: Idempotency).

import { MAX_LINES, MAX_LINE_QTY, NOT_ON_SALE, PICK_COLOUR, PICK_SIZE, QTY, TOO_MANY_LINES, mergeLines, type CartLine } from './shop';
import type { ClubData } from './types';

export interface Cart {
  /** Whose cart: a different member signing in starts a new one. */
  memberId: string | null;
  clientRef: string;
  lines: CartLine[];
}

export const emptyCart = (memberId: string | null, clientRef: string = newClientRef()): Cart => ({ memberId, clientRef, lines: [] });

/** A random version 4 uuid (the database's client_ref column is a uuid). */
export function newClientRef(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const cartCount = (cart: Cart): number => cart.lines.reduce((n, l) => n + l.qty, 0);

/** Adds a line (merging the same garment, size and colour), or says why not, in the shop's words. */
export function addToCart(cart: Cart, line: CartLine, data: ClubData): { cart: Cart } | { problem: string } {
  const garment = (data.shopGarments ?? []).find((g) => g.id === line.garmentId);
  if (!garment || !garment.onSale) return { problem: NOT_ON_SALE };
  if (garment.sizes.length > 0 ? line.size === null || !garment.sizes.includes(line.size) : line.size !== null) return { problem: PICK_SIZE };
  if (garment.colours.length > 0 ? line.colour === null || !garment.colours.includes(line.colour) : line.colour !== null) {
    return { problem: PICK_COLOUR };
  }
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_LINE_QTY) return { problem: QTY };
  const lines = mergeLines([...cart.lines, line]);
  if (lines.length > MAX_LINES) return { problem: TOO_MANY_LINES };
  if (lines.some((l) => l.qty > MAX_LINE_QTY)) return { problem: QTY };
  return { cart: { ...cart, lines, clientRef: newClientRef() } };
}

/**
 * Changing the cart makes it a new order (a new client reference): a resend of an order that did land
 * would otherwise come back as the first order, without the change.
 */
export const setCartQty = (cart: Cart, index: number, qty: number): Cart => ({
  ...cart,
  clientRef: newClientRef(),
  lines: cart.lines.map((l, i) => (i === index ? { ...l, qty: Math.min(MAX_LINE_QTY, Math.max(1, Math.round(qty))) } : l)),
});

export const removeFromCart = (cart: Cart, index: number): Cart => ({ ...cart, clientRef: newClientRef(), lines: cart.lines.filter((_, i) => i !== index) });
