import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_DECIDED,
  ALREADY_OFF,
  BUS_BAD_DRIVER,
  BUS_CLASH,
  BUS_DAYS_MISSING,
  BUS_DAYS_PASSED,
  BUS_LAST_BEFORE_FIRST,
  BUS_NOTES_TOO_LONG,
  BUS_NO_PURPOSE,
  BUS_NO_RIDE,
  BUS_PAST_START,
  BUS_PURPOSES,
  BUS_REASON_TOO_LONG,
  BUS_TOO_FAR,
  BUS_TOO_LONG,
  MAX_BUS_DAYS,
  MAX_BUS_NOTES,
  MAX_BUS_REASON,
  NOT_BUS_BOOKER,
  NOT_BUS_CANCELLER,
  NOT_BUS_MANAGER,
  NO_BOOKING,
  bookProblem,
  bookedStraightAway,
  busDrivers,
  busForRide,
  busPersonName,
  busPurposeLabel,
  busRide,
  busStatusLabel,
  busToday,
  canBookBus,
  cancelProblem,
  clashesWith,
  decideProblem,
  formatDays,
  managesBus,
  myRecentOff,
  upcomingBus,
  waitingForYes,
  type BusInput,
} from './bus';
import type { BusBooking, ClubData, Member, Position, PositionRole, Ride } from './types';

const TODAY = '2026-10-25';

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'ch-west', fullName: `Full ${id}`, roadName: id, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});

