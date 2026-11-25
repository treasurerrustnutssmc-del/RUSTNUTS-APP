// ride-weather: the ride card's forecast, for signed-in members (verify_jwt on). The Bureau of
// Meteorology's forecast through WillyWeather, with gusts from Open-Meteo (ECMWF). Needs the Edge
// Function secret WILLYWEATHER_API_KEY (the club's WillyWeather account); without it, or when
// WillyWeather doesn't answer, it gives Open-Meteo alone and says so.

import { handleRideWeather } from '../_shared/rideWeather.ts';

// The web build calls from the browser, which asks first (OPTIONS) and needs these headers back.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const TIMEOUT_MS = 8000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return Response.json({ error: 'POST the points and days.' }, { status: 405, headers: CORS });
  const body = await req.json().catch(() => null);
  const answer = await handleRideWeather({ WILLYWEATHER_API_KEY: Deno.env.get('WILLYWEATHER_API_KEY') }, body, {
    fetchJson: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
  });
  return Response.json(answer.body, { status: answer.status, headers: CORS });
});
