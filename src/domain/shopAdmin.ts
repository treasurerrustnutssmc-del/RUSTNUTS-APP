// The club shop for the people who run it and the books-keepers: who sees the admin screen, the
// order queues, and small helpers for the catalogue editor. The rules themselves are in ./shop.ts.
// Spec: docs/superpowers/specs/2026-11-01-in-app-merch-ordering-design.md (piece 4).

import { keepsBooks } from './ledger';
import { runsShop } from './shop';
import type { ClubData, Member, ShopEligibility, ShopOrder } from './types';

export const ELIGIBILITY_LABEL: Record<ShopEligibility, string> = {
  any: 'Any approved member',
  patched: 'Full and Nomad members',
  family: 'Family and patched members',
};

/** The people who run the shop see its orders and catalogue; the books-keepers see its orders to mark them paid. */
export const seesShopAdmin = (me: Member | null, data: ClubData): boolean =>
  runsShop(me, data) || keepsBooks(me, null, data.positions);

export interface ShopQueues {
  /** Saved in the app, not yet accepted by Make: resend. */
  held: ShopOrder[];
  /** Invoice emailed, waiting for the money: the treasurer marks it paid. */
  awaitingPayment: ShopOrder[];
  /** Paid: the shop posts it or hands it over at a meeting. */
  toHandOver: ShopOrder[];
  /** Posted, collected or cancelled, newest first. */
  done: ShopOrder[];
}

const oldestFirst = (a: ShopOrder, b: ShopOrder) => a.orderedAt.localeCompare(b.orderedAt);

export function shopQueues(orders: ShopOrder[]): ShopQueues {
  const by = (s: ShopOrder['status']) => orders.filter((o) => o.status === s).sort(oldestFirst);
  return {
    held: by('held'),
    awaitingPayment: by('sent'),
    toHandOver: by('paid'),
    done: orders.filter((o) => ['posted', 'collected', 'cancelled'].includes(o.status)).sort((a, b) => oldestFirst(b, a)),
  };
}

/** "S, M, L" as the list the catalogue keeps. The database checks lengths and repeats. */
export const listFromText = (text: string): string[] => text.split(',').map((s) => s.trim()).filter(Boolean);
