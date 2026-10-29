// Ride weather from Open-Meteo, asked by the phone itself (no account, no key). Answers are kept in
// memory for half an hour. The demo never goes to the network: it makes a forecast up from the ride.

import { routeOf } from '../domain/routes';
import type { ClubData, Ride } from '../domain/types';
import {
  forecastReach,
  forecastUrl,
  forecastView,
  geocodeUrl,
  parseForecast,
  parseGeocode,
  placeGuesses,
  rideWindow,
  routePoints,
  type ForecastPoint,
  type ForecastView,
  type HourlySeries,
} from '../domain/weather';

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ForecastSource {
  /** The first place a name matches in Australia, or null. */
  geocode: (name: string) => Promise<ForecastPoint | null>;
  /** One series per point, for the days given, and when Open-Meteo gave it (epoch ms). */
  forecast: (points: ForecastPoint[], days: string[]) => Promise<{ series: HourlySeries[]; at: number }>;
}

export type RideForecast =
  | { kind: 'over' }
  | { kind: 'later'; opensOn: string }
  /** No route and no place found for the location. */
  | { kind: 'none' }
  /** `place`: the place a location-only ride was looked up as. */
  | { kind: 'ready'; view: ForecastView; clipped: boolean; place: string | null; fetchedAt: number };

export const NOT_ANSWERING = 'The forecast isn’t answering. Try again soon.';
const KEEP_MS = 30 * 60_000;

/** The most answers kept; the oldest goes first. */
const KEEP_MAX = 50;

/**
 * Open-Meteo through `fetch`, keeping each answer that reads well for half an hour. An answer that
 * doesn't read is never kept, so Try again really asks again.
 */
export function forecastSource(fetcher: Fetcher, now: () => number = Date.now): ForecastSource {
  const kept = new Map<string, { at: number; value: unknown }>();
  const get = async <T>(url: string, read: (json: unknown) => T, keepIf: (value: T) => boolean): Promise<{ value: T; at: number }> => {
    const hit = kept.get(url);
    if (hit && now() - hit.at < KEEP_MS) return { value: hit.value as T, at: hit.at };
    let json: unknown;
    try {
      const res = await fetcher(url);
      if (!res.ok) throw new Error(String(res.status));
      json = await res.json();
    } catch {
      throw new Error(NOT_ANSWERING);
    }
    const value = read(json);
    const at = now();
    if (keepIf(value)) {
      kept.delete(url);
      kept.set(url, { at, value });
      if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value as string);
    }
    return { value, at };
  };
  return {
    // A place nothing matches is kept too: it was a good answer.
    geocode: async (name) => (await get(geocodeUrl(name), parseGeocode, () => true)).value,
    forecast: async (points, days) => {
      const { value, at } = await get(forecastUrl(points, days), (json) => parseForecast(json, points.length), (v) => v !== null);
      if (!value) throw new Error(NOT_ANSWERING);
      return { series: value, at };
    },
  };
}

/** A small, steady number from text, for the made-up demo weather. */
function seed(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

/** Made-up hours for the demo: mild, a breeze, the odd shower. The same for the same ride every time. */
export function demoSeries(key: string, count: number, hours: string[]): HourlySeries[] {
  return Array.from({ length: count }, (_, p) => {
    const base = 12 + seed(`${key}:${p}`) * 14;
    const wet = seed(`${key}:wet:${p}`);
    return {
      time: hours,
      temp: hours.map((h) => {
        const hr = Number(h.slice(11, 13));
        return Math.round((base + 5 * Math.sin(((hr - 9) / 24) * 2 * Math.PI)) * 10) / 10;
      }),
      rain: hours.map((h, i) => Math.round(wet * 70 * (0.5 + 0.5 * Math.sin(i / 3 + p)))),
      gust: hours.map((h, i) => Math.round(20 + seed(`${key}:g:${p}`) * 35 + 5 * Math.sin(i / 2))),
      code: hours.map((h, i) => (wet > 0.6 && i % 4 === 2 ? 80 : wet > 0.3 ? 3 : 1)),
    };
  });
}

const DEMO_PLACE = { lat: -37.81, lng: 144.96 };

/** The demo's source: any name is found, and the forecast is made up for each day's 24 hours. */
export const demoSource: ForecastSource = {
  geocode: async (name) => ({ label: name, ...DEMO_PLACE }),
  forecast: async (points, days) => {
    const hours = days.flatMap((d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`));
    return { series: demoSeries(`${points.map((p) => p.label).join('|')}:${days[0]}`, points.length, hours), at: Date.now() };
  },
};

/** The live source: the phone's own `fetch`. */
export const liveSource: ForecastSource = forecastSource((url) => fetch(url));

/** The forecast for a ride along its route, or at its meeting place. Throws NOT_ANSWERING when Open-Meteo fails. */
export async function rideForecast(ride: Ride, data: ClubData, today: string, source: ForecastSource): Promise<RideForecast> {
  const reach = forecastReach(ride, today);
  if (reach.kind !== 'ready') return reach;

  const route = routeOf(ride.id, data);
  let points = route ? routePoints(route) : [];
  let place: string | null = null;
  if (points.length === 0 && ride.location) {
    for (const guess of placeGuesses(ride.location)) {
      const hit = await source.geocode(guess);
      if (hit) {
        points = [hit];
        place = hit.label;
        break;
      }
    }
  }
  if (points.length === 0) return { kind: 'none' };

  const { series, at } = await source.forecast(points, reach.days);
  const days = new Set(reach.days);
  const window = rideWindow(ride);
  const view = forecastView(points, series, { ...window, days: reach.days, hours: window.hours.filter((h) => days.has(h.slice(0, 10))) });
  if (!view) throw new Error(NOT_ANSWERING);
  return { kind: 'ready', view, clipped: reach.clipped, place, fetchedAt: at };
}
