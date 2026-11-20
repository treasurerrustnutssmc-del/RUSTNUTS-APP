// Where the phone last knew it was, without asking for anything: no permission prompt, no wait for
// a fresh fix. Null when location is off, not allowed yet, or there's no fix to hand. Used to start
// "Follow the route" from where the rider is rather than the route's start.

import * as Location from 'expo-location';
import type { LatLng } from '../domain/types';

/** A last known fix this old or newer is good enough to place a rider on a route. */
const MAX_AGE_MS = 5 * 60_000;

export async function lastKnownSpot(): Promise<LatLng | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE_MS });
    return last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null;
  } catch {
    return null;
  }
}
