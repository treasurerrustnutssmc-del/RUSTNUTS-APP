// The club shop: ordering members' merch inside the app, into Chris's Make pipeline
// (docs/superpowers/specs/2026-11-01-in-app-merch-ordering-design.md). The database's actions refuse
// with the same words, in the same order (supabase/migrations/20270730000000_in_app_shop.sql).
// Jeff's rulings of 1 Nov 2026: both routes, Chris's eligibility split, price list in the app,
// orders into the books as CR-005, address saved on the profile, bank transfer only.

import { KEEPS_ONLY, keepsBooks } from './ledger';
import { isApprovedMember } from './access';
import { melbourneDate } from './rides';
import { isIsoDate } from './conduct';
import type {
  ClubData, Member, Position, ShippingMethod, ShopDelivery, ShopDesign, ShopEligibility, ShopOrder, ShopOrderStatus,
} from './types';

export const SHOP_CODE = 'CR-005';
export const MAX_LINES = 10;
export const MAX_LINE_QTY = 10;
export const DAILY_ORDERS = 5;
export const MAX_NAME = 60;
export const MAX_BLURB = 300;
export const MAX_PRICE_CENTS = 100000;
export const MAX_SHIPPING_CENTS = 100000;
export const MAX_PAID_CENTS = 1000000;
export const MAX_SIZES = 12;
export const MAX_SIZE = 10;
export const MAX_COLOURS = 12;
export const MAX_COLOUR = 20;
export const MAX_PHONE = 30;
export const MAX_STREET = 120;
export const MAX_SUBURB = 60;
export const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;
export const SHIPPING_METHODS: ShippingMethod[] = ['standard', 'express'];
export const ELIGIBILITIES: ShopEligibility[] = ['any', 'patched', 'family'];

