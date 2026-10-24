import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crewNeeded, showsCrewNeeded } from '../domain/crew';
import { todayIso } from '../domain/dates';
import type { ClubData, CrewSpot } from '../domain/types';
import { NotAllowedError } from './clubContext';
import { leaveCrew, runDemoAction, setCrew, setRsvp, type DemoCtx } from './demoActions';
import { DEMO_DATA } from './demoData';

const NOW = '2026-10-24T00:00:00.000Z';
const spot = (memberId: string, role: CrewSpot['role'], rideId = 'r-1'): CrewSpot => ({
  rideId, memberId, role, assignedBy: 'm-torque', assignedAt: '2026-10-23T00:00:00.000Z',
});
const ctxFor = (meId: string, crew: CrewSpot[] = [], data: ClubData = DEMO_DATA): DemoCtx => ({
  data: { ...data, crew },
  me: data.members.find((m) => m.id === meId) ?? null,
  today: '2026-10-24',
  now: NOW,
});
const spotsOf = (data: ClubData, rideId = 'r-1') =>
  (data.crew ?? []).filter((s) => s.rideId === rideId).map((s) => `${s.memberId}:${s.role}`).sort();
const answerOf = (data: ClubData, memberId: string, rideId = 'r-1') =>
  data.rsvps.find((r) => r.rideId === rideId && r.memberId === memberId)?.answer;
const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof NotAllowedError, `expected NotAllowedError, got ${e}`);
    return (e as Error).message;
  }
  throw new Error('was allowed');
};

test('a manager puts a member on the crew, and they are going', () => {
  const data = setCrew(ctxFor('m-torque'), 'r-1', 'm-diesel', 'road_captain');
  assert.deepEqual(spotsOf(data), ['m-diesel:road_captain']);
  assert.equal(data.crew![0].assignedBy, 'm-torque');
  assert.equal(data.crew![0].assignedAt, NOW);
  assert.equal(answerOf(data, 'm-diesel'), 'going');
});

test('a member volunteers themselves, and a maybe becomes going', () => {
  assert.equal(answerOf(DEMO_DATA, 'm-gravel'), 'maybe');
  const data = setCrew(ctxFor('m-gravel'), 'r-1', 'm-gravel', 'officer');
  assert.deepEqual(spotsOf(data), ['m-gravel:officer']);
  assert.equal(answerOf(data, 'm-gravel'), 'going');
});

test('a manager replacing a single spot removes the old holder', () => {
  const data = setCrew(ctxFor('m-torque', [spot('m-diesel', 'road_captain')]), 'r-1', 'm-sparks', 'road_captain');
  assert.deepEqual(spotsOf(data), ['m-sparks:road_captain']);
  assert.equal(answerOf(DEMO_DATA, 'm-diesel'), 'going');
  assert.equal(answerOf(data, 'm-diesel'), 'going', 'the replaced holder’s answer stays as it was');
});

test('officers add up, and never replace each other', () => {
  const data = setCrew(ctxFor('m-torque', [spot('m-chook', 'officer')]), 'r-1', 'm-gravel', 'officer');
  assert.deepEqual(spotsOf(data), ['m-chook:officer', 'm-gravel:officer']);
});

test('moving to another spot replaces your old one', () => {
  const data = setCrew(ctxFor('m-spanner', [spot('m-spanner', 'tail_gunner')]), 'r-1', 'm-spanner', 'assistant_tail_gunner');
  assert.deepEqual(spotsOf(data), ['m-spanner:assistant_tail_gunner']);
});

test('crew on other rides are left alone', () => {
  const data = setCrew(ctxFor('m-torque', [spot('m-diesel', 'road_captain', 'r-4')]), 'r-1', 'm-diesel', 'road_captain');
  assert.deepEqual(spotsOf(data, 'r-4'), ['m-diesel:road_captain']);
  assert.deepEqual(spotsOf(data, 'r-1'), ['m-diesel:road_captain']);
});

test('the action is pure: the club it was given is not changed', () => {
  const ctx = ctxFor('m-torque');
  setCrew(ctx, 'r-1', 'm-diesel', 'road_captain');
  assert.deepEqual(ctx.data.crew, []);
});

test('leaving takes your spot off, and a manager can take someone else off', () => {
  const crew = [spot('m-spanner', 'tail_gunner'), spot('m-diesel', 'road_captain')];
  assert.deepEqual(spotsOf(leaveCrew(ctxFor('m-spanner', crew), 'r-1', 'm-spanner')), ['m-diesel:road_captain']);
  assert.deepEqual(spotsOf(leaveCrew(ctxFor('m-torque', crew), 'r-1', 'm-diesel')), ['m-spanner:tail_gunner']);
});

test('answering Maybe or No takes you off the crew, Going keeps you on', () => {
  const crew = [spot('m-spanner', 'tail_gunner'), spot('m-diesel', 'road_captain')];
  const maybe = setRsvp(ctxFor('m-spanner', crew), 'r-1', 'maybe');
  assert.deepEqual(spotsOf(maybe), ['m-diesel:road_captain']);
  assert.equal(answerOf(maybe, 'm-spanner'), 'maybe');
  const no = setRsvp(ctxFor('m-spanner', crew), 'r-1', 'no');
  assert.deepEqual(spotsOf(no), ['m-diesel:road_captain']);
  const going = setRsvp(ctxFor('m-spanner', crew), 'r-1', 'going');
  assert.deepEqual(spotsOf(going), ['m-diesel:road_captain', 'm-spanner:tail_gunner']);
});

