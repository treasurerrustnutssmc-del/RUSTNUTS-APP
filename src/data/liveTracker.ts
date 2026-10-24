// Live ride on the phone: reads the location while you share, posts each fix, and raises a local
// notification for any new alert so a phone in a pocket still hears it. On a phone with a
// development build it keeps going with the screen off (a background task, with Android's
// "Sharing your location" notification); on the web and in Expo Go only while the app is open.
// It switches itself off at the time the club gave, even if the app was closed. This file must be
// imported at start-up (index.ts) so the background task is defined before the phone wakes it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { melbourneTime } from '../domain/rides';
import type { LiveState } from '../domain/types';
import type { Fix } from './liveRideBackend';
import { liveBackend } from './liveRideSource';
import { alertNotice, drainQueue, queueAlert, unseenAlerts, type QueuedAlert } from './liveQueue';

export const LIVE_TASK = 'rustnuts-live-ride';
const ACTIVE = 'live.active';
const SEEN = 'live.seen';
const QUEUE = 'live.queue';
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

/** Tells the phone's owner about alerts they haven't heard yet. */
async function notifyNew(state: LiveState, fix: Fix, meId: string): Promise<void> {
  if (!NATIVE) return;
  const seen = await read<string[]>(SEEN, []);
  const fresh = unseenAlerts(seen, state.alerts, meId);
  if (fresh.length === 0) return;
  for (const a of fresh) {
    const { title, body } = alertNotice(a, fix);
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true, data: { rideId: state.rideId }, priority: Notifications.AndroidNotificationPriority.MAX },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    }).catch(() => {});
  }
  await write(SEEN, [...seen, ...fresh.map((a) => a.id)]);
}

/** Sends alerts that were raised with no signal. */
export async function flushQueue(): Promise<void> {
  const queue = await read<QueuedAlert[]>(QUEUE, []);
  if (queue.length === 0) return;
  const left = await drainQueue(queue, async (q) => {
    await liveBackend().raise(q.rideId, q.kind, q.at);
  });
  await write(QUEUE, left);
}

/** Keeps an alert to send when signal comes back. */
export async function holdAlert(item: QueuedAlert): Promise<void> {
  await write(QUEUE, queueAlert(await read<QueuedAlert[]>(QUEUE, []), item));
}

export async function heldAlerts(): Promise<QueuedAlert[]> {
  return read<QueuedAlert[]>(QUEUE, []);
}

async function handleFix(fix: Fix): Promise<void> {
  const active = await read<Active | null>(ACTIVE, null);
  if (!active) return;
  if (Date.now() >= new Date(active.stopsAt).getTime()) {
    await stopTracking();
    return;
  }
  try {
    const state = await liveBackend().update(active.rideId, fix);
    await notifyNew(state, fix, active.meId);
    await flushQueue();
    listeners.forEach((l) => l(fix, state, null));
  } catch (e) {
    listeners.forEach((l) => l(fix, null, e as Error));
  }
}

if (NATIVE) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LIVE_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await handleFix(toFix(data.locations[data.locations.length - 1]));
  });
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Live ride alerts',
    importance: AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 200, 400],
  }).catch(() => {});
}

const OPTIONS = { accuracy: Location.Accuracy.Balanced, timeInterval: 20_000, distanceInterval: 50 };

/**
 * Starts reading the location for this ride until `stopsAt`. Says how: 'background' (keeps going
 * with the screen off), 'foreground' (only while the app is open) or 'denied' (location is off).
 */
export async function startTracking(rideId: string, stopsAt: string, meId: string): Promise<'background' | 'foreground' | 'denied'> {
  const fg = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (!fg?.granted) return 'denied';
  await write(ACTIVE, { rideId, stopsAt, meId } satisfies Active);

  if (NATIVE) {
    await ensureChannel();
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

  watch?.remove();
  watch = await Location.watchPositionAsync(OPTIONS, (loc) => {
    handleFix(toFix(loc));
  });
  return 'foreground';
}

export async function stopTracking(): Promise<void> {
  watch?.remove();
  watch = null;
  if (NATIVE) {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LIVE_TASK)) await Location.stopLocationUpdatesAsync(LIVE_TASK);
    } catch {
      // Not running.
    }
  }
  await AsyncStorage.multiRemove([ACTIVE, SEEN]).catch(() => {});
}

/** Which ride this phone is sharing on, if any (and it hasn't switched itself off). */
export async function activeRide(): Promise<Active | null> {
  const active = await read<Active | null>(ACTIVE, null);
  return active && Date.now() < new Date(active.stopsAt).getTime() ? active : null;
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
  try {
    const last = await Location.getLastKnownPositionAsync();
    return last ? toFix(last) : null;
  } catch {
    return null;
  }
}
