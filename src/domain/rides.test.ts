import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarFreshness, defaultCategories, lastDay, melbourneDate, melbourneTime, nextRide, rsvpCounts, rsvpProblem, rsvpToast, upcomingByMonth } from './rides';
import type { Chapter, Member, Ride, Rsvp } from './types';

const chapters: Chapter[] = [
  { id: 'ch-west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
  { id: 'ch-north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
];

const member = (over: Partial<Member> = {}): Member => ({
  id: 'm-1', chapterId: 'ch-west', fullName: 'Test Rider', roadName: 'Tester', status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});

const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r-1', title: 'Coffee run', startsAt: '2026-11-07T21:30:00.000Z', endsAt: null, allDay: false,
  location: null, notes: null, category: 'west', cancelledAt: null, ...over,
});

test('Melbourne date and time from an instant', () => {
  assert.equal(melbourneDate('2026-11-07T14:30:00Z'), '2026-11-08', 'AEDT is UTC+11');
  assert.equal(melbourneDate('2026-07-01T13:59:00Z'), '2026-07-01', 'AEST is UTC+10');
  assert.equal(melbourneTime('2026-11-07T20:30:00Z'), '7:30 am');
  assert.equal(melbourneTime('2026-11-08T03:05:00Z'), '2:05 pm');
});

test('default filter: your chapter, the whole club and supported rides', () => {
  assert.deepEqual(defaultCategories(member(), chapters), ['west', 'club', 'supported']);
  assert.deepEqual(defaultCategories(member({ chapterId: 'ch-north' }), chapters), ['north', 'club', 'supported']);
});

test('upcoming rides grouped by Melbourne month, filtered and sorted', () => {
  const rides = [
    ride({ id: 'old', startsAt: '2026-10-23T21:00:00.000Z' }), // 24 Oct Melbourne, but before today below
    ride({ id: 'dec', startsAt: '2026-12-05T22:00:00.000Z' }),
    ride({ id: 'today', startsAt: '2026-11-01T00:00:00.000Z' }),
    ride({ id: 'gone', startsAt: '2026-11-20T00:00:00.000Z', cancelledAt: '2026-11-02T00:00:00.000Z' }),
    ride({ id: 'north', startsAt: '2026-11-10T00:00:00.000Z', category: 'north' }),
    ride({ id: 'nov30', startsAt: '2026-11-30T14:00:00.000Z' }), // 1 Dec in Melbourne
  ];
  const months = upcomingByMonth(rides, ['west'], '2026-11-01');
  assert.deepEqual(months.map((m) => m.month), ['November 2026', 'December 2026']);
  assert.deepEqual(months[0].rides.map((r) => r.id), ['today', 'gone']);
  assert.deepEqual(months[1].rides.map((r) => r.id), ['nov30', 'dec']);
});

test('who can answer a ride, and why not', () => {
  const now = '2026-11-01T00:00:00.000Z';
  assert.equal(rsvpProblem(null, ride(), now), 'Sign in first.');
  assert.equal(rsvpProblem(member({ approval: 'pending' }), ride(), now), 'Only approved members can do that.');
  assert.equal(rsvpProblem(member(), undefined, now), 'No such ride.');
  assert.equal(rsvpProblem(member(), ride({ cancelledAt: now }), now), 'That ride was cancelled.');
  assert.equal(rsvpProblem(member(), ride({ startsAt: now }), now), 'That ride has already started.');
  assert.equal(rsvpProblem(member(), ride(), now), null);
  assert.equal(rsvpProblem(member({ status: 'legacy' }), ride(), now), null, 'any approved member');
});

test('answer counts for one ride', () => {
  const rsvps: Rsvp[] = [
    { rideId: 'r-1', memberId: 'a', answer: 'going', updatedAt: '' },
    { rideId: 'r-1', memberId: 'b', answer: 'going', updatedAt: '' },
    { rideId: 'r-1', memberId: 'c', answer: 'maybe', updatedAt: '' },
    { rideId: 'r-2', memberId: 'a', answer: 'no', updatedAt: '' },
  ];
  assert.deepEqual(rsvpCounts('r-1', rsvps), { going: 2, maybe: 1, no: 0 });
});

test('a weekend away stays listed, and takes answers, until it should', () => {
  // All-day, Fri 20 to Sun 22 Nov in Melbourne (the end is the midnight after, as calendars give it).
  const weekend = ride({ id: 'island', allDay: true, startsAt: '2026-11-19T13:00:00.000Z', endsAt: '2026-11-22T13:00:00.000Z' });
  assert.deepEqual(upcomingByMonth([weekend], ['west'], '2026-11-22')[0].rides.map((r) => r.id), ['island'], 'still on, Sunday');
  assert.deepEqual(upcomingByMonth([weekend], ['west'], '2026-11-23'), [], 'gone Monday');
  assert.equal(rsvpProblem(member(), weekend, '2026-11-20T09:00:00.000Z'), null, 'Friday evening: still answering');
  assert.equal(rsvpProblem(member(), weekend, '2026-11-20T13:00:00.000Z'), 'That ride has already started.', 'from Saturday');
});

