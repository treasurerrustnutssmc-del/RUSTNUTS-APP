// What each club-shop action does to the demo club, under the same rules as the database
// (src/domain/shop.ts; checked by src/data/parity.test.ts and scripts/parity-sql.mts).

import {
  SHOP_CODE, cancelShopOrderProblem, cartSubtotal, cleanList, handOverShopOrderProblem, handedOverStatus, mergeLines,
  nameShopRunnerProblem, orderEmail, payShopOrderProblem, placeShopOrderProblem, resendShopOrderProblem, saveDeliveryAddressProblem,
  setShopDesignProblem, setShopGarmentProblem, setShopShippingProblem, shippingCents, shopLedgerDescription, unnameShopRunnerProblem,
  type AddressInput, type DesignInput, type GarmentInput, type PlaceOrderInput, type ShippingInput,
} from '../domain/shop';
import type { ClubData, LedgerEntry, ShippingMethod, ShopDelivery, ShopEligibility, ShopOrder } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

const withOrder = (data: ClubData, id: string, change: (o: ShopOrder) => ShopOrder): ClubData => ({
  ...data, shopOrders: (data.shopOrders ?? []).map((o) => (o.id === id ? change(o) : o)),
});

/** The demo has no Make: an order is sent the moment it is placed. A repeat clientRef is the first order. */
export function placeShopOrder(ctx: DemoCtx, input: PlaceOrderInput): { data: ClubData; id: string } {
  refuse(placeShopOrderProblem(ctx.me, input, ctx.data, ctx.today));
  const me = ctx.me!;
  const existing = (ctx.data.shopOrders ?? []).find((o) => o.memberId === me.id && o.clientRef === input.clientRef);
  if (existing) return { data: ctx.data, id: existing.id };
  const ship = input.delivery === 'ship';
  const lines = mergeLines(input.lines);
  const now = nowOf(ctx);
  const id = newId('so');
  const order: ShopOrder = {
    id, memberId: me.id, clientRef: input.clientRef, buyerName: me.fullName, roadName: me.roadName,
    email: orderEmail(me, input.email, ctx.data), phone: input.phone.trim() || null, delivery: input.delivery,
    street: ship ? input.street.trim() : null, suburb: ship ? input.suburb.trim() : null,
    state: ship ? input.state.trim().toUpperCase() : null, postcode: ship ? input.postcode.trim() : null,
    shippingMethod: ship ? input.shippingMethod : null,
    subtotalCents: cartSubtotal(lines, ctx.data), shippingCents: shippingCents(input, ctx.data),
    status: 'sent', makeSentAt: now, makeError: null, paidOn: null, paidCents: null, ledgerEntryId: null, handedOverOn: null,
    cancelledAt: null, cancelledBy: null, orderedAt: now,
    lines: lines.map((l) => {
      const garment = (ctx.data.shopGarments ?? []).find((g) => g.id === l.garmentId)!;
      const design = (ctx.data.shopDesigns ?? []).find((d) => d.id === garment.designId)!;
      return {
        id: newId('sl'), orderId: id, garmentId: garment.id, designName: design.name, garmentName: garment.name,
        size: l.size, colour: l.colour, qty: l.qty, unitCents: garment.priceCents,
      };
    }),
  };
  let data: ClubData = { ...ctx.data, shopOrders: [...(ctx.data.shopOrders ?? []), order] };
  if (ship && input.saveAddress) data = saveDeliveryAddress({ ...ctx, data }, input);
  return { data, id };
}

/** The money in: a CR-005 line in the Club fund for what landed, banked that day. */
export function payShopOrder(ctx: DemoCtx, id: string, paidOn: string, cents: number): { data: ClubData; id: string } {
  refuse(payShopOrderProblem(ctx.me, id, paidOn, cents, ctx.data, ctx.today));
  const order = (ctx.data.shopOrders ?? []).find((o) => o.id === id)!;
  const buyer = ctx.data.members.find((m) => m.id === order.memberId);
  const now = nowOf(ctx);
  const entry: LedgerEntry = {
    id: newId('le'), chapterId: null, code: SHOP_CODE, description: shopLedgerDescription(order, buyer?.roadName ?? buyer?.fullName ?? 'Member'),
    amountCents: cents, receivedOn: paidOn, entryOn: paidOn, payeeMemberId: null, payeeName: null, paymentId: null,
    state: 'paid', recordedBy: ctx.me!.id, recordedAt: now, updatedAt: now, voidReason: null, voidedBy: null, approvals: [],
  };
  const data = withOrder({ ...ctx.data, ledger: [...(ctx.data.ledger ?? []), entry] }, id, (o) => ({
    ...o, status: 'paid', paidOn, paidCents: cents, ledgerEntryId: entry.id,
  }));
  return { data, id: entry.id };
}

