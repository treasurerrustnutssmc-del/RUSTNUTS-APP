// send-push: sends what's waiting in the push outbox to members' phones through Expo's push service.
// Runs every minute (see migration 20270201020000_push.sql). Deployed with verify_jwt off, like
// sync-rides: a call can only send what the database has queued, and while the master switch
// (private.app_settings 'push_enabled') is off the database holds everything and nothing is sent.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { sendAll, type ExpoTicket, type OutboxMessage } from '../_shared/sendPush.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  try {
    const result = await sendAll({
      take: async () => {
        const r = await db.rpc('push_take', { p_limit: 500 });
        if (r.error) throw new Error(r.error.message);
        return r.data as { enabled: boolean; messages: OutboxMessage[] };
      },
      post: async (batch) => {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`Expo answered ${res.status}`);
        return ((await res.json()).data ?? []) as ExpoTicket[];
      },
      done: async (sent, failed, dead) => {
        const r = await db.rpc('push_done', { p_sent: sent, p_failed: failed, p_dead_tokens: dead });
        if (r.error) throw new Error(r.error.message);
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
