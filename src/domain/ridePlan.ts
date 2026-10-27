// A ride's plan: the RC's stops (fuel, coffee, lunch, regroup) on top of the route. These are the
// rules the database's save_ride_plan applies, in the same order with the same words.

import { writesBriefing } from './briefings';
import { endOfFirstDay } from './rides';
import { signedInProblem } from './routes';
import type { ClubData, Member, PlanStop, Ride, StopKind } from './types';

export const MAX_STOPS = 15;
export const MAX_STOP_NAME = 60;
export const MAX_KM = 2000;
export const STOP_KINDS: StopKind[] = ['fuel', 'coffee', 'lunch', 'regroup', 'other'];
export const STOP_LABEL: Record<StopKind, string> = { fuel: 'Fuel', coffee: 'Coffee', lunch: 'Lunch', regroup: 'Regroup', other: 'Other' };

/** Refusals the screens and demo also show, in the database's words. */
export const PLAN_LOCKED = 'The plan can’t change after the ride day.';
export const NOT_PLANNER = 'Only the board, ride committee or this ride’s Road Captain can plan the ride.';
export const TOO_MANY_STOPS = 'That’s too many stops (15 at most).';
export const STOP_NAME = 'Give each stop a short name (60 characters at most).';
export const BAD_KM = 'Check the km: 0 to 2000.';
export const BAD_TIME = 'Write times as 24-hour HH:MM, like 10:30.';
export const PLAN_CONFLICT =
  'Someone else saved this plan while you were editing. Your changes aren’t saved: copy them, then open the plan again.';

/** Whether a refusal is the plan's version check (the screen reloads to show the newer plan). */
export const isPlanConflict = (e: unknown): boolean => e instanceof Error && e.message === PLAN_CONFLICT;

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const length = (s: string): number => [...s].length;

/** The stops as saved: names trimmed, in km order, stops without a km keeping their place after those with one. */
export function cleanStops(stops: PlanStop[]): PlanStop[] {
  const trimmed = stops.map((s) => ({ ...s, name: s.name.trim() }));
  const withKm = trimmed.filter((s) => s.km !== null).sort((a, b) => (a.km as number) - (b.km as number));
  return [...withKm, ...trimmed.filter((s) => s.km === null)];
}

/** Why `me` can't change this ride's plan at all, or null. */
export function editPlanProblem(me: Member | null, ride: Ride | undefined, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (Date.parse(now) >= endOfFirstDay(ride)) return PLAN_LOCKED;
  if (!writesBriefing(me, ride, data)) return NOT_PLANNER;
  return null;
}

/** What's wrong with one stop, checked name (and kind), km, then time; or null. */
export function stopProblem(s: PlanStop): string | null {
  const name = s.name.trim();
  if (!STOP_KINDS.includes(s.kind) || name === '' || length(name) > MAX_STOP_NAME) return STOP_NAME;
  if (s.km !== null && (!Number.isFinite(s.km) || s.km < 0 || s.km > MAX_KM)) return BAD_KM;
  if (s.time !== null && !TIME.test(s.time)) return BAD_TIME;
  return null;
}

/**
 * Why `me` can't save these stops, or null when they can. Mirrors public.save_ride_plan. `seen` is
 * the version the editor opened on (null when there was no plan): a save on top of someone else's
 * newer plan is refused.
 */
export function savePlanProblem(
  me: Member | null,
  ride: Ride | undefined,
  stops: PlanStop[],
  seen: string | null,
  data: ClubData,
  now: string,
): string | null {
  const editing = editPlanProblem(me, ride, data, now);
  if (editing) return editing;
  if (stops.length > MAX_STOPS) return TOO_MANY_STOPS;
  for (const s of stops) {
    const problem = stopProblem(s);
    if (problem) return problem;
  }
  const stored = (data.ridePlans ?? []).find((p) => p.rideId === ride!.id);
  // The app holds milliseconds and the database microseconds: up to 1 ms newer is the same version.
  if (stored && (seen === null || Date.parse(stored.updatedAt) > Date.parse(seen) + 1)) return PLAN_CONFLICT;
  return null;
}

/** What the briefing card lists: the plan's stops when there are any, and the route's waypoints otherwise. */
export function briefingStops(rideId: string, data: ClubData): { name: string; kind?: StopKind; km?: number | null; time?: string | null }[] {
  const planned = (data.ridePlans ?? []).find((p) => p.rideId === rideId)?.stops ?? [];
  if (planned.length > 0) return planned.map((s) => ({ name: s.name, kind: s.kind, km: s.km, time: s.time }));
  const routeId = (data.rideRoutes ?? []).find((r) => r.rideId === rideId)?.routeId;
  const route = (data.routes ?? []).find((r) => r.id === routeId);
  return (route?.stops ?? []).map((s) => ({ name: s.name }));
}
