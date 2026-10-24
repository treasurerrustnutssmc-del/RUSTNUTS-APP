import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultCategories, melbourneDate, melbourneTime, rsvpCounts, rsvpProblem, upcomingByMonth } from './rides';
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
