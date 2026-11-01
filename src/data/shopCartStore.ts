// The club shop's cart, kept for the session while the member moves between the design, cart and
// checkout screens. Belongs to whoever is signed in: someone else signing in starts an empty one.

import { useCallback, useSyncExternalStore } from 'react';
import { addToCart, emptyCart, newClientRef, removeFromCart, setCartQty, type Cart } from '../domain/shopCart';
import type { CartLine } from '../domain/shop';
import type { ClubData } from '../domain/types';

let cart: Cart = emptyCart(null);
const listeners = new Set<() => void>();
const set = (next: Cart) => {
  cart = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const read = () => cart;

export function useShopCart(memberId: string | null) {
  const current = useSyncExternalStore(subscribe, read, read);
  const mine = current.memberId === memberId ? current : emptyCart(memberId, current.clientRef);
  const own = useCallback(() => (cart.memberId === memberId ? cart : emptyCart(memberId)), [memberId]);
  return {
    cart: mine,
    /** Adds a line, or resolves to why not. */
    add: useCallback((line: CartLine, data: ClubData): string | null => {
      const r = addToCart(own(), line, data);
      if ('problem' in r) return r.problem;
      set(r.cart);
      return null;
    }, [own]),
    setQty: useCallback((index: number, qty: number) => set(setCartQty(own(), index, qty)), [own]),
    remove: useCallback((index: number) => set(removeFromCart(own(), index)), [own]),
    /** After the order is in: an empty cart with a new reference, so the next order is a new one. */
    sent: useCallback(() => set(emptyCart(memberId, newClientRef())), [memberId]),
  };
}
