// The in-app ride map: whether this phone can show one, where the camera sits so the route and the
// riders fit, the pins for riders on a live ride, and the "Navigate" hand-off to a maps app. The
// map itself is the phone's own: Apple Maps on an iPhone, Google Maps on Android.

import { haversineM } from './gpx';
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

/**
 * How far from the line a rider can be and still count as on the ride: a servo, a lunch stop or a
 * wrong turn. Further than this, they're on their way to the start.
 */
const ON_ROUTE_M = 5000;
/** A rider this close to the start hasn't set off yet, whatever stretch is nearest (on a loop, the last one). */
const AT_START_M = 300;
/** Stretches this close to the nearest one count as "here too" (the two sides of an out-and-back). */
const SAME_PLACE_M = 60;
/** Google Maps takes 9 waypoints from a link; Apple Maps takes more, but 9 keeps both alike. */
const MAX_WAYPOINTS = 9;

/** The part of a route still to ride, and whether that's the whole thing from its start. */
export interface RouteAhead {
  line: [number, number][];
  fromStart: boolean;
}

/** Where the rider is, and the way they're heading in degrees from north when the phone knows. */
export type RiderSpot = LatLng & { heading?: number | null };

/** Metres from `p` to the segment a–b, on a flat projection (fine over a few kilometres). */
function toSegmentM(p: LatLng, a: [number, number], b: [number, number]): number {
  const kx = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a[1] - p.lng) * kx;
  const ay = a[0] - p.lat;
  const bx = (b[1] - p.lng) * kx;
  const by = b[0] - p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return haversineM([p.lat, p.lng], [p.lat + y, p.lng + x / (kx || 1)]);
}

/** The compass bearing from a to b, 0–360. */
function bearing(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad);
  const x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

const turnBetween = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/**
 * What's left of the route for a rider at `at`: from the next point past the stretch they're on,
 * so a maps app never turns them round. Where the route passes the same spot twice (an
 * out-and-back), the pass running the way they're heading wins, else the earlier. Within 300 m of the start it's
 * the whole route (on a loop the closing stretch is right there too). The whole route from its
 * start when we don't know where they are, or they're more than 5 km off it.
 */
export function routeAhead(line: [number, number][], at: RiderSpot | null): RouteAhead {
  if (!at || line.length < 2) return { line, fromStart: true };
  const dist = line.slice(0, -1).map((p, i) => toSegmentM(at, p, line[i + 1]));
  const nearestM = Math.min(...dist);
  if (nearestM > ON_ROUTE_M) return { line, fromStart: true };
  if (haversineM([at.lat, at.lng], line[0]) <= AT_START_M) return { line, fromStart: false };
  // Stretches about as near as the nearest, in runs of neighbours: each run is one pass of that
  // spot (both sides of an out-and-back are two runs). Each run's own nearest stretch stands for it.
  const legs: number[] = [];
  let prev = -2;
  dist.forEach((m, i) => {
    if (m > nearestM + SAME_PLACE_M) return;
    if (i === prev + 1 && legs.length > 0) {
      if (m < dist[legs[legs.length - 1]]) legs[legs.length - 1] = i;
    } else legs.push(i);
    prev = i;
  });
  const heading = typeof at.heading === 'number' && at.heading >= 0 ? at.heading : null;
  let best = legs[0];
  if (heading !== null && legs.length > 1) {
    const going = legs.find((i) => turnBetween(bearing(line[i], line[i + 1]), heading) < 90);
    if (going !== undefined) best = going;
  }
  return { line: line.slice(best + 1), fromStart: false };
}

