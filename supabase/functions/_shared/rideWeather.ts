// Ride weather on the server: the Bureau of Meteorology's forecast through WillyWeather (temperature,
// rain chance, sky) with gusts from Open-Meteo's ECMWF model, which WillyWeather doesn't forecast.
// The WillyWeather key stays here, and every answer is kept for half an hour. Shared by the
// ride-weather Edge Function and the app's tests.

export const NO_FORECAST = 'The forecast isn’t answering. Try again soon.';

const WW = 'https://api.willyweather.com.au/v2';
const OM = 'https://api.open-meteo.com/v1/forecast';
const ZONE = 'Australia/Melbourne';
const KEEP_MS = 30 * 60_000;
const MAX_POINTS = 5;
const MAX_DAYS = 16;
/** WillyWeather's nearest place stands for a point only this close (km). */
const NEAR_KM = 40;
/** The most of each kind kept; the oldest goes first. */
const KEEP_MAX = 500;

export interface Point {
  lat: number;
  lng: number;
}

export interface Ask {
  points: Point[];
  days: string[];
}

/** One place's hours, the shape the app reads ("2026-11-07T08:00", Melbourne time). Missing is NaN. */
export interface Series {
  time: string[];
  temp: number[];
  rain: number[];
  gust: number[];
  code: number[];
}

interface Hour {
  temp?: number;
  rain?: number;
  code?: number;
}

export type FetchJson = (url: string) => Promise<unknown>;

export interface Cache {
  answers: Map<string, { at: number; value: unknown }>;
  places: Map<string, number | null>;
}

export const newCache = (): Cache => ({ answers: new Map(), places: new Map() });

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const inAustralia = (p: Point) => p.lat >= -44.5 && p.lat <= -9 && p.lng >= 112 && p.lng <= 154.5;

/** The phone's ask, checked: 1 to 5 points in Australia and up to 16 days running on. Null if not. */
export function parseAsk(body: unknown): Ask | null {
  const b = body as { points?: unknown; days?: unknown } | null;
  if (!b || !Array.isArray(b.points) || !Array.isArray(b.days)) return null;
  if (b.points.length < 1 || b.points.length > MAX_POINTS) return null;
  if (b.days.length < 1 || b.days.length > MAX_DAYS) return null;
  const points: Point[] = [];
  for (const p of b.points as { lat?: unknown; lng?: unknown }[]) {
    if (typeof p?.lat !== 'number' || typeof p?.lng !== 'number' || !inAustralia({ lat: p.lat, lng: p.lng })) return null;
    points.push({ lat: p.lat, lng: p.lng });
  }
  const days = b.days as unknown[];
  if (!days.every((d): d is string => typeof d === 'string' && ISO_DAY.test(d))) return null;
  for (let i = 1; i < days.length; i++) if (days[i] !== nextDay(days[i - 1] as string)) return null;
  return { points, days: days as string[] };
}

const coord = (n: number) => String(Math.round(n * 1000) / 1000);

/** One Open-Meteo request for every point: gusts (and a fallback for everything else), ECMWF 9 km. */
export function openMeteoUrl(ask: Ask): string {
  const url = new URL(OM);
  url.searchParams.set('latitude', ask.points.map((p) => coord(p.lat)).join(','));
  url.searchParams.set('longitude', ask.points.map((p) => coord(p.lng)).join(','));
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,wind_gusts_10m,weather_code');
  url.searchParams.set('models', 'ecmwf_ifs');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('timezone', ZONE);
  url.searchParams.set('start_date', ask.days[0]);
  url.searchParams.set('end_date', ask.days[ask.days.length - 1]);
  return url.toString();
}

const numbers = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length === n ? v.map((x) => (typeof x === 'number' ? x : NaN)) : null;