const position = (memberId: string, role: PositionRole, chapterId: string | null, endedOn: string | null = null): Position => ({
  id: `p-${memberId}-${role}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn,
});

const ride = (id: string, over: Partial<Ride> = {}): Ride => ({
  id, title: `Ride ${id}`, startsAt: '2026-11-08T22:00:00.000Z', endsAt: null, allDay: false, location: null,
  notes: null, category: 'club', cancelledAt: null, ...over,
});

const booking = (id: string, firstDay: string, lastDay: string, over: Partial<BusBooking> = {}): BusBooking => ({
  id, firstDay, lastDay, purpose: 'charity_ride', rideId: null, driverId: 'rider', notes: '', status: 'approved',
  bookedBy: 'rider', bookedAt: '2026-10-01T00:00:00.000Z', decidedBy: 'nec', decidedAt: '2026-10-02T00:00:00.000Z',
  declineReason: '', cancelledBy: null, cancelledAt: null, ...over,
});

// The cast. nec sits on the NEC; westTreasurer is an FNG with a board seat (a manager, so can book);
// rideCommittee and exPres have no board seat; the rest are ordinary members by status.
const nec = member('nec', { chapterId: 'ch-north' });
const westTreasurer = member('west-treasurer', { status: 'fng' });
const exPres = member('ex-pres');
const rideCommittee = member('ride-committee');
const rider = member('rider');
const nomad = member('nomad', { status: 'nomad' });
const fng = member('fng', { status: 'fng' });
const supporter = member('supporter', { status: 'supporter' });
const legacy = member('legacy', { status: 'legacy' });
const pending = member('pending', { approval: 'pending' });
const suspendedNec = member('suspended-nec', { approval: 'suspended' });

const data = (over: Partial<ClubData> = {}): ClubData => ({
  chapters: [], members: [nec, westTreasurer, exPres, rideCommittee, rider, nomad, fng, supporter, legacy, pending, suspendedNec],
  privates: [], bikes: [], registrations: [], emergencyContacts: [],
  positions: [
    position('nec', 'nec_chair', null),
    position('west-treasurer', 'treasurer', 'ch-west'),
    position('ex-pres', 'president', 'ch-west', '2025-06-30'),
    position('ride-committee', 'ride_committee', 'ch-west'),
    position('suspended-nec', 'nec_secretary', null),
  ],
  rides: [ride('r-1'), ride('r-gone', { cancelledAt: '2026-10-20T00:00:00.000Z' })],
  rsvps: [],
  ...over,
});

const OK: BusInput = {
  firstDay: '2026-11-08', lastDay: '2026-11-09', purpose: 'charity_ride', rideId: 'r-1', driverId: 'rider', notes: 'Trailer too.',
};

// ---------------------------------------------------------------------------
// Messages, limits and labels
// ---------------------------------------------------------------------------

test('the messages are the spec’s words, with the curly ’', () => {
  assert.equal(NOT_BUS_BOOKER, 'Only Full and Nomad members can book the Rusty Bus.');
  assert.equal(BUS_DAYS_MISSING, 'Pick the first and last day.');
  assert.equal(BUS_LAST_BEFORE_FIRST, 'The last day can’t be before the first.');
  assert.equal(BUS_PAST_START, 'Bookings can’t start in the past.');
  assert.equal(BUS_TOO_LONG, 'Keep a booking to 14 days at most.');
  assert.equal(BUS_TOO_FAR, 'Book at most 12 months ahead.');
  assert.equal(BUS_NO_PURPOSE, 'Pick what it’s for.');
  assert.equal(BUS_NO_RIDE, 'That ride isn’t on the calendar.');
  assert.equal(BUS_BAD_DRIVER, 'Pick a driver who’s an approved member.');
  assert.equal(BUS_NOTES_TOO_LONG, 'Keep the notes to 500 characters at most.');
  assert.equal(BUS_CLASH, 'The Rusty Bus is already booked then.');
  assert.equal(NOT_BUS_MANAGER, 'Only the board or NEC can say yes or no to Rusty Bus bookings.');
  assert.equal(NO_BOOKING, 'No such booking.');
  assert.equal(ALREADY_DECIDED, 'That booking has already been decided.');
  assert.equal(BUS_DAYS_PASSED, 'That booking’s days have passed.');
  assert.equal(BUS_REASON_TOO_LONG, 'Keep the reason to 300 characters at most.');
  assert.equal(NOT_BUS_CANCELLER, 'Only whoever booked it, its driver or the board can cancel it.');
  assert.equal(ALREADY_OFF, 'That booking is already off.');
  assert.equal(MAX_BUS_DAYS, 14);
  assert.equal(MAX_BUS_NOTES, 500);
  assert.equal(MAX_BUS_REASON, 300);
});

test('purposes and statuses have the spec’s names, in the spec’s order', () => {
  assert.deepEqual(BUS_PURPOSES, ['charity_ride', 'recovery', 'club_event', 'other']);
  assert.deepEqual(BUS_PURPOSES.map(busPurposeLabel), ['Charity ride', 'Recovery', 'Club event', 'Other']);
  assert.equal(busStatusLabel('requested'), 'Waiting');
  assert.equal(busStatusLabel('approved'), 'Booked');
  assert.equal(busStatusLabel('declined'), 'Declined');
  assert.equal(busStatusLabel('cancelled'), 'Cancelled');
});

test('formatDays shows one date for a single day, or a range with an en dash', () => {
  assert.equal(formatDays('2026-11-08', '2026-11-08'), '08/11/2026');
  assert.equal(formatDays('2026-11-08', '2026-11-10'), '08/11/2026 – 10/11/2026');
});

// ---------------------------------------------------------------------------
// Who manages and who books
// ---------------------------------------------------------------------------

test('bus managers are the NEC plus any sitting board seat, approved', () => {
  const d = data();
  assert.equal(managesBus(nec, d), true, 'NEC');
  assert.equal(managesBus(westTreasurer, d), true, 'a board seat in any chapter');
  assert.equal(managesBus(member('north-pres', { chapterId: 'ch-north' }), data({ positions: [position('north-pres', 'president', 'ch-north')] })), true);
  assert.equal(managesBus(exPres, d), false, 'an ended seat');
  assert.equal(managesBus(rideCommittee, d), false, 'not a board seat');
  assert.equal(managesBus(rider, d), false);
  assert.equal(managesBus(suspendedNec, d), false, 'not approved');
  assert.equal(managesBus(null, d), false);
});

test('approved Full and Nomad members and bus managers can book', () => {
  const d = data();
  assert.equal(canBookBus(rider, d), true);
  assert.equal(canBookBus(nomad, d), true);
  assert.equal(canBookBus(westTreasurer, d), true, 'an FNG with a board seat');
  assert.equal(canBookBus(nec, d), true);
  assert.equal(canBookBus(fng, d), false);
  assert.equal(canBookBus(supporter, d), false);
  assert.equal(canBookBus(legacy, d), false);
  assert.equal(canBookBus(pending, d), false);
  assert.equal(canBookBus(suspendedNec, d), false);
  assert.equal(canBookBus(null, d), false);
});

// ---------------------------------------------------------------------------
// Booking: every message, in order
// ---------------------------------------------------------------------------

test('bookProblem gives every message in the spec’s order', () => {
  const booked = booking('b-booked', '2026-10-25', '2026-10-26');
  const d = data({ busBookings: [booked] });
  // Start with everything wrong and put one thing right at a time.
  let input: BusInput = { firstDay: '', lastDay: '', purpose: null, rideId: 'r-gone', driverId: null, notes: 'x'.repeat(501) };
  assert.equal(bookProblem(null, input, d, TODAY), 'Sign in first.');
  assert.equal(bookProblem(pending, input, d, TODAY), 'Only approved members can do that.');
  assert.equal(bookProblem(fng, input, d, TODAY), NOT_BUS_BOOKER);
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_DAYS_MISSING);
  input = { ...input, firstDay: '2026-11-09', lastDay: '2026-11-08' };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_LAST_BEFORE_FIRST);
  input = { ...input, firstDay: '2026-10-24', lastDay: '2026-11-30' };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_PAST_START);
  input = { ...input, firstDay: '2027-11-01', lastDay: '2027-11-30' };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_TOO_LONG);
  input = { ...input, lastDay: '2027-11-02' };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_TOO_FAR);
  input = { ...input, firstDay: '2026-10-25', lastDay: '2026-10-26' };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_NO_PURPOSE);
  input = { ...input, purpose: 'recovery' };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_NO_RIDE);
  input = { ...input, rideId: null };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_BAD_DRIVER);
  input = { ...input, driverId: 'rider' };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_NOTES_TOO_LONG);
  input = { ...input, notes: '' };
  assert.equal(bookProblem(rider, input, d, TODAY), BUS_CLASH, 'a recovery today, booked straight away, on Booked days');
  input = { ...input, firstDay: '2026-10-27', lastDay: '2026-10-27' };
  assert.equal(bookProblem(rider, input, d, TODAY), null);
});

test('a day that is not a real ISO date is missing', () => {
  const d = data();
  for (const [firstDay, lastDay] of [
    ['', '2026-11-08'], ['2026-11-08', ''], ['2026-02-30', '2026-03-01'], ['2026-11-08', '2026-13-01'],
    ['08/11/2026', '2026-11-09'], ['2026-11-8', '2026-11-09'], ['not a date', '2026-11-09'],
  ]) {
    assert.equal(bookProblem(rider, { ...OK, firstDay, lastDay }, d, TODAY), BUS_DAYS_MISSING, `${firstDay}..${lastDay}`);
  }
  assert.equal(bookProblem(rider, OK, d, TODAY), null);
});

test('a booking can start today but not yesterday', () => {
  const d = data();
  assert.equal(bookProblem(rider, { ...OK, rideId: null, firstDay: TODAY, lastDay: TODAY }, d, TODAY), null);
  assert.equal(bookProblem(rider, { ...OK, rideId: null, firstDay: '2026-10-24', lastDay: TODAY }, d, TODAY), BUS_PAST_START);
});

test('a booking is 14 days at most, both ends counted', () => {
  const d = data();
  const at = (lastDay: string) => bookProblem(rider, { ...OK, rideId: null, firstDay: '2026-11-01', lastDay }, d, TODAY);
  assert.equal(at('2026-11-01'), null, 'one day');
  assert.equal(at('2026-11-14'), null, '14 days');
  assert.equal(at('2026-11-15'), BUS_TOO_LONG, '15 days');
});

test('the first day is at most 12 calendar months ahead', () => {
  const d = data();
  const at = (firstDay: string, today: string) => bookProblem(rider, { ...OK, rideId: null, firstDay, lastDay: firstDay }, d, today);
  assert.equal(at('2027-10-25', TODAY), null, 'exactly 12 months');
  assert.equal(at('2027-10-26', TODAY), BUS_TOO_FAR);
  // From 29 February the edge is 28 February the year after.
  assert.equal(at('2029-02-28', '2028-02-29'), null);
  assert.equal(at('2029-03-01', '2028-02-29'), BUS_TOO_FAR);
  // From 28 February in a year before a leap year, the edge is 28 February, not 29.
  assert.equal(at('2028-02-28', '2027-02-28'), null);
  assert.equal(at('2028-02-29', '2027-02-28'), BUS_TOO_FAR);
});

test('the ride must be on the calendar and not cancelled; no ride is fine', () => {
  const d = data();
  assert.equal(bookProblem(rider, { ...OK, rideId: 'r-1' }, d, TODAY), null);
  assert.equal(bookProblem(rider, { ...OK, rideId: null }, d, TODAY), null);
  assert.equal(bookProblem(rider, { ...OK, rideId: 'r-missing' }, d, TODAY), BUS_NO_RIDE);
  assert.equal(bookProblem(rider, { ...OK, rideId: 'r-gone' }, d, TODAY), BUS_NO_RIDE);
});

test('the driver must be an approved member', () => {
  const d = data();
  assert.equal(bookProblem(rider, { ...OK, driverId: 'nomad' }, d, TODAY), null);
  assert.equal(bookProblem(rider, { ...OK, driverId: 'supporter' }, d, TODAY), null, 'any approved member');
  assert.equal(bookProblem(rider, { ...OK, driverId: 'pending' }, d, TODAY), BUS_BAD_DRIVER);
  assert.equal(bookProblem(rider, { ...OK, driverId: 'suspended-nec' }, d, TODAY), BUS_BAD_DRIVER);
  assert.equal(bookProblem(rider, { ...OK, driverId: 'gone' }, d, TODAY), BUS_BAD_DRIVER);
  assert.equal(bookProblem(rider, { ...OK, driverId: null }, d, TODAY), BUS_BAD_DRIVER);
});

test('notes are trimmed and counted in code points', () => {
  const d = data();
  assert.equal(bookProblem(rider, { ...OK, notes: `  ${'x'.repeat(500)}  ` }, d, TODAY), null);
  assert.equal(bookProblem(rider, { ...OK, notes: '🚐'.repeat(500) }, d, TODAY), null, 'an emoji is one');
  assert.equal(bookProblem(rider, { ...OK, notes: 'x'.repeat(501) }, d, TODAY), BUS_NOTES_TOO_LONG);
});

// ---------------------------------------------------------------------------
// Booked straight away (Review Focus 2)
// ---------------------------------------------------------------------------

test('a manager’s booking, or a recovery today or tomorrow, is booked straight away', () => {
  const d = data();
  const recovery = (firstDay: string): BusInput => ({ ...OK, purpose: 'recovery', rideId: null, firstDay, lastDay: firstDay });
  assert.equal(bookedStraightAway(nec, { ...OK, firstDay: '2027-01-10', lastDay: '2027-01-12' }, TODAY, d), true, 'NEC');
  assert.equal(bookedStraightAway(westTreasurer, OK, TODAY, d), true, 'a board seat');
  assert.equal(bookedStraightAway(rider, recovery('2026-10-25'), TODAY, d), true, 'recovery today');
  assert.equal(bookedStraightAway(rider, recovery('2026-10-26'), TODAY, d), true, 'recovery tomorrow');
  assert.equal(bookedStraightAway(rider, recovery('2026-10-27'), TODAY, d), false, 'recovery in 2 days waits');
  assert.equal(bookedStraightAway(rider, recovery('2026-10-28'), TODAY, d), false, 'recovery in 3 days waits');
  assert.equal(bookedStraightAway(rider, { ...recovery('2026-10-25'), purpose: 'club_event' }, TODAY, d), false, 'not a recovery');
  assert.equal(bookedStraightAway(rider, OK, TODAY, d), false, 'an ordinary request waits');
  assert.equal(bookedStraightAway(rideCommittee, OK, TODAY, d), false, 'ride committee isn’t a manager');
});

test('a clash on straight-away is refused, but a waiting request may overlap', () => {
  const booked = booking('b-booked', '2026-11-08', '2026-11-10');
  const d = data({ busBookings: [booked] });
  // An ordinary member asking: waits, so the overlap is allowed.
  assert.equal(bookProblem(rider, { ...OK, firstDay: '2026-11-09', lastDay: '2026-11-09' }, d, TODAY), null);
  // A manager's booking is booked straight away, so it's refused.
  assert.equal(bookProblem(nec, { ...OK, firstDay: '2026-11-10', lastDay: '2026-11-12' }, d, TODAY), BUS_CLASH);
  assert.equal(bookProblem(nec, { ...OK, firstDay: '2026-11-11', lastDay: '2026-11-12' }, d, TODAY), null, 'the next day is free');
  // A recovery tomorrow by an ordinary Full member, on Booked days.
  const today = '2026-11-07';
  const recovery: BusInput = { ...OK, purpose: 'recovery', rideId: null, firstDay: '2026-11-08', lastDay: '2026-11-08' };
  assert.equal(bookProblem(rider, recovery, d, today), BUS_CLASH);
  assert.equal(bookProblem(rider, { ...recovery, firstDay: '2026-11-07', lastDay: '2026-11-07' }, d, today), null);
});

// ---------------------------------------------------------------------------
// Clashes (Review Focus 1)
// ---------------------------------------------------------------------------

test('clashes share a day: touching ranges clash, neighbours don’t', () => {
  const a = booking('a', '2026-11-01', '2026-11-03');
  const d = data({ busBookings: [a] });
  assert.deepEqual(clashesWith({ first: '2026-11-03', last: '2026-11-05' }, d).map((b) => b.id), ['a'], '01–03 and 03–05 share the 3rd');
  assert.deepEqual(clashesWith({ first: '2026-10-30', last: '2026-11-01' }, d).map((b) => b.id), ['a'], 'sharing the 1st');
  assert.deepEqual(clashesWith({ first: '2026-11-04', last: '2026-11-05' }, d), [], '01–03 and 04–05');
  assert.deepEqual(clashesWith({ first: '2026-10-29', last: '2026-10-31' }, d), [], 'the days before');
});

test('a single day clashes with a range that covers it, both ways', () => {
  const range = booking('range', '2026-11-01', '2026-11-05');
  assert.deepEqual(clashesWith({ first: '2026-11-03', last: '2026-11-03' }, data({ busBookings: [range] })).map((b) => b.id), ['range']);
  const single = booking('single', '2026-11-03', '2026-11-03');
  assert.deepEqual(clashesWith({ first: '2026-11-01', last: '2026-11-05' }, data({ busBookings: [single] })).map((b) => b.id), ['single']);
  assert.deepEqual(clashesWith({ first: '2026-11-03', last: '2026-11-03' }, data({ busBookings: [single] })).map((b) => b.id), ['single']);
});

test('only Booked bookings clash; Waiting, Declined and Cancelled never block', () => {
  const d = data({
    busBookings: [
      booking('waiting', '2026-11-01', '2026-11-05', { status: 'requested' }),
      booking('declined', '2026-11-01', '2026-11-05', { status: 'declined' }),
      booking('cancelled', '2026-11-01', '2026-11-05', { status: 'cancelled' }),
    ],
  });
  assert.deepEqual(clashesWith({ first: '2026-11-01', last: '2026-11-05' }, d), []);
  assert.equal(bookProblem(nec, { ...OK, firstDay: '2026-11-01', lastDay: '2026-11-05' }, d, TODAY), null);
});

test('clashes come in first-day order, and leave out the booking asked about', () => {
  const d = data({
    busBookings: [booking('late', '2026-11-20', '2026-11-21'), booking('early', '2026-11-02', '2026-11-03'), booking('mid', '2026-11-10', '2026-11-10')],
  });
  assert.deepEqual(clashesWith({ first: '2026-11-01', last: '2026-11-30' }, d).map((b) => b.id), ['early', 'mid', 'late']);
  assert.deepEqual(clashesWith({ first: '2026-11-01', last: '2026-11-30' }, d, 'mid').map((b) => b.id), ['early', 'late']);
  assert.deepEqual(clashesWith({ first: '2026-11-01', last: '2026-11-30' }, data()), [], 'no bookings loaded');
});

// ---------------------------------------------------------------------------
// Deciding: every message, in order
// ---------------------------------------------------------------------------

test('decideProblem gives every message in the spec’s order', () => {
  const booked = booking('booked', '2026-11-08', '2026-11-08');
  const waiting = booking('waiting', '2026-11-08', '2026-11-09', { status: 'requested', decidedBy: null, decidedAt: null });
  const d = data({ busBookings: [booked, waiting] });
  const long = 'x'.repeat(301);
  assert.equal(decideProblem(null, undefined, false, long, d, TODAY), 'Sign in first.');
  assert.equal(decideProblem(pending, undefined, false, long, d, TODAY), 'Only approved members can do that.');
  assert.equal(decideProblem(rider, undefined, false, long, d, TODAY), NOT_BUS_MANAGER);
  assert.equal(decideProblem(rideCommittee, waiting, true, '', d, TODAY), NOT_BUS_MANAGER);
  assert.equal(decideProblem(nec, undefined, false, long, d, TODAY), NO_BOOKING);
  assert.equal(decideProblem(nec, booked, false, long, d, TODAY), ALREADY_DECIDED);
  assert.equal(decideProblem(nec, { ...waiting, status: 'cancelled' }, true, '', d, TODAY), ALREADY_DECIDED);
  assert.equal(decideProblem(nec, waiting, false, long, d, '2026-11-10'), BUS_DAYS_PASSED);
  assert.equal(decideProblem(nec, waiting, true, '', d, TODAY), BUS_CLASH);
  assert.equal(decideProblem(nec, waiting, false, long, d, TODAY), BUS_REASON_TOO_LONG);
  assert.equal(decideProblem(nec, waiting, false, `  ${'🚐'.repeat(300)}  `, d, TODAY), null, 'trimmed, code points');
  assert.equal(decideProblem(nec, waiting, false, '', d, TODAY), null, 'a no without a reason');
  assert.equal(decideProblem(westTreasurer, { ...waiting, firstDay: '2026-11-09' }, true, long, d, TODAY), null, 'a yes ignores the reason');
});

test('a yes is still allowed on the last day itself (Review Focus 4)', () => {
  const waiting = booking('waiting', '2026-10-24', '2026-10-25', { status: 'requested' });
  const d = data({ busBookings: [waiting] });
  assert.equal(decideProblem(nec, waiting, true, '', d, TODAY), null);
  assert.equal(decideProblem(nec, waiting, true, '', d, '2026-10-26'), BUS_DAYS_PASSED);
});

// ---------------------------------------------------------------------------
// Cancelling: every message, in order
// ---------------------------------------------------------------------------

test('cancelProblem gives every message in the spec’s order', () => {
  const b = booking('b', '2026-11-08', '2026-11-09', { bookedBy: 'rider', driverId: 'nomad' });
  const d = data({ busBookings: [b] });
  assert.equal(cancelProblem(null, undefined, d, TODAY), 'Sign in first.');
  assert.equal(cancelProblem(pending, undefined, d, TODAY), 'Only approved members can do that.');
  assert.equal(cancelProblem(rider, undefined, d, TODAY), NO_BOOKING);
  assert.equal(cancelProblem(fng, { ...b, status: 'cancelled' }, d, '2026-11-10'), NOT_BUS_CANCELLER);
  assert.equal(cancelProblem(rider, { ...b, status: 'cancelled' }, d, '2026-11-10'), ALREADY_OFF);
  assert.equal(cancelProblem(rider, { ...b, status: 'declined' }, d, TODAY), ALREADY_OFF);
  assert.equal(cancelProblem(rider, b, d, '2026-11-10'), BUS_DAYS_PASSED);
  assert.equal(cancelProblem(rider, b, d, TODAY), null);
});

test('the booker, the driver or a manager can cancel, Booked or Waiting', () => {
  const b = booking('b', '2026-11-08', '2026-11-09', { bookedBy: 'rider', driverId: 'nomad' });
  const w = { ...b, status: 'requested' as const };
  const d = data({ busBookings: [b] });
  assert.equal(cancelProblem(rider, b, d, TODAY), null, 'the booker');
  assert.equal(cancelProblem(nomad, b, d, TODAY), null, 'the driver');
  assert.equal(cancelProblem(nec, b, d, TODAY), null, 'NEC');
  assert.equal(cancelProblem(westTreasurer, w, d, TODAY), null, 'a board seat, on a Waiting one');
  assert.equal(cancelProblem(fng, b, d, TODAY), NOT_BUS_CANCELLER);
  assert.equal(cancelProblem(rideCommittee, b, d, TODAY), NOT_BUS_CANCELLER);
});

test('a booking that started yesterday and ends tomorrow can still be cancelled (Review Focus 4)', () => {
  const b = booking('b', '2026-10-24', '2026-10-26');
  const d = data({ busBookings: [b] });
  assert.equal(cancelProblem(rider, b, d, TODAY), null);
  assert.equal(cancelProblem(rider, booking('past', '2026-10-20', '2026-10-24'), d, TODAY), BUS_DAYS_PASSED);
});

test('when the booker or driver has left, only a manager can cancel (Review Focus 5)', () => {
  const b = booking('b', '2026-11-08', '2026-11-09', { bookedBy: null, driverId: null });
  const d = data({ busBookings: [b] });
  assert.equal(cancelProblem(rider, b, d, TODAY), NOT_BUS_CANCELLER);
  assert.equal(cancelProblem(nec, b, d, TODAY), null);
});

// ---------------------------------------------------------------------------
// What the screens show
// ---------------------------------------------------------------------------

test('busToday is the Booked booking covering today', () => {
  const d = data({
    busBookings: [
      booking('waiting', '2026-10-25', '2026-10-25', { status: 'requested' }),
      booking('cancelled', '2026-10-24', '2026-10-26', { status: 'cancelled' }),
      booking('out', '2026-10-24', '2026-10-25', { purpose: 'recovery' }),
      booking('later', '2026-10-26', '2026-10-27'),
    ],
  });
  assert.equal(busToday(d, TODAY)?.id, 'out');
  assert.equal(busToday(d, '2026-10-26')?.id, 'later');
  assert.equal(busToday(d, '2026-10-28'), undefined);
  assert.equal(busToday(data(), TODAY), undefined, 'no bookings loaded');
});

test('upcomingBus is Booked and Waiting from today on, by first-day month, in date order', () => {
  const d = data({
    busBookings: [
      booking('dec', '2026-12-01', '2026-12-02', { status: 'requested' }),
      booking('nov-late', '2026-11-20', '2026-11-21'),
      booking('ongoing', '2026-10-24', '2026-10-25'),
      booking('ended', '2026-10-20', '2026-10-24'),
      booking('nov-early', '2026-11-02', '2026-11-02', { status: 'requested' }),
      booking('declined', '2026-11-05', '2026-11-05', { status: 'declined' }),
      booking('cancelled', '2026-11-06', '2026-11-06', { status: 'cancelled' }),
      booking('oct', '2026-10-30', '2026-10-31'),
    ],
  });
  const groups = upcomingBus(d, TODAY);
  assert.deepEqual(
    groups.map((g) => ({ month: g.month, ids: g.bookings.map((b) => b.id) })),
    [
      { month: '2026-10', ids: ['ongoing', 'oct'] },
      { month: '2026-11', ids: ['nov-early', 'nov-late'] },
      { month: '2026-12', ids: ['dec'] },
    ],
  );
  assert.deepEqual(upcomingBus(data(), TODAY), []);
});

test('waitingForYes is Waiting bookings not yet over, oldest asked first', () => {
  const d = data({
    busBookings: [
      booking('newer', '2026-11-01', '2026-11-01', { status: 'requested', bookedAt: '2026-10-20T00:00:00.000Z' }),
      booking('older', '2026-12-01', '2026-12-01', { status: 'requested', bookedAt: '2026-10-10T00:00:00.000Z' }),
      booking('passed', '2026-10-20', '2026-10-24', { status: 'requested', bookedAt: '2026-10-01T00:00:00.000Z' }),
      booking('last-day', '2026-10-24', '2026-10-25', { status: 'requested', bookedAt: '2026-10-15T00:00:00.000Z' }),
      booking('booked', '2026-11-03', '2026-11-03'),
    ],
  });
  assert.deepEqual(waitingForYes(d, TODAY).map((b) => b.id), ['older', 'last-day', 'newer']);
});

test('myRecentOff is my Declined and Cancelled bookings from the last 30 days, newest first', () => {
  const mine = { bookedBy: 'rider' };
  const d = data({
    busBookings: [
      booking('declined', '2026-11-01', '2026-11-01', { ...mine, status: 'declined', decidedAt: '2026-10-20T02:00:00.000Z', declineReason: 'Rego' }),
      booking('cancelled', '2026-11-02', '2026-11-02', { ...mine, status: 'cancelled', cancelledAt: '2026-10-22T02:00:00.000Z' }),
      // 30 days ago in Melbourne (25/09/2026, midday) is in; 31 days ago is out.
      booking('edge', '2026-10-01', '2026-10-01', { ...mine, status: 'declined', decidedAt: '2026-09-25T02:00:00.000Z' }),
      booking('old', '2026-10-01', '2026-10-01', { ...mine, status: 'cancelled', cancelledAt: '2026-09-24T02:00:00.000Z' }),
      booking('booked', '2026-11-03', '2026-11-03', mine),
      booking('waiting', '2026-11-04', '2026-11-04', { ...mine, status: 'requested' }),
      booking('theirs', '2026-11-05', '2026-11-05', { bookedBy: 'nomad', status: 'declined', decidedAt: '2026-10-23T02:00:00.000Z' }),
    ],
  });
  assert.deepEqual(myRecentOff(rider, d, TODAY).map((b) => b.id), ['cancelled', 'declined', 'edge']);
  assert.deepEqual(myRecentOff(null, d, TODAY), []);
});

test('busForRide is the newest Booked or Waiting booking on that ride', () => {
  const d = data({
    busBookings: [
      booking('old', '2026-11-08', '2026-11-08', { rideId: 'r-1', status: 'requested', bookedAt: '2026-10-01T00:00:00.000Z' }),
      booking('new', '2026-11-08', '2026-11-08', { rideId: 'r-1', bookedAt: '2026-10-05T00:00:00.000Z' }),
      booking('off', '2026-11-08', '2026-11-08', { rideId: 'r-1', status: 'cancelled', bookedAt: '2026-10-09T00:00:00.000Z' }),
      booking('other', '2026-11-08', '2026-11-08', { rideId: 'r-2', bookedAt: '2026-10-09T00:00:00.000Z' }),
    ],
  });
  assert.equal(busForRide('r-1', d)?.id, 'new');
  assert.equal(busForRide('r-3', d), undefined);
  const off = data({ busBookings: [booking('declined', '2026-11-08', '2026-11-08', { rideId: 'r-1', status: 'declined' })] });
  assert.equal(busForRide('r-1', off), undefined);
});

test('busDrivers is every approved member, by name', () => {
  const d = data({ members: [member('zed', { roadName: 'Zed' }), member('amy', { roadName: 'amy' }), pending, member('bo', { roadName: 'Bo', status: 'supporter' })] });
  assert.deepEqual(busDrivers(d).map((m) => m.id), ['amy', 'bo', 'zed']);
});

test('people and rides who have gone still render (Review Focus 5)', () => {
  const d = data();
  assert.equal(busPersonName('rider', d), 'rider');
  assert.equal(busPersonName('gone', d), 'A former member');
  assert.equal(busPersonName(null, d), 'A former member');
  assert.equal(busRide(booking('b', TODAY, TODAY, { rideId: 'r-1' }), d)?.id, 'r-1');
  assert.equal(busRide(booking('b', TODAY, TODAY, { rideId: null }), d), undefined, 'a deleted ride');
  assert.equal(busRide(booking('b', TODAY, TODAY, { rideId: 'r-missing' }), d), undefined);
  // Lists still work with nobody behind a booking.
  const nobody = booking('nobody', TODAY, TODAY, { bookedBy: null, driverId: null, rideId: null });
  const withNobody = data({ busBookings: [nobody] });
  assert.equal(busToday(withNobody, TODAY)?.id, 'nobody');
  assert.deepEqual(upcomingBus(withNobody, TODAY)[0].bookings.map((b) => b.id), ['nobody']);
});
