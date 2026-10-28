// Fuel stops planned around the smallest tank in the pack. Each bike can carry its range (km on a
// full tank before the fuel light comes on); the pack's limit is the shortest range among everyone
// Going and the crew, and every leg between fuel stops has to fit inside 90% of it. Nothing here is
// stored except the range, which the database's set_bike_range checks with the same words.

import { haversineM } from './gpx';
import { signedInProblem } from './routes';
import type { Bike, ClubData, Member, PlanStop, Route } from './types';

export const MIN_RANGE = 30;
export const MAX_RANGE = 1000;
/** The share of the pack's limit a leg may use: a 10% margin on top of the fuel light. */
export const SAFE_SHARE = 0.9;

/** Refusals the screens and demo also show, in the database's words. */
export const NOT_YOUR_BIKE = 'That’s not your bike.';
export const RANGE_LIMITS = 'Range is in km, from 30 to 1000.';

/** Why `me` can't set this bike's range, or null when they can. null clears it. Mirrors public.set_bike_range. */
export function rangeProblem(me: Member | null, bike: Bike | undefined, rangeKm: number | null): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!bike || bike.memberId !== me!.id) return NOT_YOUR_BIKE;
  if (rangeKm !== null && (!Number.isInteger(rangeKm) || rangeKm < MIN_RANGE || rangeKm > MAX_RANGE)) return RANGE_LIMITS;
  return null;
}

/** A member's shortest-range bike that isn't a project, or null when none has a range. */
export function bikeRange(memberId: string, data: ClubData): { bike: Bike; rangeKm: number } | null {
  let best: { bike: Bike; rangeKm: number } | null = null;
  for (const b of data.bikes) {
    if (b.memberId !== memberId || b.isProject || b.rangeKm == null) continue;
    if (!best || b.rangeKm < best.rangeKm) best = { bike: b, rangeKm: b.rangeKm };
  }
  return best;
}

/** Everyone Going to the ride, plus its crew. */
export function packIds(rideId: string, data: ClubData): string[] {
  const ids = new Set(data.rsvps.filter((r) => r.rideId === rideId && r.answer === 'going').map((r) => r.memberId));
  for (const s of data.crew ?? []) if (s.rideId === rideId) ids.add(s.memberId);
  return [...ids].filter((id) => data.members.some((m) => m.id === id));
}

export interface PackLimit {
  memberId: string;
  bikeId: string;
  rangeKm: number;
}

/** The pack's shortest range and whose bike it is (null when nobody has one), and who has no range on file. */
export function packLimit(rideId: string, data: ClubData): { limit: PackLimit | null; unknown: string[]; riders: number } {
  const ids = packIds(rideId, data);
  let limit: PackLimit | null = null;
  const unknown: string[] = [];
  for (const id of ids) {
    const r = bikeRange(id, data);
    if (!r) unknown.push(id);
    else if (!limit || r.rangeKm < limit.rangeKm) limit = { memberId: id, bikeId: r.bike.id, rangeKm: r.rangeKm };
  }
  return { limit, unknown, riders: ids.length };
}

/** The longest a leg can be on this range, in whole km. */
export const safeLeg = (rangeKm: number): number => Math.floor(rangeKm * SAFE_SHARE);

/** How far along the route a point is, in km: the nearest point on its line, scaled to the route's distance. */
export function kmAlong(route: Pick<Route, 'line' | 'distanceM'>, point: [number, number]): number {
  const line = route.line;
  if (line.length < 2) return 0;
  const cos = Math.cos((point[0] * Math.PI) / 180);
  let walked = 0;
  let best = { d: Infinity, at: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const seg = haversineM(a, b);
    // Nearest point on the segment, on a flat map with longitude scaled by latitude.
    const ax = a[1] * cos, ay = a[0], bx = b[1] * cos, by = b[0], px = point[1] * cos, py = point[0];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
    const near: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = haversineM(near, point);
    if (d < best.d) best = { d, at: walked + t * seg };
    walked += seg;
  }
  const scale = walked > 0 && route.distanceM > 0 ? route.distanceM / walked : 1;
  return (best.at * scale) / 1000;
}

export interface FuelLeg {
  from: string;
  to: string;
  fromKm: number;
  toKm: number;
  km: number;
  tooLong: boolean;
  /** For a long leg: the km to have fuelled by (the leg's start plus the safe leg). */
  fuelByKm: number | null;
  /** For a long leg: the furthest stop or route waypoint after the leg's start and by that km. */
  suggest: string | null;
}

export interface FuelCheck {
  limit: PackLimit | null;
  /** The safe leg on the pack's limit, or null with no limit. */
  safeKm: number | null;
  /** Going or crew with no range on file. */
  unknown: string[];
  /** The legs, or null without a route or a limit. */
  legs: FuelLeg[] | null;
  /** No leg is too long (true when there's nothing to check). */
  ok: boolean;
}

/**
 * The fuel check for a ride: the pack's limit, and with a route the legs from the start (everyone
 * starts full) through each Fuel stop with a km, in order, to the route's end.
 */
export function fuelCheck(rideId: string, data: ClubData): FuelCheck {
  const { limit, unknown } = packLimit(rideId, data);
  const safeKm = limit ? safeLeg(limit.rangeKm) : null;
  const routeId = (data.rideRoutes ?? []).find((r) => r.rideId === rideId)?.routeId;
  const route = (data.routes ?? []).find((r) => r.id === routeId);
  if (!route || safeKm === null) return { limit, safeKm, unknown, legs: null, ok: true };
  const stops = (data.ridePlans ?? []).find((p) => p.rideId === rideId)?.stops ?? [];
  const legs = fuelLegs(stops, route, safeKm);
  return { limit, safeKm, unknown, legs, ok: legs.every((l) => !l.tooLong) };
}

/** The legs between fuel stops on a route, each checked against the safe leg. */
export function fuelLegs(stops: PlanStop[], route: Route, safeKm: number): FuelLeg[] {
  const endKm = route.distanceM / 1000;
  const fuels = stops
    .filter((s): s is PlanStop & { km: number } => s.kind === 'fuel' && s.km !== null)
    .sort((a, b) => a.km - b.km);
  // Where fuel could go: the plan's stops with a km, and the route's waypoints.
  const places = [
    ...stops.filter((s) => s.km !== null).map((s) => ({ name: s.name, km: s.km as number })),
    ...route.stops.map((w) => ({ name: w.name, km: kmAlong(route, [w.lat, w.lng]) })),
  ];
  const points = [{ name: 'Start', km: 0 }, ...fuels.map((f) => ({ name: f.name, km: f.km })), { name: 'Finish', km: Math.max(endKm, fuels.at(-1)?.km ?? 0) }];
  const legs: FuelLeg[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const km = to.km - from.km;
    const tooLong = km > safeKm;
    const fuelByKm = tooLong ? from.km + safeKm : null;
    const suggest = fuelByKm === null
      ? null
      : places
          .filter((p) => p.km > from.km && p.km <= fuelByKm)
          .sort((a, b) => b.km - a.km)[0]?.name ?? null;
    legs.push({ from: from.name, to: to.name, fromKm: from.km, toKm: to.km, km, tooLong, fuelByKm, suggest });
  }
  return legs;
}
