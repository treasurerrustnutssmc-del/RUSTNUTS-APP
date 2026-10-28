// Event hubs: registrations and accommodation for an overnight or big ride (the Big 4, the Not Dead
// Yet Run). No payments. These are the rules the database's save_hub, register_hub and withdraw_hub
// apply, in the same order with the same words.

import { managesRide } from './crew';
import { formatAuDate, weekday } from './dates';
import { displayName } from './profile';
import { answersClose, endOfFirstDay, melbourneDate } from './rides';
import { signedInProblem } from './routes';
import type { ClubData, HubRegistration, HubStaying, Member, Ride, RideHub } from './types';

export const MAX_HUB_TEXT = 1000;
export const MAX_SHARE_WITH = 80;
export const MAX_REG_NOTES = 200;
export const STAYING: HubStaying[] = ['group', 'own', 'camping', 'day'];
export const STAYING_LABEL: Record<HubStaying, string> = {
  group: 'With the group',
  own: 'Sorting my own',
  camping: 'Camping',
  day: 'Day trip only',
};

export const HUB_LOCKED = 'The hub can’t change after the ride day.';
export const NOT_HUB_MANAGER = 'Only the board, ride committee or NEC can run the hub.';
export const BAD_CLOSING_DAY = 'Pick a closing day from today up to the ride day.';
export const BEDS_LIMITS = 'Group beds: 1 to 500, or leave it blank.';
export const HUB_TEXT_TOO_LONG = 'That’s too long (1000 characters at most).';
export const NO_HUB = 'This ride doesn’t take registrations.';
export const REGISTRATIONS_CLOSED = 'Registrations have closed.';
export const MEMBERS_ONLY = 'This one’s for FNG, Full and Nomad members.';
export const REGISTER_TOO_LONG = 'Keep it short: 80 characters for who you’re sharing with, 200 for notes.';
export const GROUP_FULL = 'The group booking is full.';
export const NOT_REGISTERED = 'You’re not registered.';

export interface HubInput {
  membersOnly: boolean;
  closesOn: string | null;
  beds: number | null;
  accommodation: string;
  notes: string;
}

export interface RegisterInput {
  staying: HubStaying;
  pillion: boolean;
  shareWith: string;
  notes: string;
}

const length = (s: string): number => [...s.trim()].length;

export const hubFor = (rideId: string, data: ClubData): RideHub | undefined => (data.rideHubs ?? []).find((h) => h.rideId === rideId);

/** A ride's registrations that haven't been withdrawn, by when they came in. */
export function registrationsFor(rideId: string, data: ClubData): HubRegistration[] {
  return (data.hubRegistrations ?? [])
    .filter((r) => r.rideId === rideId && !r.withdrawnAt)
    .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
}

export function myRegistration(rideId: string, memberId: string, data: ClubData): HubRegistration | undefined {
  return registrationsFor(rideId, data).find((r) => r.memberId === memberId);
}

/** Why `me` can't open or change this ride's hub, or null when they can. Mirrors public.save_hub. */
export function saveHubProblem(me: Member | null, ride: Ride | undefined, input: HubInput, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (Date.parse(now) >= endOfFirstDay(ride)) return HUB_LOCKED;
  if (!managesRide(me, ride, data)) return NOT_HUB_MANAGER;
  if (input.beds !== null && (!Number.isInteger(input.beds) || input.beds < 1 || input.beds > 500)) return BEDS_LIMITS;
  if (length(input.accommodation) > MAX_HUB_TEXT || length(input.notes) > MAX_HUB_TEXT) return HUB_TEXT_TOO_LONG;
  // A closing day already set can stay; a new one runs from today to the ride day.
  const kept = input.closesOn !== null && hubFor(ride.id, data)?.closesOn === input.closesOn;
  if (input.closesOn !== null && !kept && (input.closesOn < melbourneDate(now) || input.closesOn > melbourneDate(ride.startsAt))) {
    return BAD_CLOSING_DAY;
  }
  return null;
}

/** Whether registrations are closed: the ride has started, or its closing day (Melbourne `today`) has passed. */
export function registrationsClosed(ride: Ride, hub: RideHub, now: string, today: string): boolean {
  return Date.parse(now) >= answersClose(ride) || (hub.closesOn !== null && today > hub.closesOn);
}

