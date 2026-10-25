// The Rusty Bus (the club van, for charity rides and vehicle recovery): bookings for whole
// Melbourne days, and the board's yes or no. These are the rules the database's book_bus,
// decide_bus and cancel_bus actions apply, in the same order with the same words, so the app never
// offers what the server would refuse.

import { activePositions, isNational } from './access';
import { charCount } from './chat';
import { byName } from './crew';
import { addDays, daysBetween, formatAuDate } from './dates';
import { BOARD_ROLES } from './labels';
import { FORMER_MEMBER, memberName } from './profile';
import { lastDay, melbourneDate } from './rides';
import { signedInProblem } from './routes';
import type { BusBooking, BusPurpose, BusStatus, ClubData, Member, Ride } from './types';

/** The longest a booking can be, in days, both ends counted. */
export const MAX_BUS_DAYS = 14;
/** The longest the notes can be, in characters (code points). */
export const MAX_BUS_NOTES = 500;
/** The longest a no's reason can be, in characters (code points). */
export const MAX_BUS_REASON = 300;
/** How long a Declined or Cancelled booking stays under Yours, in days. */
export const RECENT_OFF_DAYS = 30;

/** Refusals the screens and demo also show, in the database's words. */
export const NOT_BUS_BOOKER = 'Only Full and Nomad members can book the Rusty Bus.';
export const BUS_DAYS_MISSING = 'Pick the first and last day.';
export const BUS_LAST_BEFORE_FIRST = 'The last day can’t be before the first.';
export const BUS_PAST_START = 'Bookings can’t start in the past.';
export const BUS_TOO_LONG = 'Keep a booking to 14 days at most.';
export const BUS_TOO_FAR = 'Book at most 12 months ahead.';
export const BUS_NO_PURPOSE = 'Pick what it’s for.';
export const BUS_NO_RIDE = 'That ride isn’t on the calendar.';
export const BUS_BAD_DRIVER = 'Pick a driver who’s an approved member.';
export const BUS_NOTES_TOO_LONG = 'Keep the notes to 500 characters at most.';
export const BUS_CLASH = 'The Rusty Bus is already booked then.';
export const NOT_BUS_MANAGER = 'Only the board or NEC can say yes or no to Rusty Bus bookings.';
export const NO_BOOKING = 'No such booking.';
export const ALREADY_DECIDED = 'That booking has already been decided.';
export const BUS_DAYS_PASSED = 'That booking’s days have passed.';
export const BUS_REASON_TOO_LONG = 'Keep the reason to 300 characters at most.';
export const NOT_BUS_CANCELLER = 'Only whoever booked it, its driver or the board can cancel it.';
export const ALREADY_OFF = 'That booking is already off.';

/** A Waiting booking whose days went by with no yes or no (shown only; it's still stored as Waiting). */
export const NOT_ANSWERED = 'Not answered';
export const NO_YES_IN_TIME = 'The days passed without a yes.';
/** A booking whose linked ride was cancelled: the calendar sync cancels a ride when it moves, too. */
export const RIDE_CALLED_OFF = 'The ride was called off or moved.';
export const RIDE_CALLED_OFF_HINT = 'Cancel this booking if the bus isn’t needed, or book again for the new ride.';
/** The ride screen's chip when another Booked booking holds the bus on the ride's days. */
export const RIDE_BUS_BUSY = 'Rusty Bus booked those days';

/** What someone booking types. Days are ISO dates, or '' when missing. */
export interface BusInput {
  firstDay: string;
  lastDay: string;
  purpose: BusPurpose | null;
  rideId: string | null;
  driverId: string | null;
  notes: string;
}

/** A run of days, both ends included, as ISO dates. */
export interface BusRange {
  first: string;
  last: string;
}

/** The purposes, in the order the form's chips show them. */
export const BUS_PURPOSES: readonly BusPurpose[] = ['charity_ride', 'recovery', 'club_event', 'other'];

const PURPOSE_LABELS: Record<BusPurpose, string> = {
  charity_ride: 'Charity ride',
  recovery: 'Recovery',
  club_event: 'Club event',
  other: 'Other',
};

