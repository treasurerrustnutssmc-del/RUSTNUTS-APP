import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSeries, forecastSource, rideForecast, serverSource, type Fetcher } from './weather';
import type { ClubData, Ride, Route } from '../domain/types';

const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r-1',
  title: 'Run',
  startsAt: '2026-11-06T21:30:00.000Z',
  endsAt: '2026-11-07T01:00:00.000Z',
  allDay: false,
  location: 'Maccas, Bacchus Marsh VIC 3340',
  notes: null,
  category: 'west',
  cancelledAt: null,
  ...over,
});

const loop: Route = {
  id: 'rt',
  name: 'Loop',
  chapterId: null,
  notes: '',
  distanceM: 0,
  climbM: null,
  line: [[-37.85, 144.77], [-37.35, 144.14], [-37.85, 144.77]],
  stops: [],
  bounds: { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 },
  archivedAt: null,
  updatedAt: '2026-10-01T00:00:00Z',
};

const data = (over: Partial<ClubData> = {}) => ({ routes: [], rideRoutes: [], ...over }) as unknown as ClubData;

const HOURS = ['2026-11-07T08:00', '2026-11-07T09:00', '2026-11-07T10:00', '2026-11-07T11:00', '2026-11-07T12:00'];
const place = () => ({
  hourly: { time: HOURS, temperature_2m: [10, 12, 14, 15, 16], precipitation_probability: [0, 5, 10, 5, 0], wind_gusts_10m: [20, 25, 30, 25, 20], weather_code: [1, 2, 2, 3, 2] },
});

function fakeFetch(answers: Record<string, unknown>): Fetcher & { asked: string[] } {
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(url);
    const u = new URL(url);
    const key = u.hostname.startsWith('geocoding') ? `geo:${u.searchParams.get('name')}` : 'forecast';
    if (!(key in answers)) return { ok: true, status: 200, json: async () => ({}) };
    const a = answers[key];
    if (a === 500) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => a };
  }) as Fetcher & { asked: string[] };
  f.asked = asked;
  return f;
}

test('a ride with a route asks once, for its points', async () => {
  const f = fakeFetch({ forecast: [place()] });
  const source = forecastSource(f);
  const r = await rideForecast(ride(), data({ routes: [loop], rideRoutes: [{ rideId: 'r-1', routeId: 'rt' }] }), '2026-11-01', source);
  assert.equal(r.kind, 'ready');
  if (r.kind !== 'ready') return;
  assert.deepEqual(r.view.rows.map((x) => x.label), ['Start and finish']);
  assert.equal(f.asked.length, 1);
  assert.equal(r.place, null);
});

test('a ride with only a location looks it up, guess by guess, then asks for the forecast', async () => {
  const f = fakeFetch({
    'geo:Bacchus Marsh': { results: [{ name: 'Bacchus Marsh', latitude: -37.67, longitude: 144.43 }] },
    forecast: place(),
  });
  const r = await rideForecast(ride({ location: 'Maccas, 12 Main St, Bacchus Marsh VIC 3340' }), data(), '2026-11-01', forecastSource(f));
  assert.equal(r.kind, 'ready');
  if (r.kind !== 'ready') return;
  assert.equal(r.place, 'Bacchus Marsh');
  assert.deepEqual(r.view.headline, { sky: 'Cloudy', icon: 'cloudy', low: 10, high: 15, rain: 10, gust: 30 });
  assert.equal(f.asked.filter((u) => u.includes('geocoding')).length, 1, 'stops at the first hit');
});

test('a location nothing matches, or no location, means no forecast', async () => {
  const f = fakeFetch({});
  assert.deepEqual(await rideForecast(ride({ location: 'Somewhere odd' }), data(), '2026-11-01', forecastSource(f)), { kind: 'none' });
  assert.deepEqual(await rideForecast(ride({ location: null }), data(), '2026-11-01', forecastSource(f)), { kind: 'none' });
});

test('too far out, or over, never asks', async () => {
  const f = fakeFetch({});
  assert.deepEqual(await rideForecast(ride(), data(), '2026-10-01', forecastSource(f)), { kind: 'later', opensOn: '2026-10-23' });
  assert.deepEqual(await rideForecast(ride(), data(), '2026-11-09', forecastSource(f)), { kind: 'over' });
  assert.equal(f.asked.length, 0);
});

test('a failed forecast says so in plain words', async () => {
  const f = fakeFetch({ 'geo:Bacchus Marsh': { results: [{ name: 'Bacchus Marsh', latitude: -37.67, longitude: 144.43 }] }, forecast: 500 });
  await assert.rejects(rideForecast(ride(), data(), '2026-11-01', forecastSource(f)), /The forecast isn’t answering/);
});

