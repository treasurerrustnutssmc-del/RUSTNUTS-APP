// ride-weather: the ride card's forecast, for signed-in members (verify_jwt on). The Bureau of
// Meteorology's forecast through WillyWeather, with gusts from Open-Meteo (ECMWF). Never log errors
// here: WillyWeather's addresses carry the club's key. Needs the Edge
// Function secret WILLYWEATHER_API_KEY (the club's WillyWeather account); without it, or when
// WillyWeather doesn't answer, it gives Open-Meteo alone and says so.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handleRideWeather } from '../_shared/rideWeather.ts';

// The web build calls from the browser, which asks first (OPTIONS) and needs these headers back.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

// Each outside request; with WillyWeather's 4 s in all, the answer stays inside the phone's 12 s wait.
const TIMEOUT_MS = 6000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return Response.json({ error: 'POST the points and days.' }, { status: 405, headers: CORS });
  const body = await req.json().catch(() => null);
  // The gateway lets the app's public key through too; only a signed-in member gets an answer.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const answer = await handleRideWeather({ WILLYWEATHER_API_KEY: Deno.env.get('WILLYWEATHER_API_KEY') }, body, {
    userId: async () => (await db.auth.getUser()).data.user?.id ?? null,
    fetchJson: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
  });
  return Response.json(answer.body, { status: answer.status, headers: CORS });
});
