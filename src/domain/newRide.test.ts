import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALENDAR_RIDE, callOffProblem, cleanRideInput, isAppRide, managesCategory, MAX_RIDE_LOCATION, MAX_RIDE_NOTES, MAX_RIDE_TITLE,
  NOT_CHAPTER_RIDE_MANAGER, NOT_RIDE_MANAGER, putBackProblem, RIDE_ALREADY_OFF, RIDE_END, RIDE_GONE, RIDE_LOCATION, RIDE_NOT_OFF,
  RIDE_NOTES, RIDE_OVER, RIDE_PAST, RIDE_START, RIDE_TITLE, saveRideProblem, type RideInput,
} from './newRide';
import { member, planningClub, ride, who } from './planning.testkit';
import type { ClubData } from './types';

const NOW = '2026-11-01T02:00:00.000Z'; // 1 Nov, 1pm Melbourne
const input = (over: Partial<RideInput> = {}): RideInput => ({
  title: 'Spring run', startsAt: '2026-11-14T22:00:00.000Z', endsAt: null, allDay: false, category: 'west', location: 'Bacchus Marsh',
  notes: '', website: true, ...over,
});

/** The planning club plus rc2 on the West ride committee and nrc on North's. */
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
      ride('r-app', { source: 'app', title: 'Planning night', category: 'club', startsAt: '2026-11-20T08:00:00.000Z' }),
      ride('r-app-west', { source: 'app', category: 'west', startsAt: '2026-11-21T22:00:00.000Z' }),
      ride('r-app-off', { source: 'app', category: 'club', startsAt: '2026-11-22T22:00:00.000Z', cancelledAt: '2026-10-30T00:00:00.000Z' }),
      ride('r-app-past', { source: 'app', category: 'club', startsAt: '2026-10-20T22:00:00.000Z' }),
    ],
    ...over,
  };
}
const find = (data: ClubData, id: string) => data.rides.find((r) => r.id === id);

test('who manages which category: chapter seats for their chapter, any board, ride committee or NEC for the rest', () => {
  const data = club();
  assert.equal(managesCategory(who(data, 'sec'), 'west', data), true);
  assert.equal(managesCategory(who(data, 'sec'), 'north', data), false);
  assert.equal(managesCategory(who(data, 'sec'), 'club', data), true);
  assert.equal(managesCategory(who(data, 'rc2'), 'west', data), true);
  assert.equal(managesCategory(who(data, 'rc2'), 'north', data), false);
  assert.equal(managesCategory(who(data, 'rc2'), 'supported', data), true);
  assert.equal(managesCategory(who(data, 'nrc'), 'north', data), true);
  assert.equal(managesCategory(who(data, 'chair'), 'north', data), true);
  assert.equal(managesCategory(who(data, 'rider'), 'club', data), false);
  assert.equal(managesCategory(null, 'club', data), false);
});

test('a ride from the calendar is not an app ride; the default is the calendar', () => {
  const data = club();
  assert.equal(isAppRide(find(data, 'r-west')!), false);
  assert.equal(isAppRide(find(data, 'r-app')!), true);
});

test('cleaning trims the words, keeps an all-day ride at its dates, and drops an empty end', () => {
  const c = cleanRideInput(input({ title: '  Spring run ', location: '  ', notes: ' Bring cash ', endsAt: '' as unknown as null }));
  assert.equal(c.title, 'Spring run');
  assert.equal(c.location, null);
  assert.equal(c.notes, 'Bring cash');
  assert.equal(c.endsAt, null);
});