test('answers are kept for half an hour', async () => {
  let now = 0;
  const f = fakeFetch({ 'geo:Bacchus Marsh': { results: [{ name: 'Bacchus Marsh', latitude: -37.67, longitude: 144.43 }] }, forecast: place() });
  const source = forecastSource(f, () => now);
  await rideForecast(ride(), data(), '2026-11-01', source);
  await rideForecast(ride(), data(), '2026-11-01', source);
  assert.equal(f.asked.length, 2, 'one place search, one forecast');
  now = 31 * 60_000;
  const r = await rideForecast(ride(), data(), '2026-11-01', source);
  assert.equal(f.asked.length, 4);
  assert.equal(r.kind === 'ready' && r.fetchedAt, 31 * 60_000);
});

test('Updated is when the forecast came, not when the card was drawn again', async () => {
  let now = 1000;
  const f = fakeFetch({ 'geo:Bacchus Marsh': { results: [{ name: 'Bacchus Marsh', latitude: -37.67, longitude: 144.43 }] }, forecast: place() });
  const source = forecastSource(f, () => now);
  await rideForecast(ride(), data(), '2026-11-01', source);
  now = 25 * 60_000;
  const r = await rideForecast(ride(), data(), '2026-11-01', source);
  assert.equal(r.kind === 'ready' && r.fetchedAt, 1000);
});

test('an answer that doesn’t read is never kept, so Try again asks again', async () => {
  const answers: Record<string, unknown> = { 'geo:Bacchus Marsh': { results: [{ name: 'Bacchus Marsh', latitude: -37.67, longitude: 144.43 }] }, forecast: { hourly: {} } };
  const f = fakeFetch(answers);
  const source = forecastSource(f, () => 0);
  await assert.rejects(rideForecast(ride(), data(), '2026-11-01', source), /isn’t answering/);
  answers.forecast = place();
  const r = await rideForecast(ride(), data(), '2026-11-01', source);
  assert.equal(r.kind, 'ready');
});

test('the demo forecast is made up from the ride, the same every time, and covers its hours', () => {
  const a = demoSeries('r-1', 2, HOURS);
  assert.deepEqual(a, demoSeries('r-1', 2, HOURS));
  assert.equal(a.length, 2);
  assert.deepEqual(a[0].time, HOURS);
  assert.ok(a.every((s) => s.temp.every((t) => t > 0 && t < 40)));
});