const STATUS_LABELS: Record<BusStatus, string> = {
  requested: 'Waiting',
  approved: 'Booked',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

/** "Charity ride", "Recovery", "Club event" or "Other". */
export const busPurposeLabel = (purpose: BusPurpose): string => PURPOSE_LABELS[purpose];

/** "Waiting", "Booked", "Declined" or "Cancelled". */
export const busStatusLabel = (status: BusStatus): string => STATUS_LABELS[status];

/** "08/11/2026" for one day, or "08/11/2026 – 10/11/2026" for a range. */
export function formatDays(first: string, last: string): string {
  return first === last ? formatAuDate(first) : `${formatAuDate(first)} – ${formatAuDate(last)}`;
}

/**
 * Who says yes or no: an approved member on the NEC (`isNational`), or with a sitting board seat
 * in any chapter. Mirrors private.manages_bus.
 */
export function managesBus(me: Member | null, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (isNational(me.id, data.positions)) return true;
  return activePositions(me.id, data.positions).some((p) => p.chapterId !== null && BOARD_ROLES.includes(p.role));
}

/** Who can book: approved Full and Nomad members, plus bus managers. */
export function canBookBus(me: Member | null, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  return me.status === 'full' || me.status === 'nomad' || managesBus(me, data);
}

/**
 * Whether a booking skips Waiting: a bus manager makes it, or it's a Recovery whose first day is
 * today or tomorrow. `data` comes last because the spec's three come first.
 */
export function bookedStraightAway(me: Member | null, input: BusInput, today: string, data: ClubData): boolean {
  if (managesBus(me, data)) return true;
  return input.purpose === 'recovery' && (input.firstDay === today || input.firstDay === addDays(today, 1));
}

/** Whether `iso` is a real calendar date written YYYY-MM-DD: the shape, then a round trip through a UTC date. */
function isIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const back = new Date(Date.UTC(y, m - 1, d));
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The same date 12 calendar months on, with 29 February rolling to 28 February (as Road Rules' goodUntil). */
function yearAhead(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  return `${y + 1}-${pad(m)}-${pad(m === 2 && d === 29 ? 28 : d)}`;
}

/**
 * Why `me` can't book these days, or null when they can. Mirrors public.book_bus. `today` is the
 * Melbourne date. A booking that will wait may overlap a Booked one; one that's booked straight
 * away may not.
 */
export function bookProblem(me: Member | null, input: BusInput, data: ClubData, today: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!canBookBus(me, data)) return NOT_BUS_BOOKER;
  const { firstDay: first, lastDay: last } = input;
  if (!isIsoDate(first) || !isIsoDate(last)) return BUS_DAYS_MISSING;
  if (last < first) return BUS_LAST_BEFORE_FIRST;
  if (first < today) return BUS_PAST_START;
  if (daysBetween(first, last) + 1 > MAX_BUS_DAYS) return BUS_TOO_LONG;
  if (first > yearAhead(today)) return BUS_TOO_FAR;
  if (!input.purpose) return BUS_NO_PURPOSE;
  if (input.rideId !== null) {
    const ride = data.rides.find((r) => r.id === input.rideId);
    if (!ride || ride.cancelledAt) return BUS_NO_RIDE;
  }
  const driver = input.driverId === null ? undefined : data.members.find((m) => m.id === input.driverId);
  if (!driver || driver.approval !== 'approved') return BUS_BAD_DRIVER;
  if (charCount(input.notes.trim()) > MAX_BUS_NOTES) return BUS_NOTES_TOO_LONG;
  if (bookedStraightAway(me, input, today, data) && clashesWith({ first, last }, data).length > 0) return BUS_CLASH;
  return null;
}

/**
 * Why `me` can't say yes (or no) to this booking, or null when they can. Mirrors
 * public.decide_bus. The reason only counts on a no.
 */
export function decideProblem(
  me: Member | null,
  booking: BusBooking | undefined,
  yes: boolean,
  reason: string,
  data: ClubData,
  today: string,
): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!managesBus(me, data)) return NOT_BUS_MANAGER;
  if (!booking) return NO_BOOKING;
  if (booking.status !== 'requested') return ALREADY_DECIDED;
  if (booking.lastDay < today) return BUS_DAYS_PASSED;
  if (yes && clashesWith(rangeOf(booking), data, booking.id).length > 0) return BUS_CLASH;
  if (!yes && charCount(reason.trim()) > MAX_BUS_REASON) return BUS_REASON_TOO_LONG;
  return null;
}

/**
 * Why `me` can't cancel this booking, or null when they can. Mirrors public.cancel_bus. A
 * booking already under way can still be cancelled until its last day is over.
 */
export function cancelProblem(me: Member | null, booking: BusBooking | undefined, data: ClubData, today: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!booking) return NO_BOOKING;
  if (!canCancelBus(me, booking, data)) return NOT_BUS_CANCELLER;
  if (isOff(booking)) return ALREADY_OFF;
  if (booking.lastDay < today) return BUS_DAYS_PASSED;
  return null;
}

