// Club merch (constitution v4 15.1, 13.1): designs the board approves, orders with sizes, and the
// money in the books as CR-005. No card payments. The database's actions refuse with the same
// words, in the same order.

import { KEEPS_ONLY, keepsBooks } from './ledger';
import { reviewsScope, runsScope, scopeRefusal, signedInProblem } from './meetings';
import { melbourneDate } from './rides';
import { isIsoDate } from './conduct';
import type { ClubData, Member, MerchItem, MerchOrder, MerchStatus, OrderStatus } from './types';

export const MERCH_CODE = 'CR-005';
export const MAX_NAME = 80;
export const MAX_DETAILS = 500;
export const MAX_SIZES = 12;
export const MAX_SIZE = 10;
export const MAX_PRICE_CENTS = 100000;
export const MAX_QTY = 10;
export const MAX_NOTE = 300;

export const ITEM_STATUS_LABEL: Record<MerchStatus, string> = {
  proposed: 'Waiting for a yes',
  on_sale: 'On sale',
  declined: 'Declined',
  closed: 'Closed',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  waiting: 'Waiting',
  approved: 'To pay',
  paid: 'Paid',
  handed_over: 'Handed over',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const NO_ITEM = 'No such item.';
export const NO_ORDER = 'No such order.';
export const SIZES_RULE = 'Keep sizes to 10 characters, no repeats, 12 at most.';

const length = (s: string) => [...s].length;
const patched = (m: Member) => m.status === 'full' || m.status === 'nomad';

export interface MerchInput {
  chapterId: string | null;
  name: string;
  details: string;
  sizes: string[];
  priceCents: number;
  patchedOnly: boolean;
}

export interface OrderInput {
  itemId: string;
  size: string | null;
  qty: number;
  note: string;
}

/** Sizes as saved: trimmed, in the order given. */
export const cleanSizes = (sizes: string[]): string[] => sizes.map((s) => s.trim());

export const orderTotal = (o: Pick<MerchOrder, 'unitCents' | 'qty'>): number => o.unitCents * o.qty;

/** On sale or closed for any approved member; proposed and declined ones for the people who run it. */
export function seesItem(me: Member | null, item: MerchItem, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  return item.status === 'on_sale' || item.status === 'closed' || reviewsScope(me, item.chapterId, data.positions);
}

export const visibleItems = (me: Member | null, data: ClubData): MerchItem[] =>
  (data.merchItems ?? []).filter((i) => seesItem(me, i, data));

/** Who ordered it, the board that runs the item, whoever keeps that fund's books, and the Auditor (11.8). */
export function seesOrder(me: Member | null, order: MerchOrder, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  const item = (data.merchItems ?? []).find((i) => i.id === order.itemId);
  if (!item) return false;
  return order.memberId === me.id || reviewsScope(me, item.chapterId, data.positions) || keepsBooks(me, item.chapterId, data.positions);
}

export const visibleOrders = (me: Member | null, data: ClubData): MerchOrder[] =>
  (data.merchOrders ?? []).filter((o) => seesOrder(me, o, data));

/**
 * Whether the Merch tab shows the app's own gear to a member. Only when something is on sale in
 * the app or they have an order there; otherwise members just see the Discord and website shops.
 * The people who run merch always see it (they can put items up).
 */
export function showsAppMerch(me: Member | null, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (visibleItems(me, data).some((i) => i.status === 'on_sale')) return true;
  return (data.merchOrders ?? []).some((o) => o.memberId === me.id);
}

const itemOf = (order: MerchOrder, data: ClubData) => (data.merchItems ?? []).find((i) => i.id === order.itemId)!;

/** Orders waiting on this person: a yes or no and a hand-over for the board, a payment for book-keepers. */
export function ordersToAct(me: Member | null, data: ClubData): MerchOrder[] {
  return visibleOrders(me, data).filter((o) => {
    const item = itemOf(o, data);
    const runs = runsScope(me, item.chapterId, data.positions);
    return (runs && (o.status === 'waiting' || o.status === 'paid')) || (o.status === 'approved' && keepsBooks(me, item.chapterId, data.positions));
  });
}

export function proposeMerchProblem(me: Member | null, input: MerchInput, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (input.chapterId !== null && !data.chapters.some((c) => c.id === input.chapterId)) return 'No such chapter.';
  if (!runsScope(me, input.chapterId, data.positions)) return scopeRefusal(input.chapterId);
  const name = input.name.trim();
  if (!name) return 'Name it.';
  if (length(name) > MAX_NAME) return 'Keep the name to 80 characters at most.';
  if (length(input.details.trim()) > MAX_DETAILS) return 'Keep the details to 500 characters at most.';
  const sizes = cleanSizes(input.sizes);
  if (sizes.length > MAX_SIZES || new Set(sizes).size !== sizes.length || sizes.some((s) => !s || length(s) > MAX_SIZE)) return SIZES_RULE;
  if (!Number.isInteger(input.priceCents) || input.priceCents < 1 || input.priceCents > MAX_PRICE_CENTS) return 'Enter a price from $0.01 to $1,000.';
  return null;
}

function itemFor(me: Member | null, id: string, data: ClubData): { problem: string } | { item: MerchItem } {
  const signedIn = signedInProblem(me);
  if (signedIn) return { problem: signedIn };
  const item = visibleItems(me, data).find((i) => i.id === id);
  if (!item) return { problem: NO_ITEM };
  if (!runsScope(me, item.chapterId, data.positions)) return { problem: scopeRefusal(item.chapterId) };
  return { item };
}

/** A yes puts it on sale; someone other than whoever put it up gives it (inferred two-person rule). */
export function decideMerchProblem(me: Member | null, id: string, yes: boolean, reason: string, data: ClubData): string | null {
  const found = itemFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (found.item.status !== 'proposed') return 'That item has already been decided.';
  if (yes && found.item.proposedBy === me!.id) return 'Someone other than whoever put it up approves it (15.1).';
  if (!yes && length(reason.trim()) > MAX_NOTE) return 'Keep the reason to 300 characters at most.';
  return null;
}

export function closeMerchProblem(me: Member | null, id: string, data: ClubData): string | null {
  const found = itemFor(me, id, data);
  if ('problem' in found) return found.problem;
  return found.item.status === 'on_sale' ? null : 'Only an item on sale can be closed.';
}

export function orderProblem(me: Member | null, input: OrderInput, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (me!.status === 'legacy') return 'Legacy members can’t order merch.';
  const item = visibleItems(me, data).find((i) => i.id === input.itemId);
  if (!item || item.status !== 'on_sale') return 'That item isn’t on sale.';
  if (item.patchedOnly && !patched(me!)) return 'That item is for Full and Nomad members only.';
  if (item.sizes.length > 0 && (input.size === null || !item.sizes.includes(input.size))) return 'Pick a size.';
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > MAX_QTY) return 'Order 1 to 10.';
  if (length(input.note.trim()) > MAX_NOTE) return 'Keep the note to 300 characters at most.';
  return null;
}

