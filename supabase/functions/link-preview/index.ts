// link-preview: the card under a link in a chat (site, title, short description, picture), read
// from the page's Open Graph tags. Called by signed-in members only (JWT checked); each link is
// fetched at most once a week and kept in private.link_previews.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { fetchableUrl, fetchPreview, TIMEOUT_MS } from '../_shared/linkPreview.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(async (req) => {
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

  const preview = await fetchPreview(url.toString(), {
    resolve: async (host) => {
      const [a, aaaa] = await Promise.all([
        Deno.resolveDns(host, 'A').catch(() => [] as string[]),
        Deno.resolveDns(host, 'AAAA').catch(() => [] as string[]),
      ]);
      return [...a, ...aaaa];
    },
    get: (u) =>
      fetch(u, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'RustnutsLinkPreview/1.0' },
      }),
  }).catch(() => null);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  await admin.rpc('save_link_preview', { p_url: url.toString(), p_preview: preview });
  return json({ preview });
});
