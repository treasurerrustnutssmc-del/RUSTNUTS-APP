// Rides from the club calendar: Melbourne-time display, the default filter, month grouping and
// who can answer. The database's set_rsvp action applies the same rules with the same words.

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

/** Rides from today on (cancelled ones too, so people see they're off), by Melbourne month. */
export function upcomingByMonth(
  rides: Ride[],
  categories: RideCategory[],
  today: string,
): { month: string; rides: Ride[] }[] {
  const months: { key: string; month: string; rides: Ride[] }[] = [];
  const shown = rides
    .filter((r) => categories.includes(r.category) && melbourneDate(r.startsAt) >= today)
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
  if (new Date(now).getTime() >= new Date(ride.startsAt).getTime()) return 'That ride has already started.';
  return null;
}

export function rsvpCounts(rideId: string, rsvps: Rsvp[]): Record<RsvpAnswer, number> {
  const counts: Record<RsvpAnswer, number> = { going: 0, maybe: 0, no: 0 };
  for (const r of rsvps) if (r.rideId === rideId) counts[r.answer] += 1;
  return counts;
}
