// The shop-order Edge Function's logic, without the network or the database (both are passed in),
// so `npm test` runs exactly what the function runs. A member's cart goes to place_shop_order()
// (the database enforces every rule and the clientRef idempotency), the saved order is turned into
// the payload Chris's Discord bot sends his Make.com scenario "Rustnuts Merch Order Intake" (the old
// Jotform shape, wrapped as a rawRequest JSON string), POSTed to MAKE_WEBHOOK_MEMBER_URL, and the
// order is marked sent (or kept held with the error, so an order is never lost when Make is down).
// Spec: docs/superpowers/specs/2026-11-01-in-app-merch-ordering-design.md.

export const NOT_SWITCHED_ON = 'MAKE_WEBHOOK_MEMBER_URL is not set.';
export const SEND_AGAIN = 'Something went wrong sending the order. Try again.';
export const START_AGAIN = 'Start the order again.';
export const HELD_MESSAGE = 'We’ve kept your order; the shop will send it on.';
export const SENT_MESSAGE = 'Order sent. Your invoice with the club’s bank details is on its way.';
/** What Make's datastore and sheet expect in q16_deliveryMethod. */
export const DELIVERY_LABEL = { ship: 'Ship to me', collect: 'Collect at next club meeting' } as const;
/** What Make's datastore key STATE_METHOD expects in q22_shippingMethod. */
export const SHIPPING_LABEL = { standard: 'Standard', express: 'Express' } as const;
/** Make gets this long to answer before the order is kept as held. */
export const MAKE_TIMEOUT_MS = 20_000;

export interface OrderLineRow {
  id: string;
  order_id: string;
  garment_id: string | null;
  design_name: string;
  garment_name: string;
  size: string | null;
  colour: string | null;
  qty: number;
  unit_cents: number;
}

/** A shop_orders row with its lines, as place_shop_order() and resend_shop_order() return it. */
export interface OrderRow {
  id: string;
  member_id: string;
  client_ref: string;
  buyer_name: string;
  road_name: string | null;
  email: string;
  phone: string | null;
  delivery: 'ship' | 'collect';
  street: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  shipping_method: 'standard' | 'express' | null;
  subtotal_cents: number;
  shipping_cents: number;
  status: 'held' | 'sent' | 'paid' | 'posted' | 'collected' | 'cancelled';
  make_sent_at: string | null;
  make_error: string | null;
  lines: OrderLineRow[];
  /** From place_shop_order: true when this call made the order; false when the clientRef was seen before. */
  created?: boolean;
}

/** What the phone sends: a cart to place, or a held order to send again. */
export interface PlaceBody {
  clientRef: string;
  lines: { garmentId: string; size: string | null; colour: string | null; qty: number }[];
  email?: string;
  phone?: string;
  delivery: 'ship' | 'collect';
  street?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  shippingMethod?: 'standard' | 'express' | null;
  saveAddress?: boolean;
}
export interface ResendBody {
  resend: string;
}

export interface MakeProduct {
  productName: string;
  quantity: number;
  productOptions: string[];
}

/** The fields Make's scenario reads out of rawRequest (module 2, json:ParseJSON). */
export interface MakeOrder {
  q3_name: { first: string; last: string };
  q4_email: string;
  q17_roadName: string;
  q15_phoneNumber: { area: string; phone: string };
  q11_myProducts: { products: MakeProduct[]; totalInfo: { totalSum: number } };
  q16_deliveryMethod: string;
  q18_streetAddress: string;
  q19_suburb: string;
  q20_state: string;
  q21_postcode: string;
  q22_shippingMethod: string;
}

export interface ShopOrderDeps {
  /** public.place_shop_order as the member; throws Error(message) with the database's words. */
  placeOrder: (b: PlaceBody) => Promise<OrderRow>;
  /** public.resend_shop_order as the member; throws Error(message) with the database's words. */
  resend: (orderId: string) => Promise<OrderRow>;
  /** POST the payload to Make. Throws on a network failure. */
  post: (url: string, payload: { rawRequest: string }) => Promise<{ ok: boolean; status: number; text: string }>;
  /** public.shop_order_sent with the service role. */
  sent: (orderId: string, ok: boolean, error: string | null) => Promise<void>;
}

