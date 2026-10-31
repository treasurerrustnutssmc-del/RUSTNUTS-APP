// purge-files: deletes from Storage the files the database queued when a member deleted their account
// (private.storage_purge, filled by private.forget_member). Runs every ten minutes (see migration
// 20270620000000_storage_purge.sql). Deployed with verify_jwt off, like send-push: a call can only
// delete what the database has queued. With the CRON_SECRET secret set, a call must carry it too.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { purgeAll, type QueuedFile } from '../_shared/purgeFiles.ts';
import { CRON_HEADER, cronCallAllowed } from '../_shared/cronAuth.ts';

Deno.serve(async (req) => {
  if (!cronCallAllowed(req.headers.get(CRON_HEADER), Deno.env.get('CRON_SECRET'))) {
    return Response.json({ error: 'Not allowed.' }, { status: 401 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  try {
    const result = await purgeAll({
      take: async (limit) => {
        const r = await db.rpc('purge_take', { p_limit: limit });
        if (r.error) throw new Error(r.error.message);
        return (r.data ?? []) as QueuedFile[];
      },
      remove: async (bucket, paths) => {
        // A path Storage no longer has isn't an error here: remove just leaves it out of its answer.
        const r = await db.storage.from(bucket).remove(paths);
        if (r.error) throw new Error(r.error.message);
      },
      done: async (done, failed) => {
        const r = await db.rpc('purge_done', { p_done: done, p_failed: failed });
        if (r.error) throw new Error(r.error.message);
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
