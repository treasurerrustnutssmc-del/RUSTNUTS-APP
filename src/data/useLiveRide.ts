// The live ride screen's connection to live mode: switching sharing on and off, the latest state
// (every 15 seconds, or whenever the phone posts a fix), raising and clearing alerts, and holding
// alerts raised with no signal until they can be sent.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertKind, LatLng, LiveState } from '../domain/types';
import { useClub } from './ClubStore';
import type { Fix } from './liveRideBackend';
import { liveBackend } from './liveRideSource';
import { activeRide, currentFix, flushQueue, heldAlerts, holdAlert, onTrack, startTracking, stopTracking } from './liveTracker';

const POLL_MS = 15_000;
/** In the demo, when the browser won't give a location: a made-up spot at the BP in Ravenhall. */
const DEMO_SPOT: Fix = { lat: -37.7677, lng: 144.7516, accuracyM: 20, heading: null, speedKmh: null };

const isOffline = (e: unknown) => /no connection|network|fetch|timed? ?out/i.test((e as Error)?.message ?? '');

export type ShareMode = 'background' | 'foreground' | 'demo';

export function useLiveRide(rideId: string) {
  const { me, isDemo } = useClub();
  const [state, setState] = useState<LiveState | null>(null);
  const [mode, setMode] = useState<ShareMode | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [held, setHeld] = useState(0);
  const [myFix, setMyFix] = useState<Fix | null>(null);
  const fixRef = useRef<Fix | null>(null);
  const sharing = !!state?.me;

  const fail = useCallback((e: unknown) => {
    if (isOffline(e)) setOffline(true);
    else setError((e as Error).message);
  }, []);

  const refresh = useCallback(async () => {
    try {
      // The demo moves its made-up riders when you report in, so it reports in on every poll.
      const next = mode === 'demo' && fixRef.current ? await liveBackend().update(rideId, fixRef.current) : await liveBackend().state(rideId);
      setState(next);
      setOffline(false);
      await flushQueue();
      setHeld((await heldAlerts()).length);
    } catch (e) {
      if (/Share your location first/.test((e as Error).message)) setState(null);
      else fail(e);
    }
  }, [rideId, mode, fail]);

  // Already sharing on this ride (from an earlier visit, or with the screen off)?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const active = await activeRide();
      try {
        const s = await liveBackend().state(rideId);
        if (cancelled) return;
        setState(s);
        setMode(isDemo ? 'demo' : active?.rideId === rideId ? 'background' : 'foreground');
      } catch {
        // Not sharing.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId, isDemo]);

  // Each fix the phone posts comes back with fresh state.
  useEffect(
    () =>
      onTrack((fix, next, err) => {
        fixRef.current = fix;
        setMyFix(fix);
        if (next && next.rideId === rideId) {
          setState(next);
          setOffline(false);
        } else if (err) {
          if (/Share your location first/.test(err.message)) setState(null);
          else if (isOffline(err)) setOffline(true);
        }
      }),
    [rideId],
  );

  // Poll while sharing, and switch off on time even if the server's cleanup hasn't run yet.
  useEffect(() => {
    if (!sharing) return;
    const timer = setInterval(() => {
      if (state?.me && Date.now() >= new Date(state.me.stopsAt).getTime()) {
        stopTracking();
        setState(null);
        return;
      }
      refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [sharing, state?.me, refresh]);

  const start = useCallback(async () => {
    if (!me) return;
    setError(null);
    try {
      const stopsAt = await liveBackend().start(rideId);
      const tracking = await startTracking(rideId, stopsAt, me.id).catch(() => 'denied' as const);
      if (tracking === 'denied' && !isDemo) {
        await liveBackend().stop(rideId).catch(() => {});
        setError('Location is off for Rustnuts. Turn it on in Settings to share.');
        return;
      }
      setMode(tracking === 'denied' ? 'demo' : isDemo ? 'demo' : tracking);
      const fix = (await currentFix()) ?? (isDemo ? DEMO_SPOT : null);
      if (fix) {
        fixRef.current = fix;
        setMyFix(fix);
        setState(await liveBackend().update(rideId, fix));
      } else {
        setState(await liveBackend().state(rideId));
      }
    } catch (e) {
      fail(e);
    }
  }, [me, rideId, isDemo, fail]);

  const stop = useCallback(async () => {
    setError(null);
    await stopTracking();
    try {
      await liveBackend().stop(rideId);
    } catch (e) {
      fail(e);
    }
    setState(null);
    setMode(null);
  }, [rideId, fail]);

  /** Raises an alert where you are. With no signal it waits on the phone and sends itself later. */
  const raise = useCallback(
    async (kind: AlertKind): Promise<boolean> => {
      setError(null);
      const at: LatLng | null = fixRef.current ?? (await currentFix()) ?? (isDemo ? DEMO_SPOT : null);
      try {
        await liveBackend().raise(rideId, kind, at ? { lat: at.lat, lng: at.lng } : null);
        if (kind === 'out') {
          await stopTracking();
          setState(null);
          setMode(null);
        } else {
          await refresh();
        }
        return true;
      } catch (e) {
        if (isOffline(e)) {
          await holdAlert({ rideId, kind, at: at ? { lat: at.lat, lng: at.lng } : null, queuedAt: new Date().toISOString() });
          setHeld((await heldAlerts()).length);
          setOffline(true);
          return true;
        }
        setError((e as Error).message);
        return false;
      }
    },
    [rideId, isDemo, refresh],
  );

  const resolve = useCallback(
    async (alertId: string) => {
      setError(null);
      try {
        await liveBackend().resolve(alertId);
        await refresh();
      } catch (e) {
        fail(e);
      }
    },
    [refresh, fail],
  );

  return { state, sharing, checking, mode, error, offline, held, myFix, start, stop, raise, resolve };
}
