// Calling a ride: Off, Postponed (with an optional new day) or Back on, by the ride's writers, until
// the ride day ends. These are the rules the database's call_ride applies, in the same order with
// the same words. The club calendar stays the source of the ride's date.

import { writesBriefing } from './briefings';
import { formatAuDate } from './dates';
import { endOfFirstDay, melbourneDate } from './rides';
import { signedInProblem } from './routes';
import type { ClubData, Member, Ride, RideCall, RideCallState } from './types';

export const MAX_REASON = 200;
/** Tap to fill the reason. */
export const QUICK_REASONS = ['Weather', 'Not enough riders', 'Road closures'];

export const CALL_TOO_LATE = 'It’s too late to call this ride.';
export const NOT_CALLER = 'Only the board, ride committee or this ride’s Road Captain can call the ride.';
export const ALREADY_OFF = 'The ride’s already off.';
export const NOT_CALLED = 'The ride isn’t off or postponed.';
export const REASON_TOO_LONG = 'Keep the reason to 200 characters at most.';
export const NEW_DAY_NEEDS_POSTPONED = 'Only a postponed ride takes a new day.';
export const BAD_NEW_DAY = 'Pick a new day after the ride, within 12 months.';

const pad = (n: number) => String(n).padStart(2, '0');
/** The same date 12 calendar months on, with 29 February rolling to 28 February (as Postgres does). */
function yearOn(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${y + 1}-${pad(m)}-${pad(m === 2 && d === 29 ? 28 : d)}`;
}

/** Why `me` can't make this call, or null when they can. Mirrors public.call_ride. */
export function callProblem(
  me: Member | null,
  ride: Ride | undefined,
  state: RideCallState,
  reason: string,
  newDay: string | null,
  data: ClubData,
  now: string,
): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (Date.parse(now) >= endOfFirstDay(ride)) return CALL_TOO_LATE;
  if (!writesBriefing(me, ride, data)) return NOT_CALLER;
  // A call has to change something (a postponed ride can be postponed again, to a new day).
  const current = activeCall(ride.id, data)?.state ?? 'on';
  if (state === 'off' && current === 'off') return ALREADY_OFF;
  if (state === 'on' && current === 'on') return NOT_CALLED;
  if (state !== 'on' && [...reason.trim()].length > MAX_REASON) return REASON_TOO_LONG;
  if (newDay !== null && state !== 'postponed') return NEW_DAY_NEEDS_POSTPONED;
  const rideDay = melbourneDate(ride.startsAt);
  if (newDay !== null && (newDay <= rideDay || newDay > yearOn(rideDay))) return BAD_NEW_DAY;
  return null;
}

/** The line the call posts in the ride's chat, as the database writes it. */
export function callLine(state: RideCallState, reason: string, newDay: string | null): string {
  const head = state === 'off' ? 'Ride’s off' : state === 'postponed' ? `Ride’s postponed${newDay ? ` to ${formatAuDate(newDay)}` : ''}` : 'Ride’s back on';
  const why = state === 'on' ? '' : reason.trim();
  return why ? `${head}: ${why}` : `${head}.`;
}

/** The ride's call while it's Off or Postponed; null when there's none or it's Back on. */
export function activeCall(rideId: string, data: ClubData): RideCall | null {
  const call = (data.rideCalls ?? []).find((c) => c.rideId === rideId);
  return call && call.state !== 'on' ? call : null;
}

/** "Ride’s off" or "Postponed to 15/11/2026": the banner's title. */
export function callTitle(call: RideCall): string {
  if (call.state === 'off') return 'Ride’s off';
  return call.newDay ? `Postponed to ${formatAuDate(call.newDay)}` : 'Postponed';
}
