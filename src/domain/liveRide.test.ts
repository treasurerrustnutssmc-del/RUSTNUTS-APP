import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIVE_MSG,
  alertProblem,
  awayText,
  compass,
  fixProblem,
  offTime,
  distanceKm,
  isRideLeader,
  isStale,
  lastSeen,
  liveProblem,
  liveWindow,
  personalStop,
  resolveProblem,
  splitGroups,
  splitWarning,
} from './liveRide';
import type { LiveRider, Member, Position, Ride, RideAlert } from './types';

const member = (over: Partial<Member> = {}): Member => ({
  id: 'm-1', chapterId: 'ch-west', fullName: 'Test Rider', roadName: 'Tester', status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});

// Sat 07/11/2026 9:30 am to 1:00 pm Melbourne (AEDT, UTC+11).
const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r-1', title: 'Coffee run', startsAt: '2026-11-06T22:30:00.000Z', endsAt: '2026-11-07T02:00:00.000Z', allDay: false,
  location: null, notes: null, category: 'west', cancelledAt: null, ...over,
});

test('live window: 2 hours either side of a timed ride', () => {
  assert.deepEqual(liveWindow(ride()), { opens: '2026-11-06T20:30:00.000Z', closes: '2026-11-07T04:00:00.000Z' });
});

test('live window: no end time closes at Melbourne midnight', () => {
  // 6 pm Melbourne start.
  const w = liveWindow(ride({ startsAt: '2026-11-07T07:00:00.000Z', endsAt: null }));
  assert.deepEqual(w, { opens: '2026-11-07T05:00:00.000Z', closes: '2026-11-07T13:00:00.000Z' });
});

test('live window: an overnight ride closes 2 hours after it ends', () => {
  const w = liveWindow(ride({ startsAt: '2026-11-07T09:00:00.000Z', endsAt: '2026-11-07T14:30:00.000Z' }));
  assert.equal(w?.closes, '2026-11-07T16:30:00.000Z');
});

test('live window: an all-day ride runs midnight to midnight over its days', () => {
  // Fri 29/01 to Sun 31/01/2027, as a calendar lists it (end is the midnight after).
  const w = liveWindow(ride({ startsAt: '2027-01-28T13:00:00.000Z', endsAt: '2027-01-31T13:00:00.000Z', allDay: true }));
  assert.deepEqual(w, { opens: '2027-01-28T13:00:00.000Z', closes: '2027-01-31T13:00:00.000Z' });
});

test('live window: daylight saving starts (05/10/2025) are handled', () => {
  // 10 am AEDT on the changeover day is 23:00Z the day before; no end, so it closes at midnight AEDT.
  const w = liveWindow(ride({ startsAt: '2025-10-04T23:00:00.000Z', endsAt: null }));
  assert.deepEqual(w, { opens: '2025-10-04T21:00:00.000Z', closes: '2025-10-05T13:00:00.000Z' });
  // And when it ends (05/04/2026), midnight is back on AEST.
  const back = liveWindow(ride({ startsAt: '2026-04-04T23:00:00.000Z', endsAt: null }));
  assert.equal(back?.closes, '2026-04-05T14:00:00.000Z');
});

test('live window: a cancelled ride has none', () => {
  assert.equal(liveWindow(ride({ cancelledAt: '2026-11-01T00:00:00.000Z' })), null);
});