test('the demo forecast follows Melbourne’s seasons: no 28° in July, no cold January', () => {
  const dayOf = (date: string) => Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`);
  // Many rides and points, so the seeded spread is covered.
  const keys = Array.from({ length: 60 }, (_, i) => `Laverton|Ballan|Daylesford:2027-0${1 + (i % 9)}-${10 + (i % 18)}:${i}`);
  for (const key of keys) {
    for (const s of demoSeries(key, 3, dayOf('2027-07-25'))) {
      assert.ok(s.temp.every((t) => t <= 20), `July ${key}: ${Math.max(...s.temp)}°`);
      assert.ok(s.temp.every((t) => t > 0), `July ${key}: ${Math.min(...s.temp)}°`);
    }
    for (const s of demoSeries(key, 3, dayOf('2027-01-17'))) {
      const top = Math.max(...s.temp);
      assert.ok(top >= 20 && top <= 33, `January ${key}: top of the day ${top}°`);
    }
  }
});

// The club's server: the Bureau's forecast through WillyWeather, with the phone's own Open-Meteo as the fallback.

const serverSeries = () => ({
  time: HOURS,
  temp: [9, 11, 13, 14, 15],
  rain: [0, 0, 60, 0, 0],
  gust: [20, 25, 30, 25, 20],
  code: [0, 0, 80, 1, 1],
});

function fakeServer(answer: unknown | Error) {
  const asked: unknown[] = [];
  const invoke = async (body: unknown) => {
    asked.push(body);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { asked, invoke };
}

const routed = () => data({ routes: [loop], rideRoutes: [{ rideId: 'r-1', routeId: 'rt' }] });

test('the club server answers: its blended hours are used and the card is told it was WillyWeather', async () => {
  const server = fakeServer({ series: [serverSeries()], willy: true });
  const phone = fakeFetch({ forecast: [place()] });
  const r = await rideForecast(ride(), routed(), '2026-11-01', serverSource(server.invoke, forecastSource(phone)));
  assert.equal(r.kind, 'ready');
  if (r.kind !== 'ready') return;
  assert.equal(r.willy, true);
  assert.equal(r.view.headline.high, 14, 'the server’s figures (the ride ends before noon)');
  assert.equal(r.view.headline.rain, 60);
  assert.deepEqual(server.asked, [{ points: [{ lat: -37.85, lng: 144.77 }], days: ['2026-11-07'] }]);
  assert.ok(!phone.asked.some((u) => u.includes('api.open-meteo.com/v1/forecast')), 'the phone does not ask Open-Meteo too');
});

test('the club server fails or answers oddly: the phone asks Open-Meteo itself, and the card says Open-Meteo', async () => {
  for (const answer of [new Error('down'), { series: [{ time: HOURS }] }, { series: [serverSeries(), serverSeries()], willy: true }, null]) {
    const phone = fakeFetch({ forecast: [place()] });
    const r = await rideForecast(ride(), routed(), '2026-11-01', serverSource(fakeServer(answer).invoke, forecastSource(phone)));
    assert.equal(r.kind, 'ready');
    if (r.kind !== 'ready') return;
    assert.equal(r.willy, false);
    assert.equal(r.view.headline.high, 15, 'Open-Meteo’s figures');
  }
});

test('the club server keeps WillyWeather out of it (no key yet): Open-Meteo figures, credited to Open-Meteo', async () => {
  const r = await rideForecast(ride(), routed(), '2026-11-01', serverSource(fakeServer({ series: [serverSeries()], willy: false }).invoke, forecastSource(fakeFetch({}))));
  assert.equal(r.kind === 'ready' && r.willy, false);
});

test('the club server is asked once in half an hour for the same ride', async () => {
  const server = fakeServer({ series: [serverSeries()], willy: true });
  let now = 0;
  const source = serverSource(server.invoke, forecastSource(fakeFetch({})), () => now);
  await rideForecast(ride(), routed(), '2026-11-01', source);
  now = 29 * 60_000;
  await rideForecast(ride(), routed(), '2026-11-01', source);
  assert.equal(server.asked.length, 1);
  now = 31 * 60_000;
  await rideForecast(ride(), routed(), '2026-11-01', source);
  assert.equal(server.asked.length, 2);
});

test('the phone’s own Open-Meteo answer says it was not WillyWeather', async () => {
  const r = await rideForecast(ride(), routed(), '2026-11-01', forecastSource(fakeFetch({ forecast: [place()] })));
  assert.equal(r.kind === 'ready' && r.willy, false);
});

test('a club server that hangs is given up on, and the phone asks Open-Meteo itself', async () => {
  const phone = fakeFetch({ forecast: [place()] });
  const source = serverSource(() => new Promise(() => {}), forecastSource(phone), Date.now, 50);
  const r = await rideForecast(ride(), routed(), '2026-11-01', source);
  assert.equal(r.kind === 'ready' && r.willy, false);
  assert.ok(phone.asked.some((u) => u.includes('api.open-meteo.com/v1/forecast')));
});

test('a list of rides asking at once: the same question is asked once, the server three at a time', async () => {
  const pt = { lat: -37.7, lng: 144.7, label: 'x' };
  // The phone: two rows at the same place share one look-up and one forecast.
  let fetches = 0;
  const phone = forecastSource(async () => {
    fetches += 1;
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, status: 200, json: async () => place() };
  });
  await Promise.all([phone.forecast([pt], ['2026-11-07']), phone.forecast([pt], ['2026-11-07'])]);
  assert.equal(fetches, 1);

  // The server: five different questions never have more than three out at once; two the same share.
  let out = 0;
  let most = 0;
  let calls = 0;
  const server = serverSource(async (body) => {
    calls += 1;
    out += 1;
    most = Math.max(most, out);
    await new Promise((r) => setTimeout(r, 5));
    out -= 1;
    return { series: body.points.map(() => ({ time: HOURS, temp: [1, 2, 3, 4, 5], rain: [0, 0, 0, 0, 0], gust: [9, 9, 9, 9, 9], code: [1, 1, 1, 1, 1] })), willy: true };
  }, phone);
  const at = (i: number) => [{ lat: -37.7 + i / 100, lng: 144.7, label: 'x' }];
  const answers = await Promise.all([0, 1, 2, 3, 4, 4].map((i) => server.forecast(at(i), ['2026-11-07'])));
  assert.equal(calls, 5);
  assert.ok(most <= 3, `most out at once: ${most}`);
  assert.ok(answers.every((a) => a.willy === true));
});
