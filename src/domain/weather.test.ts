import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_DAYS,
  forecastReach,
  forecastUrl,
  forecastView,
  geocodeUrl,
  parseForecast,
  parseGeocode,
  placeGuesses,
  rideWindow,
  routePoints,
  skyOf,
  type HourlySeries,
} from './weather';
import type { Ride, Route } from './types';

const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r',
  title: 'Run',
  // 8:30 am Melbourne (summer time, UTC+11) on Sat 7 Nov 2026
  startsAt: '2026-11-06T21:30:00.000Z',
  endsAt: '2026-11-07T01:00:00.000Z',
  allDay: false,
  location: null,
  notes: null,
  category: 'west',
  cancelledAt: null,
  ...over,
});

const route = (line: [number, number][], stops: Route['stops'] = []): Route => ({
  id: 'rt',
  name: 'Loop',
  chapterId: null,
  notes: '',
  distanceM: 0,
  climbM: null,
  line,
  stops,
  bounds: { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 },
  archivedAt: null,
  updatedAt: '2026-10-01T00:00:00Z',
});

// About 0.5 degrees of latitude is 55 km.
const LAVERTON: [number, number] = [-37.85, 144.77];
const DAYLESFORD: [number, number] = [-37.35, 144.14];

test('a route gives its start, its named stops and its finish', () => {
  const pts = routePoints(
    route([LAVERTON, [-37.6, 144.45], DAYLESFORD], [{ name: 'Ballan Bakery', lat: -37.6, lng: 144.22 }]),
  );
  assert.deepEqual(pts.map((p) => p.label), ['Start', 'Ballan Bakery', 'Finish']);
  assert.deepEqual([pts[0].lat, pts[0].lng], LAVERTON);
  assert.deepEqual([pts[2].lat, pts[2].lng], DAYLESFORD);
});

test('a loop folds its finish into the start, and close points are dropped', () => {
  const pts = routePoints(
    route([LAVERTON, DAYLESFORD, [-37.851, 144.771]], [
      { name: 'Servo next door', lat: -37.86, lng: 144.78 },
      { name: 'Daylesford', lat: -37.35, lng: 144.14 },
    ]),
  );
  assert.deepEqual(pts.map((p) => p.label), ['Start and finish', 'Daylesford']);
});

test('a route with many stops keeps the start, three stops spread along, and the finish', () => {
  const stops = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ name: `S${i}`, lat: -37 - i * 0.5, lng: 145 }));
  const pts = routePoints(route([[-36.5, 145], [-41, 145]], stops));
  assert.equal(pts.length, 5);
  assert.equal(pts[0].label, 'Start');
  assert.equal(pts[4].label, 'Finish');
  assert.deepEqual(pts.slice(1, 4).map((p) => p.label), ['S0', 'S3', 'S6']);
});

test('an empty route gives no points', () => {
  assert.deepEqual(routePoints(route([])), []);
});

test('place guesses: the last part first, without street numbers, state or postcode, then shorter', () => {
  assert.deepEqual(placeGuesses('Maccas, 12 Main St, Bacchus Marsh VIC 3340'), ['Bacchus Marsh', 'Bacchus', 'Maccas']);
  assert.deepEqual(placeGuesses('Kilmore Bakery'), ['Kilmore Bakery', 'Kilmore']);
  assert.deepEqual(placeGuesses('Caltex Laverton North'), ['Caltex Laverton North', 'Caltex Laverton', 'Laverton North']);
  assert.deepEqual(placeGuesses('Phillip Island, Victoria, Australia'), ['Phillip Island', 'Phillip']);
  assert.deepEqual(placeGuesses('Bacchus Marsh McDonald’s'), ['Bacchus Marsh McDonald’s', 'Bacchus Marsh', 'Marsh McDonald’s']);
  assert.equal(placeGuesses('A, B, C, D, E, F, G').length, 6, 'at most six tries');
  assert.deepEqual(placeGuesses('  '), []);
});

test('a timed ride: its start hour to the last hour before its end, in Melbourne time', () => {
  const w = rideWindow(ride());
  assert.deepEqual(w.days, ['2026-11-07']);
  assert.deepEqual(w.hours, ['2026-11-07T08:00', '2026-11-07T09:00', '2026-11-07T10:00', '2026-11-07T11:00']);
  assert.equal(w.byDay, false);
  // Ending at 12:30 takes in the 12 o'clock hour.
  assert.equal(rideWindow(ride({ endsAt: '2026-11-07T01:30:00.000Z' })).hours.at(-1), '2026-11-07T12:00');
});

test('an evening ride past midnight spans two dates but still goes by place', () => {
  // 8 pm Sat to 1 am Sun, Melbourne
  const w = rideWindow(ride({ startsAt: '2026-11-07T09:00:00.000Z', endsAt: '2026-11-07T14:00:00.000Z' }));
  assert.deepEqual(w.days, ['2026-11-07', '2026-11-08']);
  assert.equal(w.byDay, false);
  assert.deepEqual(w.hours, ['2026-11-07T20:00', '2026-11-07T21:00', '2026-11-07T22:00', '2026-11-07T23:00', '2026-11-08T00:00']);
});

