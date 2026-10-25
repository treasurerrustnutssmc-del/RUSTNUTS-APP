import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_DECIDED,
  ALREADY_OFF,
  BUS_CLASH,
  BUS_PAST_START,
  busToday,
  clashesWith,
  busOverRide,
  canBookBus,
  managesBus,
  myRecentOff,
  notAnswered,
  NO_BOOKING,
  NOT_BUS_BOOKER,
  NOT_BUS_CANCELLER,
  NOT_BUS_MANAGER,
  rideCalledOff,
  waitingForYes,
  type BusInput,
} from '../domain/bus';
import { addDays } from '../domain/dates';
import { managesRide } from '../domain/crew';
import { lastDay, melbourneDate } from '../domain/rides';
import type { BusBooking, ClubData } from '../domain/types';
import { bookBus, cancelBus, decideBus, runDemoAction, type DemoCtx } from './demoActions';
import { DEMO_DATA } from './demoData';

// The demo's bookings are dated from the real today (the charity one from its ride), so the bus
// is out today and the waiting request always clashes, whenever the demo is opened.
const TODAY = melbourneDate(new Date().toISOString());
const NOW = '2026-10-24T00:00:00.000Z';
const ctxFor = (meId: string | null, data: ClubData = DEMO_DATA, now = NOW): DemoCtx => ({
  data,
  me: data.members.find((m) => m.id === meId) ?? null,
  today: TODAY,
  now,
});
const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('was allowed');
};
const member = (id: string) => DEMO_DATA.members.find((m) => m.id === id)!;
const bookings = (data: ClubData = DEMO_DATA) => data.busBookings ?? [];
const booking = (id: string, data: ClubData = DEMO_DATA) => bookings(data).find((b) => b.id === id)!;
/** Six weeks or so out, on two days no demo booking is Booked for (Ride for Kids is a fixed date). */
const FREE = [40, 43].find((n) => clashesWith({ first: addDays(TODAY, n), last: addDays(TODAY, n + 1) }, DEMO_DATA).length === 0)!;
const input = (over: Partial<BusInput> = {}): BusInput => ({
  firstDay: addDays(TODAY, FREE),
  lastDay: addDays(TODAY, FREE + 1),
  purpose: 'club_event',
  rideId: null,
  driverId: 'm-gravel',
  notes: '',
  ...over,
});
/** A club with no bookings but one Booked one, for the clash checks. */
const withBooked = (first: string, last: string): ClubData => ({
  ...DEMO_DATA,
  busBookings: [
    {
      id: 'bus-x', firstDay: first, lastDay: last, purpose: 'recovery', rideId: null, driverId: 'm-diesel', notes: '',
      status: 'approved', bookedBy: 'm-diesel', bookedAt: NOW, decidedBy: 'm-diesel', decidedAt: NOW, declineReason: '',
      cancelledBy: null, cancelledAt: null,
    },
  ],
});

// ---------------------------------------------------------------------------
// The demo's bookings
// ---------------------------------------------------------------------------

test('the demo: a Booked charity ride on Ride for Kids on its own date, or a month out with no ride once it’s past', () => {
  const ride = DEMO_DATA.rides.find((r) => r.id === 'r-6')!;
  assert.equal(ride.title, 'Ride for Kids (supported)');
  const b = booking('bus-1');
  assert.equal(b.purpose, 'charity_ride');
  assert.equal(b.status, 'approved');
  // Linked while Spanner's request (the day before it, through it) stays clear of today's recovery.
  const kidsDay = melbourneDate(ride.startsAt);
  if (kidsDay > addDays(TODAY, 1)) {
    assert.equal(b.rideId, 'r-6');
    assert.equal(b.firstDay, kidsDay, 'the ride’s Melbourne date');
  } else {
    assert.equal(b.rideId, null, 'the ride is (nearly) past, so it links to no ride');
    assert.equal(b.firstDay, addDays(TODAY, 30), 'a month from today');
    assert.doesNotMatch(b.notes, /Ride for Kids/, 'and its notes don’t name a ride it isn’t linked to');
  }
  assert.ok(b.firstDay >= TODAY, 'still to come, whenever the demo is opened');
  assert.equal(b.lastDay, b.firstDay, 'one day');
  assert.ok(managesBus(member(b.decidedBy!), DEMO_DATA), 'said yes to by the board');
});