/** Up to `n` points spread evenly by distance along `line`, never its last point. */
function spread(line: [number, number][], n: number): [number, number][] {
  if (n <= 0 || line.length < 2) return [];
  const at: number[] = [0];
  for (let i = 1; i < line.length; i++) at.push(at[i - 1] + haversineM(line[i - 1], line[i]));
  const total = at[at.length - 1];
  const picked: number[] = [];
  let j = 0;
  for (let k = 1; k <= n; k++) {
    const want = (total * k) / (n + 1);
    while (j < at.length - 1 && Math.abs(at[j + 1] - want) < Math.abs(at[j] - want)) j++;
    if (j < line.length - 1 && picked[picked.length - 1] !== j) picked.push(j);
  }
  return picked.map((i) => line[i]);
}

/** Whether this iPhone's Apple Maps takes waypoints in a link (iOS 18.4 and later). */
function appleTakesWaypoints(version: string | number): boolean {
  const [major, minor] = String(version).split('.').map((n) => parseInt(n, 10) || 0);
  return major > 18 || (major === 18 && minor >= 4);
}

/**
 * "Follow the route": maps apps that will lead a rider along `ahead` rather than their own way to
 * one spot, as closely as a link allows: the route's end as the destination and up to 9 points
 * along it as waypoints, from wherever the phone is. Apple Maps (iPhone, iOS 18.4 and later), then
 * Google Maps. Waze can't take waypoints, so it isn't offered. The GPX share follows every bend.
 */
/** The apps that can follow a route on this phone, in order, without working any route out. */
export function followApps(os: string, version: string | number): NavApp[] {
  return os === 'ios' && appleTakesWaypoints(version) ? ['apple', 'google'] : ['google'];
}

export function followRouteOptions(ahead: RouteAhead, os: string, version: string | number): NavOption[] {
  const { line } = ahead;
  if (line.length === 0) return [];
  const end = line[line.length - 1];
  // From the start, the start itself goes first, so a rider on their way there is taken to it.
  const points = ahead.fromStart && line.length > 1 ? [line[0], ...spread(line.slice(1), MAX_WAYPOINTS - 1)] : spread(line, MAX_WAYPOINTS);
  const fmt = (p: [number, number]) => `${coord(p[0])},${coord(p[1])}`;
  const dest = fmt(end);
  // No repeats, and never the destination itself: each one would be a stop for nothing.
  const wps = [...new Set(points.map(fmt))].filter((p) => p !== dest);
  const list: NavOption[] = [];
  if (followApps(os, version).includes('apple')) {
    const w = wps.map((p) => `&waypoint=${p}`).join('');
    list.push({ app: 'apple', label: 'Apple Maps', url: `https://maps.apple.com/directions?destination=${dest}${w}&mode=driving` });
  }
  const gw = wps.length > 0 ? `&waypoints=${wps.join('%7C')}` : '';
  list.push({ app: 'google', label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${dest}${gw}&travelmode=driving` });
  return list;
}

/** How far along the route Waze is sent: far enough to be worth a tap, near enough to keep it on the route. */
const WAZE_AHEAD_M = 30_000;

/**
 * Waze takes one spot, never waypoints, so the best it can do is the point about 30 km further
 * along the route (the end when less is left), or the start for a rider on the way to the ride.
 * Tapping again there sends it on to the next. Null when there's no route.
 */
export function wazeAheadUrl(ahead: RouteAhead): string | null {
  const { line } = ahead;
  if (line.length === 0) return null;
  let target = line[line.length - 1];
  if (ahead.fromStart) target = line[0];
  else {
    let gone = 0;
    for (let i = 1; i < line.length; i++) {
      gone += haversineM(line[i - 1], line[i]);
      if (gone >= WAZE_AHEAD_M) {
        target = line[i];
        break;
      }
    }
  }
  return `https://waze.com/ul?ll=${coord(target[0])},${coord(target[1])}&navigate=yes`;
}

/**
 * A link that looks a typed place up (a ride's meeting point, say) in the phone's own maps app:
 * Apple Maps on an iPhone, Google Maps everywhere else. Both open in the browser without the app.
 */
export function placeSearchUrl(query: string, os: string): string {
  const q = encodeURIComponent(query.trim());
  return os === 'ios' ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
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
