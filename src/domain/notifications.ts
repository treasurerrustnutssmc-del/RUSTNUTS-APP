// Which notifications a member gets. Ride reminders are set on the phone itself, so the club sends
// nothing; the rest come as pushes once the app launches (part 3b).

import { melbourneDate, melbourneTime } from './rides';
import type { NotificationPrefs, Ride, Rsvp } from './types';

export const DEFAULT_PREFS: NotificationPrefs = { rideReminders: true, rideChanges: true, newRides: false, approvals: true, revSound: true };

/** Settings kept on the phone by an app from before a setting existed get that setting's default.
 *  Null (never saved) and undefined (not known) pass through. */
export function completePrefs<T extends NotificationPrefs | null | undefined>(prefs: T): T {
  return (prefs ? { ...DEFAULT_PREFS, ...prefs } : prefs) as T;
}

/** The Harley rev, bundled with the phone build (app.json, expo-notifications "sounds"). */
export const REV_SOUND = 'v_twin_rev.wav';

/** What a notification is: a ride reminder, news from the club, or a live ride alert (safety). */
export type NotificationKind = 'reminder' | 'club' | 'live-alert';

/**
 * The Android channels the phone sets up. Android fixes a channel's sound once it exists, so the rev
 * and the plain sound are separate channels. Live ride alerts always keep the urgent sound, so an
 * emergency never sounds like a reminder.
 */
export const ANDROID_CHANNELS: { id: string; name: string; urgent: boolean; sound: string }[] = [
  { id: 'ride-reminders-rev', name: 'Ride reminders (Harley rev)', urgent: false, sound: REV_SOUND },
  { id: 'ride-reminders', name: 'Ride reminders', urgent: false, sound: 'default' },
  { id: 'club-rev', name: 'Club news (Harley rev)', urgent: false, sound: REV_SOUND },
  { id: 'club', name: 'Club news', urgent: false, sound: 'default' },
  { id: 'ride-alerts', name: 'Live ride alerts', urgent: true, sound: 'default' },
];

/** The Android channel and iPhone sound for a notification. Pushes use the same (supabase/functions/_shared/sendPush.ts). */
export function soundFor(kind: NotificationKind, revSound: boolean): { channelId: string; sound: string } {
  if (kind === 'live-alert') return { channelId: 'ride-alerts', sound: 'default' };
  const base = kind === 'reminder' ? 'ride-reminders' : 'club';
  return revSound ? { channelId: `${base}-rev`, sound: REV_SOUND } : { channelId: base, sound: 'default' };
}

/** A reminder the phone should have scheduled. */
export interface Reminder {
  /** "ride-<ride id>": one per ride, so a moved ride replaces its reminder. */
  id: string;
  rideId: string;
  at: string;
  title: string;
  body: string;
  channelId: string;
  /** REV_SOUND or 'default'. */
  sound: string;
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
  const { channelId, sound } = soundFor('reminder', prefs.revSound);
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
        channelId,
        sound,
      };
    })
    .filter((r) => Date.parse(r.at) > nowMs)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, MAX_REMINDERS);
}

/** What the phone should schedule and cancel to match the plan. A reminder whose time, text or sound
 *  changed is both. (A scheduled one with no text recorded is compared on time alone, and one with no
 *  sound recorded was set before the rev, so it has the plain sound.) */
export function reminderDiff(
  plan: Reminder[],
  scheduled: { id: string; at: string; body?: string; sound?: string }[],
): { add: Reminder[]; cancel: string[] } {
  const wanted = new Map(plan.map((r) => [r.id, r]));
  const same = (s: { at: string; body?: string; sound?: string }, r: Reminder | undefined) =>
    !!r && r.at === s.at && (s.body === undefined || s.body === r.body) && (s.sound ?? 'default') === r.sound;
  const cancel = scheduled.filter((s) => !same(s, wanted.get(s.id))).map((s) => s.id);
  const keep = new Set(scheduled.filter((s) => same(s, wanted.get(s.id))).map((s) => s.id));
  return { add: plan.filter((r) => !keep.has(r.id)), cancel };
}
