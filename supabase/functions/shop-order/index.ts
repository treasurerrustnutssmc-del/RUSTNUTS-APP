// shop-order: a member's club-shop order, saved in the app (public.place_shop_order, as the member,
// so the database decides) and sent to Chris's Make.com scenario "Rustnuts Merch Order Intake" in
// the exact shape his Discord bot uses. Deployed with verify_jwt ON. Needs the Edge Function secret
// MAKE_WEBHOOK_MEMBER_URL (the scenario's webhook address; Jeff pastes it, Claude may not type
// secrets); without it orders are kept as held and the shop resends them once it is set.
// Everything it decides is in ../_shared/shopOrder.ts, which `npm test` checks.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handleShopOrder, MAKE_TIMEOUT_MS, type OrderRow, type PlaceBody } from '../_shared/shopOrder.ts';

// The web build calls from the browser, which asks first (OPTIONS) and needs these headers back.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return Response.json({ error: 'POST an order.' }, { status: 405, headers: CORS });
  // As the member, so the database's rules decide who may order what.
  const asMember = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  // The service role only for shop_order_sent() (nobody else may call it).
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const body = await req.json().catch(() => null);
  const answer = await handleShopOrder({ MAKE_WEBHOOK_MEMBER_URL: Deno.env.get('MAKE_WEBHOOK_MEMBER_URL') }, body, {
    placeOrder: async (b: PlaceBody) => {
      const r = await asMember.rpc('place_shop_order', {
        p_client_ref: b.clientRef,
        p_lines: b.lines.map((l) => ({ garment_id: l.garmentId, size: l.size ?? null, colour: l.colour ?? null, qty: l.qty })),
        p_email: b.email ?? '',
        p_phone: b.phone ?? '',
        p_delivery: b.delivery,
        p_street: b.street ?? '',
        p_suburb: b.suburb ?? '',
        p_state: b.state ?? '',
        p_postcode: b.postcode ?? '',
        p_shipping_method: b.shippingMethod ?? null,
        p_save_address: b.saveAddress ?? false,
      });
      if (r.error) throw new Error(r.error.message);
      return r.data as OrderRow;
    },
    resend: async (orderId) => {
      const r = await asMember.rpc('resend_shop_order', { p_order: orderId });
      if (r.error) throw new Error(r.error.message);
      return r.data as OrderRow;
    },
    post: async (url, payload) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(MAKE_TIMEOUT_MS),
      });
      return { ok: r.ok, status: r.status, text: await r.text().catch(() => '') };
    },
    sent: async (orderId, ok, error) => {
      const r = await admin.rpc('shop_order_sent', { p_order: orderId, p_ok: ok, p_error: error });
      if (r.error) console.error('shop_order_sent', r.error.message);
    },
  });
  return Response.json(answer.body, { status: answer.status, headers: CORS });
});