test('the demo: a Booked recovery today, driven by Diesel, so the bus is out today', () => {
  const recovery = bookings().filter((b) => b.purpose === 'recovery');
  assert.equal(recovery.length, 1);
  const [b] = recovery;
  assert.equal(b.status, 'approved');
  assert.equal(b.firstDay, TODAY);
  assert.equal(b.lastDay, TODAY);
  assert.equal(b.driverId, 'm-diesel');
  assert.equal(melbourneDate(b.bookedAt), TODAY, 'booked earlier today, straight away');
  assert.ok(b.bookedAt <= new Date().toISOString(), 'never booked in the future');
  assert.equal(b.decidedAt, b.bookedAt, 'booked straight away: decided when it was booked');
  assert.equal(b.decidedBy, b.bookedBy);
  assert.equal(busToday(DEMO_DATA, TODAY)?.id, b.id);
  assert.ok(b.notes.length > 0 && b.notes.length <= 500);
});

test('the demo: Spanner’s Waiting club-event request overlaps the charity booking', () => {
  const waiting = waitingForYes(DEMO_DATA, TODAY);
  assert.equal(waiting.length, 1);
  const [b] = waiting;
  assert.equal(b.purpose, 'club_event');
  assert.equal(b.bookedBy, 'm-spanner');
  assert.equal(b.decidedBy, null);
  assert.equal(b.decidedAt, null);
  const clashes = clashesWith({ first: b.firstDay, last: b.lastDay }, DEMO_DATA, b.id);
  assert.deepEqual(clashes.map((c) => c.purpose), ['charity_ride']);
});

test('the demo: a Declined request of Spanner’s from last week, with a reason, under his Yours', () => {
  const declined = bookings().filter((b) => b.status === 'declined');
  assert.equal(declined.length, 1);
  const [b] = declined;
  assert.equal(b.bookedBy, 'm-spanner');
  assert.ok(b.declineReason.length > 0 && b.declineReason.length <= 300, 'with a reason');
  assert.ok(b.firstDay >= addDays(TODAY, -7) && b.lastDay < TODAY, 'its days were last week');
  assert.ok(managesBus(member(b.decidedBy!), DEMO_DATA), 'said no to by the board');
  assert.ok(melbourneDate(b.decidedAt!) <= b.firstDay, 'decided before its days');
  assert.ok(b.bookedAt < b.decidedAt!);
  assert.equal(myRecentOff(member('m-spanner'), DEMO_DATA, TODAY)[0].id, b.id);
});

test('the demo: a Waiting request of Spanner’s whose days passed without an answer, under his Yours', () => {
  const unanswered = bookings().filter((b) => notAnswered(b, TODAY));
  assert.equal(unanswered.length, 1);
  const [b] = unanswered;
  assert.equal(b.status, 'requested', 'still stored as Waiting');
  assert.equal(b.bookedBy, 'm-spanner');
  assert.ok(b.lastDay < TODAY && b.lastDay >= addDays(TODAY, -30), 'its days were in the last month');
  assert.ok(melbourneDate(b.bookedAt) < b.firstDay, 'asked for before its days');
  assert.deepEqual(myRecentOff(member('m-spanner'), DEMO_DATA, TODAY).map((x) => x.id), ['bus-4', b.id]);
  assert.ok(!waitingForYes(DEMO_DATA, TODAY).some((x) => x.id === b.id), 'not on the board’s list');
});

test('the demo: a Booked charity ride whose ride moved, holding the bus on the new ride’s day', () => {
  const held = bookings().filter((b) => rideCalledOff(b, DEMO_DATA, TODAY));
  assert.equal(held.length, 1);
  const [b] = held;
  assert.equal(b.status, 'approved');
  assert.equal(b.purpose, 'charity_ride');
  assert.ok(b.firstDay > addDays(TODAY, 14), 'past the fortnight, so its rides never show Crew needed');
  const old = DEMO_DATA.rides.find((r) => r.id === b.rideId)!;
  assert.ok(old.cancelledAt && melbourneDate(old.cancelledAt) < TODAY, 'cancelled when the website moved it');
  assert.equal(melbourneDate(old.startsAt), b.firstDay);
  assert.equal(b.lastDay, b.firstDay);
  // The calendar sync's new ride: same title, same day, a later time, not cancelled.
  const moved = DEMO_DATA.rides.filter((r) => r.title === old.title && r.id !== old.id);
  assert.equal(moved.length, 1);
  const [ride] = moved;
  assert.equal(ride.cancelledAt, null);
  assert.equal(melbourneDate(ride.startsAt), b.firstDay);
  assert.equal(lastDay(ride), b.firstDay);
  assert.ok(ride.startsAt > old.startsAt);
  // Its crew managers see "Rusty Bus booked those days" in place of the Book link.
  assert.equal(busOverRide(ride, DEMO_DATA)?.id, b.id);
  assert.ok(managesRide(member('m-torque'), ride, DEMO_DATA) && canBookBus(member('m-torque'), DEMO_DATA));
  // Torque booked it (so can cancel it); it never touches another booking.
  assert.equal(b.bookedBy, 'm-torque');
  assert.ok(!bookings().some((x) => x.id !== b.id && x.firstDay <= b.lastDay && b.firstDay <= x.lastDay), 'no other booking those days');
});

