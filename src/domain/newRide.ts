// Rides made in the app (website-and-app task 6): who may make, change and call off a ride, and
// what a ride needs. The database's save_ride and set_ride_called_off apply the same rules with the
// same words, in the same order. Spec: docs/superpowers/specs/2026-11-01-app-made-rides-design.md.

import { isNational, managesChapterRides } from './access';
import { melbourneInstant } from './business';
import { addDays } from './dates';
import { RIDE_CATEGORIES } from './labels';
import { lastDay, melbourneDate } from './rides';
import { signedInProblem } from './routes';
import type { ClubData, Member, Ride, RideCategory } from './types';

export const MAX_RIDE_TITLE = 80;
export const MIN_RIDE_TITLE = 3;
export const MAX_RIDE_LOCATION = 120;
export const MAX_RIDE_NOTES = 1000;

export const NOT_RIDE_MANAGER = 'Only the board, ride committee or NEC can make and change rides.';
export const NOT_CHAPTER_RIDE_MANAGER = 'Only that chapter’s board or ride committee can run its rides.';
export const RIDE_TITLE = 'Give the ride a title (3 to 80 characters).';
export const RIDE_CATEGORY = 'Pick a chapter or colour.';
export const RIDE_START = 'Pick a start date and time.';
export const RIDE_PAST = 'A ride starts today or later.';
export const RIDE_END = 'The end comes after the start.';
export const RIDE_LOCATION = 'Keep the meeting place to 120 characters.';
export const RIDE_NOTES = 'Keep the notes to 1,000 characters.';
export const RIDE_GONE = 'No such ride.';
export const CALENDAR_RIDE = 'This ride comes from the club calendar; change it there.';
export const RIDE_OVER = 'That ride is history; it can’t change now.';
export const RIDE_ALREADY_OFF = 'That ride is already called off.';
export const RIDE_NOT_OFF = 'That ride isn’t called off.';

/** What the form sends. Instants are ISO strings; an all-day ride's instants are Melbourne midnights. */
export interface RideInput {
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  category: RideCategory;
  location: string | null;
  notes: string;
  website: boolean;
}

/** A ride made in the app, as opposed to one synced from the club's Google calendar. */
export function isAppRide(ride: Ride): boolean {
  return ride.source === 'app';
}

/** Trim the words; an empty meeting place or end becomes null. */
export function cleanRideInput(input: RideInput): RideInput {
  const location = (input.location ?? '').trim();
  return {
    ...input,
    title: input.title.trim(),
    location: location === '' ? null : location,
    notes: input.notes.trim(),
    endsAt: input.endsAt ? input.endsAt : null,
  };
}

/**
 * Whether `me` runs rides of this category: North and West need that chapter's board or ride
 * committee (or the NEC); the rest take any board seat, ride committee seat or the NEC. The same
 * rule as `managesRide` in crew.ts, asked of a category instead of a ride.
 */
export function managesCategory(me: Member | null, category: RideCategory, data: ClubData): boolean {
  if (category === 'north' || category === 'west') {
    const chapterId = data.chapters.find((c) => c.slug === category)?.id ?? null;
    if (chapterId !== null) return managesChapterRides(me, chapterId, data);
    return me?.approval === 'approved' && isNational(me.id, data.positions);
  }
  return managesChapterRides(me, null, data);
}

/** Whether `me` may make a ride of any category at all (shows the New ride button). */
export function managesAnyCategory(me: Member | null, data: ClubData): boolean {
  return RIDE_CATEGORIES.some((c) => managesCategory(me, c, data));
}

function managerProblem(me: Member, categories: RideCategory[], data: ClubData): string | null {
  if (!managesAnyCategory(me, data)) return NOT_RIDE_MANAGER;
  if (categories.some((c) => !managesCategory(me, c, data))) return NOT_CHAPTER_RIDE_MANAGER;
  return null;
}

function validInstant(iso: string | null | undefined): boolean {
  return typeof iso === 'string' && iso !== '' && !Number.isNaN(new Date(iso).getTime());
}

/** A ride is history once its last Melbourne day has passed. */
function isOver(ride: Ride, now: string): boolean {
  return lastDay(ride) < melbourneDate(now);
}