test('making a ride: refusals in order, then allowed', () => {
  const data = club();
  const rc2 = who(data, 'rc2');
  assert.equal(saveRideProblem(null, undefined, input(), data, NOW), 'Sign in first.');
  assert.equal(saveRideProblem(member('new', { approval: 'pending' }), undefined, input(), data, NOW), 'Only approved members can do that.');
  assert.equal(saveRideProblem(who(data, 'rider'), undefined, input(), data, NOW), NOT_RIDE_MANAGER);
  assert.equal(saveRideProblem(rc2, undefined, input({ category: 'north' }), data, NOW), NOT_CHAPTER_RIDE_MANAGER);
  assert.equal(saveRideProblem(rc2, undefined, input({ title: 'Go' }), data, NOW), RIDE_TITLE);
  assert.equal(saveRideProblem(rc2, undefined, input({ title: 'x'.repeat(MAX_RIDE_TITLE + 1) }), data, NOW), RIDE_TITLE);
  assert.equal(saveRideProblem(rc2, undefined, input({ startsAt: '' }), data, NOW), RIDE_START);
  assert.equal(saveRideProblem(rc2, undefined, input({ startsAt: 'yesterday' }), data, NOW), RIDE_START);
  assert.equal(saveRideProblem(rc2, undefined, input({ startsAt: '2026-10-31T12:00:00.000Z' }), data, NOW), RIDE_PAST);
  assert.equal(saveRideProblem(rc2, undefined, input({ endsAt: '2026-11-14T21:00:00.000Z' }), data, NOW), RIDE_END);
  assert.equal(saveRideProblem(rc2, undefined, input({ endsAt: '2026-11-14T22:00:00.000Z' }), data, NOW), RIDE_END);
  assert.equal(saveRideProblem(rc2, undefined, input({ location: 'x'.repeat(MAX_RIDE_LOCATION + 1) }), data, NOW), RIDE_LOCATION);
  assert.equal(saveRideProblem(rc2, undefined, input({ notes: 'x'.repeat(MAX_RIDE_NOTES + 1) }), data, NOW), RIDE_NOTES);
  assert.equal(saveRideProblem(rc2, undefined, input(), data, NOW), null);
  // Earlier today (Melbourne) is still today, so allowed; an all-day ride ending on its start day is fine.
  assert.equal(saveRideProblem(rc2, undefined, input({ startsAt: '2026-10-31T22:30:00.000Z' }), data, NOW), null);
  assert.equal(saveRideProblem(rc2, undefined, input({ allDay: true, startsAt: '2026-11-14T13:00:00.000Z', endsAt: '2026-11-14T13:00:00.000Z' }), data, NOW), null);
  assert.equal(saveRideProblem(who(data, 'chair'), undefined, input({ category: 'north' }), data, NOW), null);
  assert.equal(saveRideProblem(who(data, 'sec'), undefined, input({ category: 'club', notes: 'Members only' }), data, NOW), null);
});

test('changing a ride: only an app ride, before it is over, by someone who manages the old and the new category', () => {
  const data = club();
  const rc2 = who(data, 'rc2');
  const sec = who(data, 'sec');
  assert.equal(saveRideProblem(sec, undefined, input(), data, NOW), null);
  assert.equal(saveRideProblem(sec, find(data, 'r-west'), input(), data, NOW), CALENDAR_RIDE);
  assert.equal(saveRideProblem(sec, find(data, 'r-app-past'), input({ category: 'club' }), data, NOW), RIDE_OVER);
  assert.equal(saveRideProblem(who(data, 'rider'), find(data, 'r-app'), input({ category: 'club' }), data, NOW), NOT_RIDE_MANAGER);
  // rc2 (West ride committee) can't take a West ride to North, and can't touch a North ride at all.
  assert.equal(saveRideProblem(rc2, find(data, 'r-app-west'), input({ category: 'north' }), data, NOW), NOT_CHAPTER_RIDE_MANAGER);
  assert.equal(saveRideProblem(who(data, 'nrc'), find(data, 'r-app-west'), input({ category: 'north' }), data, NOW), NOT_CHAPTER_RIDE_MANAGER);
  // A change may move the start into the past of today, but not before today.
  assert.equal(saveRideProblem(sec, find(data, 'r-app'), input({ category: 'club', startsAt: '2026-10-31T12:00:00.000Z' }), data, NOW), RIDE_PAST);
  assert.equal(saveRideProblem(sec, find(data, 'r-app'), input({ category: 'club', website: false }), data, NOW), null);
  assert.equal(saveRideProblem(rc2, find(data, 'r-app-west'), input({ category: 'club' }), data, NOW), null);
  // A called-off app ride can still be edited (it comes back with Put it back on).
  assert.equal(saveRideProblem(sec, find(data, 'r-app-off'), input({ category: 'club' }), data, NOW), null);
});

test('calling off and putting back', () => {
  const data = club();
  const sec = who(data, 'sec');
  assert.equal(callOffProblem(null, find(data, 'r-app'), data, NOW), 'Sign in first.');
  assert.equal(callOffProblem(sec, undefined, data, NOW), RIDE_GONE);
  assert.equal(callOffProblem(sec, find(data, 'r-west'), data, NOW), CALENDAR_RIDE);
  assert.equal(callOffProblem(sec, find(data, 'r-app-past'), data, NOW), RIDE_OVER);
  assert.equal(callOffProblem(who(data, 'rider'), find(data, 'r-app'), data, NOW), NOT_RIDE_MANAGER);
  assert.equal(callOffProblem(who(data, 'rc2'), find(data, 'r-app'), data, NOW), null);
  assert.equal(callOffProblem(sec, find(data, 'r-app-off'), data, NOW), RIDE_ALREADY_OFF);
  assert.equal(callOffProblem(sec, find(data, 'r-app'), data, NOW), null);
  assert.equal(putBackProblem(sec, find(data, 'r-app'), data, NOW), RIDE_NOT_OFF);
  assert.equal(putBackProblem(sec, find(data, 'r-off'), data, NOW), CALENDAR_RIDE);
  assert.equal(putBackProblem(sec, find(data, 'r-app-off'), data, NOW), null);
});