test('the demo: every booking is valid as the database would store it', () => {
  const ids = new Set<string>();
  for (const b of bookings()) {
    assert.ok(!ids.has(b.id), `${b.id} is unique`);
    ids.add(b.id);
    assert.ok(b.lastDay >= b.firstDay, b.id);
    for (const id of [b.driverId, b.bookedBy, b.decidedBy]) {
      if (id !== null) assert.equal(member(id).approval, 'approved', `${b.id}: ${id}`);
    }
    assert.equal(b.notes, b.notes.trim());
    assert.equal(b.declineReason === '', b.status !== 'declined', `${b.id}: a reason only on a no`);
    assert.equal(b.cancelledAt, null);
  }
  const booked = bookings().filter((b) => b.status === 'approved');
  for (const b of booked) {
    assert.deepEqual(clashesWith({ first: b.firstDay, last: b.lastDay }, DEMO_DATA, b.id), [], `${b.id} is never double-booked`);
  }
});

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

test('a Full member’s booking waits for a yes, with the notes trimmed', () => {
  const { data, id } = bookBus(ctxFor('m-chook'), input({ notes: '  The marquee and the eskies.  ' }));
  const b = booking(id, data);
  assert.deepEqual(b, {
    id, firstDay: addDays(TODAY, FREE), lastDay: addDays(TODAY, FREE + 1), purpose: 'club_event', rideId: null, driverId: 'm-gravel',
    notes: 'The marquee and the eskies.', status: 'requested', bookedBy: 'm-chook', bookedAt: NOW, decidedBy: null, decidedAt: null,
    declineReason: '', cancelledBy: null, cancelledAt: null,
  });
  assert.equal(bookings(data).length, bookings().length + 1, 'added, nothing else changed');
});

test('a Waiting request may overlap a Booked one', () => {
  const data = withBooked(addDays(TODAY, 5), addDays(TODAY, 6));
  const { data: after, id } = bookBus(ctxFor('m-chook', data), input({ firstDay: addDays(TODAY, 6), lastDay: addDays(TODAY, 6) }));
  assert.equal(booking(id, after).status, 'requested');
});

test('a recovery for today or tomorrow is Booked straight away, decided by whoever booked it', () => {
  for (const day of [TODAY, addDays(TODAY, 1)]) {
    const { data, id } = bookBus(ctxFor('m-chook', { ...DEMO_DATA, busBookings: [] }), input({ purpose: 'recovery', firstDay: day, lastDay: day }));
    const b = booking(id, data);
    assert.equal(b.status, 'approved', day);
    assert.equal(b.decidedBy, 'm-chook');
    assert.equal(b.decidedAt, NOW);
  }
  const later = bookBus(ctxFor('m-chook'), input({ purpose: 'recovery', firstDay: addDays(TODAY, 3), lastDay: addDays(TODAY, 3) }));
  assert.equal(booking(later.id, later.data).status, 'requested', 'a recovery in three days waits');
});

test('a bus manager’s booking is Booked straight away, linked to a ride', () => {
  const { data, id } = bookBus(ctxFor('m-torque'), input({ purpose: 'charity_ride', rideId: 'r-4', driverId: 'm-sparks' }));
  const b = booking(id, data);
  assert.equal(b.status, 'approved');
  assert.equal(b.rideId, 'r-4');
  assert.equal(b.driverId, 'm-sparks');
  assert.equal(b.decidedBy, 'm-torque');
});

test('booking checks the app rules: a straight-away clash, a past start, an FNG', () => {
  const data = withBooked(TODAY, TODAY);
  assert.equal(refusal(() => bookBus(ctxFor('m-chook', data), input({ purpose: 'recovery', firstDay: TODAY, lastDay: TODAY }))), BUS_CLASH);
  assert.equal(refusal(() => bookBus(ctxFor('m-chook'), input({ firstDay: addDays(TODAY, -1) }))), BUS_PAST_START);
  assert.equal(refusal(() => bookBus(ctxFor('m-throttle'), input())), NOT_BUS_BOOKER);
  assert.equal(refusal(() => bookBus(ctxFor(null), input())), 'Sign in first.');
});

test('each new booking gets its own id', () => {
  const a = bookBus(ctxFor('m-chook'), input());
  const b = bookBus(ctxFor('m-chook', a.data), input());
  assert.notEqual(a.id, b.id);
});

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

const asked = (data: ClubData = DEMO_DATA) => bookBus(ctxFor('m-chook', data), input());

