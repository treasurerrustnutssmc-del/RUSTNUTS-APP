// Which notifications a member gets. Ride reminders are set on the phone itself, so the club sends
// nothing; the rest come as pushes once the app launches (part 3b).

import { melbourneDate, melbourneTime } from './rides';
import type { NotificationPrefs, Ride, Rsvp } from './types';

export const DEFAULT_PREFS: NotificationPrefs = { rideReminders: true, rideChanges: true, newRides: false, approvals: true };

/** A reminder the phone should have scheduled. */
export interface Reminder {
  /** "ride-<ride id>": one per ride, so a moved ride replaces its reminder. */
  id: string;
  rideId: string;
  at: string;
  title: string;
  body: string;
}

/** Phones hold 64 scheduled notifications on iPhone; leave room for everything else. */
const MAX_REMINDERS = 30;
const HOUR = 3_600_000;

/** 7:00 am Melbourne time on the day an instant falls on (Melbourne), daylight saving or not. */
function sevenAm(startsAt: string): number {
  const day = melbourneDate(startsAt);
  const base = Date.parse(`${day}T00:00:00Z`) - 14 * HOUR;
  for (let t = base; t < base + 28 * HOUR; t += HOUR) {
    const iso = new Date(t).toISOString();
    if (melbourneDate(iso) === day && melbourneTime(iso) === '7:00 am') return t;
  }
  return Date.parse(startsAt) + 7 * HOUR;
}

/** Reminders for rides this member is going to: 2 hours before, or 7 am on an all-day ride's first day. */
export function reminderPlan(rides: Ride[], rsvps: Rsvp[], meId: string | null, prefs: NotificationPrefs, now: string): Reminder[] {
  if (!meId || !prefs.rideReminders) return [];
  const goingTo = new Set(rsvps.filter((r) => r.memberId === meId && r.answer === 'going').map((r) => r.rideId));
  const nowMs = Date.parse(now);
  return rides
    .filter((r) => goingTo.has(r.id) && !r.cancelledAt)
    .map((r): Reminder => {
      const at = r.allDay ? sevenAm(r.startsAt) : Date.parse(r.startsAt) - 2 * HOUR;
      const when = r.allDay ? 'All day' : melbourneTime(r.startsAt);
      return {
        id: `ride-${r.id}`,
        rideId: r.id,
        at: new Date(at).toISOString(),
        title: r.allDay ? 'Ride today' : 'Ride in 2 hours',
        body: [r.title, when, r.location?.trim()].filter(Boolean).join(' · '),
      };
    })
    .filter((r) => Date.parse(r.at) > nowMs)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, MAX_REMINDERS);
}

/** What the phone should schedule and cancel to match the plan. A reminder whose time changed is both. */
export function reminderDiff(plan: Reminder[], scheduled: { id: string; at: string }[]): { add: Reminder[]; cancel: string[] } {
  const wanted = new Map(plan.map((r) => [r.id, r]));
  const have = new Map(scheduled.map((s) => [s.id, s.at]));
  const cancel = scheduled.filter((s) => wanted.get(s.id)?.at !== s.at).map((s) => s.id);
  const add = plan.filter((r) => have.get(r.id) !== r.at);
  return { add, cancel };
}
