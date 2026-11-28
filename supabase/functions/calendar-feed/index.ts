// calendar-feed: a member's own ride calendar, for Google, Outlook or Apple Calendar to subscribe to.
// Deployed with JWT checks OFF (calendar apps can't sign in): GET /calendar-feed/<token>.ics. The
// token is the key, unguessable and private to one member (public.my_calendar_link); a new one
// (public.new_calendar_link) stops the old. Everything it does is decided in
// ../_shared/rideCalendarFeed.ts, which `npm test` checks; public.calendar_feed, which only the
// service role may call, picks the rides. Spec: docs/superpowers/specs/2026-11-28-personal-ride-calendar-design.md.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { feedPath, handleCalendarFeed, type FeedRide } from '../_shared/rideCalendarFeed.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const path = feedPath(new URL(req.url).pathname);
  const out = await handleCalendarFeed(
    { method: req.method, path },
    {
      feed: async (token) => {
        const r = await admin.rpc('calendar_feed', { p_token: token });
        if (r.error) throw new Error(r.error.message);
        return (r.data ?? null) as FeedRide[] | null;
      },
    },
    new Date().toISOString(),
  );
  return new Response(out.body || null, { status: out.status, headers: out.headers });
});
