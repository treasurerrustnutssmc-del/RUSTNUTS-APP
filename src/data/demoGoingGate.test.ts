// The Going gate in the demo (2026-10-25-road-rules-going-gate-design.md): a member who's asked to
// sign can't say Going, or be put on the crew, while unsigned or expired. Maybe and Can't make it
// always work, and answers and crew spots already there stay.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREW_NOT_SIGNED, roadRulesStatus, SIGN_FIRST } from '../domain/roadRules';
import { melbourneDate } from '../domain/rides';
import type { ClubData } from '../domain/types';
import { NotAllowedError } from './clubContext';
import { runDemoAction, setCrew, setRsvp, type DemoCtx } from './demoActions';
import { DEMO_DATA } from './demoData';

// The demo's sign-offs are dated from the real today.
const TODAY = melbourneDate(new Date().toISOString());
const NOW = new Date().toISOString();
// The West breakfast run (r-1), which Torque manages, is on a fixed date. Here it's moved to the
// date of North coffee and curves (r-2), always about a week out, so the crew can still change
// whenever these tests run.
const r2 = DEMO_DATA.rides.find((r) => r.id === 'r-2')!;
const DATA: ClubData = {
  ...DEMO_DATA,
  rides: DEMO_DATA.rides.map((r) => (r.id === 'r-1' ? { ...r, startsAt: r2.startsAt, endsAt: r2.endsAt } : r)),
};
const ctxFor = (meId: string, data: ClubData = DATA): DemoCtx => ({
  data,
  me: data.members.find((m) => m.id === meId) ?? null,
  today: TODAY,
  now: NOW,
});
const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof NotAllowedError, `expected NotAllowedError, got ${e}`);
    return (e as Error).message;
  }
  throw new Error('was allowed');
};
const stateOf = (id: string, data: ClubData = DEMO_DATA) =>
  roadRulesStatus(data.members.find((m) => m.id === id)!, data, TODAY).state;
const answerOf = (data: ClubData, memberId: string, rideId: string) =>
  data.rsvps.find((r) => r.rideId === rideId && r.memberId === memberId)?.answer;
// North coffee and curves, still to come, with no answer yet from Rusty, Diesel or Torque.
const RIDE = 'r-2';

test('the demo keeps unsigned members to show the prompt: Rusty (the National persona) ran out, Diesel never signed', () => {
  assert.equal(stateOf('m-rusty'), 'expired');
  assert.equal(stateOf('m-diesel'), 'unsigned');
  assert.equal(stateOf('m-torque'), 'current');
  assert.equal(stateOf('m-spanner'), 'due_soon');
});

test('most demo members have signed, so the crew picker and the Member persona still work', () => {
  const asked = DEMO_DATA.members.filter((m) => m.approval === 'approved' && m.status !== 'legacy');
  const notSigned = asked.filter((m) => ['unsigned', 'expired'].includes(stateOf(m.id))).map((m) => m.id).sort();
  assert.deepEqual(notSigned, ['m-diesel', 'm-rusty']);
});

test('an expired or unsigned member can’t say Going; Maybe and Can’t make it work', () => {
  assert.equal(refusal(() => setRsvp(ctxFor('m-rusty'), RIDE, 'going')), SIGN_FIRST);
  assert.equal(refusal(() => setRsvp(ctxFor('m-diesel'), RIDE, 'going')), SIGN_FIRST);
  assert.equal(answerOf(setRsvp(ctxFor('m-rusty'), RIDE, 'maybe'), 'm-rusty', RIDE), 'maybe');
  assert.equal(answerOf(setRsvp(ctxFor('m-diesel'), RIDE, 'no'), 'm-diesel', RIDE), 'no');
  // The ride checks come first.
  const cancelled = { ...DATA, rides: DATA.rides.map((r) => (r.id === RIDE ? { ...r, cancelledAt: NOW } : r)) };
  assert.equal(refusal(() => setRsvp(ctxFor('m-rusty', cancelled), RIDE, 'going')), 'That ride was cancelled.');
});

test('signed and due soon can say Going, and so can Legacy, who isn’t asked to sign', () => {
  assert.equal(answerOf(setRsvp(ctxFor('m-torque'), RIDE, 'going'), 'm-torque', RIDE), 'going');
  assert.equal(answerOf(setRsvp(ctxFor('m-spanner'), RIDE, 'going'), 'm-spanner', RIDE), 'going');
  assert.equal(answerOf(setRsvp(ctxFor('m-rooster'), RIDE, 'going'), 'm-rooster', RIDE), 'going');
});

test('after signing, Going works again', () => {
  const signed = runDemoAction(ctxFor('m-rusty'), { action: 'signRoadRules', version: 2 });
  assert.equal(stateOf('m-rusty', signed), 'current');
  assert.equal(answerOf(setRsvp(ctxFor('m-rusty', signed), RIDE, 'going'), 'm-rusty', RIDE), 'going');
});

test('with nothing published, nobody is stopped', () => {
  const none: ClubData = { ...DATA, roadRules: [], roadRulesSignoffs: [] };
  assert.equal(answerOf(setRsvp(ctxFor('m-diesel', none), RIDE, 'going'), 'm-diesel', RIDE), 'going');
  assert.equal(answerOf(setCrew(ctxFor('m-torque', none), 'r-1', 'm-diesel', 'officer'), 'm-diesel', 'r-1'), 'going');
});

test('answers and crew spots given before stay: Diesel is still Going and still Road Captain on the West run', () => {
  assert.equal(answerOf(DEMO_DATA, 'm-diesel', 'r-1'), 'going');
  assert.ok((DEMO_DATA.crew ?? []).some((s) => s.rideId === 'r-1' && s.memberId === 'm-diesel' && s.role === 'road_captain'));
  // Another change to the crew leaves him where he is.
  const after = setCrew(ctxFor('m-torque'), 'r-1', 'm-sparks', 'officer');
  assert.ok((after.crew ?? []).some((s) => s.rideId === 'r-1' && s.memberId === 'm-diesel' && s.role === 'road_captain'));
  assert.equal(answerOf(after, 'm-diesel', 'r-1'), 'going');
});

test('a manager can’t put an unsigned member on the crew, nor can they volunteer', () => {
  // The West breakfast run, which Torque (West Secretary) manages.
  assert.equal(refusal(() => setCrew(ctxFor('m-torque'), 'r-1', 'm-diesel', 'officer')), CREW_NOT_SIGNED, 'not even a move');
  assert.equal(refusal(() => setCrew(ctxFor('m-torque'), 'r-1', 'm-rusty', 'officer')), CREW_NOT_SIGNED);
  assert.equal(refusal(() => setCrew(ctxFor('m-rusty'), 'r-1', 'm-rusty', 'officer')), CREW_NOT_SIGNED);
  const crewed = setCrew(ctxFor('m-torque'), 'r-1', 'm-sparks', 'officer');
  assert.equal(answerOf(crewed, 'm-sparks', 'r-1'), 'going', 'a signed member crews, and is going');
});