/** Group places taken: riders and their pillions with the group, leaving out `exceptId`. */
function groupTaken(rideId: string, data: ClubData, exceptId: string | null): number {
  return registrationsFor(rideId, data)
    .filter((r) => r.staying === 'group' && r.memberId !== exceptId)
    .reduce((n, r) => n + 1 + (r.pillion ? 1 : 0), 0);
}

/** Why `me` can't register (or change their registration), or null. Mirrors public.register_hub. */
export function registerProblem(
  me: Member | null,
  ride: Ride | undefined,
  input: RegisterInput,
  data: ClubData,
  now: string,
  today: string,
): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  const hub = hubFor(ride.id, data);
  if (!hub) return NO_HUB;
  if (registrationsClosed(ride, hub, now, today)) return REGISTRATIONS_CLOSED;
  if (hub.membersOnly && !['fng', 'full', 'nomad'].includes(me!.status)) return MEMBERS_ONLY;
  if (length(input.shareWith) > MAX_SHARE_WITH || length(input.notes) > MAX_REG_NOTES) return REGISTER_TOO_LONG;
  if (input.staying === 'group' && hub.beds !== null && groupTaken(ride.id, data, me!.id) + 1 + (input.pillion ? 1 : 0) > hub.beds) {
    return GROUP_FULL;
  }
  return null;
}

/** Why `me` can't withdraw, or null. The closing day doesn't stop it. Mirrors public.withdraw_hub. */
export function withdrawHubProblem(me: Member | null, ride: Ride | undefined, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (!myRegistration(ride.id, me!.id, data)) return NOT_REGISTERED;
  if (Date.parse(now) >= answersClose(ride)) return REGISTRATIONS_CLOSED;
  return null;
}

export interface HubCounts extends Record<HubStaying, number> {
  riders: number;
  pillions: number;
}

/** The hub's numbers: riders, pillions, and riders by where they're staying. */
export function hubCounts(rideId: string, data: ClubData): HubCounts {
  const counts: HubCounts = { riders: 0, pillions: 0, group: 0, own: 0, camping: 0, day: 0 };
  for (const r of registrationsFor(rideId, data)) {
    counts.riders += 1;
    if (r.pillion) counts.pillions += 1;
    counts[r.staying] += 1;
  }
  return counts;
}

/** The registrations as plain text, for booking rooms: by where they're staying, then by name. */
export function hubListText(ride: Ride, data: ClubData): string {
  const day = melbourneDate(ride.startsAt);
  const counts = hubCounts(ride.id, data);
  const hub = hubFor(ride.id, data);
  const name = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? (m.roadName ? `${m.roadName} (${m.fullName})` : m.fullName) : 'Former member';
  };
  const lines = [
    `${ride.title} · ${weekday(day)} ${formatAuDate(day)}`,
    `${counts.riders} rider${counts.riders === 1 ? '' : 's'}, ${counts.pillions} pillion${counts.pillions === 1 ? '' : 's'}`,
  ];
  if (hub?.accommodation) lines.push(`Staying: ${hub.accommodation}`);
  for (const staying of STAYING) {
    const regs = registrationsFor(ride.id, data).filter((r) => r.staying === staying);
    if (regs.length === 0) continue;
    const beds = staying === 'group' && hub?.beds ? ` (${groupTaken(ride.id, data, null)} of ${hub.beds} beds)` : '';
    lines.push('', `${STAYING_LABEL[staying]}${beds}`);
    for (const r of regs.sort((a, b) => name(a.memberId).localeCompare(name(b.memberId)))) {
      const extra = [r.pillion ? ' + pillion' : '', r.shareWith ? `, sharing with ${r.shareWith}` : '', r.notes ? `: ${r.notes}` : ''].join('');
      lines.push(`- ${name(r.memberId)}${extra}`);
    }
  }
  return lines.join('\n');
}

/** Registered, but not Going: the hub nudges them to say Going too. */
export function registeredNotGoing(rideId: string, me: Member, data: ClubData): boolean {
  return !!myRegistration(rideId, me.id, data) && !data.rsvps.some((r) => r.rideId === rideId && r.memberId === me.id && r.answer === 'going');
}

export { displayName };
