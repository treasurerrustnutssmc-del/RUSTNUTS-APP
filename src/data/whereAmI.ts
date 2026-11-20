// Where the phone is, for "Follow the route" to start from where the rider is rather than the
// route's start. A fix from the last minute straight away; otherwise a fresh one, waiting at most
// 4 seconds. Asks for location only if it has never been asked. Null when it can't tell.

import * as Location from 'expo-location';
import type { RiderSpot } from '../domain/rideMap';

/** A last known fix this old or newer is near enough: at 100 km/h, under 2 km behind. */
const MAX_AGE_MS = 60_000;
const FRESH_WAIT_MS = 4_000;

const toSpot = (loc: Location.LocationObject): RiderSpot => ({
  lat: loc.coords.latitude,
  lng: loc.coords.longitude,
  heading: loc.coords.heading,
});

export async function whereAmI(): Promise<RiderSpot | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.status === Location.PermissionStatus.UNDETERMINED && perm.canAskAgain) {
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE_MS }).catch(() => null);
    if (last) return toSpot(last);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FRESH_WAIT_MS));
    const fresh = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout]);
    return fresh ? toSpot(fresh) : null;
  } catch {
    return null;
  }
}