test('a yes Books a Waiting request, keeping no reason', () => {
  const { data, id } = asked();
  const after = decideBus(ctxFor('m-torque', data, '2026-10-24T02:00:00.000Z'), id, true, 'ignored on a yes');
  const b = booking(id, after);
  assert.equal(b.status, 'approved');
  assert.equal(b.decidedBy, 'm-torque');
  assert.equal(b.decidedAt, '2026-10-24T02:00:00.000Z');
  assert.equal(b.declineReason, '');
  assert.equal(b.bookedAt, NOW, 'when it was booked is kept');
});

test('a no Declines it with the reason trimmed, or none', () => {
  const { data, id } = asked();
  const no = booking(id, decideBus(ctxFor('m-rusty', data), id, false, '  The bus is at the mechanic’s.  '));
  assert.equal(no.status, 'declined');
  assert.equal(no.decidedBy, 'm-rusty');
  assert.equal(no.declineReason, 'The bus is at the mechanic’s.');
  assert.equal(booking(id, decideBus(ctxFor('m-rusty', data), id, false, '   ')).declineReason, '');
});

test('deciding checks the app rules: a clashing yes, a non-manager, already decided, no booking', () => {
  // Spanner's demo request clashes with the charity booking.
  const spanners = waitingForYes(DEMO_DATA, TODAY)[0];
  assert.equal(refusal(() => decideBus(ctxFor('m-torque'), spanners.id, true, '')), BUS_CLASH);
  assert.equal(booking(spanners.id, decideBus(ctxFor('m-torque'), spanners.id, false, '')).status, 'declined', 'a no is fine');
  assert.equal(refusal(() => decideBus(ctxFor('m-spanner'), spanners.id, false, '')), NOT_BUS_MANAGER);
  assert.equal(refusal(() => decideBus(ctxFor('m-torque'), 'bus-1', true, '')), ALREADY_DECIDED);
  assert.equal(refusal(() => decideBus(ctxFor('m-torque'), 'bus-nope', true, '')), NO_BOOKING);
});

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

test('whoever booked it, its driver or the board can cancel; who said yes is kept', () => {
  const recovery = bookings().find((b) => b.purpose === 'recovery')!;
  for (const who of [recovery.bookedBy!, 'm-diesel', 'm-smokey']) {
    const b = booking(recovery.id, cancelBus(ctxFor(who, DEMO_DATA, '2026-10-24T03:00:00.000Z'), recovery.id));
    assert.equal(b.status, 'cancelled', who);
    assert.equal(b.cancelledBy, who);
    assert.equal(b.cancelledAt, '2026-10-24T03:00:00.000Z');
    assert.equal(b.decidedBy, recovery.decidedBy);
    assert.equal(b.decidedAt, recovery.decidedAt);
  }
});

test('cancelling checks the app rules: a stranger, already off, no booking', () => {
  const recovery = bookings().find((b) => b.purpose === 'recovery')!;
  assert.equal(refusal(() => cancelBus(ctxFor('m-ace'), recovery.id)), NOT_BUS_CANCELLER);
  const declined = bookings().find((b) => b.status === 'declined')!;
  assert.equal(refusal(() => cancelBus(ctxFor('m-spanner'), declined.id)), ALREADY_OFF);
  const off = cancelBus(ctxFor('m-diesel'), recovery.id);
  assert.equal(refusal(() => cancelBus(ctxFor('m-diesel', off), recovery.id)), ALREADY_OFF);
  assert.equal(refusal(() => cancelBus(ctxFor('m-diesel'), 'bus-nope')), NO_BOOKING);
});

// ---------------------------------------------------------------------------
// The parity cases' actions
// ---------------------------------------------------------------------------

test('the parity actions book, decide and cancel, writing the texts out `repeat` times', () => {
  const ctx = ctxFor('m-chook', { ...DEMO_DATA, busBookings: [] });
  const booked = runDemoAction(ctx, {
    action: 'bookBus', first: addDays(TODAY, 40), last: addDays(TODAY, 40), purpose: 'other', ride: null, driver: 'm-gravel', notes: 'ab', repeat: 3,
  });
  const [b] = bookings(booked) as BusBooking[];
  assert.equal(b.notes, 'ababab');
  assert.equal(b.status, 'requested');
  // A missing day comes through as null, and is refused as missing.
  assert.equal(
    refusal(() => runDemoAction(ctx, { action: 'bookBus', first: null, last: addDays(TODAY, 40), purpose: 'other', ride: null, driver: 'm-gravel', notes: '' })),
    'Pick the first and last day.',
  );
  const decided = runDemoAction(ctxFor('m-torque', booked), { action: 'decideBus', booking: b.id, yes: false, reason: 'x', repeat: 4 });
  assert.equal(booking(b.id, decided).declineReason, 'xxxx');
  const cancelled = runDemoAction(ctxFor('m-chook', booked), { action: 'cancelBus', booking: b.id });
  assert.equal(booking(b.id, cancelled).status, 'cancelled');
});
