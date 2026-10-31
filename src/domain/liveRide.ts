// Live ride mode: when a ride's live window is open, who can share and raise alerts, and the
// distance, direction and split-group sums the live screen shows. The database's live ride actions
// (supabase/migrations/20270201000000_live_ride.sql) apply the same rules with the same words.

import { formatAuDate } from './dates';
import { BOARD_ROLES } from './labels';
import { lastDay, melbourneDate, melbourneTime } from './rides';
import { activePositions, NEC_OFFICER_ROLES } from './access';
import type { AlertKind, LatLng, LiveRider, Member, Position, PositionRole, Ride, RideAlert } from './types';

// Shown on the live ride card before the location prompt. Google Play wants this disclosure (what's
// collected, what for, and that it carries on in the background) before background location is asked.
export const BACKGROUND_LOCATION_NOTICE =
  'Rustnuts collects your location to share it with this ride, even when the app is closed or not in use, until it switches itself off.';

export const LIVE_MSG = {
  signIn: 'Sign in first.',
  approved: 'Only approved members can do that.',
  noRide: 'No such ride.',
  cancelled: 'That ride was cancelled.',
  notYet: 'Live ride opens 2 hours before the start.',
  finished: 'This ride’s finished.',
  notSharing: 'Share your location first.',
  leadersOnly: 'Only ride leaders can set a regroup pin.',
  notYours: 'Only the rider or a ride leader can clear this.',
  cleared: 'Already cleared.',
  noAlert: 'That alert has gone.',
  badFix: 'That location doesn’t look right.',
} as const;

const HOUR = 3600_000;
const BEFORE_START = 2 * HOUR;
const AFTER_END = 2 * HOUR;
const PERSONAL_CAP = 12 * HOUR;
const STALE_AFTER = 5 * 60_000;
const SAME_GROUP_KM = 3;

const iso = (ms: number) => new Date(ms).toISOString();

/** The instant Melbourne's clocks reach midnight at the end of this calendar date (YYYY-MM-DD). */
export function melbourneMidnightAfter(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d + 1);
  const next = melbourneDate(iso(utcMidnight + 12 * HOUR));
  // Melbourne is UTC+10 or +11, so its midnight is 10 or 11 hours before UTC's.
  for (const offset of [11, 10]) {
    const t = utcMidnight - offset * HOUR;
    if (melbourneDate(iso(t)) === next && melbourneTime(iso(t)) === '12:00 am') return iso(t);
  }
  return iso(utcMidnight - 10 * HOUR);
}

/**
 * Whether a "Don't allow" on location stops a share. It does everywhere except the web demo, where a
 * browser often can't give a location and a made-up spot stands in. The review demo on a phone stops,
 * so Google's reviewer sees what a member sees.
 */
export function locationDenialStops(isDemo: boolean, platform: string): boolean {
  return !isDemo || platform !== 'web';
}

/** When live mode is open for a ride, or null for a cancelled ride. */
export function liveWindow(ride: Ride): { opens: string; closes: string } | null {
  if (ride.cancelledAt) return null;
  const start = new Date(ride.startsAt).getTime();
  if (ride.allDay) return { opens: ride.startsAt, closes: melbourneMidnightAfter(lastDay(ride)) };
  const closes = ride.endsAt
    ? iso(new Date(ride.endsAt).getTime() + AFTER_END)
    : melbourneMidnightAfter(melbourneDate(ride.startsAt));
  return { opens: iso(start - BEFORE_START), closes };
}

/** Why `me` can't share on this ride right now, or null when they can. Mirrors start_live_ride. */
export function liveProblem(me: Member | null, ride: Ride | undefined, now: string): string | null {
  if (!me) return LIVE_MSG.signIn;
  if (me.approval !== 'approved') return LIVE_MSG.approved;
  if (!ride) return LIVE_MSG.noRide;
  const w = liveWindow(ride);
  if (!w) return LIVE_MSG.cancelled;
  const t = new Date(now).getTime();
  if (t < new Date(w.opens).getTime()) return LIVE_MSG.notYet;
  if (t >= new Date(w.closes).getTime()) return LIVE_MSG.finished;
  return null;
}

/** When your sharing switches itself off: 12 hours on, or the window's close if that's sooner. */
export function personalStop(ride: Ride, now: string): string {
  const cap = new Date(now).getTime() + PERSONAL_CAP;
  const w = liveWindow(ride);
  return iso(w ? Math.min(cap, new Date(w.closes).getTime()) : cap);
}