export function handOverShopOrder(ctx: DemoCtx, id: string): ClubData {
  refuse(handOverShopOrderProblem(ctx.me, id, ctx.data));
  return withOrder(ctx.data, id, (o) => ({ ...o, status: handedOverStatus(o), handedOverOn: ctx.today }));
}

export function cancelShopOrder(ctx: DemoCtx, id: string): ClubData {
  refuse(cancelShopOrderProblem(ctx.me, id, ctx.data));
  return withOrder(ctx.data, id, (o) => ({ ...o, status: 'cancelled', cancelledAt: nowOf(ctx), cancelledBy: ctx.me!.id }));
}

/** The demo has no Make: a resend just marks it sent. */
export function resendShopOrder(ctx: DemoCtx, id: string): ClubData {
  refuse(resendShopOrderProblem(ctx.me, id, ctx.data));
  return withOrder(ctx.data, id, (o) => ({ ...o, status: 'sent', makeSentAt: nowOf(ctx), makeError: null }));
}

export function setShopDesign(ctx: DemoCtx, input: DesignInput): { data: ClubData; id: string } {
  refuse(setShopDesignProblem(ctx.me, input, ctx.data));
  const id = input.id ?? newId('sd');
  const design = {
    id, name: input.name.trim(), eligibility: input.eligibility, blurb: input.blurb.trim(), sort: input.sort, onSale: input.onSale,
    updatedBy: ctx.me!.id, updatedAt: nowOf(ctx),
  };
  const designs = ctx.data.shopDesigns ?? [];
  return {
    data: { ...ctx.data, shopDesigns: input.id ? designs.map((d) => (d.id === id ? design : d)) : [...designs, design] },
    id,
  };
}

export function setShopGarment(ctx: DemoCtx, input: GarmentInput): { data: ClubData; id: string } {
  refuse(setShopGarmentProblem(ctx.me, input, ctx.data));
  const id = input.id ?? newId('sg');
  const garment = {
    id, designId: input.designId, name: input.name.trim(), priceCents: input.priceCents, sizes: cleanList(input.sizes),
    colours: cleanList(input.colours), sort: input.sort, onSale: input.onSale,
  };
  const garments = ctx.data.shopGarments ?? [];
  return {
    data: { ...ctx.data, shopGarments: input.id ? garments.map((g) => (g.id === id ? garment : g)) : [...garments, garment] },
    id,
  };
}

export function setShopShipping(ctx: DemoCtx, input: ShippingInput): ClubData {
  refuse(setShopShippingProblem(ctx.me, input, ctx.data));
  const row = { state: input.state.trim().toUpperCase(), method: input.method, cents: input.cents };
  const rest = (ctx.data.shopShipping ?? []).filter((s) => !(s.state === row.state && s.method === row.method));
  return { ...ctx.data, shopShipping: [...rest, row] };
}

export function nameShopRunner(ctx: DemoCtx, memberId: string): ClubData {
  refuse(nameShopRunnerProblem(ctx.me, memberId, ctx.data));
  return { ...ctx.data, shopRunners: [...(ctx.data.shopRunners ?? []), { memberId, namedBy: ctx.me!.id, namedOn: ctx.today }] };
}

export function unnameShopRunner(ctx: DemoCtx, memberId: string): ClubData {
  refuse(unnameShopRunnerProblem(ctx.me, memberId, ctx.data));
  return { ...ctx.data, shopRunners: (ctx.data.shopRunners ?? []).filter((r) => r.memberId !== memberId) };
}