test('a timed ride with no end gets 6 hours', () => {
  const w = rideWindow(ride({ endsAt: null }));
  assert.equal(w.hours.length, 6);
  assert.equal(w.hours[0], '2026-11-07T08:00');
  assert.equal(w.hours[5], '2026-11-07T13:00');
});

test('an all-day ride: 8 am to 5 pm on each of its days', () => {
  // Fri 29 Jan to Sun 31 Jan 2027 (the calendar's end is the midnight after)
  const w = rideWindow(ride({ allDay: true, startsAt: '2027-01-28T13:00:00.000Z', endsAt: '2027-01-31T13:00:00.000Z' }));
  assert.deepEqual(w.days, ['2027-01-29', '2027-01-30', '2027-01-31']);
  assert.equal(w.hours.length, 30);
  assert.equal(w.hours[0], '2027-01-29T08:00');
  assert.equal(w.hours[9], '2027-01-29T17:00');
  assert.equal(w.hours[29], '2027-01-31T17:00');
  assert.equal(w.byDay, true);
});

test('reach: too far out says when it opens; over or cancelled shows nothing', () => {
  assert.equal(FORECAST_DAYS, 16);
  assert.deepEqual(forecastReach(ride(), '2026-10-20'), { kind: 'later', opensOn: '2026-10-23' });
  assert.deepEqual(forecastReach(ride(), '2026-10-23'), { kind: 'ready', days: ['2026-11-07'], clipped: false });
  assert.deepEqual(forecastReach(ride(), '2026-11-08'), { kind: 'over' });
  assert.deepEqual(forecastReach(ride({ cancelledAt: '2026-11-01T00:00:00Z' }), '2026-11-01'), { kind: 'over' });
});

test('reach: a multi-day ride past the forecast gets the days it has; a ride under way, the days left', () => {
  const weekend = ride({ allDay: true, startsAt: '2027-01-28T13:00:00.000Z', endsAt: '2027-01-31T13:00:00.000Z' });
  assert.deepEqual(forecastReach(weekend, '2027-01-14'), { kind: 'ready', days: ['2027-01-29'], clipped: true });
  assert.deepEqual(forecastReach(weekend, '2027-01-30'), { kind: 'ready', days: ['2027-01-30', '2027-01-31'], clipped: false });
});

test('the forecast address asks for every point at once, in Melbourne time, for the days', () => {
  const url = new URL(forecastUrl([{ label: 'Start', lat: -37.85, lng: 144.77 }, { label: 'Finish', lat: -37.35, lng: 144.14 }], ['2026-11-07', '2026-11-08']));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '-37.85,-37.35');
  assert.equal(url.searchParams.get('longitude'), '144.77,144.14');
  assert.equal(url.searchParams.get('timezone'), 'Australia/Melbourne');
  assert.equal(url.searchParams.get('start_date'), '2026-11-07');
  assert.equal(url.searchParams.get('end_date'), '2026-11-08');
  assert.equal(url.searchParams.get('hourly'), 'temperature_2m,precipitation_probability,wind_gusts_10m,weather_code');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh');
});

test('the place search looks in Australia only', () => {
  const url = new URL(geocodeUrl('Bacchus Marsh'));
  assert.equal(url.origin + url.pathname, 'https://geocoding-api.open-meteo.com/v1/search');
  assert.equal(url.searchParams.get('name'), 'Bacchus Marsh');
  assert.equal(url.searchParams.get('countryCode'), 'AU');
  assert.equal(url.searchParams.get('count'), '1');
});

test('reading a place search', () => {
  assert.deepEqual(parseGeocode({ results: [{ name: 'Bacchus Marsh', latitude: -37.67, longitude: 144.43, admin1: 'Victoria' }] }), {
    label: 'Bacchus Marsh',
    lat: -37.67,
    lng: 144.43,
  });
  assert.equal(parseGeocode({ results: [{ name: 'Marsh', latitude: -27.5, longitude: 153.0 }] }), null, 'a match far from Melbourne is the wrong town');
  assert.equal(parseGeocode({}), null);
  assert.equal(parseGeocode({ results: [{ name: 'x', latitude: 'no' }] }), null);
  assert.equal(parseGeocode(null), null);
});

const HOURS = ['2026-11-07T08:00', '2026-11-07T09:00', '2026-11-07T10:00'];
const hourly = (temp: number[], rain: number[], gust: number[], code: number[]) => ({
  hourly: { time: HOURS, temperature_2m: temp, precipitation_probability: rain, wind_gusts_10m: gust, weather_code: code },
});

test('reading a forecast: one place is an object, several are a list', () => {
  const one = parseForecast(hourly([10, 12, 14], [0, 10, 20], [20, 30, 25], [0, 2, 3]), 1);
  assert.equal(one?.length, 1);
  assert.deepEqual(one?.[0].temp, [10, 12, 14]);
  const two = parseForecast([hourly([1, 2, 3], [0, 0, 0], [0, 0, 0], [0, 0, 0]), hourly([4, 5, 6], [0, 0, 0], [0, 0, 0], [0, 0, 0])], 2);
  assert.deepEqual(two?.map((s) => s.temp[0]), [1, 4]);
  assert.equal(parseForecast([hourly([1], [0], [0], [0])], 2), null, 'a place missing');
  assert.equal(parseForecast({ hourly: { time: HOURS } }, 1), null, 'figures missing');
  assert.equal(parseForecast(null, 1), null);
});

