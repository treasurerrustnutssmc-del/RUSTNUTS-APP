// Ride comms bubbles: how many are on each ride's comms (from the club, every 30 seconds while a ride
// is on and the app is open), and the Emergency a bubble raises for its own ride. The demo makes the
// counts up. Spec: docs/superpowers/specs/2026-11-23-ride-comms-bubbles-design.md.

import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { countsFrom } from '../domain/commsBubbles';
import type { LatLng } from '../domain/types';
import { liveBackend } from './liveRideSource';
import { currentFix, flushQueue, heldAlerts, holdAlert, quickFix, unsentAlerts, withTimeout } from './liveTracker';
import { supabase } from './supabase';

const POLL_MS = 30_000;
const NONE: Record<string, number> = {};

/** The demo's made-up crowds, so the bubbles can be seen. */
export const DEMO_COUNTS: Record<string, number> = { 'r-today': 4, 'r-today-club': 6 };

/** Counts for every ride on now, only while `on` (some ride's live window is open). */
export function useCommsCounts(on: boolean, isDemo: boolean): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>(NONE);
  useEffect(() => {
    if (!on || isDemo) return undefined;
    let live = true;
    const look = () => {
      if (AppState.currentState !== 'active') return;
      supabase()
        .rpc('ride_comms_counts')
        .then(({ data, error }) => {
          if (live && !error) setCounts(countsFrom(data));
        }, () => undefined);
    };
    look();
    const timer = setInterval(look, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && look());
    return () => {
      live = false;
      clearInterval(timer);
      sub.remove();
      setCounts(NONE);
    };
  }, [on, isDemo]);
  if (!on) return NONE;
  return isDemo ? DEMO_COUNTS : counts;
}

/** Tells the club this phone has joined or left a ride's comms. Best effort: the sweep catches up.
 *  One at a time, in order, so a late "here" can never land after the "left". */
let told: Promise<void> = Promise.resolve();
export function sayOnComms(rideId: string, here: boolean): void {
  told = told.then(() =>
    supabase()
      .rpc('ride_comms_here', { p_ride: rideId, p_here: here })
      .then(() => undefined, () => undefined),
  );
}

const isOffline = (e: unknown) => /no connection|network|fetch|timed? ?out/i.test((e as Error)?.message ?? '');
const place = (f: { lat: number; lng: number } | null): LatLng | null => (f ? { lat: f.lat, lng: f.lng } : null);

export type SosResult =
  | { sent: true; alertId: string }
  | { sent: false; held: true; pressedAt: string }
  | { sent: false; error: string };

/** Where the phone already knows you are. Never on the web, where asking would pop up a prompt. */
const knownFix = () => (Platform.OS === 'web' ? Promise.resolve(null) : quickFix());

/** Raises an emergency on this ride, where the phone already knows you are (it never asks for
 *  location, and never waits for a fix). With no signal it waits on the phone and sends itself. */
export async function raiseRideEmergency(rideId: string): Promise<SosResult> {
  const pressedAt = new Date().toISOString();
  const fix = await knownFix();
  try {
    const alertId = await withTimeout(liveBackend().raise(rideId, 'emergency', place(fix), pressedAt));
    if (!fix && Platform.OS !== 'web') {
      // Add where you are once the phone finds it (the club updates the same alert).
      currentFix().then((later) => {
        if (later) liveBackend().raise(rideId, 'emergency', place(later), pressedAt).catch(() => undefined);
      });
    }
    return { sent: true, alertId };
  } catch (e) {
    if (isOffline(e)) {
      await holdAlert({ rideId, kind: 'emergency', at: place(fix), queuedAt: pressedAt });
      return { sent: false, held: true, pressedAt };
    }
    return { sent: false, error: (e as Error).message };
  }
}

/** "I'm OK": clears the emergency this phone raised. */
export async function cancelRideEmergency(alertId: string): Promise<string | null> {
  try {
    await withTimeout(liveBackend().resolve(alertId));
    return null;
  } catch (e) {
    const said = (e as Error).message;
    // A leader cleared it already, or it's gone: either way it's no longer open.
    return /already cleared|has gone/i.test(said) ? null : said;
  }
}

export type HeldResult = { state: 'waiting' } | { state: 'sent'; alertId: string } | { state: 'refused'; reason: string };

/** Tries to send a held emergency. Once it's through, asks again with the same press to learn its id
 *  (the club answers with the same alert), so it can be cancelled from the bubble. */
export async function sendHeldEmergency(rideId: string, pressedAt: string): Promise<HeldResult> {
  await flushQueue().catch(() => undefined);
  if ((await heldAlerts()).some((q) => q.rideId === rideId && q.kind === 'emergency')) return { state: 'waiting' };
  const refused = (await unsentAlerts()).find((u) => u.item.rideId === rideId && u.item.kind === 'emergency' && u.item.queuedAt === pressedAt);
  if (refused) return { state: 'refused', reason: refused.reason };
  try {
    const alertId = await withTimeout(liveBackend().raise(rideId, 'emergency', null, pressedAt));
    return { state: 'sent', alertId };
  } catch (e) {
    return isOffline(e) ? { state: 'waiting' } : { state: 'refused', reason: (e as Error).message };
  }
}