export const STATUS_LABEL: Record<ShopOrderStatus, string> = {
  held: 'Held',
  sent: 'Sent',
  paid: 'Paid',
  posted: 'Posted',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

// Eligibility
export const LEGACY = 'Legacy members can’t order merch.';
export const PATCHED_ONLY = 'That design is for Full and Nomad members.';
export const FAMILY_ONLY = 'That design is for Family members and patched members.';
export const NOT_ON_SALE = 'That isn’t on sale.';
// Cart
export const EMPTY_CART = 'Add something first.';
export const TOO_MANY_LINES = 'Up to 10 lines an order.';
export const QTY = 'Order 1 to 10 of each.';
export const PICK_SIZE = 'Pick a size.';
export const PICK_COLOUR = 'Pick a colour.';
// Checkout
export const BAD_EMAIL = 'That email address does not look right.';
export const LONG_PHONE = 'Keep the phone number to 30 characters.';
export const PICK_DELIVERY = 'Pick ship or collect.';
export const ADDRESS = 'Fill in the delivery address.';
export const PICK_STATE = 'Pick a state.';
export const POSTCODE = 'Postcode is four digits.';
export const PICK_METHOD = 'Pick Standard or Express.';
export const DAILY = 'That’s enough orders for one day. Try again tomorrow.';
// Orders
export const NO_ORDER = 'No such order.';
export const RUNS_SHOP_ONLY = 'Only the people who run the shop can do that.';
export const PAY_NEEDS_SENT = 'Mark it paid once it has been sent to Make.';
export const PAID_DAY = 'Pick the day it was paid.';
export const AMOUNT = 'Enter the amount received.';
export const OWN_PAYMENT = 'Someone else records your own payment.';
export const HAND_OVER_NEEDS_PAID = 'Mark it paid first.';
export const ONLY_BUYER_OR_SHOP = 'Only whoever ordered it or the shop can cancel it.';
export const CANT_CANCEL = 'That order can’t be cancelled now.';
export const RESEND_HELD_ONLY = 'Only a held order can be resent.';
// Catalogue
export const NO_DESIGN = 'No such design.';
export const NO_GARMENT = 'No such garment.';
export const NAME_IT = 'Name it.';
export const LONG_NAME = 'Keep the name to 60 characters at most.';
export const PICK_ELIGIBILITY = 'Pick who the design is for.';
export const LONG_BLURB = 'Keep the blurb to 300 characters at most.';
export const SORT_RULE = 'Sort order is a whole number.';
export const PRICE_RULE = 'Enter a price from $0.01 to $1,000.';
export const SIZES_RULE = 'Keep sizes to 10 characters, no repeats, 12 at most.';
export const COLOURS_RULE = 'Keep colours to 20 characters, no repeats, 12 at most.';
export const SHIPPING_RULE = 'Enter a shipping cost from $0 to $1,000.';
export const NAMERS_ONLY = 'Only the NEC, Presidents and Treasurers name shop runners.';
export const NO_MEMBER = 'No such member.';
export const ALREADY_RUNNER = 'Already a shop runner.';
export const NOT_RUNNER = 'Not a shop runner.';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Session and approval, the first two checks of every shop action. Mirrors private.require_member:
 * Family accounts (the family view) aren't approved members there, so the shop isn't theirs today
 * even though the Family design names them (ruling 2 holds for the design; the family view has no merch).
 */
export function signedInProblem(me: Member | null): string | null {
  if (!me) return 'Sign in first.';
  if (!isApprovedMember(me)) return 'Only approved members can do that.';
  return null;
}
const length = (s: string) => [...s].length;
const approved = (me: Member | null): me is Member => isApprovedMember(me);
const patched = (m: Member) => m.status === 'full' || m.status === 'nomad';
const active = (memberId: string, positions: Position[]) => positions.filter((p) => p.memberId === memberId && p.endedOn === null);
const SHOP_SEATS = new Set<Position['role']>(['nec_chair', 'nec_secretary', 'president', 'treasurer']);

export interface CartLine {
  garmentId: string;
  size: string | null;
  colour: string | null;
  qty: number;
}

export interface DeliveryInput {
  delivery: ShopDelivery;
  street: string;
  suburb: string;
  state: string;
  postcode: string;
  shippingMethod: ShippingMethod | null;
}

export interface PlaceOrderInput extends DeliveryInput {
  clientRef: string;
  lines: CartLine[];
  /** Empty: the member's saved email. */
  email: string;
  phone: string;
  saveAddress: boolean;
}

export interface DesignInput {
  /** Null for a new design. */
  id: string | null;
  name: string;
  eligibility: ShopEligibility;
  blurb: string;
  sort: number;
  onSale: boolean;
}

export interface GarmentInput {
  id: string | null;
  designId: string;
  name: string;
  priceCents: number;
  sizes: string[];
  colours: string[];
  sort: number;
  onSale: boolean;
}

export interface ShippingInput {
  state: string;
  method: ShippingMethod;
  cents: number;
}

export interface AddressInput {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
}

// Who -------------------------------------------------------------------------------------------

/** Holds a seat that runs the shop: NEC Chair or Secretary, a President or a Treasurer. Mirrors private.shop_seat. */
export function holdsShopSeat(me: Member | null, positions: Position[]): boolean {
  return approved(me) && active(me.id, positions).some((p) => SHOP_SEATS.has(p.role));
}

/** Runs the shop: a shop seat, or named as a shop runner. Mirrors private.runs_shop. */
export function runsShop(me: Member | null, data: ClubData): boolean {
  if (!approved(me)) return false;
  return holdsShopSeat(me, data.positions) || (data.shopRunners ?? []).some((r) => r.memberId === me.id);
}

// Catalogue reading --------------------------------------------------------------------------------

/** Why this member can't order the design, or null. Mirrors private.design_problem. */
export function designProblem(me: Member | null, design: ShopDesign, _data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (me!.status === 'legacy') return LEGACY;
  if (!design.onSale) return NOT_ON_SALE;
  if (design.eligibility === 'patched' && !patched(me!)) return PATCHED_ONLY;
  if (design.eligibility === 'family' && !patched(me!) && me!.status !== 'family') return FAMILY_ONLY;
  return null;
}

/** The designs on sale this member may order, in catalogue order. */
export function orderableDesigns(me: Member | null, data: ClubData): ShopDesign[] {
  return [...(data.shopDesigns ?? [])]
    .sort((a, b) => a.sort - b.sort)
    .filter((d) => designProblem(me, d, data) === null);
}

const garmentOf = (data: ClubData, id: string) => (data.shopGarments ?? []).find((g) => g.id === id);
const designOf = (data: ClubData, id: string) => (data.shopDesigns ?? []).find((d) => d.id === id);

/** The same garment, size and colour twice becomes one line. */
export function mergeLines(lines: CartLine[]): CartLine[] {
  const out: CartLine[] = [];
  for (const l of lines) {
    const same = out.find((o) => o.garmentId === l.garmentId && o.size === l.size && o.colour === l.colour);
    if (same) same.qty += l.qty;
    else out.push({ ...l });
  }
  return out;
}

export const cartSubtotal = (lines: CartLine[], data: ClubData): number =>
  lines.reduce((sum, l) => sum + (garmentOf(data, l.garmentId)?.priceCents ?? 0) * l.qty, 0);

/** From the app's shipping table; 0 for collect or a state and method it has no row for (the invoice wins). */
export function shippingCents(d: DeliveryInput, data: ClubData): number {
  if (d.delivery !== 'ship') return 0;
  const state = d.state.trim().toUpperCase();
  return (data.shopShipping ?? []).find((s) => s.state === state && s.method === d.shippingMethod)?.cents ?? 0;
}

// Placing an order -------------------------------------------------------------------------------

function lineProblem(me: Member, l: CartLine, data: ClubData): string | null {
  const garment = garmentOf(data, l.garmentId);
  const design = garment ? designOf(data, garment.designId) : undefined;
  if (!garment || !design || !garment.onSale) return NOT_ON_SALE;
  const eligible = designProblem(me, design, data);
  if (eligible) return eligible;
  if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_LINE_QTY) return QTY;
  if (garment.sizes.length > 0 ? l.size === null || !garment.sizes.includes(l.size) : l.size !== null) return PICK_SIZE;
  if (garment.colours.length > 0 ? l.colour === null || !garment.colours.includes(l.colour) : l.colour !== null) return PICK_COLOUR;
  return null;
}

