// Live ride on the phone: reads the location while you share, posts each fix, and raises a local
// notification for any new alert so a phone in a pocket still hears it. On a phone with a
// development build it keeps going with the screen off (a background task, with Android's
// "Sharing your location" notification); on the web and in Expo Go only while the app is open.
// It switches itself off at the time the club gave: on the next fix past it (fixes come at least
// every 30 seconds on Android, even standing still), when the app opens, or on a timer while it's
// running. This file must be imported at start-up (index.ts) so the background task is defined
// before the phone wakes it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { LIVE_MSG } from '../domain/liveRide';
import { showWhileOpen } from '../domain/notifications';
import { melbourneTime } from '../domain/rides';
import type { LiveState } from '../domain/types';
import type { Fix } from './liveRideBackend';
import { liveBackend } from './liveRideSource';
import { ensureChannels } from './notificationChannels';
import { viewingChat } from './viewingChat';
import { alertNotice, createAlertQueue, unseenAlerts, type QueuedAlert, type Refused } from './liveQueue';

export const LIVE_TASK = 'rustnuts-live-ride';
const ACTIVE = 'live.active';
const SEEN = 'live.seen';
const UNSENT = 'live.unsent';
const CHANNEL = 'ride-alerts';
const NATIVE = Platform.OS !== 'web';

interface Active {
  rideId: string;
  stopsAt: string;
  meId: string;
}

type Listener = (fix: Fix, state: LiveState | null, error: Error | null) => void;
const listeners = new Set<Listener>();
let watch: Location.LocationSubscription | null = null;
let offTimer: ReturnType<typeof setTimeout> | null = null;

/** The screen hears each fix and the state that came back with it. */
export function onTrack(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const write = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});

/** Gives up on a request that hasn't answered in time, so weak signal counts as no signal. */
export function withTimeout<T>(promise: Promise<T>, ms = 8_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timed out. No connection.')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function toFix(loc: Location.LocationObject): Fix {
  const { latitude, longitude, accuracy, heading, speed } = loc.coords;
  return {
    lat: latitude,
    lng: longitude,
    accuracyM: accuracy ?? null,
    heading: heading !== null && heading >= 0 ? heading : null,
    speedKmh: speed !== null && speed >= 0 ? speed * 3.6 : null,
  };
}

// ---------------------------------------------------------------------------
// Alerts: notifications, and the ones waiting for signal
// ---------------------------------------------------------------------------

// One at a time, so a fix and a poll arriving together don't both notify about the same alert.
let noticing: Promise<unknown> = Promise.resolve();

/** Tells the phone's owner about alerts they haven't heard yet (once each, even across shares). */
export function noticeAlerts(state: LiveState, fix: Fix | null, meId: string): Promise<void> {
  if (!NATIVE) return Promise.resolve();
  const next = noticing.then(async () => {
    const seen = await read<string[]>(SEEN, []);
    const fresh = unseenAlerts(seen, state.alerts, meId);
    if (fresh.length === 0) return;
    for (const a of fresh) {
      const { title, body } = alertNotice(a, fix);
      await Notifications.scheduleNotificationAsync({
        content: { title, body, sound: true, data: { kind: 'live-alert', rideId: state.rideId }, priority: Notifications.AndroidNotificationPriority.MAX },
        trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
      }).catch(() => {});
    }
    await write(SEEN, [...seen, ...fresh.map((a) => a.id)].slice(-200));
  });
  noticing = next.catch(() => {});
  return next;
}

const queue = createAlertQueue(AsyncStorage, async (item) => {
  if (item.kind === 'stop') await withTimeout(liveBackend().stop(item.rideId));
  else await withTimeout(liveBackend().raise(item.rideId, item.kind, item.at, item.queuedAt));
});

/** Sends what's waiting for signal. An emergency or dropping out the club refused (say the ride
 *  ended before signal came back) is kept to show the rider, never dropped quietly. */
export async function flushQueue(): Promise<void> {
  const refused = await queue.flush();
  const tell = refused.filter((r) => r.item.kind === 'emergency' || r.item.kind === 'out');
  if (tell.length > 0) await write(UNSENT, [...(await read<Refused[]>(UNSENT, [])), ...tell]);
}

/** Keeps an alert (or a stop) to send when signal comes back. */
export const holdAlert = (item: QueuedAlert) => queue.hold(item);
export const heldAlerts = () => queue.list();
export const forgetHeld = (rideId: string, kind: QueuedAlert['kind']) => queue.forget(rideId, kind);
export const unsentAlerts = () => read<Refused[]>(UNSENT, []);
export const dismissUnsent = () => AsyncStorage.removeItem(UNSENT).catch(() => {});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

async function handleFix(fix: Fix): Promise<void> {
  const active = await read<Active | null>(ACTIVE, null);
  if (!active) return;
  if (Date.now() >= new Date(active.stopsAt).getTime()) {
    await stopTracking();
    return;
  }
  try {
    const state = await withTimeout(liveBackend().update(active.rideId, fix));
    await noticeAlerts(state, fix, active.meId);
    await flushQueue();
    listeners.forEach((l) => l(fix, state, null));
  } catch (e) {
    // The club has stopped this rider sharing (ride cancelled, switched off, cleaned up): stop the GPS too.
    if ((e as Error).message === LIVE_MSG.notSharing) await stopTracking();
    listeners.forEach((l) => l(fix, null, e as Error));
  }
}