test('who can switch live mode on, and when', () => {
  const r = ride();
  assert.equal(liveProblem(null, r, '2026-11-06T21:00:00.000Z'), 'Sign in first.');
  assert.equal(liveProblem(member({ approval: 'pending' }), r, '2026-11-06T21:00:00.000Z'), 'Only approved members can do that.');
  assert.equal(liveProblem(member(), undefined, '2026-11-06T21:00:00.000Z'), 'No such ride.');
  assert.equal(
    liveProblem(member(), ride({ cancelledAt: '2026-11-01T00:00:00.000Z' }), '2026-11-06T21:00:00.000Z'),
    'That ride was cancelled.',
  );
  assert.equal(liveProblem(member(), r, '2026-11-06T20:29:00.000Z'), 'Live ride opens 2 hours before the start.');
  assert.equal(liveProblem(member(), r, '2026-11-06T20:30:00.000Z'), null);
  assert.equal(liveProblem(member(), r, '2026-11-07T03:59:00.000Z'), null);
  assert.equal(liveProblem(member(), r, '2026-11-07T04:00:00.000Z'), 'This ride’s finished.');
  assert.equal(liveProblem(member({ status: 'legacy' }), r, '2026-11-06T21:00:00.000Z'), null, 'Legacy can ride too');
});

test('your sharing stops after 12 hours or at the window close, whichever is first', () => {
  assert.equal(personalStop(ride(), '2026-11-06T21:00:00.000Z'), '2026-11-07T04:00:00.000Z');
  const weekend = ride({ startsAt: '2027-01-28T13:00:00.000Z', endsAt: '2027-01-31T13:00:00.000Z', allDay: true });
  assert.equal(personalStop(weekend, '2027-01-29T20:00:00.000Z'), '2027-01-30T08:00:00.000Z');
});

