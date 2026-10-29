import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSeries, forecastSource, rideForecast, type Fetcher } from './weather';
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
  assert.deepEqual(r.view.headline, { sky: 'Cloudy', icon: 'cloudy', low: 10, high: 16, rain: 10, gust: 30 });
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
  await rideForecast(ride(), data(), '2026-11-01', source);
  assert.equal(f.asked.length, 4);
});

test('the demo forecast is made up from the ride, the same every time, and covers its hours', () => {
  const a = demoSeries('r-1', 2, HOURS);
  assert.deepEqual(a, demoSeries('r-1', 2, HOURS));
  assert.equal(a.length, 2);
  assert.deepEqual(a[0].time, HOURS);
  assert.ok(a.every((s) => s.temp.every((t) => t > 0 && t < 40)));
});