/** Stops a share that has run past its switch-off time, or a location service left running. */
async function checkSwitchOff(): Promise<void> {
  const active = await read<Active | null>(ACTIVE, null);
  if (active && Date.now() >= new Date(active.stopsAt).getTime()) {
    await stopTracking();
    return;
  }
  if (!active && NATIVE) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LIVE_TASK)) await Location.stopLocationUpdatesAsync(LIVE_TASK);
    } catch {
      // Not running.
    }
  }
  if (active) armOffTimer(active.stopsAt);
}

function armOffTimer(stopsAt: string): void {
  if (offTimer) clearTimeout(offTimer);
  const ms = new Date(stopsAt).getTime() - Date.now();
  // Timers past about 24 days overflow; a share never runs more than 12 hours.
  offTimer = setTimeout(() => {
    stopTracking();
  }, Math.max(0, Math.min(ms, 13 * 3600_000)));
}

if (NATIVE) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LIVE_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await handleFix(toFix(data.locations[data.locations.length - 1]));
  });
  Notifications.setNotificationHandler({
    // A message for the chat that's on screen is already showing there.
    handleNotification: async (n) => {
      const show = showWhileOpen(n.request.content.data, viewingChat());
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}

// On opening the app, and each time it comes back to the front: switch off anything overdue and
// send what's been waiting for signal (after a moment, so the sign-in has loaded).
setTimeout(() => {
  checkSwitchOff().then(flushQueue).catch(() => {});
}, 3_000);
AppState.addEventListener('change', (s) => {
  if (s === 'active') checkSwitchOff().then(flushQueue).catch(() => {});
});

// distanceInterval 0: a fix every 30 seconds even standing still, so a parked phone still hears
// alerts and still switches itself off on time.
const OPTIONS = { accuracy: Location.Accuracy.Balanced, timeInterval: 30_000, distanceInterval: 0 };

async function startWatch(): Promise<void> {
  watch?.remove();
  watch = await Location.watchPositionAsync(OPTIONS, (loc) => {
    handleFix(toFix(loc));
  });
}

/**
 * Starts reading the location for this ride until `stopsAt`. Says how: 'background' (keeps going
 * with the screen off), 'foreground' (only while the app is open) or 'denied' (location is off).
 */
export async function startTracking(rideId: string, stopsAt: string, meId: string): Promise<'background' | 'foreground' | 'denied'> {
  const fg = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (!fg?.granted) return 'denied';
  await write(ACTIVE, { rideId, stopsAt, meId } satisfies Active);
  armOffTimer(stopsAt);

  if (NATIVE) {
    await ensureChannels();
    await Notifications.requestPermissionsAsync().catch(() => null);
    try {
      if (await TaskManager.isAvailableAsync()) {
        const bg = await Location.requestBackgroundPermissionsAsync();
        if (bg.granted) {
          if (await Location.hasStartedLocationUpdatesAsync(LIVE_TASK)) await Location.stopLocationUpdatesAsync(LIVE_TASK);
          await Location.startLocationUpdatesAsync(LIVE_TASK, {
            ...OPTIONS,
            pausesUpdatesAutomatically: false,
            activityType: Location.ActivityType.AutomotiveNavigation,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'Sharing your location with the ride',
              notificationBody: `Switches off at ${melbourneTime(stopsAt)}. Tap to open.`,
              notificationColor: '#B92632',
            },
          });
          return 'background';
        }
      }
    } catch {
      // Expo Go can't run the background service; share while the app is open instead.
    }
  }

  await startWatch();
  return 'foreground';
}

/**
 * After the app restarts: how this phone is sharing on this ride now, picking the location back up
 * if it had stopped (an app closed while sharing only in the foreground). Null when not sharing here.
 */
export async function resumeTracking(rideId: string): Promise<'background' | 'foreground' | null> {
  const active = await activeRide();
  if (!active || active.rideId !== rideId) return null;
  armOffTimer(active.stopsAt);
  if (NATIVE) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LIVE_TASK)) return 'background';
    } catch {
      // Fall through to the foreground.
    }
  }
  if (!watch) {
    const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (!fg?.granted) return null;
    await startWatch();
  }
  return 'foreground';
}

export async function stopTracking(): Promise<void> {
  if (offTimer) clearTimeout(offTimer);
  offTimer = null;
  watch?.remove();
  watch = null;
  if (NATIVE) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LIVE_TASK)) await Location.stopLocationUpdatesAsync(LIVE_TASK);
    } catch {
      // Not running.
    }
  }
  await AsyncStorage.removeItem(ACTIVE).catch(() => {});
}

/** Which ride this phone is sharing on, if any (and it hasn't switched itself off). */
export async function activeRide(): Promise<Active | null> {
  const active = await read<Active | null>(ACTIVE, null);
  return active && Date.now() < new Date(active.stopsAt).getTime() ? active : null;
}

/** The phone's last known spot, straight away (for an emergency, which mustn't wait for a fix). */
export async function quickFix(): Promise<Fix | null> {
  try {
    const last = await Location.getLastKnownPositionAsync();
    return last ? toFix(last) : null;
  } catch {
    return null;
  }
}

/** Where the phone is now, as best it can tell within 10 seconds; null if it can't. */
export async function currentFix(): Promise<Fix | null> {
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000));
    const loc = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), timeout]);
    if (loc) return toFix(loc);
  } catch {
    // Fall back to the last known spot.
  }
  return quickFix();
}