/** Open-Meteo's answer, one series per point. Null if it doesn't read. */
export function parseOpenMeteo(json: unknown, count: number): Series[] | null {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : [];
  if (list.length !== count) return null;
  const out: Series[] = [];
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

const wwPlaceUrl = (key: string, p: Point) => `${WW}/${encodeURIComponent(key)}/search.json?lat=${coord(p.lat)}&lng=${coord(p.lng)}&units=distance:km`;

const wwWeatherUrl = (key: string, id: number, ask: Ask) =>
  `${WW}/${encodeURIComponent(key)}/locations/${id}/weather.json?forecasts=temperature,rainfallprobability,precis&startDate=${ask.days[0]}&days=${ask.days.length}`;

/** The id of WillyWeather's nearest place, if it's close enough to stand for the point. */
export function parseWwLocation(json: unknown): number | null {
  const loc = (json as { location?: { id?: unknown; distance?: unknown } } | null)?.location;
  if (!loc || typeof loc.id !== 'number') return null;
  if (typeof loc.distance === 'number' && loc.distance > NEAR_KM) return null;
  return loc.id;
}

/** WillyWeather's precis words as the WMO codes the card already reads. */
const PRECIS: Record<string, number> = {
  fine: 0,
  'mostly-fine': 1,
  'high-cloud': 2,
  'partly-cloudy': 2,
  'mostly-cloudy': 3,
  cloudy: 3,
  overcast: 3,
  wind: 3,
  dust: 3,
  frost: 0,
  fog: 45,
  drizzle: 51,
  'showers-rain': 63,
  'shower-or-two': 80,
  'chance-shower-fine': 80,
  'chance-shower-cloud': 80,
  'few-showers': 80,
  'heavy-showers-rain': 82,
  'chance-thunderstorm-fine': 95,
  'chance-thunderstorm-cloud': 95,
  'chance-thunderstorm-showers': 95,
  thunderstorm: 95,
  hail: 96,
  'chance-snow-fine': 71,
  'chance-snow-cloud': 71,
  'light-snow': 71,
  'snow-and-rain': 71,
  snow: 73,
  'heavy-snow': 75,
};

export const precisCode = (word: string): number => PRECIS[word] ?? NaN;

type Entries = { days?: { entries?: Record<string, unknown>[] }[] } | undefined;

/** "2026-11-27 14:00:00" → "2026-11-27T14:00", moved by whole hours. */
function shift(dateTime: string, hours: number): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):\d{2}/.exec(dateTime);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:00:00Z`) + hours * 3600_000;
  return new Date(t).toISOString().slice(0, 16);
}

function each(forecast: Entries, read: (e: Record<string, unknown>) => number | undefined, spread: number[], put: (hour: string, v: number) => void) {
  for (const day of forecast?.days ?? []) {
    for (const e of day.entries ?? []) {
      const v = read(e);
      if (typeof e.dateTime !== 'string' || v === undefined || Number.isNaN(v)) continue;
      for (const s of spread) {
        const h = shift(e.dateTime, s);
        if (h) put(h, v);
      }
    }
  }
}

/** WillyWeather's forecast by hour: temperature hourly; rain chance and sky are 3-hourly, so each
 *  covers its own hour and the one either side. */
export function wwHours(json: unknown): Map<string, Hour> {
  const out = new Map<string, Hour>();
  const f = (json as { forecasts?: Record<string, Entries> } | null)?.forecasts;
  if (!f) return out;
  const put = (k: keyof Hour) => (hour: string, v: number) => out.set(hour, { ...out.get(hour), [k]: v });
  const num = (k: string) => (e: Record<string, unknown>) => (typeof e[k] === 'number' ? (e[k] as number) : undefined);
  each(f.temperature, num('temperature'), [0], put('temp'));
  each(f.rainfallprobability, num('probability'), [-1, 0, 1], put('rain'));
  each(f.precis, (e) => (typeof e.precisCode === 'string' ? precisCode(e.precisCode) : undefined), [-1, 0, 1], put('code'));
  return out;
}

/** Open-Meteo's hours with WillyWeather's figures laid over them where it has them. Gusts stay Open-Meteo's. */
export function blend(om: Series, ww: Map<string, Hour>): Series {
  const pick = (k: keyof Hour, list: number[]) => om.time.map((t, i) => ww.get(t)?.[k] ?? list[i]);
  return { time: om.time, temp: pick('temp', om.temp), rain: pick('rain', om.rain), gust: om.gust, code: pick('code', om.code) };
}

export interface Deps {
  fetchJson: FetchJson;
  now?: () => number;
  cache?: Cache;
}

const shared = newCache();

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key);
  map.set(key, value);
  if (map.size > KEEP_MAX) map.delete(map.keys().next().value as K);
}

export async function handleRideWeather(env: { WILLYWEATHER_API_KEY?: string }, body: unknown, deps: Deps): Promise<{ status: number; body: unknown }> {
  const ask = parseAsk(body);
  if (!ask) return { status: 400, body: { error: 'Send 1 to 5 points in Australia and the ride’s days.' } };
  const now = deps.now ?? Date.now;
  const cache = deps.cache ?? shared;

  // A good answer is kept for half an hour; a failure is never kept.
  const get = async (url: string, good: (v: unknown) => boolean): Promise<unknown> => {
    const hit = cache.answers.get(url);
    if (hit && now() - hit.at < KEEP_MS) return hit.value;
    const value = await deps.fetchJson(url);
    if (good(value)) remember(cache.answers, url, { at: now(), value });
    return value;
  };

  let om: Series[] | null = null;
  try {
    om = parseOpenMeteo(await get(openMeteoUrl(ask), (v) => parseOpenMeteo(v, ask.points.length) !== null), ask.points.length);
  } catch {
    om = null;
  }
  if (!om) return { status: 503, body: { error: NO_FORECAST } };

  const key = env.WILLYWEATHER_API_KEY;
  let willy = false;
  const series = await Promise.all(
    om.map(async (s, i) => {
      if (!key) return s;
      try {
        const p = ask.points[i];
        const spot = `${coord(p.lat)},${coord(p.lng)}`;
        let id = cache.places.get(spot);
        if (id === undefined) {
          id = parseWwLocation(await deps.fetchJson(wwPlaceUrl(key, p)));
          remember(cache.places, spot, id);
        }
        if (id === null) return s;
        const hours = wwHours(await get(wwWeatherUrl(key, id, ask), (v) => wwHours(v).size > 0));
        if (hours.size === 0) return s;
        willy = true;
        return blend(s, hours);
      } catch {
        return s;
      }
    }),
  );
  return { status: 200, body: { series, willy } };
}
