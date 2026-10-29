// Ride weather: where along a ride to ask, for which hours, the Open-Meteo addresses, reading their
// answers, and what the card says. Open-Meteo needs no account or key, and the phone asks it directly.

import { addDays, formatAuDate, weekday } from './dates';
import { haversineM } from './gpx';
import { lastDay, melbourneDate } from './rides';
import type { Ride, Route } from './types';

/** Open-Meteo forecasts 16 days, today included. */
export const FORECAST_DAYS = 16;

/** The heads-up lines' thresholds. The app's own call; change them here. */
export const RAIN_CHANCE = 50;
export const GUST_KMH = 60;
export const HOT = 35;
export const ICY = 3;

/** Points closer than this to one already chosen add nothing. */
const NEAR_M = 15_000;
/** The most stops asked about between the start and the finish. */
const MAX_STOPS = 3;
/** A timed ride with no end. */
const DEFAULT_HOURS = 6;
/** An all-day ride's riding hours, Melbourne time. */
const DAY_FROM = 8;
const DAY_TO = 17;
const HOUR = 3600_000;
const ZONE = 'Australia/Melbourne';

export interface ForecastPoint {
  label: string;
  lat: number;
  lng: number;
}

/** The ride's days and its hours, as Open-Meteo's Melbourne-time labels ("2026-11-07T08:00"). */
export interface ForecastWindow {
  days: string[];
  hours: string[];
}

export type ForecastReach =
  | { kind: 'over' }
  | { kind: 'later'; opensOn: string }
  /** `clipped`: some later days of the ride are past the forecast's reach. */
  | { kind: 'ready'; days: string[]; clipped: boolean };

export type SkyIcon = 'sunny' | 'partly-sunny' | 'cloudy' | 'rainy' | 'thunderstorm' | 'snow';

export interface WeatherSummary {
  sky: string;
  icon: SkyIcon;
  low: number;
  high: number;
  /** The highest chance of rain, in per cent. */
  rain: number;
  /** The strongest gust, in km/h. */
  gust: number;
}

/** One place's hours. A figure Open-Meteo left out is NaN. */
export interface HourlySeries {
  time: string[];
  temp: number[];
  rain: number[];
  gust: number[];
  code: number[];
}

export interface ForecastView {
  headline: WeatherSummary;
  /** A row per point, or per day on a multi-day ride. */
  rows: { label: string; summary: WeatherSummary }[];
  headsUps: string[];
}

const near = (a: ForecastPoint, b: ForecastPoint) => haversineM([a.lat, a.lng], [b.lat, b.lng]) < NEAR_M;

/** The start, up to three named stops spread along, and the finish (folded into the start on a loop). */
export function routePoints(route: Route): ForecastPoint[] {
  if (route.line.length === 0) return [];
  const [sLat, sLng] = route.line[0];
  const [fLat, fLng] = route.line[route.line.length - 1];
  const finish: ForecastPoint = { label: 'Finish', lat: fLat, lng: fLng };
  const loop = near({ label: '', lat: sLat, lng: sLng }, finish);
  const start: ForecastPoint = { label: loop ? 'Start and finish' : 'Start', lat: sLat, lng: sLng };
  const ends = loop ? [start] : [start, finish];

  const stops: ForecastPoint[] = [];
  for (const s of route.stops) {
    const p = { label: s.name, lat: s.lat, lng: s.lng };
    if (!ends.some((e) => near(e, p)) && !stops.some((o) => near(o, p))) stops.push(p);
  }
  const spread =
    stops.length <= MAX_STOPS
      ? stops
      : Array.from({ length: MAX_STOPS }, (_, i) => stops[Math.round((i * (stops.length - 1)) / (MAX_STOPS - 1))]);
  return loop ? [start, ...spread] : [start, ...spread, finish];
}

const STATES = /^(vic|victoria|nsw|new south wales|qld|queensland|sa|south australia|wa|western australia|tas|tasmania|nt|northern territory|act|australia)$/i;
const MAX_GUESSES = 6;

/**
 * Place names to look a calendar location up by, best first. Calendar locations are often full
 * addresses, so the last comma part comes first, with the state and postcode off, street addresses
 * and states skipped, and each part tried whole, then without its last word, then without its first.
 */
