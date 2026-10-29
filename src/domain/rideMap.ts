// The in-app ride map: whether this phone can show one, where the camera sits so the route and the
// riders fit, the pins for riders on a live ride, and the "Navigate" hand-off to a maps app. The
// map itself is the phone's own: Apple Maps on an iPhone, Google Maps on Android.

import { isStale } from './liveRide';
import type { LatLng, LiveRider, Route } from './types';

type Bounds = Route['bounds'];

/**
 * Whether this build can draw a real map. iPhones need iOS 17 for Apple Maps here; Android needs
 * the build to carry a Google Maps key. The web preview never does, and keeps the drawn shape.
 */
export function mapsAvailable(p: { os: string; version: string | number; androidKey: boolean }): boolean {
  if (p.os === 'ios') return parseInt(String(p.version), 10) >= 17;
  if (p.os === 'android') return p.androidKey;
  return false;
}

/** The smallest box holding the route's bounds (if any) and every point. Null when there's nothing. */
export function boundsAround(route: Bounds | null, points: LatLng[]): Bounds | null {
  let b = route ? { ...route } : null;
  for (const p of points) {
    b = b
      ? { minLat: Math.min(b.minLat, p.lat), minLng: Math.min(b.minLng, p.lng), maxLat: Math.max(b.maxLat, p.lat), maxLng: Math.max(b.maxLng, p.lng) }
      : { minLat: p.lat, minLng: p.lng, maxLat: p.lat, maxLng: p.lng };
  }
  return b;
}

const POINT_ZOOM = 14;
const MIN_ZOOM = 2;
const TILE = 256;

/** Web Mercator's y for a latitude, in the same units as a longitude span over 360°. */
const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 360;
};

/**
 * Where the camera sits so the bounds fit a `width` × `height` view inside `pad` points: their
 * middle, at the biggest whole zoom that still fits (rounded down, so nothing is cut off).
 */
export function fitCamera(b: Bounds, width: number, height: number, pad: number): LatLng & { zoom: number } {
  const lat = (b.minLat + b.maxLat) / 2;
  const lng = (b.minLng + b.maxLng) / 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const spanX = b.maxLng - b.minLng;
  const spanY = mercY(b.maxLat) - mercY(b.minLat);
  if (w <= 0 || h <= 0 || (spanX <= 0 && spanY <= 0)) return { lat, lng, zoom: POINT_ZOOM };
  const fits = [spanX > 0 ? Math.log2((w * 360) / (TILE * spanX)) : Infinity, spanY > 0 ? Math.log2((h * 360) / (TILE * spanY)) : Infinity];
  const zoom = Math.min(POINT_ZOOM, Math.max(MIN_ZOOM, Math.floor(Math.min(...fits))));
  return { lat, lng, zoom };
}

export type NavApp = 'apple' | 'google' | 'waze';
export interface NavOption {
  app: NavApp;
  label: string;
  url: string;
}

const coord = (n: number) => String(Number(n.toFixed(6)));

/**
 * The maps apps a rider can be taken to `to` in, in order: Apple Maps (iPhone only), Google Maps,
 * Waze. Each is a web link the phone opens in its app when it has it, and in the browser when not.
 * The locked GPX route goes to OsmAnd or MyRoute through the share sheet instead.
 */
export function navigateOptions(to: LatLng, os: string): NavOption[] {
  const at = `${coord(to.lat)},${coord(to.lng)}`;
  const list: NavOption[] = [];
  if (os === 'ios') list.push({ app: 'apple', label: 'Apple Maps', url: `https://maps.apple.com/?daddr=${at}&dirflg=d` });
  list.push({ app: 'google', label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=driving` });
  list.push({ app: 'waze', label: 'Waze', url: `https://waze.com/ul?ll=${at}&navigate=yes` });
  return list;
}

export type PinTone = 'me' | 'help' | 'leader' | 'split' | 'stale' | 'rider';
export interface RiderPin {
  memberId: string;
  name: string;
  position: LatLng;
  tone: PinTone;
}

/**
 * A pin for each rider with a fix: their latest one only, never a trail. Needing help wins, then
 * you, then a fix over 5 minutes old, then split off from the group, then leader.
 */
export function riderPins(riders: LiveRider[], now: string, ctx: { meId: string; help: Set<string>; splitOff: Set<string> }): RiderPin[] {
  return riders.flatMap((r) => {
    if (!r.position) return [];
    const tone: PinTone = ctx.help.has(r.memberId)
      ? 'help'
      : r.memberId === ctx.meId
        ? 'me'
        : !r.updatedAt || isStale(r.updatedAt, now)
          ? 'stale'
          : ctx.splitOff.has(r.memberId)
            ? 'split'
            : r.leader
              ? 'leader'
              : 'rider';
    return [{ memberId: r.memberId, name: r.name, position: r.position, tone }];
  });
}
