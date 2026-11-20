import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_CHAPTER_RIDE_MANAGER, NOT_RIDE_MANAGER, RIDE_GONE, RIDE_OVER } from './newRide';
import {
  LEGS_SPREAD, LEGS_TOO_MANY, LEGS_TWICE, legLabel, legsOf, linkableRides, nextLegDraft, setLegsProblem, tripAfterSave,
} from './rideLegs';
import { member, planningClub, ride, who } from './planning.testkit';
import type { ClubData } from './types';

const NOW = '2026-11-01T02:00:00.000Z'; // 1 Nov, 1pm Melbourne

function club(over: Partial<ClubData> = {}): ClubData {
  const base = planningClub();
  return {
    ...base,
    members: [...base.members, member('rc2'), member('nrc', { chapterId: 'north' })],
    positions: [
      ...base.positions,
      { id: 'p-rc2', memberId: 'rc2', chapterId: 'west', role: 'ride_committee', startedOn: '2025-01-01', endedOn: null },
      { id: 'p-nrc', memberId: 'nrc', chapterId: 'north', role: 'ride_committee', startedOn: '2025-01-01', endedOn: null },
    ],
    rides: [
      ...base.rides,
      ride('b4-out', { title: 'Big 4 Alpine Run', category: 'club', allDay: true, startsAt: '2026-11-20T13:00:00.000Z', endsAt: '2026-11-22T13:00:00.000Z' }),
      ride('b4-2', { source: 'app', title: 'Day one second leg', category: 'club', startsAt: '2026-11-21T02:30:00.000Z' }),
      ride('b4-home', { source: 'app', title: 'Leg home', category: 'club', startsAt: '2026-11-21T19:00:00.000Z' }),
      ride('north-run', { source: 'app', category: 'north', startsAt: '2026-11-21T22:00:00.000Z' }),
      ride('far', { source: 'app', category: 'club', startsAt: '2026-12-20T22:00:00.000Z' }),
      ride('old', { source: 'app', category: 'club', startsAt: '2026-10-20T22:00:00.000Z' }),
    ],
    rideLegs: [
      { rideId: 'b4-home', tripId: 'b4-out', legNo: 3 },
      { rideId: 'b4-out', tripId: 'b4-out', legNo: 1 },
      { rideId: 'b4-2', tripId: 'b4-out', legNo: 2 },
    ],
    ...over,
  };
}

test('a trip’s legs come in leg order, with a label for each', () => {
  const data = club();
  assert.deepEqual(legsOf('b4-2', data)?.map((r) => r.id), ['b4-out', 'b4-2', 'b4-home']);
  assert.equal(legLabel('b4-2', data), 'Leg 2 of 3');
  assert.equal(legLabel('b4-home', data), 'Leg 3 of 3');
  assert.equal(legsOf('far', data), null);
  assert.equal(legLabel('far', data), null);
  // A leg the calendar removed from view leaves the others numbered as they stand.
  const gone = { ...data, rides: data.rides.filter((r) => r.id !== 'b4-2') };
  assert.equal(legLabel('b4-home', gone), 'Leg 2 of 2');
  // A trip with a single ride left in view isn't a trip.
  const alone = { ...data, rides: data.rides.filter((r) => r.id !== 'b4-2' && r.id !== 'b4-home') };
  assert.equal(legLabel('b4-out', alone), null);
});

test('linking legs: refusals in the database’s order, then allowed', () => {
  const data = club();
  const sec = who(data, 'sec');
  assert.equal(setLegsProblem(null, ['b4-out', 'b4-2'], data, NOW), 'Sign in first.');
  assert.equal(setLegsProblem(member('new', { approval: 'pending' }), ['b4-out'], data, NOW), 'Only approved members can do that.');
  assert.equal(setLegsProblem(sec, ['b4-out', 'b4-2', 'b4-home', 'far', 'north-run', 'old', 'r-west'], data, NOW), LEGS_TOO_MANY);
  assert.equal(setLegsProblem(sec, ['b4-out', 'b4-out'], data, NOW), LEGS_TWICE);
  assert.equal(setLegsProblem(sec, ['b4-out', 'nope'], data, NOW), RIDE_GONE);
  assert.equal(setLegsProblem(who(data, 'rider'), ['b4-out', 'b4-2'], data, NOW), NOT_RIDE_MANAGER);
  assert.equal(setLegsProblem(sec, ['b4-out', 'north-run'], data, NOW), NOT_CHAPTER_RIDE_MANAGER);
  assert.equal(setLegsProblem(sec, ['old', 'b4-out'], data, NOW), RIDE_OVER);
  assert.equal(setLegsProblem(sec, ['b4-out', 'far'], data, NOW), LEGS_SPREAD);
  assert.equal(setLegsProblem(sec, ['b4-out', 'b4-2', 'b4-home'], data, NOW), null);
  assert.equal(setLegsProblem(who(data, 'rc2'), ['b4-2', 'b4-home'], data, NOW), null);
  assert.equal(setLegsProblem(who(data, 'nrc'), ['b4-out', 'north-run'], data, NOW), null, 'any manager runs club rides');
  // One ride, or none: unlinking.
  assert.equal(setLegsProblem(sec, ['b4-out'], data, NOW), null);
});

test('the rides a manager can link to a ride: their own, on, not history, within 14 days, in start order', () => {
  const data = club();
  assert.deepEqual(linkableRides(who(data, 'sec'), 'b4-2', data, NOW).map((r) => r.id), ['r-club', 'r-west', 'b4-out', 'b4-2', 'b4-home']);
  assert.deepEqual(linkableRides(who(data, 'nrc'), 'b4-2', data, NOW).map((r) => r.id), ['r-club', 'b4-out', 'b4-2', 'b4-home', 'north-run']);
  assert.deepEqual(linkableRides(who(data, 'rider'), 'b4-2', data, NOW), []);
});

test('the next leg starts filled in from the last leg, and the trip it joins', () => {
  const data = club();
  const draft = nextLegDraft('b4-2', data);
  assert.equal(draft.category, 'club');
  assert.equal(draft.title, 'Big 4 Alpine Run, leg 4');
  assert.equal(draft.dateIso, '2026-11-22', 'the day the last leg starts');
  assert.deepEqual(tripAfterSave('b4-2', 'new', data), ['b4-out', 'b4-2', 'b4-home', 'new']);
  // From a ride on its own: it becomes leg 1, the new ride leg 2.
  const single = nextLegDraft('far', data);
  assert.equal(single.title.endsWith(', leg 2'), true);
  assert.equal(single.dateIso, '2026-12-21');
  assert.deepEqual(tripAfterSave('far', 'new', data), ['far', 'new']);
  // A long title is cut so the whole stays within 80 characters.
  const long = club({ rides: [...club().rides, ride('long', { title: 'x'.repeat(80), category: 'club', startsAt: '2026-11-25T22:00:00.000Z' })] });
  assert.equal(nextLegDraft('long', long).title.length <= 80, true);
});
