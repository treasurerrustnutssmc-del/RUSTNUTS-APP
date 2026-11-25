import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blend,
  handleRideWeather,
  newCache,
  NO_FORECAST,
  parseAsk,
  parseWwLocation,
  precisCode,
  wwHours,
  type FetchJson,
} from '../../supabase/functions/_shared/rideWeather';

const DAY = '2026-11-27';
const HOURS = Array.from({ length: 24 }, (_, h) => `${DAY}T${String(h).padStart(2, '0')}:00`);

/** Open-Meteo's answer for one place: 24 hours, flat figures. */
const omPlace = (gust = 30) => ({
  hourly: {
    time: HOURS,
    temperature_2m: HOURS.map(() => 20),
    precipitation_probability: HOURS.map(() => 10),
    wind_gusts_10m: HOURS.map(() => gust),
    weather_code: HOURS.map(() => 1),
  },
});

/** WillyWeather's answer: hourly temperature, 3-hourly rain chance and precis, local times. */
const wwWeather = () => ({
  forecasts: {
    temperature: { days: [{ dateTime: `${DAY} 00:00:00`, entries: HOURS.map((h, i) => ({ dateTime: `${DAY} ${h.slice(11)}:00`, temperature: 10 + i })) }] },
    rainfallprobability: {
      days: [{ dateTime: `${DAY} 00:00:00`, entries: [2, 5, 8, 11, 14, 17, 20, 23].map((h) => ({ dateTime: `${DAY} ${String(h).padStart(2, '0')}:00:00`, probability: h === 14 ? 70 : 0 })) }],
    },
    precis: {
      days: [{ dateTime: `${DAY} 00:00:00`, entries: [2, 5, 8, 11, 14, 17, 20, 23].map((h) => ({ dateTime: `${DAY} ${String(h).padStart(2, '0')}:00:00`, precisCode: h === 14 ? 'thunderstorm' : 'fine' })) }],
    },
  },
});

