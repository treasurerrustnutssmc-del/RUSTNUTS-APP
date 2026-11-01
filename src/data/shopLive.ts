// The club shop's live reads (merch_catalogue() and shop_orders(), snake_case JSON) as the app's
// shop data, and the shop-order Edge Function's body and refusals.
// Spec: docs/superpowers/specs/2026-11-01-in-app-merch-ordering-design.md (pieces 3 and 4).

import type { PlaceOrderInput, AddressInput } from '../domain/shop';
import type {
  ShippingMethod, ShopData, ShopDelivery, ShopEligibility, ShopOrder, ShopOrderStatus,
} from '../domain/types';
import type { PlaceBody } from '../../supabase/functions/_shared/shopOrder';

type Ts = string;
type Id = string;
type Cents = number | string;

export interface CatalogueJson {
  designs: {
    id: Id; name: string; eligibility: ShopEligibility; blurb: string | null; sort: number; on_sale: boolean; updated_by: Id | null;
    updated_at: Ts; problem: string | null;
    garments: {
      id: Id; design_id: Id; name: string; price_cents: Cents; sizes: string[] | null; colours: string[] | null; sort: number;
      on_sale: boolean;
    }[] | null;
  }[];
  shipping: { state: string; method: ShippingMethod; cents: Cents }[];
  address: AddressInput | null;
  runners?: { member_id: Id; named_by: Id | null; named_on: string }[];
  runs_shop: boolean;
}

export interface OrderJson {
  id: Id; member_id: Id; client_ref: string; buyer_name: string; road_name: string | null; email: string; phone: string | null;
  delivery: ShopDelivery; street: string | null; suburb: string | null; state: string | null; postcode: string | null;
  shipping_method: ShippingMethod | null; subtotal_cents: Cents; shipping_cents: Cents; status: ShopOrderStatus;
  make_sent_at: Ts | null; make_error: string | null; paid_on: string | null; paid_cents: Cents | null; ledger_entry_id: Id | null;
  handed_over_on: string | null; cancelled_at: Ts | null; cancelled_by: Id | null; ordered_at: Ts;
  lines: {
    id: Id; order_id: Id; garment_id: Id | null; design_name: string; garment_name: string; size: string | null; colour: string | null;
    qty: number; unit_cents: Cents;
  }[] | null;
}

/** The shop as the app holds it, plus the two things only the catalogue read knows. */
export interface LiveShop extends Required<ShopData> {
  /** The signed-in member's saved delivery address, or null. */
  address: AddressInput | null;
  /** The database's own answer to "runs the shop" (seats and named runners). */
  runsShop: boolean;
}

const instant = (ts: Ts) => new Date(ts).toISOString();
const maybeInstant = (ts: Ts | null | undefined) => (ts ? instant(ts) : null);
const list = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
const num = (n: Cents) => Number(n);
const objectOf = <T,>(v: unknown): T | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null);

export function toShop(catalogue: CatalogueJson | null | undefined, orders: OrderJson[] | null | undefined): LiveShop {
  const c = objectOf<CatalogueJson>(catalogue);
  const designs = list(c?.designs);
  const address = objectOf<AddressInput>(c?.address);
  return {
    shopDesigns: designs.map((d) => ({
      id: d.id, name: d.name, eligibility: d.eligibility, blurb: d.blurb ?? '', sort: d.sort, onSale: d.on_sale,
      updatedBy: d.updated_by, updatedAt: instant(d.updated_at),
    })),
    shopGarments: designs.flatMap((d) =>
      list(d.garments).map((g) => ({
        id: g.id, designId: g.design_id, name: g.name, priceCents: num(g.price_cents), sizes: list(g.sizes), colours: list(g.colours),
        sort: g.sort, onSale: g.on_sale,
      })),
    ),
    shopShipping: list(c?.shipping).map((s) => ({ state: s.state, method: s.method, cents: num(s.cents) })),
    shopRunners: list(c?.runners).map((r) => ({ memberId: r.member_id, namedBy: r.named_by, namedOn: r.named_on })),
    shopOrders: list(orders).map(toOrder),
    address: address ? { street: address.street, suburb: address.suburb, state: address.state, postcode: address.postcode } : null,
    runsShop: c?.runs_shop === true,
  };
}

function toOrder(o: OrderJson): ShopOrder {
  return {
    id: o.id, memberId: o.member_id, clientRef: o.client_ref, buyerName: o.buyer_name, roadName: o.road_name, email: o.email,
    phone: o.phone, delivery: o.delivery, street: o.street, suburb: o.suburb, state: o.state, postcode: o.postcode,
    shippingMethod: o.shipping_method, subtotalCents: num(o.subtotal_cents), shippingCents: num(o.shipping_cents), status: o.status,
    makeSentAt: maybeInstant(o.make_sent_at), makeError: o.make_error, paidOn: o.paid_on, paidCents: o.paid_cents === null ? null : num(o.paid_cents),
    ledgerEntryId: o.ledger_entry_id, handedOverOn: o.handed_over_on, cancelledAt: maybeInstant(o.cancelled_at),
    cancelledBy: o.cancelled_by, orderedAt: instant(o.ordered_at),
    lines: list(o.lines).map((l) => ({
      id: l.id, orderId: l.order_id, garmentId: l.garment_id, designName: l.design_name, garmentName: l.garment_name, size: l.size,
      colour: l.colour, qty: l.qty, unitCents: num(l.unit_cents),
    })),
  };
}

/** What the phone sends the shop-order function: trimmed, and no address on an order to collect. */
export function placeOrderBody(input: PlaceOrderInput): PlaceBody {
  const ship = input.delivery === 'ship';
  return {
    clientRef: input.clientRef,
    lines: input.lines.map((l) => ({ garmentId: l.garmentId, size: l.size, colour: l.colour, qty: l.qty })),
    email: input.email.trim(),
    phone: input.phone.trim(),
    delivery: input.delivery,
    street: ship ? input.street.trim() : '',
    suburb: ship ? input.suburb.trim() : '',
    state: ship ? input.state.trim().toUpperCase() : '',
    postcode: ship ? input.postcode.trim() : '',
    shippingMethod: ship ? input.shippingMethod : null,
    saveAddress: ship && input.saveAddress,
  };
}

export const SHOP_NEEDS_SIGNAL = 'Sending the order needs signal. Your cart is kept; try again.';
export const SHOP_CANT_SEND = 'The order couldn’t be sent right now. Your cart is kept; try again in a minute.';

/** The words for a failed call: the function's own (the database's refusal), or no signal, or try later. */
export async function shopFunctionWords(error: unknown): Promise<string> {
  const name = (error as { name?: string })?.name;
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return SHOP_NEEDS_SIGNAL;
  const context = (error as { context?: Response })?.context;
  if (!context) return SHOP_NEEDS_SIGNAL;
  const said = (await context.json?.().catch(() => null)) as { error?: unknown } | null;
  return typeof said?.error === 'string' && said.error ? said.error : SHOP_CANT_SEND;
}