/** Whoever booked it, its driver, or a bus manager. Someone who has left (null) is nobody. */
function canCancelBus(me: Member | null, booking: BusBooking, data: ClubData): boolean {
  if (!me) return false;
  return booking.bookedBy === me.id || booking.driverId === me.id || managesBus(me, data);
}

const isOff = (b: BusBooking): boolean => b.status === 'declined' || b.status === 'cancelled';
const isLive = (b: BusBooking): boolean => b.status === 'approved' || b.status === 'requested';
const rangeOf = (b: BusBooking): BusRange => ({ first: b.firstDay, last: b.lastDay });
/** Orders ISO dates and timestamps (they sort as plain strings), with no locale involved. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byFirstDay = (a: BusBooking, b: BusBooking): number =>
  cmp(a.firstDay, b.firstDay) || cmp(a.lastDay, b.lastDay) || cmp(a.bookedAt, b.bookedAt);

/**
 * The Booked bookings sharing any day with `range`, by first day. Touching ends clash (01–03 and
 * 03–05 share the 3rd). `exceptId` leaves out the booking being decided.
 */
export function clashesWith(range: BusRange, data: ClubData, exceptId?: string): BusBooking[] {
  return (data.busBookings ?? [])
    .filter((b) => b.status === 'approved' && b.id !== exceptId && b.firstDay <= range.last && range.first <= b.lastDay)
    .sort(byFirstDay);
}

/** The Booked booking covering `today`, or undefined when the bus is free. */
export function busToday(data: ClubData, today: string): BusBooking | undefined {
  return clashesWith({ first: today, last: today }, data)[0];
}

/**
 * Booked and Waiting bookings not yet over, grouped by month ('YYYY-MM'), in date order. A booking
 * sits under the month of the later of its first day and today, so one already under way shows
 * under this month rather than the month it started.
 */
