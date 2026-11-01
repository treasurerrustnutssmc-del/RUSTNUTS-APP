// site-api: the club website's one door into the app. Deployed with JWT checks OFF (the website has
// no sign-in): GET /site-api/sponsors gives the public sponsor list, GET /site-api/rides the public
// ride list, POST /site-api/enquiry takes a
// "Ride With Us" join enquiry. Everything it does is decided in ../_shared/siteApi.ts, which
// `npm test` checks; the database checks the enquiry again (public.site_enquiry) and keeps the
// spam limits. Only the club website's origins get CORS headers.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handleSiteApi, LOGO_URL_LIFE_S, type PublicRide, type SponsorRow } from '../_shared/siteApi.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // The path after the function's own name: /site-api/sponsors -> /sponsors.
  const path = url.pathname.replace(/^\/+site-api(?=\/|$)/, '') || '/';

  // As anon: list_sponsors() hides the member deals, the same as a signed-out phone.
  const asAnon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
  });
  // The service role only for site_enquiry() (nobody else may call it) and for signing logo links.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
  const out = await handleSiteApi(
    { method: req.method, path, origin: req.headers.get('origin'), body },
    {
      listSponsors: async () => {
        const r = await asAnon.rpc('list_sponsors');
        if (r.error) throw new Error(r.error.message);
        return (r.data ?? []) as SponsorRow[];
      },
      listRides: async () => {
        const r = await asAnon.rpc('public_rides');
        if (r.error) throw new Error(r.error.message);
        return (r.data ?? []) as PublicRide[];
      },
      signLogo: async (logoPath) => {
        const r = await admin.storage.from('sponsor-logos').createSignedUrl(logoPath, LOGO_URL_LIFE_S);
        return r.error ? null : r.data.signedUrl;
      },
      enquire: async (e) => {
        const r = await admin.rpc('site_enquiry', { p_name: e.name, p_email: e.email, p_chapter: e.chapter, p_about: e.about });
        return r.error ? r.error.message : null;
      },
    },
  );
  if (out.status === 204) return new Response(null, { status: 204, headers: out.headers });
  return Response.json(out.body, { status: out.status, headers: out.headers });
});