/** The address and method checks shared by checkout and the saved address. */
function addressProblem(a: AddressInput): string | null {
  const street = a.street.trim();
  const suburb = a.suburb.trim();
  if (!street || length(street) > MAX_STREET || !suburb || length(suburb) > MAX_SUBURB) return ADDRESS;
  if (!(STATES as readonly string[]).includes(a.state.trim().toUpperCase())) return PICK_STATE;
  if (!/^\d{4}$/.test(a.postcode.trim())) return POSTCODE;
  return null;
}

export function deliveryProblem(d: DeliveryInput): string | null {
  if (d.delivery === 'collect') return null;
  if (d.delivery !== 'ship') return PICK_DELIVERY;
  const address = addressProblem(d);
  if (address) return address;
  if (d.shippingMethod === null || !SHIPPING_METHODS.includes(d.shippingMethod)) return PICK_METHOD;
  return null;
}

/** The email an order goes out to: the one typed, or the member's saved one. Empty when neither. */
export function orderEmail(me: Member, typed: string, data: ClubData): string {
  const t = typed.trim();
  if (t) return t;
  return (data.privates ?? []).find((p) => p.memberId === me.id)?.email?.trim() ?? '';
}

export const ordersToday = (me: Member, data: ClubData, today: string): number =>
  (data.shopOrders ?? []).filter((o) => o.memberId === me.id && melbourneDate(o.orderedAt) === today).length;

/** Mirrors public.place_shop_order. A repeat clientRef is the first order again, so never a problem. */
export function placeShopOrderProblem(me: Member | null, input: PlaceOrderInput, data: ClubData, today: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if ((data.shopOrders ?? []).some((o) => o.memberId === me!.id && o.clientRef === input.clientRef)) return null;
  if (me!.status === 'legacy') return LEGACY;
  if (input.lines.length === 0) return EMPTY_CART;
  const lines = mergeLines(input.lines);
  if (lines.length > MAX_LINES) return TOO_MANY_LINES;
  for (const l of lines) {
    const problem = lineProblem(me!, l, data);
    if (problem) return problem;
  }
  if (!EMAIL.test(orderEmail(me!, input.email, data))) return BAD_EMAIL;
  if (length(input.phone.trim()) > MAX_PHONE) return LONG_PHONE;
  const delivery = deliveryProblem(input);
  if (delivery) return delivery;
  if (ordersToday(me!, data, today) >= DAILY_ORDERS) return DAILY;
  return null;
}