export function placeGuesses(location: string): string[] {
  const parts = location
    .split(',')
    .map((p) => p.replace(/\s+\d{4}$/, '').replace(/\s+(vic|nsw|qld|sa|wa|tas|nt|act)$/i, '').replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^\d/.test(p) && !STATES.test(p))
    .reverse();
  const out: string[] = [];
  const add = (g: string) => {
    if (g && !out.includes(g)) out.push(g);
  };
  for (const p of parts) {
    add(p);
    const words = p.split(' ');
    if (words.length > 1) {
      add(words.slice(0, -1).join(' '));
      add(words.slice(1).join(' '));
    }
  }
  return out.slice(0, MAX_GUESSES);
}

/** "2026-11-07T08:00", Melbourne time. */
function melbourneHour(ms: number): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-AU', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))) {
    p[x.type] = x.value;
  }
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Each day from the first to the last, inclusive. */
function daysFrom(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A timed ride: its start hour to its end hour (or 6 hours). All day, or longer than a day: 8 am to 5 pm each day. */
export function rideWindow(ride: Ride): ForecastWindow {
  const start = new Date(ride.startsAt).getTime();
  const end = ride.endsAt ? new Date(ride.endsAt).getTime() : null;
  if (ride.allDay || (end !== null && end - start > 24 * HOUR)) {
    const days = daysFrom(melbourneDate(ride.startsAt), lastDay(ride));
    const hours = days.flatMap((d) => Array.from({ length: DAY_TO - DAY_FROM + 1 }, (_, i) => `${d}T${pad(DAY_FROM + i)}:00`));
    return { days, hours };
  }
  const from = Math.floor(start / HOUR) * HOUR;
  const to = end !== null ? Math.max(from, Math.floor(end / HOUR) * HOUR) : from + (DEFAULT_HOURS - 1) * HOUR;
  const hours: string[] = [];
  for (let t = from; t <= to; t += HOUR) hours.push(melbourneHour(t));
  const days = [...new Set(hours.map((h) => h.slice(0, 10)))];
  return { days, hours };
}

/** Whether the forecast reaches the ride yet, and which of its days it covers. */
export function forecastReach(ride: Ride, today: string): ForecastReach {
  if (ride.cancelledAt || lastDay(ride) < today) return { kind: 'over' };
  const left = rideWindow(ride).days.filter((d) => d >= today);
  if (left.length === 0) return { kind: 'over' };
  const reach = addDays(today, FORECAST_DAYS - 1);
  if (left[0] > reach) return { kind: 'later', opensOn: addDays(left[0], -(FORECAST_DAYS - 1)) };
  const days = left.filter((d) => d <= reach);
  return { kind: 'ready', days, clipped: days.length < left.length };
}

const coord = (n: number) => String(Math.round(n * 1000) / 1000);

/** One request for every point, hourly, in Melbourne time, for the given days. */
export function forecastUrl(points: ForecastPoint[], days: string[]): string {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', points.map((p) => coord(p.lat)).join(','));
  url.searchParams.set('longitude', points.map((p) => coord(p.lng)).join(','));
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,wind_gusts_10m,weather_code');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('timezone', ZONE);
  url.searchParams.set('start_date', days[0]);
  url.searchParams.set('end_date', days[days.length - 1]);
  return url.toString();
}

/** A place-name search, in Australia only. */
export function geocodeUrl(name: string): string {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  url.searchParams.set('countryCode', 'AU');
  return url.toString();
}

export function parseGeocode(json: unknown): ForecastPoint | null {
  const hit = (json as { results?: { name?: unknown; latitude?: unknown; longitude?: unknown }[] } | null)?.results?.[0];
  if (!hit || typeof hit.name !== 'string' || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') return null;
  return { label: hit.name, lat: hit.latitude, lng: hit.longitude };
}

const numbers = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length === n ? v.map((x) => (typeof x === 'number' ? x : NaN)) : null;

/** One series per point asked about, in the same order. Open-Meteo answers one place as an object, several as a list. */
export function parseForecast(json: unknown, count: number): HourlySeries[] | null {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : [];
  if (list.length !== count) return null;
  const out: HourlySeries[] = [];
  for (const place of list) {
    const h = (place as { hourly?: Record<string, unknown> } | null)?.hourly;
    const time = h?.time;
    if (!Array.isArray(time) || !time.every((t) => typeof t === 'string')) return null;
    const temp = numbers(h?.temperature_2m, time.length);
    const rain = numbers(h?.precipitation_probability, time.length);
    const gust = numbers(h?.wind_gusts_10m, time.length);
    const code = numbers(h?.weather_code, time.length);
    if (!temp || !rain || !gust || !code) return null;
    out.push({ time: time as string[], temp, rain, gust, code });
  }
  return out;
}

/** A WMO weather code in words, with its icon. */
export function skyOf(code: number): { sky: string; icon: SkyIcon } {
  if (code >= 95) return { sky: 'Storms', icon: 'thunderstorm' };
  if (code >= 85) return { sky: 'Snow', icon: 'snow' };
  if (code >= 80) return { sky: 'Showers', icon: 'rainy' };
  if (code >= 71) return { sky: 'Snow', icon: 'snow' };
  if (code >= 61) return { sky: 'Rain', icon: 'rainy' };
  if (code >= 51) return { sky: 'Drizzle', icon: 'rainy' };
  if (code >= 45) return { sky: 'Fog', icon: 'cloudy' };
  if (code >= 3) return { sky: 'Cloudy', icon: 'cloudy' };
  if (code >= 2) return { sky: 'Partly cloudy', icon: 'partly-sunny' };
  return { sky: 'Clear', icon: 'sunny' };
}

/** One reading: a place's figures at one hour. */
interface Reading {
  point: number;
  hour: string;
  temp: number;
  rain: number;
  gust: number;
  code: number;
}

function readings(series: HourlySeries[], hours: Set<string>): Reading[] {
  return series.flatMap((s, point) =>
    s.time.flatMap((hour, i) =>
      hours.has(hour) ? [{ point, hour, temp: s.temp[i], rain: s.rain[i], gust: s.gust[i], code: s.code[i] }] : [],
    ),
  );
}

/** The worst reading by one figure (the highest, or the lowest), skipping missing ones. */
function worst(list: Reading[], key: 'temp' | 'rain' | 'gust' | 'code', lowest = false): Reading | null {
  let best: Reading | null = null;
  for (const r of list) {
    if (Number.isNaN(r[key])) continue;
    if (!best || (lowest ? r[key] < best[key] : r[key] > best[key])) best = r;
  }
  return best;
}

function summarise(list: Reading[]): WeatherSummary | null {
  const hot = worst(list, 'temp');
  const cold = worst(list, 'temp', true);
  if (!hot || !cold) return null;
  return {
    ...skyOf(worst(list, 'code')?.code ?? 0),
    low: Math.round(cold.temp),
    high: Math.round(hot.temp),
    rain: Math.round(worst(list, 'rain')?.rain ?? 0),
    gust: Math.round(worst(list, 'gust')?.gust ?? 0),
  };
}

/** "Sat 30/01/2027" */
const dayLabel = (day: string) => `${weekday(day)} ${formatAuDate(day)}`;

const at = (label: string) =>
  label === 'Start' || label === 'Finish' || label === 'Start and finish' ? `the ${label.toLowerCase()}` : label;

/** The headline, the rows and the heads-ups for the ride's hours. Null when none of its hours came back. */
export function forecastView(points: ForecastPoint[], series: HourlySeries[], window: ForecastWindow): ForecastView | null {
  const all = readings(series, new Set(window.hours));
  const headline = summarise(all);
  if (!headline) return null;
  const multiDay = window.days.length > 1;

  const rows = (
    multiDay
      ? window.days.map((d) => ({ label: dayLabel(d), summary: summarise(all.filter((r) => r.hour.startsWith(d))) }))
      : points.map((p, i) => ({ label: p.label, summary: summarise(all.filter((r) => r.point === i)) }))
  ).filter((r): r is { label: string; summary: WeatherSummary } => !!r.summary);

  const where = (r: Reading) => `${multiDay ? ` on ${dayLabel(r.hour.slice(0, 10))}` : ''} at ${at(points[r.point]?.label ?? '')}`;
  const headsUps: string[] = [];
  const wet = worst(all, 'rain');
  if (wet && wet.rain >= RAIN_CHANCE) headsUps.push(`${Math.round(wet.rain)}% chance of rain${where(wet)}`);
  const windy = worst(all, 'gust');
  if (windy && windy.gust >= GUST_KMH) headsUps.push(`Gusts to ${Math.round(windy.gust)} km/h${where(windy)}`);
  const hot = worst(all, 'temp');
  if (hot && hot.temp >= HOT) headsUps.push(`Up to ${Math.round(hot.temp)}°${where(hot)}`);
  const cold = worst(all, 'temp', true);
  if (cold && cold.temp <= ICY) headsUps.push(`Down to ${Math.round(cold.temp)}°${where(cold)}. Watch for ice.`);

  return { headline, rows, headsUps };
}
