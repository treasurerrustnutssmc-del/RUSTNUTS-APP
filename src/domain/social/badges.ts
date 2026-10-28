// Badges: what a member has ridden, from their check-ins. Rides, Big 4s, kilometres and the states
// and territories their rides' routes passed through. Worked out on the phone from data the app
// already has; nothing is stored and nobody is told.

import { appliesTo } from '../big4';
import type { ClubData, Member, Route, RideRoute } from '../types';

export type AuState = 'VIC' | 'NSW' | 'ACT' | 'QLD' | 'SA' | 'NT' | 'WA' | 'TAS';
/** The order states are listed in: home first, then the neighbours outwards. */
export const AU_STATES: AuState[] = ['VIC', 'NSW', 'ACT', 'SA', 'TAS', 'QLD', 'NT', 'WA'];
export const STATE_NAME: Record<AuState, string> = {
  VIC: 'Victoria', NSW: 'New South Wales', ACT: 'Australian Capital Territory', QLD: 'Queensland', SA: 'South Australia',
  NT: 'Northern Territory', WA: 'Western Australia', TAS: 'Tasmania',
};

export type BadgeTrack = 'rides' | 'big4' | 'km' | 'states';

const TIERS: Record<BadgeTrack, [number, string][]> = {
  rides: [[1, 'First ride'], [10, '10 rides'], [25, '25 rides'], [50, '50 rides'], [100, '100 rides']],
  big4: [[1, 'First Big 4'], [4, '4 Big 4s'], [10, '10 Big 4s']],
  km: [[1000, '1,000 km'], [5000, '5,000 km'], [10000, '10,000 km'], [25000, '25,000 km']],
  states: [[2, 'Two states'], [3, 'Three states'], [5, 'Five states'], [8, 'Every state and territory']],
};

export interface TrackBadge {
  track: BadgeTrack;
  /** How many so far (rides, Big 4s, whole kilometres, states). */
  value: number;
  /** The highest badge earned on this track, or null for none yet. */
  earned: string | null;
  /** What the next badge needs, or null at the top. */
  next: number | null;
  /** The next badge's name. */
  nextLabel: string | null;
  /** How far from the last badge (or none) to the next, 0 to 1; 1 at the top. */
  progress: number;
}

export interface Badges {
  tracks: TrackBadge[];
  /** The states and territories ridden, in `AU_STATES` order. */
  states: AuState[];
}

function trackOf(track: BadgeTrack, value: number): TrackBadge {
  const tiers = TIERS[track];
  const reached = tiers.filter(([at]) => value >= at);
  const nextTier = tiers.find(([at]) => value < at);
  const from = reached.at(-1)?.[0] ?? 0;
  return {
    track,
    value,
    earned: reached.at(-1)?.[1] ?? null,
    next: nextTier?.[0] ?? null,
    nextLabel: nextTier?.[1] ?? null,
    progress: nextTier ? Math.max(0, (value - from) / (nextTier[0] - from)) : 1,
  };
}

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "23 rides", "1 Big 4", "3,788 km", "3 states". */
export function badgeCount(track: BadgeTrack, n: number): string {
  if (track === 'km') return `${thousands(n)} km`;
  const word = { rides: ['ride', 'rides'], big4: ['Big 4', 'Big 4s'], states: ['state', 'states'] }[track];
  return `${thousands(n)} ${n === 1 ? word[0] : word[1]}`;
}

/** "2,290 more for 5,000 km", or "Top badge". */
export function toGoLine(t: TrackBadge): string {
  return t.next === null || t.nextLabel === null ? 'Top badge' : `${thousands(t.next - t.value)} more for ${t.nextLabel}`;
}

// ---------------------------------------------------------------------------------------------
// Which state a point is in: simplified borders, close enough for a badge (a ride hugging a border
// can be off by a few kilometres). Points are [lng, lat].