/** All four parts saved on the member's private record, or all cleared. */
export function saveDeliveryAddress(ctx: DemoCtx, a: AddressInput): ClubData {
  refuse(saveDeliveryAddressProblem(ctx.me, a));
  const me = ctx.me!;
  const clear = !a.street.trim() && !a.suburb.trim() && !a.state.trim() && !a.postcode.trim();
  const address = clear
    ? { street: null, suburb: null, state: null, postcode: null }
    : { street: a.street.trim(), suburb: a.suburb.trim(), state: a.state.trim().toUpperCase(), postcode: a.postcode.trim() };
  const privates = ctx.data.privates ?? [];
  const mine = privates.find((p) => p.memberId === me.id);
  const updated = mine
    ? privates.map((p) => (p.memberId === me.id ? { ...p, ...address } : p))
    : [...privates, {
        memberId: me.id, email: null, phone: null, licenceClass: null, licenceExpiry: null, firstAidExpiry: null, introducedBy: null,
        applicationNote: null, ...address,
      }];
  return { ...ctx.data, privates: updated };
}

// The shared parity cases ------------------------------------------------------------------------

/** The club-shop actions the shared parity cases use, by name. Dates come as …Days from today. */
export type ShopAction =
  | {
      action: 'shopOrder'; clientRef?: string; lines: { garment: string; size?: string | null; colour?: string | null; qty: number }[];
      email?: string; phone?: string; delivery: ShopDelivery; street?: string; suburb?: string; state?: string; postcode?: string;
      method?: ShippingMethod | null; saveAddress?: boolean;
    }
  | { action: 'shopPay'; order: string; paid?: string; cents: number }
  | { action: 'shopHandOver'; order: string }
  | { action: 'shopCancel'; order: string }
  | { action: 'shopResend'; order: string }
  | { action: 'shopSetDesign'; design?: string | null; designName: string; eligibility: ShopEligibility; blurb?: string; sort?: number; onSale?: boolean }
  | {
      action: 'shopSetGarment'; garment?: string | null; design: string; garmentName: string; priceCents: number; sizes: string[];
      colours: string[]; sort?: number; onSale?: boolean;
    }
  | { action: 'shopSetShipping'; state: string; method: ShippingMethod; cents: number }
  | { action: 'shopNameRunner'; member: string }
  | { action: 'shopUnnameRunner'; member: string }
  | { action: 'shopSaveAddress'; street: string; suburb: string; state: string; postcode: string };

export const SHOP_ACTIONS = new Set<string>([
  'shopOrder', 'shopPay', 'shopHandOver', 'shopCancel', 'shopResend', 'shopSetDesign', 'shopSetGarment', 'shopSetShipping',
  'shopNameRunner', 'shopUnnameRunner', 'shopSaveAddress',
]);

export function runShopAction(ctx: DemoCtx, a: ShopAction): ClubData {
  switch (a.action) {
    case 'shopOrder':
      return placeShopOrder(ctx, {
        clientRef: a.clientRef ?? 'case', lines: a.lines.map((l) => ({ garmentId: l.garment, size: l.size ?? null, colour: l.colour ?? null, qty: l.qty })),
        email: a.email ?? '', phone: a.phone ?? '', delivery: a.delivery, street: a.street ?? '', suburb: a.suburb ?? '', state: a.state ?? '',
        postcode: a.postcode ?? '', shippingMethod: a.method ?? null, saveAddress: a.saveAddress ?? false,
      }).data;
    case 'shopPay':
      return payShopOrder(ctx, a.order, a.paid ?? '', a.cents).data;
    case 'shopHandOver':
      return handOverShopOrder(ctx, a.order);
    case 'shopCancel':
      return cancelShopOrder(ctx, a.order);
    case 'shopResend':
      return resendShopOrder(ctx, a.order);
    case 'shopSetDesign':
      return setShopDesign(ctx, {
        id: a.design ?? null, name: a.designName, eligibility: a.eligibility, blurb: a.blurb ?? '', sort: a.sort ?? 0, onSale: a.onSale ?? true,
      }).data;
    case 'shopSetGarment':
      return setShopGarment(ctx, {
        id: a.garment ?? null, designId: a.design, name: a.garmentName, priceCents: a.priceCents, sizes: a.sizes, colours: a.colours,
        sort: a.sort ?? 0, onSale: a.onSale ?? true,
      }).data;
    case 'shopSetShipping':
      return setShopShipping(ctx, { state: a.state, method: a.method, cents: a.cents });
    case 'shopNameRunner':
      return nameShopRunner(ctx, a.member);
    case 'shopUnnameRunner':
      return unnameShopRunner(ctx, a.member);
    case 'shopSaveAddress':
      return saveDeliveryAddress(ctx, { street: a.street, suburb: a.suburb, state: a.state, postcode: a.postcode });
    default:
      throw new Error(`Unknown shop action ${(a as { action: string }).action}`);
  }
}