test('a refusal passes crewProblem’s words through NotAllowedError', () => {
  assert.equal(
    refusal(() => setCrew(ctxFor('m-spanner'), 'r-1', 'm-diesel', 'road_captain')),
    'Only the board or ride committee can put someone else on the crew.',
  );
  assert.equal(
    refusal(() => setCrew(ctxFor('m-spanner', [spot('m-diesel', 'road_captain')]), 'r-1', 'm-spanner', 'road_captain')),
    'That spot’s taken.',
  );
  assert.equal(
    refusal(() => setCrew(ctxFor('m-torque'), 'r-1', 'm-throttle', 'officer')),
    'Only Full and Nomad members can crew a ride.',
  );
  assert.equal(
    refusal(() => setCrew(ctxFor('m-torque'), 'r-1', 'm-sparks', 'tail_gunner')),
    'Tail Gunners need a current first aid certificate on file.',
  );
  assert.equal(refusal(() => setCrew(ctxFor('m-torque'), 'nope', 'm-diesel', 'officer')), 'No such ride.');
  assert.equal(refusal(() => setCrew({ ...ctxFor('m-torque'), me: null }, 'r-1', 'm-diesel', 'officer')), 'Sign in first.');
});

test('leave refusals pass leaveProblem’s words through', () => {
  assert.equal(refusal(() => leaveCrew(ctxFor('m-spanner'), 'r-1', 'm-spanner')), 'They’re not on the crew.');
  assert.equal(
    refusal(() => leaveCrew(ctxFor('m-spanner', [spot('m-diesel', 'road_captain')]), 'r-1', 'm-diesel')),
    'Only the board or ride committee can take someone else off the crew.',
  );
});

test('the shared parity cases can drive the crew actions', () => {
  const data = runDemoAction(ctxFor('m-torque'), { action: 'crew', ride: 'r-1', member: 'm-diesel', role: 'road_captain' });
  assert.deepEqual(spotsOf(data), ['m-diesel:road_captain']);
  const left = runDemoAction(ctxFor('m-diesel', data.crew), { action: 'leaveCrew', ride: 'r-1', member: 'm-diesel' });
  assert.deepEqual(spotsOf(left), []);
});

test('the demo club has crew: an RC and TG on one ride, only an RC on another, and an Officer', () => {
  const crew = DEMO_DATA.crew ?? [];
  const ride = (id: string) => DEMO_DATA.rides.find((r) => r.id === id)!;
  const roles = (id: string) => crew.filter((s) => s.rideId === id).map((s) => s.role).sort();
  assert.ok(crew.some((s) => s.role === 'officer'));
  const complete = DEMO_DATA.rides.filter((r) => roles(r.id).includes('road_captain') && roles(r.id).includes('tail_gunner'));
  const partial = DEMO_DATA.rides.filter((r) => roles(r.id).includes('road_captain') && !roles(r.id).includes('tail_gunner'));
  assert.ok(complete.length >= 1 && partial.length >= 1);
  assert.equal(crewNeeded(complete[0], crew), false);
  assert.equal(crewNeeded(partial[0], crew), true);
  assert.deepEqual(roles('r-2'), ['road_captain'], 'North coffee and curves has an RC and no TG');
  assert.equal(crewNeeded(ride('r-2'), crew), true, 'so it needs crew');
  // Everyone crewing is a Full or Nomad member, going, with first aid for the Tail Gunner spots.
  for (const s of crew) {
    const m = DEMO_DATA.members.find((x) => x.id === s.memberId)!;
    assert.ok(m.status === 'full' || m.status === 'nomad', `${m.fullName} is ${m.status}`);
    assert.equal(DEMO_DATA.rsvps.find((r) => r.rideId === s.rideId && r.memberId === s.memberId)?.answer, 'going');
    if (s.role === 'tail_gunner' || s.role === 'assistant_tail_gunner') {
      const aid = DEMO_DATA.privates.find((p) => p.memberId === s.memberId)?.firstAidExpiry;
      assert.ok(aid && aid >= ride(s.rideId).startsAt.slice(0, 10), `${m.fullName} first aid`);
    }
  }
});

test('a demo ride shows Crew needed for a manager today, whatever the real date', () => {
  // The demo provider uses the device's date, so this checks against the real today.
  const today = todayIso();
  const smokey = DEMO_DATA.members.find((m) => m.id === 'm-smokey')!; // North president
  const needy = DEMO_DATA.rides.filter((r) => showsCrewNeeded(smokey, r, DEMO_DATA, today));
  assert.ok(needy.length >= 1, 'a North ride with no TG starts in the next 14 days');
  const gravel = DEMO_DATA.members.find((m) => m.id === 'm-gravel')!; // West board: not North's crew
  assert.equal(needy.some((r) => showsCrewNeeded(gravel, r, DEMO_DATA, today)), false, 'only for a manager of that ride');
});