const pos = (memberId: string, role: Position['role'], endedOn: string | null = null, chapterId: string | null = 'ch-west'): Position => ({
  id: `${memberId}-${role}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn,
});

test('ride leaders: road captains, tail gunners, the board and the NEC', () => {
  const positions = [
    pos('tg', 'tail_gunner'),
    pos('atg', 'assistant_tail_gunner'),
    pos('rc', 'road_captain'),
    pos('sgt', 'sergeant_at_arms'),
    pos('chair', 'nec_chair', null, null),
    pos('off', 'officer'),
    pos('old', 'tail_gunner', '2026-01-01'),
    pos('founder', 'founder', null, null),
  ];
  for (const id of ['tg', 'atg', 'rc', 'sgt', 'chair']) assert.equal(isRideLeader(id, positions), true, id);
  for (const id of ['off', 'old', 'founder', 'nobody']) assert.equal(isRideLeader(id, positions), false, id);
});

test('who can raise which alert', () => {
  const open = { sharing: true, leader: false, live: null };
  assert.equal(alertProblem('emergency', open), null);
  assert.equal(alertProblem('out', open), null);
  // An emergency or dropping out still goes through after your own sharing has switched off (say it
  // was raised with no signal and sent later), as long as the ride is still on.
  assert.equal(alertProblem('emergency', { ...open, sharing: false }), null);
  assert.equal(alertProblem('out', { ...open, sharing: false }), null);
  assert.equal(alertProblem('emergency', { ...open, live: 'This ride’s finished.' }), 'This ride’s finished.');
  assert.equal(alertProblem('regroup', open), 'Only ride leaders can set a regroup pin.');
  assert.equal(alertProblem('regroup', { ...open, leader: true }), null);
  assert.equal(alertProblem('regroup', { ...open, leader: true, sharing: false }), 'Share your location first.');
  assert.equal(alertProblem('emergency', { ...open, at: { lat: 95, lng: 144 } }), 'That location doesn’t look right.');
  assert.equal(alertProblem('emergency', { ...open, at: { lat: -37.8, lng: Number.NaN } }), 'That location doesn’t look right.');
  assert.equal(alertProblem('emergency', { ...open, at: null }), null, 'no fix is fine');
});

test('a fix has to be somewhere on Earth', () => {
  assert.equal(fixProblem({ lat: -37.8, lng: 144.9 }), null);
  assert.equal(fixProblem({ lat: -91, lng: 0 }), 'That location doesn’t look right.');
  assert.equal(fixProblem({ lat: 0, lng: 181 }), 'That location doesn’t look right.');
});

test('switch-off time: just the time today, with the date on another day', () => {
  assert.equal(offTime('2026-11-07T05:30:00.000Z', '2026-11-06T23:00:00.000Z'), '4:30 pm');
  assert.equal(offTime('2026-11-07T14:00:00.000Z', '2026-11-06T23:00:00.000Z'), '08/11/2026 1:00 am');
});

const alert = (over: Partial<RideAlert> = {}): RideAlert => ({
  id: 'a-1', rideId: 'r-1', memberId: 'm-1', kind: 'emergency', name: 'Tester', position: null, phone: null, createdAt: '2026-11-06T23:00:00.000Z',
  resolvedAt: null, ...over,
});

test('who can clear an alert', () => {
  assert.equal(resolveProblem(alert(), 'm-1', false), null, 'the rider who raised it');
  assert.equal(resolveProblem(alert(), 'm-2', true), null, 'a leader');
  assert.equal(resolveProblem(alert(), 'm-2', false), 'Only the rider or a ride leader can clear this.');
  assert.equal(resolveProblem(alert({ resolvedAt: '2026-11-06T23:05:00.000Z' }), 'm-1', false), 'Already cleared.');
});

const CBD = { lat: -37.8136, lng: 144.9631 };
const GEELONG = { lat: -38.1499, lng: 144.3617 };

test('distance and direction', () => {
  assert.ok(Math.abs(distanceKm(CBD, GEELONG) - 64) < 1.5, `${distanceKm(CBD, GEELONG)}`);
  assert.equal(compass(CBD, GEELONG), 'SW');
  assert.equal(compass(GEELONG, CBD), 'NE');
  assert.equal(awayText(CBD, { lat: CBD.lat + 0.00108, lng: CBD.lng }), '120 m N');
  assert.equal(awayText(CBD, GEELONG), '64.6 km SW');
  assert.equal(awayText(null, GEELONG), null);
  assert.equal(awayText(CBD, null), null);
});

test('last seen', () => {
  const now = '2026-11-06T23:00:00.000Z';
  assert.equal(lastSeen('2026-11-06T22:59:30.000Z', now), 'just now');
  assert.equal(lastSeen('2026-11-06T22:56:00.000Z', now), '4 min ago');
  assert.equal(lastSeen('2026-11-06T21:55:00.000Z', now), '1 h 5 min ago');
  assert.equal(isStale('2026-11-06T22:55:30.000Z', now), false);
  assert.equal(isStale('2026-11-06T22:54:59.000Z', now), true);
});

const NOW = '2026-11-06T23:00:00.000Z';
const rider = (memberId: string, lat: number, lng: number, over: Partial<LiveRider> = {}): LiveRider => ({
  memberId, name: memberId, leader: false, position: { lat, lng }, accuracyM: 10, updatedAt: NOW, phone: null, ...over,
});

test('split groups: riders within 3 km of each other stay together', () => {
  const riders = [
    rider('a', -37.8, 144.9),
    rider('b', -37.805, 144.9), // 0.55 km from a
    rider('c', -37.81, 144.905), // near b
    rider('d', -37.87, 144.9), // 6.7 km behind c, the nearest of the front group
    rider('e', -37.872, 144.9),
    rider('stale', -38.5, 144.9, { updatedAt: '2026-11-06T22:40:00.000Z' }),
    rider('nofix', 0, 0, { position: null }),
  ];
  const groups = splitGroups(riders, NOW);
  assert.deepEqual(groups.map((g) => g.map((r) => r.memberId).sort()), [['a', 'b', 'c'], ['d', 'e']]);
  assert.equal(splitWarning(riders, NOW), 'Group split: 2 riders 6.7 km away');
  assert.equal(splitWarning(riders.slice(0, 3), NOW), null);
});

test('every refusal reads the same in the database', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/20270201000000_live_ride.sql'), 'utf8');
  for (const text of Object.values(LIVE_MSG)) {
    assert.ok(sql.includes(text.replace(/'/g, "''")), `the database says "${text}"`);
  }
});
