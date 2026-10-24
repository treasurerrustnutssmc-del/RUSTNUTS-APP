// The live ride screen's connection to live mode: switching sharing on and off, the latest state
// (every 15 seconds, or whenever the phone posts a fix), raising and clearing alerts, and holding
// alerts (and a stop) raised with no signal until they can be sent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LIVE_MSG } from '../domain/liveRide';
import type { AlertKind, LatLng, LiveState } from '../domain/types';
import { useClub } from './ClubStore';
import type { Fix } from './liveRideBackend';
import { liveBackend } from './liveRideSource';
import type { Refused } from './liveQueue';
import {
  activeRide,
  currentFix,
  dismissUnsent,
  flushQueue,
  heldAlerts,
  holdAlert,
  noticeAlerts,
  onTrack,
  quickFix,
  resumeTracking,
  startTracking,
  stopTracking,
  unsentAlerts,
  withTimeout,
} from './liveTracker';

const POLL_MS = 15_000;
/** In the demo, when the browser won't give a location: a made-up spot at the BP in Ravenhall. */
const DEMO_SPOT: Fix = { lat: -37.7677, lng: 144.7516, accuracyM: 20, heading: null, speedKmh: null };

const isOffline = (e: unknown) => /no connection|network|fetch|timed? ?out/i.test((e as Error)?.message ?? '');
const notSharing = (e: unknown) => (e as Error)?.message === LIVE_MSG.notSharing;
const place = (f: Fix | null): LatLng | null => (f ? { lat: f.lat, lng: f.lng } : null);

export type ShareMode = 'background' | 'foreground' | 'demo';