/** The Victoria and New South Wales border: the Murray, then the straight line to Cape Howe. */
const MURRAY: [number, number][] = [
  [140.96, -34.0], [142.16, -34.17], [142.75, -34.57], [143.56, -35.33], [144.75, -36.125], [146.0, -36.0],
  [146.9, -36.1], [147.4, -36.05], [148.2, -36.8], [149.976, -37.505],
];
/** The Queensland and New South Wales border: the 29th parallel, the Dumaresq, then the ranges to the coast. */
const QLD_BORDER: [number, number][] = [
  [141.0, -29.0], [148.95, -29.0], [150.3, -28.6], [151.15, -28.9], [151.93, -28.95], [152.5, -28.35], [153.55, -28.17],
];
const ACT: [number, number][] = [
  [148.95, -35.12], [149.15, -35.12], [149.2, -35.2], [149.2, -35.42], [149.12, -35.5], [149.1, -35.92], [148.8, -35.75],
  [148.76, -35.4], [148.85, -35.25],
];

/** The border's latitude at this longitude, held flat past either end. */
function latOn(line: [number, number][], lng: number): number {
  if (lng <= line[0][0]) return line[0][1];
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    if (lng <= x1) return y0 + ((lng - x0) / (x1 - x0)) * (y1 - y0);
  }
  return line[line.length - 1][1];
}

function inside(poly: [number, number][], lng: number, lat: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The state or territory at a point, or null at sea or overseas. */
export function stateAt(lat: number, lng: number): AuState | null {
  if (lat > -10 || lat < -44 || lng < 112.9 || lng > 154) return null;
  if (lat <= -39.2) return lng >= 143.5 && lng <= 149 ? 'TAS' : null;
  if (lng < 129) return 'WA';
  if (lng < 138) return lat > -26 ? 'NT' : 'SA';
  // South Australia runs to 141° east, and to 140.96° beside Victoria.
  if (lng < (lat < -34 ? 140.96 : 141)) return lat > -26 ? 'QLD' : 'SA';
  if (lat > latOn(QLD_BORDER, lng)) return 'QLD';
  if (lng <= 149.976 && lat < latOn(MURRAY, lng)) return 'VIC';
  if (inside(ACT, lng, lat)) return 'ACT';
  return lat >= -37.6 ? 'NSW' : null;
}

/** The states a route passes through (its line and stops), in `AU_STATES` order. */
export function statesOnRoute(route: Pick<Route, 'line' | 'stops'>): AuState[] {
  const found = new Set<AuState>();
  for (const [lat, lng] of route.line) {
    const s = stateAt(lat, lng);
    if (s) found.add(s);
  }
  for (const stop of route.stops) {
    const s = stateAt(stop.lat, stop.lng);
    if (s) found.add(s);
  }
  return AU_STATES.filter((s) => found.has(s));
}

// ---------------------------------------------------------------------------------------------

/**
 * A member's badges from their check-ins. Each ride counts once however many check-ins it had; a
 * ride check-in with no calendar ride counts on its own. `rideRoutes` is which route each ride
 * used, past rides included.
 */
export function badgesFor(
  member: Member,
  data: Partial<Pick<ClubData, 'checkinSessions' | 'attendance' | 'big4Rides' | 'routes'>>,
  rideRoutes: RideRoute[],
): Badges {
  const sessions = new Map((data.checkinSessions ?? []).map((s) => [s.id, s]));
  const ridden = new Set<string>();
  const rideIds = new Set<string>();
  for (const a of data.attendance ?? []) {
    if (a.memberId !== member.id) continue;
    const s = sessions.get(a.sessionId);
    if (!s || s.kind !== 'ride') continue;
    ridden.add(s.rideId ?? `session:${s.id}`);
    if (s.rideId) rideIds.add(s.rideId);
  }
  const big4 = (data.big4Rides ?? []).filter((b) => rideIds.has(b.rideId) && appliesTo(b, member)).length;

  const routeOf = new Map(rideRoutes.map((r) => [r.rideId, r.routeId]));
  const routes = new Map((data.routes ?? []).map((r) => [r.id, r]));
  let metres = 0;
  const states = new Set<AuState>();
  for (const rideId of rideIds) {
    const route = routes.get(routeOf.get(rideId) ?? '');
    if (!route) continue;
    metres += route.distanceM;
    for (const s of statesOnRoute(route)) states.add(s);
  }
  const listed = AU_STATES.filter((s) => states.has(s));
  return {
    tracks: [
      trackOf('rides', ridden.size),
      trackOf('big4', big4),
      trackOf('km', Math.floor(metres / 1000)),
      trackOf('states', listed.length),
    ],
    states: listed,
  };
}