test('the last day of a ride', () => {
  assert.equal(lastDay(ride()), '2026-11-08', 'a timed ride: its own day');
  assert.equal(lastDay(ride({ allDay: true, startsAt: '2026-11-19T13:00:00.000Z', endsAt: '2026-11-22T13:00:00.000Z' })), '2026-11-22');
  assert.equal(lastDay(ride({ allDay: true, startsAt: '2026-11-19T13:00:00.000Z', endsAt: null })), '2026-11-20');
});

test('how fresh the calendar is, and when to say so loudly', () => {
  const now = '2026-11-01T02:00:00.000Z'; // 1:00 pm, 1 Nov in Melbourne
  assert.deepEqual(calendarFreshness('2026-11-01T01:50:00.000Z', true, now),
    { stale: false, text: 'Updated 01/11/2026 12:50 pm from the club calendar' });
  assert.deepEqual(calendarFreshness('2026-10-31T23:00:00.000Z', true, now),
    { stale: true, text: 'Club calendar last updated 01/11/2026 10:00 am. Some rides may be out of date.' });
  assert.deepEqual(calendarFreshness(null, true, now),
    { stale: true, text: 'Part of the club calendar hasn’t loaded yet. Some rides may be missing.' });
  assert.deepEqual(calendarFreshness(null, false, now), { stale: false, text: 'Not updated from the club calendar yet' });
});

test('the next ride is the earliest one coming up in your colours, and never a cancelled one', () => {
  const rides = [
    ride({ id: 'old', startsAt: '2026-10-23T21:00:00.000Z' }),
    ride({ id: 'gone', startsAt: '2026-11-03T00:00:00.000Z', cancelledAt: '2026-11-02T00:00:00.000Z' }),
    ride({ id: 'north', startsAt: '2026-11-04T00:00:00.000Z', category: 'north' }),
    ride({ id: 'later', startsAt: '2026-11-20T00:00:00.000Z' }),
    ride({ id: 'soon', startsAt: '2026-11-10T00:00:00.000Z' }),
  ];
  assert.equal(nextRide(rides, ['west', 'club', 'supported'], '2026-11-01')?.id, 'soon');
  assert.equal(nextRide(rides, ['north'], '2026-11-01')?.id, 'north');
});

test('a multi-day ride that has started still counts until its last day', () => {
  const trip = ride({ id: 'trip', startsAt: '2026-11-20T00:00:00.000Z', endsAt: '2026-11-23T00:00:00.000Z', allDay: true });
  assert.equal(nextRide([trip], ['west'], '2026-11-21')?.id, 'trip');
  assert.equal(nextRide([trip], ['west'], '2026-11-25'), null);
});

test('no next ride when nothing is coming up', () => {
  assert.equal(nextRide([], ['west'], '2026-11-01'), null);
  assert.equal(nextRide([ride({ category: 'north' })], ['west'], '2026-11-01'), null);
});

test('an RSVP is confirmed in words, with Undo only when there was an earlier answer to go back to', () => {
  assert.deepEqual(rsvpToast(null, 'going'), { text: 'Saved: Going', undoTo: null });
  assert.deepEqual(rsvpToast('going', 'maybe'), { text: 'Saved: Maybe', undoTo: 'going' });
  assert.deepEqual(rsvpToast('maybe', 'no'), { text: 'Saved: Can’t make it', undoTo: 'maybe' });
  assert.deepEqual(rsvpToast('going', 'going'), { text: 'Saved: Going', undoTo: null }, 'tapping the same answer again changes nothing to undo');
});

test('a cancelled ride that has a live replacement the same day is not listed twice, but a lone cancelled ride still shows', () => {
  const rides = [
    ride({ id: 'old', title: 'West Pink Ribbon ride', startsAt: '2026-11-27T22:30:00.000Z', cancelledAt: '2026-11-20T00:00:00.000Z' }),
    ride({ id: 'new', title: 'West Pink Ribbon ride', startsAt: '2026-11-27T23:00:00.000Z' }),
    ride({ id: 'alone', title: 'West twisties', startsAt: '2026-12-12T22:00:00.000Z', cancelledAt: '2026-12-01T00:00:00.000Z' }),
  ];
  const ids = upcomingByMonth(rides, ['west'], '2026-11-01').flatMap((m) => m.rides.map((r) => r.id));
  assert.deepEqual(ids, ['new', 'alone']);
});
