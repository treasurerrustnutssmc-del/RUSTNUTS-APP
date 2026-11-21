// Home shows a live ride straight under your name while it is under way (Jeff, 21 Nov 2026, on the
// Big 4: "when a live ride is active it should be on the home page beneath the user's name").
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeLiveRide } from './liveRide';
import type { Member, Ride, RideCategory, Rsvp } from './types';

const member = (over: Partial<Member> = {}): Member => ({
  id: 'm-1', chapterId: 'ch-west', fullName: 'Test Rider', roadName: 'Tester', status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});

// Sat 07/11/2026 9:30 am to 1:00 pm Melbourne (AEDT, UTC+11).
const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r-1', title: 'Coffee run', startsAt: '2026-11-06T22:30:00.000Z', endsAt: '2026-11-07T02:00:00.000Z', allDay: false,
  location: null, notes: null, category: 'west', cancelledAt: null, source: 'feed', website: false, ...over,
});
const going = (rideId: string, answer: Rsvp['answer'] = 'going'): Rsvp => ({ rideId, memberId: 'm-1', answer, updatedAt: '2026-11-01T00:00:00.000Z' });
const CATS: RideCategory[] = ['west', 'club', 'supported'];
const at = (now: string, over: Partial<Parameters<typeof homeLiveRide>[0]> = {}) =>
  homeLiveRide({ me: member(), rides: [ride()], rsvps: [], categories: CATS, now, sharing: null, ...over });

test('shows from an hour before the start until the ride ends', () => {
  assert.equal(at('2026-11-06T21:29:00.000Z'), null, 'too early');
  assert.equal(at('2026-11-06T21:30:00.000Z')?.id, 'r-1', 'an hour before: meet-up');
  assert.equal(at('2026-11-07T01:59:00.000Z')?.id, 'r-1', 'under way');
  assert.equal(at('2026-11-07T02:00:00.000Z'), null, 'finished');
});

test('a ride with no end time stays on Home until its live window closes at midnight', () => {
  const r = ride({ endsAt: null });
  assert.equal(at('2026-11-07T12:59:00.000Z', { rides: [r] })?.id, 'r-1');
  assert.equal(at('2026-11-07T13:00:00.000Z', { rides: [r] }), null);
});

test('an all-day ride shows across its days', () => {
  // Fri 06/11 and Sat 07/11, all day (the calendar end is the midnight after).
  const r = ride({ allDay: true, startsAt: '2026-11-05T13:00:00.000Z', endsAt: '2026-11-07T13:00:00.000Z' });
  assert.equal(at('2026-11-06T02:00:00.000Z', { rides: [r] })?.id, 'r-1');
  assert.equal(at('2026-11-07T12:00:00.000Z', { rides: [r] })?.id, 'r-1');
  assert.equal(at('2026-11-07T13:00:00.000Z', { rides: [r] }), null);
});

test('only your rides: your colours unless you said no, or any ride you said Going or Maybe to', () => {
  const north = ride({ category: 'north' });
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [north] }), null, 'not your colours');
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [north], rsvps: [going('r-1')] })?.id, 'r-1', 'said Going');
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [north], rsvps: [going('r-1', 'maybe')] })?.id, 'r-1', 'said Maybe');
  assert.equal(at('2026-11-06T23:00:00.000Z', { rsvps: [going('r-1', 'no')] }), null, 'said no');
});

test('never a cancelled ride, and only for approved members', () => {
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [ride({ cancelledAt: '2026-11-01T00:00:00.000Z' })] }), null);
  assert.equal(at('2026-11-06T23:00:00.000Z', { me: member({ approval: 'pending' }) }), null);
  assert.equal(at('2026-11-06T23:00:00.000Z', { me: null }), null);
});

test('the ride you are sharing on wins, even outside the usual times', () => {
  const other = ride({ id: 'r-2', category: 'north', startsAt: '2026-11-06T20:00:00.000Z', endsAt: '2026-11-06T21:00:00.000Z' });
  // r-2 has ended, but you are still sharing on it and its live window is open.
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [ride(), other], sharing: { rideId: 'r-2', meId: 'm-1' } })?.id, 'r-2');
  // Sharing on a ride whose window has closed doesn't count.
  assert.equal(at('2026-11-08T01:00:00.000Z', { rides: [other], sharing: { rideId: 'r-2', meId: 'm-1' } }), null);
});

test('two at once (legs of a trip): the one that started last', () => {
  const leg1 = ride({ id: 'leg-1', startsAt: '2026-11-06T20:00:00.000Z', endsAt: '2026-11-07T06:00:00.000Z' });
  const leg2 = ride({ id: 'leg-2', startsAt: '2026-11-06T23:00:00.000Z', endsAt: '2026-11-07T04:00:00.000Z' });
  assert.equal(at('2026-11-06T23:30:00.000Z', { rides: [leg1, leg2] })?.id, 'leg-2');
  assert.equal(at('2026-11-06T21:30:00.000Z', { rides: [leg1, leg2] })?.id, 'leg-1', 'leg 2 not yet within the hour');
});

test('a share saved on this phone by someone else (signed out, then another member signed in) is not yours', () => {
  const other = ride({ id: 'r-2', category: 'north' });
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [other], sharing: { rideId: 'r-2', meId: 'm-someone-else' } }), null);
});

// Superpowers audit, 21 Nov 2026: a ride that's been called off or postponed isn't live, and another
// club's ride (Supported) only goes on your Home when you said Going or Maybe.
test('a ride called off or postponed is not shown as live', () => {
  assert.equal(at('2026-11-06T23:00:00.000Z', { calledOff: ['r-1'] }), null);
  assert.equal(at('2026-11-06T23:00:00.000Z', { calledOff: ['r-1'], rsvps: [going('r-1')] }), null, 'even if you said Going');
  assert.equal(at('2026-11-06T23:00:00.000Z', { calledOff: ['r-other'] })?.id, 'r-1', 'another ride called off');
});

test('another club’s ride (Supported) only when you said Going or Maybe', () => {
  const sup = ride({ category: 'supported' });
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [sup] }), null, 'in your colours, but not your club');
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [sup], rsvps: [going('r-1')] })?.id, 'r-1');
  assert.equal(at('2026-11-06T23:00:00.000Z', { rides: [sup], rsvps: [going('r-1', 'maybe')] })?.id, 'r-1');
});

// Deliberate: while you're still sharing on a ride that has since been called off, Home keeps it, because
// that card is your way back to Stop sharing.
test('the ride you are sharing on stays, even once it is called off', () => {
  const sharing = { rideId: 'r-1', meId: 'm-1' };
  assert.equal(at('2026-11-06T23:00:00.000Z', { calledOff: ['r-1'], sharing })?.id, 'r-1');
});