test('the ask: one to five points in Australia and up to 16 days in a row', () => {
  const p = { lat: -37.8, lng: 144.9 };
  assert.deepEqual(parseAsk({ points: [p], days: [DAY] }), { points: [p], days: [DAY] });
  assert.equal(parseAsk({ points: [], days: [DAY] }), null);
  assert.equal(parseAsk({ points: Array(6).fill(p), days: [DAY] }), null);
  assert.equal(parseAsk({ points: [{ lat: 51.5, lng: -0.1 }], days: [DAY] }), null, 'London is not on a ride');
  assert.equal(parseAsk({ points: [p], days: ['2026-11-27', '2026-11-29'] }), null, 'days must run on');
  assert.equal(parseAsk({ points: [p], days: Array.from({ length: 17 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`) }), null);
  assert.equal(parseAsk({ points: [p], days: ['27/11/2026'] }), null);
  assert.equal(parseAsk(null), null);
});

test('a WillyWeather place counts only when it is near the point', () => {
  assert.equal(parseWwLocation({ location: { id: 13976, distance: 0 } }), 13976);
  assert.equal(parseWwLocation({ location: { id: 12247, distance: 5.6 } }), 12247);
  assert.equal(parseWwLocation({ location: { id: 1, distance: 80 } }), null, 'too far away to stand for the point');
  assert.equal(parseWwLocation({}), null);
  assert.equal(parseWwLocation(null), null);
});

test('precis words map onto the weather codes the card already reads', () => {
  assert.equal(precisCode('fine'), 0);
  assert.equal(precisCode('partly-cloudy'), 2);
  assert.equal(precisCode('cloudy'), 3);
  assert.equal(precisCode('shower-or-two'), 80);
  assert.equal(precisCode('showers-rain'), 63);
  assert.equal(precisCode('chance-thunderstorm-showers'), 95);
  assert.equal(precisCode('thunderstorm'), 95);
  assert.equal(precisCode('fog'), 45);
  assert.equal(precisCode('snow'), 73);
  assert.ok(Number.isNaN(precisCode('something-new')), 'an unknown word leaves the hour to Open-Meteo');
});

test('WillyWeather hours: temperature by the hour, 3-hourly rain and sky spread over their hour and the ones either side', () => {
  const h = wwHours(wwWeather());
  assert.equal(h.get(`${DAY}T00:00`)?.temp, 10);
  assert.equal(h.get(`${DAY}T23:00`)?.temp, 33);
  assert.equal(h.get(`${DAY}T13:00`)?.rain, 70);
  assert.equal(h.get(`${DAY}T14:00`)?.rain, 70);
  assert.equal(h.get(`${DAY}T15:00`)?.rain, 70);
  assert.equal(h.get(`${DAY}T16:00`)?.rain, 0);
  assert.equal(h.get(`${DAY}T14:00`)?.code, 95);
  assert.equal(h.get(`${DAY}T01:00`)?.code, 0);
  assert.equal(wwHours(null).size, 0);
});

test('blending: WillyWeather for temperature, rain and sky; gusts always from Open-Meteo; gaps from Open-Meteo', () => {
  const om = { time: HOURS, temp: HOURS.map(() => 20), rain: HOURS.map(() => 10), gust: HOURS.map(() => 45), code: HOURS.map(() => 1) };
  const ww = wwHours(wwWeather());
  ww.delete(`${DAY}T05:00`);
  const b = blend(om, ww);
  assert.equal(b.temp[3], 13);
  assert.equal(b.rain[14], 70);
  assert.equal(b.code[14], 95);
  assert.deepEqual(b.gust, om.gust);
  assert.equal(b.temp[5], 20, 'an hour WillyWeather left out keeps Open-Meteo');
  assert.equal(b.code[5], 1);
  // Nothing from WillyWeather: Open-Meteo as it was.
  assert.deepEqual(blend(om, new Map()), om);
});

/** A fake web: answers by which service and path was asked, and records each address. */
function fakeWeb(opts: { ww?: 'ok' | 'down' | 'far'; om?: 'ok' | 'down' } = {}) {
  const asked: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    asked.push(url);
    const u = new URL(url);
    if (u.hostname === 'api.open-meteo.com') {
      if (opts.om === 'down') throw new Error('500');
      const n = (u.searchParams.get('latitude') ?? '').split(',').length;
      return n === 1 ? omPlace() : Array.from({ length: n }, () => omPlace());
    }
    if (opts.ww === 'down') throw new Error('500');
    if (u.pathname.endsWith('/search.json')) return { location: { id: 13976, distance: opts.ww === 'far' ? 120 : 1 } };
    return wwWeather();
  };
  return { asked, fetchJson };
}

const ask = { points: [{ lat: -37.68, lng: 144.44 }, { lat: -37.35, lng: 144.14 }], days: [DAY] };

test('the server blends both for every point, and says the Bureau forecast was used', async () => {
  const web = fakeWeb();
  const a = await handleRideWeather({ WILLYWEATHER_API_KEY: 'k' }, ask, { fetchJson: web.fetchJson, cache: newCache() });
  assert.equal(a.status, 200);
  const body = a.body as { series: { temp: number[]; gust: number[] }[]; willy: boolean };
  assert.equal(body.series.length, 2);
  assert.equal(body.willy, true);
  assert.equal(body.series[0].temp[3], 13);
  assert.equal(body.series[1].gust[3], 30);
  // One Open-Meteo call for all points, gusts from the ECMWF model.
  const om = web.asked.filter((u) => u.includes('open-meteo'));
  assert.equal(om.length, 1);
  assert.equal(new URL(om[0]).searchParams.get('models'), 'ecmwf_ifs');
  // The key goes in WillyWeather's path, never to Open-Meteo.
  assert.ok(om.every((u) => !u.includes('/k/')));
  assert.ok(web.asked.some((u) => u.startsWith('https://api.willyweather.com.au/v2/k/locations/13976/weather.json')));
});

test('answers are kept for half an hour, and places for good', async () => {
  const web = fakeWeb();
  let now = 0;
  const deps = { fetchJson: web.fetchJson, now: () => now, cache: newCache() };
  const env = { WILLYWEATHER_API_KEY: 'k' };
  await handleRideWeather(env, ask, deps);
  const first = web.asked.length;
  now = 29 * 60_000;
  await handleRideWeather(env, ask, deps);
  assert.equal(web.asked.length, first, 'nothing asked again inside half an hour');
  now = 31 * 60_000;
  await handleRideWeather(env, ask, deps);
  assert.ok(!web.asked.slice(first).some((u) => u.includes('search.json')), 'places are not looked up again');
  assert.ok(web.asked.slice(first).some((u) => u.includes('weather.json')));
});

test('WillyWeather down, too far, or no key: Open-Meteo alone, and the answer says so', async () => {
  for (const [env, web] of [
    [{ WILLYWEATHER_API_KEY: 'k' }, fakeWeb({ ww: 'down' })],
    [{ WILLYWEATHER_API_KEY: 'k' }, fakeWeb({ ww: 'far' })],
    [{}, fakeWeb()],
  ] as const) {
    const a = await handleRideWeather(env, ask, { fetchJson: web.fetchJson, cache: newCache() });
    assert.equal(a.status, 200);
    const body = a.body as { series: { temp: number[] }[]; willy: boolean };
    assert.equal(body.willy, false);
    assert.equal(body.series[0].temp[3], 20);
  }
});

test('Open-Meteo down: no forecast (the phone then asks Open-Meteo itself); a bad ask is refused', async () => {
  const down = await handleRideWeather({ WILLYWEATHER_API_KEY: 'k' }, ask, { fetchJson: fakeWeb({ om: 'down' }).fetchJson, cache: newCache() });
  assert.equal(down.status, 503);
  assert.deepEqual(down.body, { error: NO_FORECAST });
  const bad = await handleRideWeather({ WILLYWEATHER_API_KEY: 'k' }, { points: [] }, { fetchJson: fakeWeb().fetchJson, cache: newCache() });
  assert.equal(bad.status, 400);
});