/** Why `me` can't save this ride (new when `existing` is undefined), or null when they can. */
export function saveRideProblem(
  me: Member | null, existing: Ride | undefined, raw: RideInput, data: ClubData, now: string,
): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn || !me) return signedIn;
  if (existing) {
    if (!isAppRide(existing)) return CALENDAR_RIDE;
    if (isOver(existing, now)) return RIDE_OVER;
  }
  const input = cleanRideInput(raw);
  if (!RIDE_CATEGORIES.includes(input.category)) return RIDE_CATEGORY;
  const manager = managerProblem(me, existing ? [existing.category, input.category] : [input.category], data);
  if (manager) return manager;
  if (input.title.length < MIN_RIDE_TITLE || input.title.length > MAX_RIDE_TITLE) return RIDE_TITLE;
  if (!validInstant(input.startsAt)) return RIDE_START;
  // A new ride, or a moved start, lands today or later; a ride already under way keeps its start.
  const moved = !existing || new Date(input.startsAt).getTime() !== new Date(existing.startsAt).getTime();
  if (moved && melbourneDate(input.startsAt) < melbourneDate(now)) return RIDE_PAST;
  if (input.endsAt !== null) {
    if (!validInstant(input.endsAt)) return RIDE_END;
    if (input.allDay) {
      if (melbourneDate(input.endsAt) < melbourneDate(input.startsAt)) return RIDE_END;
    } else if (new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
      return RIDE_END;
    }
  }
  if ((input.location ?? '').length > MAX_RIDE_LOCATION) return RIDE_LOCATION;
  if (input.notes.length > MAX_RIDE_NOTES) return RIDE_NOTES;
  return null;
}

/** The checks shared by calling off and putting back: an app ride that hasn't started, run by `me`. */
function offSwitchProblem(me: Member | null, ride: Ride | undefined, data: ClubData, now: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn || !me) return signedIn;
  if (!ride) return RIDE_GONE;
  if (!isAppRide(ride)) return CALENDAR_RIDE;
  if (new Date(ride.startsAt).getTime() <= new Date(now).getTime()) return RIDE_OVER;
  return managerProblem(me, [ride.category], data);
}

/** Why `me` can't call this ride off, or null when they can. */
export function callOffProblem(me: Member | null, ride: Ride | undefined, data: ClubData, now: string): string | null {
  const shared = offSwitchProblem(me, ride, data, now);
  if (shared) return shared;
  if (ride?.cancelledAt) return RIDE_ALREADY_OFF;
  return null;
}

/** Why `me` can't put this called-off ride back on, or null when they can. */
export function putBackProblem(me: Member | null, ride: Ride | undefined, data: ClubData, now: string): string | null {
  const shared = offSwitchProblem(me, ride, data, now);
  if (shared) return shared;
  if (!ride?.cancelledAt) return RIDE_NOT_OFF;
  return null;
}

// --- The form's dates and times -------------------------------------------------------------------

export const DATE_HINT = 'Use DD/MM/YYYY, like 14/11/2026.';
export const TIME_HINT = 'Use a 24-hour time, like 09:30.';

/** A typed 24-hour time as "HH:MM", or null when it isn't one. */
export function readRideTime(text: string): string | null {
  const t = text.trim();
  const m = /^(\d{1,2}):(\d\d)$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** The instant a ride starts: Melbourne midnight for an all-day ride, else the typed time on the day. Null when either can't be read. */
export function rideStart(dateIso: string | null, hhmm: string | null, allDay: boolean): string | null {
  if (!dateIso) return null;
  if (allDay) return melbourneInstant(dateIso, '00:00');
  return hhmm ? melbourneInstant(dateIso, hhmm) : null;
}

/**
 * The instant a ride ends. An all-day ride ends at the Melbourne midnight after its last day, the way
 * the calendar stores it (so `lastDay` gives the day back); a timed ride ends at the typed time.
 */
export function rideEnd(dateIso: string | null, hhmm: string | null, allDay: boolean): string | null {
  if (!dateIso) return null;
  if (allDay) return melbourneInstant(addDays(dateIso, 1), '00:00');
  return hhmm ? melbourneInstant(dateIso, hhmm) : null;
}
