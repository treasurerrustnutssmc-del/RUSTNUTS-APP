import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFS } from './notifications';
import { localAlerts } from './localAlerts';
import type { ClubData, CrewSwap, RideCall } from './types';
import { BEFORE, planningClub } from './planning.testkit';

const swap = (over: Partial<CrewSwap> = {}): CrewSwap => ({
  id: 's-1', rideId: 'r-west', askedBy: 'rc', role: 'road_captain', askedTo: 'rider', theirRole: null, note: '',
  state: 'asked', askedAt: BEFORE, answeredAt: null, ...over,
});
const call = (over: Partial<RideCall> = {}): RideCall => ({
  rideId: 'r-west', state: 'off', reason: 'Weather', newDay: null, calledBy: 'rc', calledAt: BEFORE, ...over,
});

function club(over: Partial<ClubData>): ClubData {
  const base = planningClub();
  return { ...base, ...over };
}

test('an open swap ask to me is an alert; one to someone else is not', () => {
  const data = club({ crewSwaps: [swap(), swap({ id: 's-2', askedTo: 'tg' })] });
  const alerts = localAlerts(data, 'rider', DEFAULT_PREFS, BEFORE);
  assert.deepEqual(alerts.map((a) => a.id), ['swap-ask-s-1']);
  assert.match(alerts[0].body, /take their Road Captain spot/);
});

test('an answer to my own ask in the last day is an alert', () => {
  const data = club({ crewSwaps: [swap({ askedBy: 'rider', askedTo: 'rc', state: 'accepted', answeredAt: BEFORE })] });
  assert.deepEqual(localAlerts(data, 'rider', DEFAULT_PREFS, BEFORE).map((a) => a.id), ['swap-answer-s-1-accepted']);
  const old = new Date(Date.parse(BEFORE) + 25 * 3600_000).toISOString();
  assert.deepEqual(localAlerts(data, 'rider', DEFAULT_PREFS, old), []);
});

test('a call on a ride I’m going to, by someone else, is an alert; my own call is not', () => {
  const rsvps = [{ rideId: 'r-west', memberId: 'rider', answer: 'going' as const, updatedAt: BEFORE }];
  const data = club({ rsvps, rideCalls: [call()] });
  const alerts = localAlerts(data, 'rider', DEFAULT_PREFS, BEFORE);
  assert.deepEqual(alerts.map((a) => a.id), [`call-r-west-${BEFORE}`]);
  assert.equal(alerts[0].title, 'Ride’s off');
  assert.deepEqual(localAlerts(club({ rsvps, rideCalls: [call({ calledBy: 'rider' })] }), 'rider', DEFAULT_PREFS, BEFORE), []);
  assert.deepEqual(localAlerts(club({ rsvps: [], rideCalls: [call()] }), 'rider', DEFAULT_PREFS, BEFORE), []);
});

test('with ride changes turned off, or signed out, there are no alerts', () => {
  const data = club({ crewSwaps: [swap()] });
  assert.deepEqual(localAlerts(data, 'rider', { ...DEFAULT_PREFS, rideChanges: false }, BEFORE), []);
  assert.deepEqual(localAlerts(data, null, DEFAULT_PREFS, BEFORE), []);
});
