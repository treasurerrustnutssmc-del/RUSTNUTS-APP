// Rides from the club calendar: Melbourne-time display, the default filter, month grouping and
// who can answer. The database's set_rsvp action applies the same rules with the same words.

import { formatAuDate } from './dates';
import type { Chapter, Member, Ride, RideCategory, Rsvp, RsvpAnswer } from './types';

const ZONE = 'Australia/Melbourne';

function parts(iso: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, ...options }).formatToParts(new Date(iso))) {
    out[p.type] = p.value;
  }
  return out;
}

/** The Melbourne calendar date (YYYY-MM-DD) of an instant. */
export function melbourneDate(iso: string): string {
  const p = parts(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "7:30 am", in Melbourne time. */
export function melbourneTime(iso: string): string {
  const p = parts(iso, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toLowerCase()}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Your own chapter's rides, the whole club's and supported clubs'. */
export function defaultCategories(me: Member, chapters: Chapter[]): RideCategory[] {
  const slug = chapters.find((c) => c.id === me.chapterId)?.slug;
  const own: RideCategory[] = slug === 'north' || slug === 'west' ? [slug] : [];
  return [...own, 'club', 'supported'];
}

/** The Melbourne date a ride's last day falls on (a calendar's all-day end is the midnight after). */
export function lastDay(ride: Ride): string {
  if (!ride.endsAt) return melbourneDate(ride.startsAt);
  return melbourneDate(new Date(new Date(ride.endsAt).getTime() - (ride.allDay ? 1 : 0)).toISOString());
}

const HOUR = 3600_000;

function isMelbourneMidnight(t: number): boolean {
  return melbourneTime(new Date(t).toISOString()) === '12:00 am';
}

/** The first Melbourne midnight after the ride's Melbourne start date, as epoch ms. */
export function endOfFirstDay(ride: Ride): number {
  const startsAt = new Date(ride.startsAt).getTime();
  // Back to the midnight that opened the start date (Melbourne is UTC+10 or +11).
  const [y, m, d] = melbourneDate(ride.startsAt).split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const dayStart = [11, 10].map((h) => utcMidnight - h * HOUR).find(isMelbourneMidnight) ?? startsAt;
  // The next Melbourne midnight: a day on, give or take the daylight saving hour.
  const next = [23, 24, 25].map((h) => dayStart + h * HOUR).find(isMelbourneMidnight);
  return next ?? dayStart + 24 * HOUR;
}

/** When answers close: at the start, or for an all-day ride when its first day is over. */
export function answersClose(ride: Ride): number {
  return ride.allDay ? endOfFirstDay(ride) : new Date(ride.startsAt).getTime();
}

/** Rides from today on, a multi-day one until its last day (cancelled ones too, so people see
 *  they're off), by the Melbourne month they start in. */
export function upcomingByMonth(
  rides: Ride[],
  categories: RideCategory[],
  today: string,
): { month: string; rides: Ride[] }[] {
  const months: { key: string; month: string; rides: Ride[] }[] = [];
  const shown = rides
    .filter((r) => categories.includes(r.category) && lastDay(r) >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const ride of shown) {
    const key = melbourneDate(ride.startsAt).slice(0, 7);
    let group = months.find((m) => m.key === key);
    if (!group) {
      group = { key, month: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, rides: [] };
      months.push(group);
    }
    group.rides.push(ride);
  }
  return months.map(({ month, rides: list }) => ({ month, rides: list }));
}

/** Why `me` can't answer this ride right now, or null when they can. Mirrors public.set_rsvp. */
export function rsvpProblem(me: Member | null, ride: Ride | undefined, now: string): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (new Date(now).getTime() >= answersClose(ride)) return 'That ride has already started.';
  return null;
}

export function rsvpCounts(rideId: string, rsvps: Rsvp[]): Record<RsvpAnswer, number> {
  const counts: Record<RsvpAnswer, number> = { going: 0, maybe: 0, no: 0 };
  for (const r of rsvps) if (r.rideId === rideId) counts[r.answer] += 1;
  return counts;
}

/** The sync runs every 15 minutes; past an hour behind, the calendar is out of date. */
const STALE_AFTER_MS = 60 * 60_000;

/**
 * What the Rides tab says about the calendar. `syncedAt` is the oldest feed's last good read (null
 * when a feed has never been read). Stale means it's worth a warning above the list.
 */
export function calendarFreshness(syncedAt: string | null, hasRides: boolean, now: string): { stale: boolean; text: string } {
  if (!syncedAt) {
    return hasRides
      ? { stale: true, text: 'Part of the club calendar hasn’t loaded yet. Some rides may be missing.' }
      : { stale: false, text: 'Not updated from the club calendar yet' };
  }
  const when = `${formatAuDate(melbourneDate(syncedAt))} ${melbourneTime(syncedAt)}`;
  return new Date(now).getTime() - new Date(syncedAt).getTime() > STALE_AFTER_MS
    ? { stale: true, text: `Club calendar last updated ${when}. Some rides may be out of date.` }
    : { stale: false, text: `Updated ${when} from the club calendar` };
}
