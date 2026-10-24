// What goes out when a member shares a ride to Messenger, a text and the like.

import { formatAuDate } from './dates';
import { lastDay, melbourneDate, melbourneTime } from './rides';
import type { Ride } from './types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sat 07/11/2026", for a YYYY-MM-DD date. */
function dayAndDate(iso: string): string {
  return `${DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${formatAuDate(iso)}`;
}

/** "West breakfast run · Sat 07/11/2026 8:30 am · BP Ravenhall. Answer in the Rustnuts app." */
export function rideShareText(ride: Ride): string {
  const first = melbourneDate(ride.startsAt);
  const last = lastDay(ride);
  const when = ride.allDay
    ? `${dayAndDate(first)} · ${last > first ? `All day, to ${formatAuDate(last)}` : 'All day'}`
    : `${dayAndDate(first)} ${melbourneTime(ride.startsAt)}`;
  const where = ride.location?.trim();
  const parts = [ride.title, when, where].filter(Boolean).join(' · ');
  return ride.cancelledAt ? `CANCELLED: ${parts}.` : `${parts}. Answer in the Rustnuts app.`;
}
