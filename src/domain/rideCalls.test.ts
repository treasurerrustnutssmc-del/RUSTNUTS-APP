import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCall, BAD_NEW_DAY, callLine, callProblem, CALL_TOO_LATE, NEW_DAY_NEEDS_POSTPONED, NOT_CALLER, REASON_TOO_LONG } from './rideCalls';
import { AFTER_DAY, BEFORE, planningClub, who } from './planning.testkit';

test('calling a ride: in the database’s order', () => {
  const data = planningClub();
  const ride = data.rides.find((r) => r.id === 'r-west'); // Sun 8 Nov 2026 Melbourne
  const rc = who(data, 'rc');
  assert.equal(callProblem(null, ride, 'off', '', null, data, BEFORE), 'Sign in first.');
  assert.equal(callProblem(who(data, 'applicant'), ride, 'off', '', null, data, BEFORE), 'Only approved members can do that.');
  assert.equal(callProblem(rc, undefined, 'off', '', null, data, BEFORE), 'No such ride.');
  assert.equal(callProblem(who(data, 'sec'), data.rides.find((r) => r.id === 'r-off'), 'off', '', null, data, BEFORE), 'That ride was cancelled.');
  assert.equal(callProblem(rc, ride, 'off', '', null, data, AFTER_DAY), CALL_TOO_LATE);
  assert.equal(callProblem(who(data, 'off'), ride, 'off', '', null, data, BEFORE), NOT_CALLER);
  assert.equal(callProblem(rc, ride, 'off', 'x'.repeat(201), null, data, BEFORE), REASON_TOO_LONG);
  assert.equal(callProblem(rc, ride, 'on', 'x'.repeat(201), null, data, BEFORE), null); // Back on keeps no reason
  assert.equal(callProblem(rc, ride, 'off', '', '2026-11-15', data, BEFORE), NEW_DAY_NEEDS_POSTPONED);
  assert.equal(callProblem(rc, ride, 'postponed', '', '2026-11-08', data, BEFORE), BAD_NEW_DAY);
  assert.equal(callProblem(rc, ride, 'postponed', '', '2027-11-09', data, BEFORE), BAD_NEW_DAY);
  assert.equal(callProblem(rc, ride, 'postponed', '', '2027-11-08', data, BEFORE), null);
  assert.equal(callProblem(rc, ride, 'postponed', 'Weather', '2026-11-15', data, BEFORE), null);
  assert.equal(callProblem(rc, ride, 'postponed', '', null, data, BEFORE), null);
});

test('the chat line, as the database writes it', () => {
  assert.equal(callLine('off', ' Rain and 90 km/h winds. ', null), 'Ride’s off: Rain and 90 km/h winds.');
  assert.equal(callLine('off', '', null), 'Ride’s off.');
  assert.equal(callLine('postponed', 'Weather', '2026-11-15'), 'Ride’s postponed to 15/11/2026: Weather');
  assert.equal(callLine('postponed', '', null), 'Ride’s postponed.');
  assert.equal(callLine('on', 'ignored', null), 'Ride’s back on.');
});

test('the active call: Off or Postponed, not Back on', () => {
  const call = { rideId: 'r-west', reason: '', newDay: null, calledBy: 'rc', calledAt: '2026-10-30T00:00:00.000Z' };
  assert.equal(activeCall('r-west', planningClub({ rideCalls: [{ ...call, state: 'off' }] }))?.state, 'off');
  assert.equal(activeCall('r-west', planningClub({ rideCalls: [{ ...call, state: 'on' }] })), null);
  assert.equal(activeCall('r-west', planningClub()), null);
});
