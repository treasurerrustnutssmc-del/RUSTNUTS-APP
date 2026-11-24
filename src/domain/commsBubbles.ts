// Ride comms bubbles (Jeff, 22 Nov 2026): a floating bubble for each ride whose comms are on, over
// every screen of the app, with how many are connected and an Emergency for that ride only. These are
// the rules for which bubbles show. Spec: docs/superpowers/specs/2026-11-23-ride-comms-bubbles-design.md.

import { isMyRide, liveProblem } from './liveRide';
import type { Member, Ride, RideCategory, Rsvp } from './types';

export const MAX_BUBBLES = 3;
/** The Emergency button's first tap arms it this long; a second tap in that time sends. */
export const SOS_ARM_MS = 6000;

export interface BubbleInput {
  me: Member | null;
  rides: Ride[];
  rsvps: Rsvp[];
  categories: RideCategory[];
  now: string;
  /** The share saved on this phone; only counts when it's this member's. */
  sharing: { rideId: string; meId: string } | null;
  calledOff: string[];
  /** How many the club says are on each ride's comms (ride id to count). */
  counts: Record<string, number>;
  /** The call this phone is in, with the call's own count of who's in it. */
  onAir: { rideId: string; connected: number } | null;
  /** Bubbles the rider hid. Joining that ride's comms brings its bubble back. */
  hidden: string[];
  /** The live ride screen showing now, if any: its own ride needs no bubble. */
  screenRideId: string | null;
  /** Rides this phone raised an emergency on (sent or waiting): their bubbles stay, so it can be seen and cancelled. */
  sos?: string[];
}

export interface Bubble {
  ride: Ride;
  connected: number;
  onAir: boolean;
}

export function commsBubbles(input: BubbleInput): Bubble[] {
  const { me, now } = input;
  if (!me || me.approval !== 'approved' || me.status === 'family') return [];
  const sharingId = input.sharing?.meId === me.id ? input.sharing.rideId : null;
  const onAirId = input.onAir?.rideId ?? null;
  const shown: Bubble[] = [];
  for (const ride of input.rides) {
    if (liveProblem(me, ride, now) || input.calledOff.includes(ride.id)) continue;
    const onAir = ride.id === onAirId;
    const sos = input.sos?.includes(ride.id) ?? false;
    const connected = onAir ? (input.onAir as { connected: number }).connected : input.counts[ride.id] ?? 0;
    if (!sos) {
      if (ride.id === input.screenRideId) continue;
      if (!onAir && input.hidden.includes(ride.id)) continue;
      const yours = onAir || ride.id === sharingId || isMyRide(ride, me.id, input.rsvps, input.categories);
      if (!yours || (!onAir && connected <= 0)) continue;
    }
    shown.push({ ride, connected, onAir });
  }
  return shown
    .sort((a, b) => Number(b.onAir) - Number(a.onAir) || new Date(b.ride.startsAt).getTime() - new Date(a.ride.startsAt).getTime())
    .slice(0, MAX_BUBBLES);
}

/** The short name under a bubble: the first word, and the second if both fit in 8, never past 10. */
export function bubbleLabel(title: string): string {
  const words = title.replace(/\(demo\)/i, '').split(/\s+[–—-]\s+/)[0].trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = words[0].length > 10 ? `${words[0].slice(0, 10)}…` : words[0];
  const two = words.length > 1 ? `${words[0]} ${words[1]}` : null;
  return two && two.length <= 8 ? two : first;
}

/** Whether the Emergency button is still armed from a first tap at `armedAt`. */
export function sosArmed(armedAt: number | null, now: number): boolean {
  return armedAt !== null && now - armedAt < SOS_ARM_MS;
}

/** ride_comms_counts' rows as ride id to count; anything half-there is left out. */
export function countsFrom(rows: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const r = row as { ride_id?: unknown; connected?: unknown } | null;
    if (r && typeof r.ride_id === 'string' && typeof r.connected === 'number' && Number.isFinite(r.connected)) out[r.ride_id] = r.connected;
  }
  return out;
}
