// link-preview: the card under a link in a chat (site, title, short description, picture), read
// from the page's Open Graph tags. Called by signed-in members only (JWT checked); each link is
// fetched at most once a week and kept in private.link_previews.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { fetchableUrl, fetchPreview, TIMEOUT_MS } from '../_shared/linkPreview.ts';

// The web build calls from the browser, which asks first (OPTIONS) and needs these headers back.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST a url.' }, 405);
  const { url: raw } = await req.json().catch(() => ({ url: null }));
  const url = typeof raw === 'string' ? fetchableUrl(raw) : null;
  if (!url) return json({ preview: null });

  // As the member: are they allowed, and is there a recent copy?
  const asMember = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const kept = await asMember.rpc('link_preview', { p_url: url.toString() });
  if (kept.error) return json({ error: kept.error.message }, 403);
  if (kept.data?.found) return json({ preview: kept.data.preview });

  // One time limit for the whole job: name lookups, every hop and the reading.
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let preview;
  try {
    preview = await fetchPreview(url.toString(), {
      resolve: async (host) => {
        const [a, aaaa] = await Promise.all([
          Deno.resolveDns(host, 'A', { signal: deadline }).catch(() => [] as string[]),
          Deno.resolveDns(host, 'AAAA', { signal: deadline }).catch(() => [] as string[]),
        ]);
        return [...a, ...aaaa];
      },
      get: (u, signal) =>
        fetch(u, {
          redirect: 'manual',
          signal,
          headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'RustnutsLinkPreview/1.0' },
        }),
    }, deadline);
  } catch {
    // Slow or unreachable: no card this time, and nothing kept, so the app asks again later.
    return json({ error: 'No answer from that site.' }, 503);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  await admin.rpc('save_link_preview', { p_url: url.toString(), p_preview: preview });
  return json({ preview });
});
