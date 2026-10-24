// sync-rides: reads the club website's calendar feeds into public.rides. Runs every 15 minutes
// (see migration 20261024120100_ride_sync_schedule.sql) and can be run by hand. Deployed without
// JWT checks: a call can only re-read the feeds an admin set up, nothing else.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { syncAllFeeds, type Feed } from '../_shared/syncRides.ts';

const FETCH_TIMEOUT_MS = 20_000;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`The calendar answered ${res.status}`);
  return await res.text();
}

Deno.serve(async () => {
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
