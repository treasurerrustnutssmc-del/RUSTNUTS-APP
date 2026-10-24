import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFS, reminderDiff, reminderPlan, type Reminder } from './notifications';
import type { Ride, Rsvp } from './types';

const NOW = '2026-11-05T00:00:00.000Z';
const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r-1', title: 'West breakfast run', startsAt: '2026-11-06T21:30:00.000Z', endsAt: '2026-11-07T01:00:00.000Z',
  allDay: false, location: 'BP Ravenhall', notes: null, category: 'west', cancelledAt: null, ...over,
});
const going = (rideId: string, answer: Rsvp['answer'] = 'going'): Rsvp => ({ rideId, memberId: 'm-me', answer, updatedAt: NOW });

test('a ride you’re going to: a reminder 2 hours before', () => {
  assert.deepEqual(reminderPlan([ride()], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW), [
    { id: 'ride-r-1', rideId: 'r-1', at: '2026-11-06T19:30:00.000Z', title: 'Ride in 2 hours', body: 'West breakfast run · 8:30 am · BP Ravenhall' },
  ]);
  assert.equal(reminderPlan([ride({ location: null })], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW)[0].body, 'West breakfast run · 8:30 am');
});

test('an all-day ride: 7 am Melbourne time on its first day, daylight saving or not', () => {
  const allDay = ride({ allDay: true, startsAt: '2026-11-06T13:00:00.000Z', endsAt: '2026-11-08T13:00:00.000Z', title: 'Camp weekend' });
  assert.deepEqual(reminderPlan([allDay], [going('r-1')], 'm-me', DEFAULT_PREFS, NOW)[0], {
    id: 'ride-r-1', rideId: 'r-1', at: '2026-11-06T20:00:00.000Z', title: 'Ride today', body: 'Camp weekend · All day · BP Ravenhall',
  });
  // Clocks go forward at 2 am on Sunday 4 October 2026.
  const dstDay = ride({ allDay: true, startsAt: '2026-10-03T14:00:00.000Z', endsAt: '2026-10-04T13:00:00.000Z' });
  assert.equal(reminderPlan([dstDay], [going('r-1')], 'm-me', DEFAULT_PREFS, '2026-10-01T00:00:00.000Z')[0].at, '2026-10-03T20:00:00.000Z');
});

test('no reminder for maybe, can’t, cancelled, past, turned off, or nobody signed in', () => {
  const none = (rides: Ride[], rsvps: Rsvp[], meId: string | null = 'm-me', prefs = DEFAULT_PREFS, now = NOW) =>
    assert.deepEqual(reminderPlan(rides, rsvps, meId, prefs, now), []);
  none([ride()], [going('r-1', 'maybe')]);
  none([ride()], [going('r-1', 'no')]);
  none([ride()], [{ ...going('r-1'), memberId: 'm-else' }]);
  none([ride({ cancelledAt: NOW })], [going('r-1')]);
  none([ride()], [going('r-1')], 'm-me', DEFAULT_PREFS, '2026-11-06T20:00:00.000Z');
  none([ride()], [going('r-1')], 'm-me', { ...DEFAULT_PREFS, rideReminders: false });
  none([ride()], [going('r-1')], null);
});

test('the soonest 30 only, so the phone never runs out of room', () => {
  const rides = Array.from({ length: 40 }, (_, i) =>
    ride({ id: `r-${i}`, startsAt: new Date(Date.parse('2026-11-06T21:30:00.000Z') + (39 - i) * 86_400_000).toISOString(), endsAt: null }));
  const plan = reminderPlan(rides, rides.map((r) => going(r.id)), 'm-me', DEFAULT_PREFS, NOW);
  assert.equal(plan.length, 30);
  assert.equal(plan[0].rideId, 'r-39', 'soonest first');
  assert.ok(plan.every((r, i) => i === 0 || r.at >= plan[i - 1].at));
});

test('what to schedule and cancel', () => {
  const r = (id: string, at: string): Reminder => ({ id, rideId: id, at, title: 't', body: 'b' });
  const plan = [r('ride-a', '2026-11-06T19:30:00.000Z'), r('ride-b', '2026-11-07T19:30:00.000Z'), r('ride-c', '2026-11-08T19:30:00.000Z')];
  const scheduled = [
    { id: 'ride-a', at: '2026-11-06T19:30:00.000Z' }, // unchanged
    { id: 'ride-b', at: '2026-11-07T18:30:00.000Z' }, // moved
    { id: 'ride-z', at: '2026-11-09T19:30:00.000Z' }, // no longer wanted
  ];
  const { add, cancel } = reminderDiff(plan, scheduled);
  assert.deepEqual(add.map((x) => x.id), ['ride-b', 'ride-c']);
  assert.deepEqual(cancel.sort(), ['ride-b', 'ride-z']);
  assert.deepEqual(reminderDiff([], scheduled).cancel.sort(), ['ride-a', 'ride-b', 'ride-z'], 'turned off: all of them go');
  const renamed = reminderDiff([r('ride-a', '2026-11-06T19:30:00.000Z')], [{ id: 'ride-a', at: '2026-11-06T19:30:00.000Z', body: 'old name' }]);
  assert.deepEqual([renamed.add.map((x) => x.id), renamed.cancel], [['ride-a'], ['ride-a']], 'a renamed ride gets the new text');
});