export function useLiveRide(rideId: string) {
  const { me, isDemo } = useClub();
  const meId = me?.id ?? null;
  const [state, setState] = useState<LiveState | null>(null);
  const [mode, setMode] = useState<ShareMode | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [held, setHeld] = useState(0);
  const [unsent, setUnsent] = useState<Refused[]>([]);
  /** Stopped on this phone, but the club hasn't heard yet (no signal). */
  const [stopPending, setStopPending] = useState(false);
  const [myFix, setMyFix] = useState<Fix | null>(null);
  const fixRef = useRef<Fix | null>(null);
  const sharing = !!state?.me;

  const keepFix = useCallback((fix: Fix) => {
    fixRef.current = fix;
    setMyFix(fix);
  }, []);

  const fail = useCallback((e: unknown) => {
    if (isOffline(e)) setOffline(true);
    else setError((e as Error).message);
  }, []);

  const syncQueue = useCallback(async () => {
    await flushQueue();
    const waiting = await heldAlerts();
    setHeld(waiting.filter((q) => q.kind !== 'stop').length);
    setStopPending(waiting.some((q) => q.kind === 'stop' && q.rideId === rideId));
    setUnsent((await unsentAlerts()).filter((u) => u.item.rideId === rideId));
  }, [rideId]);

  const refresh = useCallback(async () => {
    try {
      // The demo moves its made-up riders when you report in, so it reports in on every poll.
      const next = await withTimeout(
        mode === 'demo' && fixRef.current ? liveBackend().update(rideId, fixRef.current) : liveBackend().state(rideId),
      );
      setState(next);
      setOffline(false);
      if (meId) await noticeAlerts(next, fixRef.current, meId);
      await syncQueue();
    } catch (e) {
      if (notSharing(e)) {
        await stopTracking();
        setState(null);
        setMode(null);
      } else fail(e);
    }
  }, [rideId, mode, meId, fail, syncQueue]);

  // Already sharing on this ride (from an earlier visit, or with the screen off)?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await withTimeout(liveBackend().state(rideId));
        if (cancelled) return;
        setState(s);
        setMode(isDemo ? 'demo' : await resumeTracking(rideId));
      } catch (e) {
        // The club says this phone isn't sharing here: make sure the GPS agrees.
        if (notSharing(e) && (await activeRide())?.rideId === rideId) await stopTracking();
        if (isOffline(e)) setOffline(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
      await syncQueue();
      // Where am I? The last known spot straight away, then a fresh fix.
      const quick = await quickFix();
      if (!cancelled && quick && !fixRef.current) keepFix(quick);
      const fresh = (await currentFix()) ?? (isDemo && !fixRef.current ? DEMO_SPOT : null);
      if (!cancelled && fresh) keepFix(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId, isDemo, syncQueue, keepFix]);

  // Each fix the phone posts comes back with fresh state.
  useEffect(
    () =>
      onTrack((fix, next, err) => {
        keepFix(fix);
        if (next && next.rideId === rideId) {
          setState(next);
          setOffline(false);
        } else if (err) {
          if (notSharing(err)) {
            setState(null);
            setMode(null);
          } else if (isOffline(err)) setOffline(true);
        }
      }),
    [rideId, keepFix],
  );

  // Poll while sharing, and switch off on time even if the club's cleanup hasn't run yet.
  const stopsAt = state?.me?.stopsAt ?? null;
  useEffect(() => {
    if (!stopsAt) return;
    const timer = setInterval(() => {
      if (Date.now() >= new Date(stopsAt).getTime()) {
        stopTracking();
        setState(null);
        setMode(null);
        return;
      }
      refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [stopsAt, refresh]);

  const start = useCallback(async () => {
    if (!meId) return;
    setError(null);
    try {
      const until = await withTimeout(liveBackend().start(rideId));
      const tracking = await startTracking(rideId, until, meId).catch(() => 'denied' as const);
      if (tracking === 'denied' && !isDemo) {
        await liveBackend().stop(rideId).catch(() => {});
        setError('Location is off for Rustnuts. Turn it on in Settings to share.');
        return;
      }
      setMode(isDemo ? 'demo' : tracking === 'denied' ? null : tracking);
      const fix = fixRef.current ?? (await currentFix()) ?? (isDemo ? DEMO_SPOT : null);
      if (fix) {
        keepFix(fix);
        setState(await withTimeout(liveBackend().update(rideId, fix)));
      } else {
        setState(await withTimeout(liveBackend().state(rideId)));
      }
      setStopPending(false);
    } catch (e) {
      fail(e);
    }
  }, [meId, rideId, isDemo, fail, keepFix]);

  const stop = useCallback(async () => {
    setError(null);
    await stopTracking();
    setState(null);
    setMode(null);
    try {
      await withTimeout(liveBackend().stop(rideId));
    } catch (e) {
      if (isOffline(e)) {
        // The phone has stopped; tell the club when signal comes back.
        await holdAlert({ rideId, kind: 'stop', at: null, queuedAt: new Date().toISOString() });
        setStopPending(true);
        setOffline(true);
      } else fail(e);
    }
  }, [rideId, fail]);

  /** Raises an alert where you are, straight away (it never waits for a fix). With no signal it
   *  waits on the phone and sends itself later. */
  const raise = useCallback(
    async (kind: AlertKind): Promise<boolean> => {
      setError(null);
      const pressedAt = new Date().toISOString();
      const fix = fixRef.current ?? (await quickFix()) ?? (isDemo ? DEMO_SPOT : null);
      try {
        await withTimeout(liveBackend().raise(rideId, kind, place(fix), pressedAt));
        if (kind === 'out') {
          await stopTracking();
          setState(null);
          setMode(null);
        } else {
          await refresh();
        }
        // Sent with no position: add it once the phone finds one (the club updates the same alert).
        if (!fix && kind !== 'regroup') {
          currentFix().then((later) => {
            if (later) liveBackend().raise(rideId, kind, place(later), pressedAt).catch(() => {});
          });
        }
        return true;
      } catch (e) {
        if (isOffline(e)) {
          await holdAlert({ rideId, kind, at: place(fix), queuedAt: pressedAt });
          setHeld((await heldAlerts()).filter((q) => q.kind !== 'stop').length);
          setOffline(true);
          if (kind === 'out') {
            await stopTracking();
            setState(null);
            setMode(null);
          }
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
        await withTimeout(liveBackend().resolve(alertId));
        await refresh();
      } catch (e) {
        fail(e);
      }
    },
    [refresh, fail],
  );

  const clearUnsent = useCallback(async () => {
    await dismissUnsent();
    setUnsent([]);
  }, []);

  return { state, sharing, checking, mode, error, offline, held, unsent, stopPending, myFix, start, stop, raise, resolve, clearUnsent };
}
