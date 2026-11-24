// Ride comms bubbles (Jeff, 22 Nov 2026): a floating bubble for each ride whose comms are on, with
// how many are connected and an Emergency for that ride only. Spec:
// docs/superpowers/specs/2026-11-23-ride-comms-bubbles-design.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bubbleLabel, commsBubbles, countsFrom, MAX_BUBBLES, sosArmed, SOS_ARM_MS, type BubbleInput } from './commsBubbles';
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
const answer = (rideId: string, a: Rsvp['answer'] = 'going'): Rsvp => ({ rideId, memberId: 'm-1', answer: a, updatedAt: '2026-11-01T00:00:00.000Z' });
const CATS: RideCategory[] = ['west', 'club', 'supported'];
const NOW = '2026-11-06T23:00:00.000Z';
const run = (over: Partial<BubbleInput> = {}) =>
  commsBubbles({
    me: member(), rides: [ride()], rsvps: [], categories: CATS, now: NOW, sharing: null, calledOff: [],
    counts: { 'r-1': 3 }, onAir: null, hidden: [], screenRideId: null, ...over,
  });
const ids = (over: Partial<BubbleInput> = {}) => run(over).map((b) => b.ride.id);

test('a bubble pops up when someone is on the comms of a ride of yours', () => {
  const [b] = run();
  assert.equal(b.ride.id, 'r-1');
  assert.equal(b.connected, 3);
  assert.equal(b.onAir, false);
  assert.deepEqual(ids({ counts: {} }), [], 'nobody on comms: no bubble');
  assert.deepEqual(ids({ counts: { 'r-1': 0 } }), [], 'zero: no bubble');
});

test('only rides that are yours: your colours unless you said no, a Supported ride only once you said Going or Maybe', () => {
  assert.deepEqual(ids({ rides: [ride({ category: 'north' })] }), [], 'not your colours');
  assert.deepEqual(ids({ rides: [ride({ category: 'north' })], rsvps: [answer('r-1')] }), ['r-1'], 'said Going');
  assert.deepEqual(ids({ rsvps: [answer('r-1', 'no')] }), [], 'said no');
  assert.deepEqual(ids({ rides: [ride({ category: 'supported' })] }), [], 'supporting another club: only when going');
  assert.deepEqual(ids({ rides: [ride({ category: 'supported' })], rsvps: [answer('r-1', 'maybe')] }), ['r-1'], 'supporting, said Maybe');
});

test('the ride you are sharing on, or on air with, gets a bubble even if it is not in your colours', () => {
  const north = ride({ category: 'north' });
  assert.deepEqual(ids({ rides: [north], sharing: { rideId: 'r-1', meId: 'm-1' } }), ['r-1'], 'sharing');
  assert.deepEqual(ids({ rides: [north], sharing: { rideId: 'r-1', meId: 'someone-else' } }), [], 'a share saved by someone else on this phone');
  assert.deepEqual(ids({ rides: [north], onAir: { rideId: 'r-1', connected: 1 }, counts: {} }), ['r-1'], 'on air, even alone');
});

test('on air: the count is the call\'s own, and it comes first', () => {
  const rides = [ride(), ride({ id: 'r-2', startsAt: '2026-11-06T22:45:00.000Z' })];
  const got = run({ rides, counts: { 'r-1': 2, 'r-2': 4 }, onAir: { rideId: 'r-1', connected: 5 } });
  assert.deepEqual(got.map((b) => [b.ride.id, b.connected, b.onAir]), [['r-1', 5, true], ['r-2', 4, false]]);
  // Otherwise the latest start first.
  assert.deepEqual(ids({ rides, counts: { 'r-1': 2, 'r-2': 4 } }), ['r-2', 'r-1']);
});