function orderFor(me: Member | null, id: string, data: ClubData): { problem: string } | { order: MerchOrder; item: MerchItem } {
  const signedIn = signedInProblem(me);
  if (signedIn) return { problem: signedIn };
  const order = visibleOrders(me, data).find((o) => o.id === id);
  if (!order) return { problem: NO_ORDER };
  return { order, item: itemOf(order, data) };
}

export function decideOrderProblem(me: Member | null, id: string, yes: boolean, reason: string, data: ClubData): string | null {
  const found = orderFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (!runsScope(me, found.item.chapterId, data.positions)) return scopeRefusal(found.item.chapterId);
  if (found.order.status !== 'waiting') return 'That order has already been decided.';
  if (found.order.memberId === me!.id) return 'Someone else approves your own order.';
  if (!yes && length(reason.trim()) > MAX_NOTE) return 'Keep the reason to 300 characters at most.';
  return null;
}

export function payOrderProblem(me: Member | null, id: string, paidOn: string, data: ClubData, today: string): string | null {
  const found = orderFor(me, id, data);
  if ('problem' in found) return found.problem;
  const { order, item } = found;
  if (!keepsBooks(me, item.chapterId, data.positions)) return KEEPS_ONLY;
  if (order.status === 'paid' || order.status === 'handed_over') return 'That order is already paid.';
  if (order.status !== 'approved') return 'Approve the order first.';
  if (order.memberId === me!.id) return 'Someone else records your own payment.';
  if (!isIsoDate(paidOn) || paidOn > today || paidOn < melbourneDate(order.orderedAt)) return 'Pick the day it was paid.';
  return null;
}

export function handOverProblem(me: Member | null, id: string, data: ClubData): string | null {
  const found = orderFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (!runsScope(me, found.item.chapterId, data.positions)) return scopeRefusal(found.item.chapterId);
  return found.order.status === 'paid' ? null : 'Mark it paid first.';
}

export function cancelOrderProblem(me: Member | null, id: string, data: ClubData): string | null {
  const found = orderFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (found.order.memberId !== me!.id && !runsScope(me, found.item.chapterId, data.positions)) {
    return 'Only whoever ordered it or the board can cancel it.';
  }
  return found.order.status === 'waiting' || found.order.status === 'approved' ? null : 'That order can’t be cancelled now.';
}

/** The ledger line a paid order makes. */
export function merchLedgerDescription(order: MerchOrder, item: MerchItem, buyer: string): string {
  return `Merch: ${item.name}${order.size ? ` (${order.size})` : ''} ×${order.qty} for ${buyer}`;
}