export function upcomingBus(data: ClubData, today: string): { month: string; bookings: BusBooking[] }[] {
  const groups: { month: string; bookings: BusBooking[] }[] = [];
  for (const b of (data.busBookings ?? []).filter((x) => isLive(x) && x.lastDay >= today).sort(byFirstDay)) {
    const month = (b.firstDay > today ? b.firstDay : today).slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.bookings.push(b);
    else groups.push({ month, bookings: [b] });
  }
  return groups;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-11' → "November 2026", for upcomingBus's month headers. */
export const busMonthLabel = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** The Rusty Bus screen's header: "Free today", or "Out today: Recovery, Diesel". */
export function busTodayLine(data: ClubData, today: string): string {
  const out = busToday(data, today);
  return out ? `Out today: ${busPurposeLabel(out.purpose)}, ${busPersonName(out.driverId, data)}` : 'Free today';
}

/** The Rides list's Rusty Bus row: busTodayLine, with " · 2 waiting" for a bus manager when any are. */
export function busRowLine(me: Member | null, data: ClubData, today: string): string {
  const waiting = managesBus(me, data) ? waitingForYes(data, today).length : 0;
  return waiting > 0 ? `${busTodayLine(data, today)} · ${waiting} waiting` : busTodayLine(data, today);
}

/** "Clashes with Recovery 03/11/2026" (and "and N more"), for clashesWith's result, or null for none. */
export function clashLine(clashes: BusBooking[]): string | null {
  const [first, ...rest] = clashes;
  if (!first) return null;
  const line = `Clashes with ${busPurposeLabel(first.purpose)} ${formatDays(first.firstDay, first.lastDay)}`;
  return rest.length > 0 ? `${line} and ${rest.length} more` : line;
}

/** Calendar rides on any of these days (Melbourne dates), cancelled ones left out, by start: the form's "For a ride?" list. */
export function ridesInDays(range: BusRange, data: ClubData): Ride[] {
  return data.rides
    .filter((r) => !r.cancelledAt && melbourneDate(r.startsAt) <= range.last && range.first <= lastDay(r))
    .sort((a, b) => cmp(a.startsAt, b.startsAt));
}

/** Waiting bookings whose days aren't over, oldest asked first: the managers' list. */
export function waitingForYes(data: ClubData, today: string): BusBooking[] {
  return (data.busBookings ?? [])
    .filter((b) => b.status === 'requested' && b.lastDay >= today)
    .sort((a, b) => cmp(a.bookedAt, b.bookedAt));
}

/** A Waiting booking whose last day is over: nobody said yes or no in time. */
export const notAnswered = (b: BusBooking, today: string): boolean => b.status === 'requested' && b.lastDay < today;

/** The status as shown: "Not answered" for a Waiting booking whose days have passed, else busStatusLabel. */
export const busShownStatus = (b: BusBooking, today: string): string => (notAnswered(b, today) ? NOT_ANSWERED : busStatusLabel(b.status));

/** Sorts after any time, so an unanswered booking counts as going off at the end of its last day. */
const END_OF_DAY = '\uffff';

/**
 * When a booking came off, as its Melbourne date and the time: decided for a Declined one,
 * cancelled for a Cancelled one, and the end of its last day for one never answered.
 */
function offWhen(b: BusBooking, today: string): { day: string; at: string } | null {
  if (b.status === 'declined' && b.decidedAt) return { day: melbourneDate(b.decidedAt), at: b.decidedAt };
  if (b.status === 'cancelled' && b.cancelledAt) return { day: melbourneDate(b.cancelledAt), at: b.cancelledAt };
  if (notAnswered(b, today)) return { day: b.lastDay, at: END_OF_DAY };
  return null;
}

/**
 * My own bookings that came off in the last 30 days (Melbourne dates), newest first: Declined,
 * Cancelled, and Waiting ones whose days passed without an answer (counted from the last day).
 */
export function myRecentOff(me: Member | null, data: ClubData, today: string): BusBooking[] {
  if (!me) return [];
  return (data.busBookings ?? [])
    .flatMap((b) => {
      const off = b.bookedBy === me.id ? offWhen(b, today) : null;
      return off && daysBetween(off.day, today) <= RECENT_OFF_DAYS ? [{ b, off }] : [];
    })
    .sort((x, y) => cmp(y.off.day, x.off.day) || cmp(y.off.at, x.off.at))
    .map((x) => x.b);
}

/** The newest Booked or Waiting booking linked to this ride, for the ride screen's chip. */
export function busForRide(rideId: string, data: ClubData): BusBooking | undefined {
  let newest: BusBooking | undefined;
  for (const b of data.busBookings ?? []) {
    if (b.rideId === rideId && isLive(b) && (!newest || b.bookedAt > newest.bookedAt)) newest = b;
  }
  return newest;
}

/** The ride's own days, as Melbourne dates. */
const rideRange = (ride: Ride): BusRange => ({ first: melbourneDate(ride.startsAt), last: lastDay(ride) });

/**
 * A Booked booking on any of the ride's days that isn't linked to it (the first by day), or
 * undefined. The ride screen shows it in place of the Book link, since a straight-away booking
 * would clash.
 */
export function busOverRide(ride: Ride, data: ClubData): BusBooking | undefined {
  return clashesWith(rideRange(ride), data).find((b) => b.rideId !== ride.id);
}

/** The ride screen's chip: "Rusty Bus booked", with the booking's days when they aren't exactly the ride's. */
export function busChipLabel(booking: BusBooking, ride: Ride): string {
  const label = booking.status === 'approved' ? 'Rusty Bus booked' : 'Rusty Bus asked for';
  const own = rideRange(ride);
  return booking.firstDay === own.first && booking.lastDay === own.last ? label : `${label} ${formatDays(booking.firstDay, booking.lastDay)}`;
}

/** Who can drive: every approved member, by name. */
export function busDrivers(data: ClubData): Member[] {
  return data.members.filter((m) => m.approval === 'approved').sort(byName);
}

/** A driver's or booker's name, or "A former member" once they've left (null or gone). */
export function busPersonName(memberId: string | null, data: ClubData): string {
  return memberId === null ? FORMER_MEMBER : memberName(memberId, data.members);
}

/** The booking's ride, or undefined when it has none or the ride was deleted. */
export function busRide(booking: BusBooking, data: ClubData): Ride | undefined {
  return booking.rideId === null ? undefined : data.rides.find((r) => r.id === booking.rideId);
}

/**
 * Whether a Booked or Waiting booking's ride is on the calendar but cancelled. The sync cancels a
 * ride and adds a new one when its time moves, so this also means "moved". A booking already off
 * isn't flagged (there's nothing left to do), nor is one whose ride isn't loaded (live loads rides
 * from today on): its ride line just goes.
 */
export function rideCalledOff(booking: BusBooking, data: ClubData): boolean {
  return isLive(booking) && !!busRide(booking, data)?.cancelledAt;
}