test('one bubble per ride, at most three', () => {
  const rides = ['a', 'b', 'c', 'd'].map((id, i) => ride({ id, startsAt: `2026-11-06T22:3${i}:00.000Z` }));
  const got = ids({ rides, counts: { a: 1, b: 1, c: 1, d: 1 } });
  assert.equal(MAX_BUBBLES, 3);
  assert.deepEqual(got, ['d', 'c', 'b']);
});

test('only while the ride\'s live window is open, and never a ride called off', () => {
  assert.deepEqual(ids({ now: '2026-11-07T13:00:00.000Z' }), [], 'after midnight on ride day');
  assert.deepEqual(ids({ now: '2026-11-04T12:00:00.000Z' }), [], 'before the window opens');
  assert.deepEqual(ids({ calledOff: ['r-1'] }), [], 'called off');
  assert.deepEqual(ids({ rides: [ride({ cancelledAt: '2026-11-01T00:00:00.000Z' })] }), [], 'cancelled');
});

test('only for approved members who can go on rides', () => {
  assert.deepEqual(ids({ me: null }), []);
  assert.deepEqual(ids({ me: member({ approval: 'pending' }) }), []);
  assert.deepEqual(ids({ me: member({ status: 'family' }) }), [], 'family can\'t join ride comms');
});

test('hidden bubbles stay hidden, and the live ride screen for that ride shows none for it', () => {
  assert.deepEqual(ids({ hidden: ['r-1'] }), []);
  assert.deepEqual(ids({ hidden: ['r-1'], onAir: { rideId: 'r-1', connected: 2 } }), ['r-1'], 'joining its comms brings it back');
  assert.deepEqual(ids({ screenRideId: 'r-1' }), [], 'already on its screen');
  assert.deepEqual(ids({ screenRideId: 'r-2' }), ['r-1']);
});

test('the bubble\'s short name: the first word or two of the ride, without "(demo)"', () => {
  assert.equal(bubbleLabel('Big 4 Alpine Run – leg 1'), 'Big 4');
  assert.equal(bubbleLabel('Today’s coffee run (demo)'), 'Today’s');
  assert.equal(bubbleLabel('Ride for Kids'), 'Ride for');
  assert.equal(bubbleLabel('Christmas'), 'Christmas');
  assert.equal(bubbleLabel('Supercalifragilistic run'), 'Supercalif…');
});

test('the Emergency button arms on one tap and disarms itself after a few seconds', () => {
  assert.equal(SOS_ARM_MS, 6000);
  assert.equal(sosArmed(null, 1000), false);
  assert.equal(sosArmed(1000, 1000 + SOS_ARM_MS - 1), true);
  assert.equal(sosArmed(1000, 1000 + SOS_ARM_MS), false);
});

test('the club\'s counts, read safely', () => {
  assert.deepEqual(countsFrom([{ ride_id: 'r-1', connected: 3 }, { ride_id: 'r-2', connected: 0 }]), { 'r-1': 3, 'r-2': 0 });
  assert.deepEqual(countsFrom(null), {});
  assert.deepEqual(countsFrom([{ ride_id: 'r-1' }, { connected: 2 }, 'junk']), {}, 'nothing half-there');
});

test('a ride you raised an emergency on keeps its bubble: hidden, nobody connected, or on its own screen', () => {
  assert.deepEqual(ids({ counts: {}, sos: ['r-1'] }), ['r-1'], 'nobody left on comms');
  assert.deepEqual(ids({ hidden: ['r-1'], sos: ['r-1'] }), ['r-1'], 'hidden');
  assert.deepEqual(ids({ screenRideId: 'r-1', sos: ['r-1'] }), ['r-1'], 'its live ride screen');
  assert.deepEqual(ids({ rides: [ride({ category: 'north' })], counts: {}, sos: ['r-1'] }), ['r-1'], 'not in your colours');
  assert.deepEqual(ids({ calledOff: ['r-1'], sos: ['r-1'] }), [], 'but never once the ride is off');
  assert.deepEqual(ids({ now: '2026-11-07T13:00:00.000Z', sos: ['r-1'] }), [], 'or over');
});