export interface ShopOrderEnv {
  MAKE_WEBHOOK_MEMBER_URL?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** First word and the rest, as the bot's q3_name has it. */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/** Make reads the products as "<name> - <qty>x (<options>)" and sums totalSum (in dollars). */
export function makeOrder(o: OrderRow): MakeOrder {
  const ship = o.delivery === 'ship';
  return {
    q3_name: splitName(o.buyer_name),
    q4_email: o.email,
    q17_roadName: o.road_name ?? '',
    q15_phoneNumber: { area: '', phone: o.phone ?? '' },
    q11_myProducts: {
      products: o.lines.map((l) => ({
        productName: `${l.design_name} ${l.garment_name}`,
        quantity: l.qty,
        productOptions: [l.size, l.colour].filter((x): x is string => !!x),
      })),
      totalInfo: { totalSum: Math.round(o.subtotal_cents) / 100 },
    },
    q16_deliveryMethod: DELIVERY_LABEL[o.delivery],
    q18_streetAddress: ship ? o.street ?? '' : '',
    q19_suburb: ship ? o.suburb ?? '' : '',
    q20_state: ship ? o.state ?? '' : '',
    q21_postcode: ship ? o.postcode ?? '' : '',
    q22_shippingMethod: ship && o.shipping_method ? SHIPPING_LABEL[o.shipping_method] : '',
  };
}

/** The webhook body: the bot's rawRequest JSON string. */
export const makePayload = (o: OrderRow): { rawRequest: string } => ({ rawRequest: JSON.stringify(makeOrder(o)) });

export interface Answer {
  status: number;
  body: { orderId?: string; status?: OrderRow['status']; message?: string; error?: string };
}

const isPlace = (b: unknown): b is PlaceBody =>
  !!b && typeof b === 'object' && typeof (b as PlaceBody).clientRef === 'string' && Array.isArray((b as PlaceBody).lines)
  && (b as PlaceBody).lines.every((l) => !!l && typeof l === 'object');
const isResend = (b: unknown): b is ResendBody => !!b && typeof b === 'object' && typeof (b as ResendBody).resend === 'string';

/** Posts a held order to Make and records the outcome. Never throws: a failure keeps the order held. */
async function send(order: OrderRow, env: ShopOrderEnv, deps: ShopOrderDeps): Promise<Answer> {
  const url = env.MAKE_WEBHOOK_MEMBER_URL;
  if (!url) {
    await deps.sent(order.id, false, NOT_SWITCHED_ON);
    return { status: 200, body: { orderId: order.id, status: 'held', message: HELD_MESSAGE } };
  }
  let error: string;
  try {
    const r = await deps.post(url, makePayload(order));
    if (r.ok) {
      await deps.sent(order.id, true, null);
      return { status: 200, body: { orderId: order.id, status: 'sent', message: SENT_MESSAGE } };
    }
    error = `Make answered ${r.status}: ${r.text.slice(0, 200)}`;
  } catch (e) {
    error = `Make unreachable: ${(e as Error).message}`.slice(0, 300);
  }
  await deps.sent(order.id, false, error);
  return { status: 200, body: { orderId: order.id, status: 'held', message: HELD_MESSAGE } };
}

/**
 * The whole function. A cart: place_shop_order (the database decides), then send only when this call
 * made the order (a repeat clientRef comes straight back as it stands, so a double tap or a retry
 * while Make is still answering never posts twice). A resend: resend_shop_order (shop runners, held
 * only), then send. Refusals come back as 400 with the database's words.
 */
export async function handleShopOrder(env: ShopOrderEnv, body: unknown, deps: ShopOrderDeps): Promise<Answer> {
  let order: OrderRow;
  let fresh = true;
  try {
    if (isResend(body)) {
      if (!UUID.test(body.resend)) return { status: 400, body: { error: 'No such order.' } };
      order = await deps.resend(body.resend);
    } else if (isPlace(body)) {
      if (!UUID.test(body.clientRef)) return { status: 400, body: { error: START_AGAIN } };
      order = await deps.placeOrder(body);
      fresh = order.created === true;
    } else {
      return { status: 400, body: { error: START_AGAIN } };
    }
  } catch (e) {
    return { status: 400, body: { error: (e as Error).message || SEND_AGAIN } };
  }
  if (order.status !== 'held') return { status: 200, body: { orderId: order.id, status: order.status } };
  if (!fresh) return { status: 200, body: { orderId: order.id, status: 'held', message: HELD_MESSAGE } };
  return send(order, env, deps);
}