// Orders -----------------------------------------------------------------------------------------

/** The buyer, the people who run the shop and whoever keeps the Club fund's books. Mirrors private.sees_shop_order. */
export function seesShopOrder(me: Member | null, order: ShopOrder, data: ClubData): boolean {
  if (!approved(me)) return false;
  return order.memberId === me.id || runsShop(me, data) || keepsBooks(me, null, data.positions);
}

export const visibleShopOrders = (me: Member | null, data: ClubData): ShopOrder[] =>
  (data.shopOrders ?? []).filter((o) => seesShopOrder(me, o, data));

function orderFor(me: Member | null, id: string, data: ClubData): { problem: string } | { order: ShopOrder } {
  const signedIn = signedInProblem(me);
  if (signedIn) return { problem: signedIn };
  const order = visibleShopOrders(me, data).find((o) => o.id === id);
  return order ? { order } : { problem: NO_ORDER };
}

/** Mirrors public.pay_shop_order: the money in, as CR-005 in the Club fund. */
export function payShopOrderProblem(me: Member | null, id: string, paidOn: string, cents: number, data: ClubData, today: string): string | null {
  const found = orderFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (!keepsBooks(me, null, data.positions)) return KEEPS_ONLY;
  const { order } = found;
  if (order.status !== 'sent') return PAY_NEEDS_SENT;
  if (!isIsoDate(paidOn) || paidOn > today || paidOn < melbourneDate(order.orderedAt)) return PAID_DAY;
  if (!Number.isInteger(cents) || cents < 1 || cents > MAX_PAID_CENTS) return AMOUNT;
  if (order.memberId === me!.id) return OWN_PAYMENT;
  return null;
}

/** Mirrors public.hand_over_shop_order: posted for a shipped order, collected for a collected one. */
export function handOverShopOrderProblem(me: Member | null, id: string, data: ClubData): string | null {
  const found = orderFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (!runsShop(me, data)) return RUNS_SHOP_ONLY;
  return found.order.status === 'paid' ? null : HAND_OVER_NEEDS_PAID;
}

export const handedOverStatus = (order: ShopOrder): ShopOrderStatus => (order.delivery === 'ship' ? 'posted' : 'collected');

/** Mirrors public.cancel_shop_order. */
export function cancelShopOrderProblem(me: Member | null, id: string, data: ClubData): string | null {
  const found = orderFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (found.order.memberId !== me!.id && !runsShop(me, data)) return ONLY_BUYER_OR_SHOP;
  return found.order.status === 'held' || found.order.status === 'sent' ? null : CANT_CANCEL;
}

/** Mirrors public.resend_shop_order (the function posts a held order to Make again). */
export function resendShopOrderProblem(me: Member | null, id: string, data: ClubData): string | null {
  const found = orderFor(me, id, data);
  if ('problem' in found) return found.problem;
  if (!runsShop(me, data)) return RUNS_SHOP_ONLY;
  return found.order.status === 'held' ? null : RESEND_HELD_ONLY;
}

// Catalogue editing ------------------------------------------------------------------------------

function runsShopProblem(me: Member | null, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  return runsShop(me, data) ? null : RUNS_SHOP_ONLY;
}

/** Trimmed, in the order given. */
export const cleanList = (xs: string[]): string[] => xs.map((s) => s.trim());

const listProblem = (xs: string[], max: number, maxLength: number) =>
  xs.length > max || new Set(xs).size !== xs.length || xs.some((s) => !s || length(s) > maxLength);

export function setShopDesignProblem(me: Member | null, input: DesignInput, data: ClubData): string | null {
  const runs = runsShopProblem(me, data);
  if (runs) return runs;
  if (input.id !== null && !designOf(data, input.id)) return NO_DESIGN;
  const name = input.name.trim();
  if (!name) return NAME_IT;
  if (length(name) > MAX_NAME) return LONG_NAME;
  if (!ELIGIBILITIES.includes(input.eligibility)) return PICK_ELIGIBILITY;
  if (length(input.blurb.trim()) > MAX_BLURB) return LONG_BLURB;
  if (!Number.isInteger(input.sort)) return SORT_RULE;
  return null;
}

