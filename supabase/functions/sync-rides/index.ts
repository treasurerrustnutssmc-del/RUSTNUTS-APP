// sync-rides: reads the club website's calendar feeds into public.rides. Runs every 15 minutes
// (see migration 20261024120100_ride_sync_schedule.sql) and can be run by hand. Deployed without
// JWT checks: a call can only re-read the feeds an admin set up, nothing else. With the CRON_SECRET
// secret set, a call must carry it in an x-cron-secret header too (the scheduled calls do, through
// private.cron_headers(); by hand, run the same net.http_post in the SQL editor; see migration
// 20270630000000_cron_secret.sql).

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { syncAllFeeds, type Feed } from '../_shared/syncRides.ts';
import { CRON_HEADER, cronCallAllowed } from '../_shared/cronAuth.ts';

const FETCH_TIMEOUT_MS = 20_000;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`The calendar answered ${res.status}`);
  return await res.text();
}

Deno.serve(async (req) => {
  if (!cronCallAllowed(req.headers.get(CRON_HEADER), Deno.env.get('CRON_SECRET'))) {
    return Response.json({ error: 'Not allowed.' }, { status: 401 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const feeds = await db.rpc('ride_feeds_for_sync');
  if (feeds.error) return Response.json({ error: feeds.error.message }, { status: 500 });

  const result = await syncAllFeeds({
    feeds: (feeds.data ?? []) as Feed[],
    fetchText,
    apply: async (feedId, events) => {
      const r = await db.rpc('apply_ride_sync', { p_feed: feedId, p_events: events });
      if (r.error) throw new Error(r.error.message);
    },
    recordError: async (feedId, message) => {
      await db.rpc('record_ride_sync_error', { p_feed: feedId, p_error: message });
    },
    now: new Date(),
  });
  return Response.json(result);
});