const LEADER_ROLES: PositionRole[] = ['road_captain', 'tail_gunner', 'assistant_tail_gunner', ...BOARD_ROLES, ...NEC_OFFICER_ROLES];

/** Road Captain, Tail Gunner or Assistant TG, or a board or NEC officer seat (not the Auditor, who runs nothing). Mirrors private.is_ride_leader. */
export function isRideLeader(memberId: string, positions: Position[]): boolean {
  return activePositions(memberId, positions).some((p) => LEADER_ROLES.includes(p.role));
}

/** A fix has to be a real place (null, for "the phone doesn't know", is fine). */
export function fixProblem(at: LatLng | null | undefined): string | null {
  if (!at) return null;
  const ok = Number.isFinite(at.lat) && Number.isFinite(at.lng) && Math.abs(at.lat) <= 90 && Math.abs(at.lng) <= 180;
  return ok ? null : LIVE_MSG.badFix;
}

/**
 * Why this alert can't be raised, or null. `live` is liveProblem for the ride now. An emergency or
 * dropping out needs only the ride's window to be open, so one raised with no signal still goes
 * through after your own sharing has switched off. A regroup pin needs a leader who is sharing.
 * Mirrors raise_ride_alert.
 */
export function alertProblem(
  kind: AlertKind,
  ctx: { sharing: boolean; leader: boolean; live: string | null; at?: LatLng | null },
): string | null {
  if (kind === 'regroup') {
    if (ctx.live) return ctx.live;
    if (!ctx.sharing) return LIVE_MSG.notSharing;
    if (!ctx.leader) return LIVE_MSG.leadersOnly;
  } else if (ctx.live) {
    return ctx.live;
  }
  return fixProblem(ctx.at);
}

/** "4:30 pm" when it's today in Melbourne, otherwise "08/11/2026 1:00 am". */
export function offTime(at: string, now: string): string {
  const time = melbourneTime(at);
  return melbourneDate(at) === melbourneDate(now) ? time : `${formatAuDate(melbourneDate(at))} ${time}`;
}

/** `leader`: a ride leader who is sharing on that ride. Mirrors resolve_ride_alert. */
export function resolveProblem(alert: RideAlert, meId: string, leader: boolean): string | null {
  if (alert.resolvedAt) return LIVE_MSG.cleared;
  if (alert.memberId !== meId && !leader) return LIVE_MSG.notYours;
  return null;
}

// ---------------------------------------------------------------------------
// Distances, for display only
// ---------------------------------------------------------------------------

const rad = (deg: number) => (deg * Math.PI) / 180;

export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Which way b is from a, to the nearest of 8 compass points. */
export function compass(a: LatLng, b: LatLng): string {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return POINTS[Math.round(bearing / 45) % 8];
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round((km * 1000) / 10) * 10} m` : `${km.toFixed(1)} km`;
}

/** "2.4 km NE" or "120 m N", from me to them; null when either position is unknown. */
export function awayText(me: LatLng | null, them: LatLng | null): string | null {
  if (!me || !them) return null;
  return `${formatDistance(distanceKm(me, them))} ${compass(me, them)}`;
}

export function lastSeen(at: string, now: string): string {
  const mins = Math.floor((new Date(now).getTime() - new Date(at).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
}

export function isStale(at: string, now: string): boolean {
  return new Date(now).getTime() - new Date(at).getTime() > STALE_AFTER;
}

type Placed = LiveRider & { position: LatLng; updatedAt: string };

const fresh = (riders: LiveRider[], now: string): Placed[] =>
  riders.filter((r): r is Placed => !!r.position && !!r.updatedAt && !isStale(r.updatedAt, now));

/** Riders with a fresh fix, grouped so anyone within 3 km of someone in a group is in it. Biggest first. */
export function splitGroups(riders: LiveRider[], now: string): LiveRider[][] {
  const list = fresh(riders, now);
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (distanceKm(list[i].position, list[j].position) < SAME_GROUP_KM) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Placed[]>();
  list.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]));
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

const gapKm = (a: LiveRider[], b: LiveRider[]) =>
  Math.min(...a.flatMap((x) => b.map((y) => distanceKm(x.position as LatLng, y.position as LatLng))));

/** For leaders: "Group split: 2 riders 6.7 km away", measured from the main group; null when together. */
export function splitWarning(riders: LiveRider[], now: string): string | null {
  const [main, ...rest] = splitGroups(riders, now);
  if (!main || rest.length === 0) return null;
  const parts = rest.map((g) => `${g.length} ${g.length === 1 ? 'rider' : 'riders'} ${formatDistance(gapKm(main, g))} away`);
  return `Group split: ${parts.join(', ')}`;
}
