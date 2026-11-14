import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_DECIDED,
  ALREADY_OFF,
  BUS_CLASH,
  BUS_PAST_START,
  clashesWith,
  NO_BOOKING,
  NOT_BUS_BOOKER,
  NOT_BUS_CANCELLER,
  NOT_BUS_MANAGER,
  waitingForYes,
  type BusInput,
} from '../domain/bus';
import { addDays } from '../domain/dates';
import type { BusBooking, ClubData } from '../domain/types';
import { bookBus, cancelBus, decideBus, runDemoAction, type DemoCtx } from './demoActions';
import { DEMO_DATA, STORY_TODAY } from './demoStory.testkit';

// The Rusty Bus actions, on the demo built for the story instant (its own bookings are checked on
// every day in demoFresh.test.ts).
const TODAY = STORY_TODAY;
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
const bookings = (data: ClubData = DEMO_DATA) => data.busBookings ?? [];
const booking = (id: string, data: ClubData = DEMO_DATA) => bookings(data).find((b) => b.id === id)!;
/** Six weeks or so out, on two days no demo booking is Booked for. */
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

// The demo's own bookings, checked on every day the demo can be opened, are in demoFresh.test.ts.

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
