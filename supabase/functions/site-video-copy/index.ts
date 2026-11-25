// site-video-copy: copies approved website videos to the club's Cloudflare R2 storage and deletes
// taken-down ones there (rules in ../_shared/siteVideoCopy.ts). Called by the database when a
// website video goes live or comes down (private.video_copy_kick), with the cron secret. Deployed
// with verify_jwt off, like purge-files: it only does what the database lists.
// Secrets: CRON_SECRET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { CRON_HEADER, cronCallAllowed } from '../_shared/cronAuth.ts';
import { copyVideos, type VideoJob } from '../_shared/siteVideoCopy.ts';

Deno.serve(async (req) => {
  if (!cronCallAllowed(req.headers.get(CRON_HEADER), Deno.env.get('CRON_SECRET'))) {
    return Response.json({ error: 'Not allowed.' }, { status: 401 });
  }
  const account = Deno.env.get('R2_ACCOUNT_ID');
  const bucket = Deno.env.get('R2_BUCKET');
  const base = Deno.env.get('R2_PUBLIC_BASE');
  const keyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secret = Deno.env.get('R2_SECRET_ACCESS_KEY');
  if (!account || !bucket || !base || !keyId || !secret) {
    return Response.json({ error: 'Cloudflare storage is not set up yet.' }, { status: 503 });
  }
  const r2 = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: 's3', region: 'auto' });
  const endpoint = `https://${account}.r2.cloudflarestorage.com/${bucket}`;
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const rpc = async <T>(fn: string, args?: Record<string, unknown>) => {
    const r = await db.rpc(fn, args);
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };
  try {
    const result = await copyVideos({
      base: base.replace(/\/$/, ''),
      jobs: async () => (await rpc<VideoJob[]>('video_copy_jobs')) ?? [],
      download: async (path) => {
        const r = await db.storage.from('chat-media').download(path);
        if (r.error || !r.data) throw new Error(r.error?.message ?? 'not found');
        return new Uint8Array(await r.data.arrayBuffer());
      },
      used: async () => {
        let total = 0;
        let token: string | null = null;
        do {
          const q = new URLSearchParams({ 'list-type': '2', 'max-keys': '1000' });
          if (token) q.set('continuation-token', token);
          const res = await r2.fetch(`${endpoint}?${q}`);
          if (!res.ok) throw new Error(`R2 list ${res.status}`);
          const xml = await res.text();
          for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) total += Number(m[1]);
          token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? null : null;
        } while (token);
        return total;
      },
      put: async (key, bytes, contentType) => {
        const res = await r2.fetch(`${endpoint}/${key}`, { method: 'PUT', body: bytes, headers: { 'content-type': contentType } });
        if (!res.ok) throw new Error(`R2 put ${res.status}`);
      },
      remove: async (key) => {
        const res = await r2.fetch(`${endpoint}/${key}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error(`R2 delete ${res.status}`);
      },
      done: async (id, videoUrl, posterUrl) => {
        return (await rpc<boolean>('video_copy_done', { p_id: id, p_video_url: videoUrl, p_poster_url: posterUrl })) === true;
      },
      cleared: async (id) => {
        await rpc('video_copy_cleared', { p_id: id });
      },
      failed: async (id) => {
        await rpc('video_copy_failed', { p_id: id });
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
