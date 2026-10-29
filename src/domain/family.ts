// Family view: partners and kids who use the app with no Club rights. See
// docs/superpowers/specs/2026-10-29-family-view-design.md. Who counts as Family is isFamily in access.ts.

import { lastDay } from './rides';
import type { Ride } from './types';

/** The next `limit` rides on the calendar from `today` (a Melbourne date), soonest first. */
export function nextRides(rides: Ride[], today: string, limit = 3): Ride[] {
  return rides
    .filter((r) => lastDay(r) >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
}