test('the sky: the worst weather in the hours, in words, with an icon', () => {
  assert.deepEqual(skyOf(0), { sky: 'Clear', icon: 'sunny' });
  assert.deepEqual(skyOf(2), { sky: 'Partly cloudy', icon: 'partly-sunny' });
  assert.deepEqual(skyOf(3), { sky: 'Cloudy', icon: 'cloudy' });
  assert.deepEqual(skyOf(45), { sky: 'Fog', icon: 'cloudy' });
  assert.deepEqual(skyOf(53), { sky: 'Drizzle', icon: 'rainy' });
  assert.deepEqual(skyOf(63), { sky: 'Rain', icon: 'rainy' });
  assert.deepEqual(skyOf(81), { sky: 'Showers', icon: 'rainy' });
  assert.deepEqual(skyOf(95), { sky: 'Storms', icon: 'thunderstorm' });
  assert.deepEqual(skyOf(73), { sky: 'Snow', icon: 'snow' });
});

const series = (temp: number[], rain: number[], gust: number[], code: number[]): HourlySeries => ({ time: HOURS, temp, rain, gust, code });

test('the view: a headline for the whole ride, and a row per point', () => {
  const view = forecastView(
    [{ label: 'Start', lat: 0, lng: 0 }, { label: 'Kinglake', lat: 1, lng: 1 }],
    [series([9.6, 12, 14.4], [0, 10, 20], [20, 30, 25], [0, 2, 1]), series([8, 11, 13], [30, 40, 20], [40, 45, 35], [3, 61, 3])],
    { days: ['2026-11-07'], hours: HOURS, byDay: false },
  );
  assert.deepEqual(view?.headline, { sky: 'Rain', icon: 'rainy', low: 8, high: 14, rain: 40, gust: 45 });
  assert.deepEqual(view?.rows.map((r) => [r.label, r.summary.sky, r.summary.low, r.summary.high, r.summary.rain, r.summary.gust]), [
    ['Start', 'Partly cloudy', 10, 14, 20, 30],
    ['Kinglake', 'Rain', 8, 13, 40, 45],
  ]);
  assert.deepEqual(view?.headsUps, []);
});

test('the view only counts the ride’s hours, and has nothing when none come back', () => {
  const view = forecastView([{ label: 'Start', lat: 0, lng: 0 }], [series([5, 20, 30], [0, 0, 90], [0, 0, 90], [0, 0, 95])], {
    days: ['2026-11-07'],
    hours: HOURS.slice(0, 2),
    byDay: false,
  });
  assert.deepEqual(view?.headline, { sky: 'Clear', icon: 'sunny', low: 5, high: 20, rain: 0, gust: 0 });
  assert.equal(forecastView([{ label: 'Start', lat: 0, lng: 0 }], [series([1, 2, 3], [0, 0, 0], [0, 0, 0], [0, 0, 0])], { days: ['2026-11-08'], hours: ['2026-11-08T08:00'], byDay: false }), null);
});

test('heads-ups: rain, gusts, heat and ice, each at its worst place', () => {
  const view = forecastView(
    [{ label: 'Start and finish', lat: 0, lng: 0 }, { label: 'Kinglake', lat: 1, lng: 1 }],
    [series([2, 20, 36], [10, 20, 50], [30, 59, 20], [0, 0, 0]), series([4, 30, 37.4], [60, 20, 10], [65, 20, 20], [0, 0, 0])],
    { days: ['2026-11-07'], hours: HOURS, byDay: false },
  );
  assert.deepEqual(view?.headsUps, [
    '60% chance of rain at Kinglake',
    'Gusts to 65 km/h at Kinglake',
    'Up to 37° at Kinglake',
    'Down to 2° at the start and finish. Watch for ice.',
  ]);
});

test('a multi-day ride: a row per day, and heads-ups name the day', () => {
  const days = ['2027-01-29', '2027-01-30'];
  const hours = ['2027-01-29T08:00', '2027-01-29T09:00', '2027-01-30T08:00', '2027-01-30T09:00'];
  const s = (temp: number[], rain: number[]): HourlySeries => ({ time: hours, temp, rain, gust: [10, 10, 10, 10], code: [0, 0, 61, 61] });
  const view = forecastView(
    [{ label: 'Phillip Island', lat: 0, lng: 0 }],
    [s([20, 24, 18, 19], [0, 10, 70, 40])],
    { days, hours, byDay: true },
  );
  assert.deepEqual(view?.rows.map((r) => [r.label, r.summary.sky, r.summary.high, r.summary.rain]), [
    ['Fri 29/01/2027', 'Clear', 24, 10],
    ['Sat 30/01/2027', 'Rain', 19, 70],
  ]);
  assert.deepEqual(view?.headsUps, ['70% chance of rain on Sat 30/01/2027 at Phillip Island']);
});
