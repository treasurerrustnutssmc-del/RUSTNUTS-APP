import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_KM, BAD_TIME, cleanStops, NOT_PLANNER, PLAN_CONFLICT, PLAN_LOCKED, savePlanProblem, STOP_NAME, TOO_MANY_STOPS, briefingStops, readTime, typeTime,
} from './ridePlan';
import { AFTER_DAY, BEFORE, planningClub, who } from './planning.testkit';
import type { PlanStop, RidePlan } from './types';

const stop = (name: string, km: number | null = null, over: Partial<PlanStop> = {}): PlanStop => ({ kind: 'fuel', name, km, time: null, ...over });

test('who can plan, and when: in the database’s order', () => {
  const data = planningClub();
  const ride = data.rides.find((r) => r.id === 'r-west');
  const plan = (me: string | null, rideId: string, now = BEFORE) =>
    savePlanProblem(me ? who(data, me) : null, data.rides.find((r) => r.id === rideId), [], null, data, now);
  assert.equal(plan(null, 'r-west'), 'Sign in first.');
  assert.equal(plan('applicant', 'r-west'), 'Only approved members can do that.');
  assert.equal(savePlanProblem(who(data, 'rc'), undefined, [], null, data, BEFORE), 'No such ride.');
  assert.equal(plan('sec', 'r-off'), 'That ride was cancelled.');
  assert.equal(plan('sec', 'r-west', AFTER_DAY), PLAN_LOCKED);
  assert.equal(plan('off', 'r-west'), NOT_PLANNER);
  assert.equal(plan('rc', 'r-west'), null); // the ride's Road Captain
  assert.equal(plan('sec', 'r-west'), null); // the West board
  assert.equal(plan('chair', 'r-west'), null); // the NEC
  assert.ok(ride);
});

test('the stop limits, each stop checked name, km, then time, in order', () => {
  const data = planningClub();
  const rc = who(data, 'rc');
  const ride = data.rides.find((r) => r.id === 'r-west');
  const check = (stops: PlanStop[]) => savePlanProblem(rc, ride, stops, null, data, BEFORE);
  assert.equal(check(Array.from({ length: 16 }, (_, i) => stop(`S${i}`, i))), TOO_MANY_STOPS);
  assert.equal(check(Array.from({ length: 15 }, (_, i) => stop(`S${i}`, i))), null);
  assert.equal(check([stop('   ')]), STOP_NAME);
  assert.equal(check([stop('x'.repeat(61))]), STOP_NAME);
  assert.equal(check([stop('é'.repeat(60))]), null);
  assert.equal(check([stop('Odd', null, { kind: 'wash' as PlanStop['kind'] })]), STOP_NAME);
  assert.equal(check([stop('Far', 2000.5)]), BAD_KM);
  assert.equal(check([stop('Back', -1)]), BAD_KM);
  assert.equal(check([stop('NaN', Number.NaN)]), BAD_KM);
  assert.equal(check([stop('Late', 5, { time: '24:00' })]), BAD_TIME);
  assert.equal(check([stop('Early', 5, { time: '9:30' })]), BAD_TIME);
  assert.equal(check([stop('Fine', 5, { time: '09:30' })]), null);
  // The first stop's problem wins.
  assert.equal(check([stop('Late', 5, { time: 'soon' }), stop('', 3)]), BAD_TIME);
});

test('saving on top of a newer plan is refused', () => {
  const saved: RidePlan = { rideId: 'r-west', stops: [], updatedAt: '2026-10-20T00:00:00.000Z', updatedBy: 'rc' };
  const data = planningClub({ ridePlans: [saved] });
  const rc = who(data, 'rc');
  const ride = data.rides.find((r) => r.id === 'r-west');
  assert.equal(savePlanProblem(rc, ride, [], null, data, BEFORE), PLAN_CONFLICT);
  assert.equal(savePlanProblem(rc, ride, [], '2026-10-19T23:59:59.000Z', data, BEFORE), PLAN_CONFLICT);
  assert.equal(savePlanProblem(rc, ride, [], '2026-10-20T00:00:00.000Z', data, BEFORE), null);
});

test('stops are saved trimmed, in km order, those without a km keeping their place after', () => {
  assert.deepEqual(
    cleanStops([stop(' Lookout ', null), stop('B', 90), stop('Pie shop', null), stop(' A ', 40.5)]).map((s) => [s.name, s.km]),
    [['A', 40.5], ['B', 90], ['Lookout', null], ['Pie shop', null]],
  );
});

test('the briefing shows the plan’s stops when there are any, and the route’s waypoints otherwise', () => {
  const data = planningClub();
  assert.deepEqual(briefingStops('r-west', data).map((s) => s.name), ['Healesville', 'Marysville']);
  const planned = planningClub({ ridePlans: [{ rideId: 'r-west', stops: [stop('Pie shop', 10, { kind: 'lunch', time: '12:30' })], updatedAt: '', updatedBy: null }] });
  assert.deepEqual(briefingStops('r-west', planned), [{ name: 'Pie shop', kind: 'lunch', km: 10, time: '12:30' }]);
  assert.deepEqual(briefingStops('r-club', planned), []);
});

test('typing a time on the number pad puts the colon in, and a one-digit hour gets its zero on save', () => {
  assert.equal(typeTime('1'), '1');
  assert.equal(typeTime('10'), '10');
  assert.equal(typeTime('103'), '1:03');
  assert.equal(typeTime('1030'), '10:30');
  assert.equal(typeTime('10:30'), '10:30');
  assert.equal(typeTime('10305'), '10:30');
  assert.equal(readTime('9:30'), '09:30');
  assert.equal(readTime('10:30'), '10:30');
  assert.equal(readTime(' '), null);
});
