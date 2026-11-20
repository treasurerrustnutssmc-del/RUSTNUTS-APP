// Rides ridden in legs (Jeff, 21 Nov 2026: the Big 4 went in as three separate rides). Each leg stays
// a ride of its own, with its own route, crew, chat and ride comms; a trip only links them and
// numbers them. The database's set_ride_legs applies the same rules with the same words, in the
// same order. Spec: docs/superpowers/specs/2026-11-21-ride-legs-design.md.

import { isOver, managerProblem, MAX_RIDE_TITLE, RIDE_GONE, RIDE_OVER } from './newRide';
import { managesRide } from './crew';
import { lastDay } from './rides';
import { signedInProblem } from './routes';
import type { ClubData, Member, Ride, RideCategory } from './types';

export const MAX_LEGS = 6;
export const LEG_SPAN_DAYS = 14;
export const LEGS_TOO_MANY = 'A ride has at most 6 legs.';
export const LEGS_TWICE = 'List each leg once.';
export const LEGS_SPREAD = 'Legs start within 14 days of the first.';

const DAY_MS = 24 * 60 * 60 * 1000;
const byStart = (a: Ride, b: Ride) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id);

/** The legs of the trip this ride is in, in leg order (only those in view), or null when it's in none. */
export function legsOf(rideId: string, data: ClubData): Ride[] | null {
  const legs = data.rideLegs ?? [];
  const mine = legs.find((l) => l.rideId === rideId);
  if (!mine) return null;
  const rides = legs
    .filter((l) => l.tripId === mine.tripId)
    .sort((a, b) => a.legNo - b.legNo)
    .map((l) => data.rides.find((r) => r.id === l.rideId))
    .filter((r): r is Ride => !!r);
  return rides.length >= 2 && rides.some((r) => r.id === rideId) ? rides : null;
}

/** "Leg 2 of 3", or null for a ride that isn't a leg. */
export function legLabel(rideId: string, data: ClubData): string | null {
  const legs = legsOf(rideId, data);
  if (!legs) return null;
  return `Leg ${legs.findIndex((r) => r.id === rideId) + 1} of ${legs.length}`;
}

/** Why `me` can't make these rides (in this order) the legs of one trip, or null. One ride or none unlinks. */
export function setLegsProblem(me: Member | null, rideIds: string[], data: ClubData, now: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn || !me) return signedIn;
  if (rideIds.length > MAX_LEGS) return LEGS_TOO_MANY;
  if (new Set(rideIds).size !== rideIds.length) return LEGS_TWICE;
  const rides: Ride[] = [];
  for (const id of rideIds) {
    const ride = data.rides.find((r) => r.id === id);
    if (!ride) return RIDE_GONE;
    rides.push(ride);
  }
  const manager = managerProblem(me, rides.map((r) => r.category), data);
  if (manager) return manager;
  if (rides.length >= 2) {
    // A ride that's history can't join a trip, but one already in it with another listed leg stays
    // (a trip under way keeps its first legs when it changes or gets a new one).
    const legs = data.rideLegs ?? [];
    const tripOf = (id: string) => legs.find((l) => l.rideId === id)?.tripId;
    const kept = (r: Ride) => {
      const trip = tripOf(r.id);
      return !!trip && rideIds.some((id) => id !== r.id && tripOf(id) === trip);
    };
    if (rides.some((r) => isOver(r, now) && !kept(r))) return RIDE_OVER;
    const first = new Date(rides[0].startsAt).getTime();
    if (rides.some((r) => Math.abs(new Date(r.startsAt).getTime() - first) > LEG_SPAN_DAYS * DAY_MS)) return LEGS_SPREAD;
  }
  return null;
}

/**
 * The rides `me` could link with this one: ones they run, still on and not history, within 14 days,
 * in start order. The legs already in this ride's trip are always listed (history legs stay put).
 */
export function linkableRides(me: Member | null, rideId: string, data: ClubData, now: string): Ride[] {
  const ride = data.rides.find((r) => r.id === rideId);
  if (!me || !ride || !managesRide(me, ride, data)) return [];
  const at = new Date(ride.startsAt).getTime();
  const current = new Set((legsOf(rideId, data) ?? []).map((r) => r.id));
  return data.rides
    .filter(
      (r) =>
        current.has(r.id) ||
        ((r.id === rideId || !r.cancelledAt) &&
          !isOver(r, now) &&
          managesRide(me, r, data) &&
          Math.abs(new Date(r.startsAt).getTime() - at) <= LEG_SPAN_DAYS * DAY_MS),
    )
    .sort(byStart);
}

/** What the New ride form starts with for the leg after this ride's trip (or after this ride on its own). */
export function nextLegDraft(
  rideId: string,
  data: ClubData,
): { title: string; category: RideCategory; dateIso: string; legNo: number; after: string } {
  const legs = legsOf(rideId, data) ?? data.rides.filter((r) => r.id === rideId);
  const first = legs[0];
  const last = legs[legs.length - 1];
  const suffix = `, leg ${legs.length + 1}`;
  const base = first ? first.title.slice(0, MAX_RIDE_TITLE - suffix.length).trim() : 'Ride';
  // The day the last leg finishes: the next leg usually sets off that day or the morning after.
  return {
    title: `${base}${suffix}`,
    category: last?.category ?? 'club',
    dateIso: last ? lastDay(last) : '',
    legNo: legs.length + 1,
    after: last?.title ?? 'that ride',
  };
}

/** The trip's rides after a new leg `newId` is added after the trip this ride is in. */
export function tripAfterSave(rideId: string, newId: string, data: ClubData): string[] {
  const legs = legsOf(rideId, data);
  return [...(legs ? legs.map((r) => r.id) : [rideId]), newId];
}