export function setShopGarmentProblem(me: Member | null, input: GarmentInput, data: ClubData): string | null {
  const runs = runsShopProblem(me, data);
  if (runs) return runs;
  if (!designOf(data, input.designId)) return NO_DESIGN;
  if (input.id !== null && garmentOf(data, input.id)?.designId !== input.designId) return NO_GARMENT;
  const name = input.name.trim();
  if (!name) return NAME_IT;
  if (length(name) > MAX_NAME) return LONG_NAME;
  if (!Number.isInteger(input.priceCents) || input.priceCents < 1 || input.priceCents > MAX_PRICE_CENTS) return PRICE_RULE;
  if (listProblem(cleanList(input.sizes), MAX_SIZES, MAX_SIZE)) return SIZES_RULE;
  if (listProblem(cleanList(input.colours), MAX_COLOURS, MAX_COLOUR)) return COLOURS_RULE;
  if (!Number.isInteger(input.sort)) return SORT_RULE;
  return null;
}

export function setShopShippingProblem(me: Member | null, input: ShippingInput, data: ClubData): string | null {
  const runs = runsShopProblem(me, data);
  if (runs) return runs;
  if (!(STATES as readonly string[]).includes(input.state.trim().toUpperCase())) return PICK_STATE;
  if (!SHIPPING_METHODS.includes(input.method)) return PICK_METHOD;
  if (!Number.isInteger(input.cents) || input.cents < 0 || input.cents > MAX_SHIPPING_CENTS) return SHIPPING_RULE;
  return null;
}

function namerProblem(me: Member | null, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  return holdsShopSeat(me, data.positions) ? null : NAMERS_ONLY;
}

/** An approved member who hasn't left (Legacy) can be named. */
export function nameShopRunnerProblem(me: Member | null, memberId: string, data: ClubData): string | null {
  const namer = namerProblem(me, data);
  if (namer) return namer;
  const target = data.members.find((m) => m.id === memberId);
  if (!target || target.approval !== 'approved' || target.status === 'legacy') return NO_MEMBER;
  if ((data.shopRunners ?? []).some((r) => r.memberId === memberId)) return ALREADY_RUNNER;
  return null;
}

export function unnameShopRunnerProblem(me: Member | null, memberId: string, data: ClubData): string | null {
  const namer = namerProblem(me, data);
  if (namer) return namer;
  return (data.shopRunners ?? []).some((r) => r.memberId === memberId) ? null : NOT_RUNNER;
}

/** Mirrors public.save_delivery_address: all four parts, or all empty to clear it. */
export function saveDeliveryAddressProblem(me: Member | null, a: AddressInput): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!a.street.trim() && !a.suburb.trim() && !a.state.trim() && !a.postcode.trim()) return null;
  return addressProblem(a);
}

// Money ------------------------------------------------------------------------------------------

export const orderTotalCents = (o: Pick<ShopOrder, 'subtotalCents' | 'shippingCents'>): number => o.subtotalCents + o.shippingCents;

/** The short reference shown on the ledger line and the screens: the first eight characters of the id. */
export const shopOrderRef = (o: Pick<ShopOrder, 'id'>): string => o.id.slice(0, 8).toUpperCase();

/** The CR-005 ledger line a paid order makes. Mirrors the SQL in pay_shop_order. */
export function shopLedgerDescription(order: ShopOrder, buyer: string): string {
  const items = order.lines
    .map((l) => {
      const opts = [l.size, l.colour].filter((x): x is string => !!x);
      return `${l.designName} ${l.garmentName}${opts.length ? ` (${opts.join(', ')})` : ''} ×${l.qty}`;
    })
    .join(', ');
  return `Shop order ${shopOrderRef(order)}: ${items} for ${buyer}`;
}

/** An order's lines as ledger-style words for an order with no lines loaded. */
export const linesSummary = (order: ShopOrder): string => order.lines.map((l) => `${l.garmentName} ×${l.qty}`).join(', ');
