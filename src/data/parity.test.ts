// Runs the shared who-can-do-what cases (supabase/tests/parity.json) against the demo.
// `npm run test:db` runs the very same cases against the real database rules, and checks the
// database refuses with exactly the demo's message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_OFF, BUS_CLASH, BUS_PAST_START, bookedStraightAway, NOT_BUS_BOOKER, NOT_BUS_CANCELLER, NOT_BUS_MANAGER,
} from '../domain/bus';
import { BRIEFED_AT, demoAnswer, fixture, fixtureData, parityToday, resolveCase } from './parityFixture.testkit';

test('the shared case list has cases', () => {
  assert.ok(fixture.cases.length >= 30);
});

test('every briefing case says which version it was made on', () => {
  const briefed = new Set((fixture.briefings ?? []).map((b) => b.ride));
  for (const c of fixture.cases.filter((x) => x.action === 'saveBriefing' || x.action === 'readBriefing')) {
    assert.ok('seen' in c && (c.seen === null || typeof c.seen === 'string'), `"${c.name}" has no seen`);
  }
  // The version-check cases are there: both refusals, and a read of the version stored.
  const named = (action: string, ride: (r: string) => boolean, seen: (s: unknown) => boolean, allowed: boolean) =>
    fixture.cases.some((c) => c.action === action && ride(String(c.ride)) && seen(c.seen) && c.allowed === allowed);
  const old = (s: unknown) => s === null || (typeof s === 'string' && Date.parse(s) < Date.parse(BRIEFED_AT) - 1);
  assert.ok(named('readBriefing', (r) => briefed.has(r), old, false), 'Got it on an older version');
  assert.ok(named('readBriefing', (r) => briefed.has(r), (s) => s === BRIEFED_AT, true), 'Got it on the version stored');
  assert.ok(named('saveBriefing', (r) => briefed.has(r), (s) => s === null, false), 'a save opened when there was none');
  assert.ok(named('saveBriefing', (r) => briefed.has(r), (s) => typeof s === 'string' && old(s), false), 'a save on an older version');
});

test('the Road Rules cases cover publishing and signing, with and without versions', () => {
  const rules = fixture.cases.filter((c) => c.action === 'publishRoadRules' || c.action === 'signRoadRules');
  for (const c of rules.filter((x) => x.action === 'publishRoadRules')) {
    assert.ok(typeof c.seen === 'number', `"${c.name}" says which version the editor opened on`);
  }
  for (const c of rules.filter((x) => x.action === 'signRoadRules')) {
    assert.ok(typeof c.version === 'number', `"${c.name}" says which version is on screen`);
  }
  const has = (action: string, test: (c: (typeof rules)[number]) => boolean) => rules.some((c) => c.action === action && test(c));
  assert.ok((fixture.roadRules ?? []).length >= 2, 'the fixture has versions');
  assert.ok(has('publishRoadRules', (c) => c.allowed && !c.noRoadRules), 'a publish on top of the current version');
  assert.ok(has('publishRoadRules', (c) => c.allowed && c.noRoadRules === true), 'a first version');
  // A clash: opened on a number that isn't the current (highest) one, whatever the numbers are.
  const current = Math.max(0, ...(fixture.roadRules ?? []).map((v) => v.number));
  assert.ok(has('publishRoadRules', (c) => !c.allowed && !c.noRoadRules && c.seen !== current), 'a clash');
  assert.ok(has('signRoadRules', (c) => c.allowed), 'a sign-off');
  assert.ok(has('signRoadRules', (c) => !c.allowed && c.noRoadRules === true), 'nothing to sign yet');
});

test('the Rusty Bus cases cover the spec’s eleven, with days counted from today', () => {
  const today = parityToday();
  const data = fixtureData([], today);
  const bus = fixture.cases.filter((c) => ['bookBus', 'decideBus', 'cancelBus'].includes(String(c.action)));
  for (const c of bus.filter((x) => x.action === 'bookBus')) {
    // Fixed dates would go stale: the database's today is the real Melbourne date.
    assert.ok(!('first' in c) && !('last' in c), `"${c.name}" counts its days from today`);
    assert.ok('firstDays' in c && 'lastDays' in c, `"${c.name}" has its days`);
  }
  for (const b of fixture.busBookings ?? []) {
    assert.ok(typeof b.firstDays === 'number' && typeof b.lastDays === 'number', `${b.key} counts its days from today`);
  }
  const me = (c: (typeof bus)[number]) => data.members.find((m) => m.id === c.as) ?? null;
  const straight = (c: (typeof bus)[number]) => {
    const r = resolveCase(c, today) as Record<string, unknown>;
    const input = {
      firstDay: String(r.first ?? ''), lastDay: String(r.last ?? ''), purpose: r.purpose as never, rideId: null, driverId: null, notes: '',
    };
    return bookedStraightAway(me(c), input, today, data);
  };
  const has = (action: string, what: string, test: (c: (typeof bus)[number]) => boolean) =>
    assert.ok(bus.some((c) => c.action === action && test(c)), what);
  const says = (message: string) => (c: (typeof bus)[number]) => !c.allowed && demoAnswer(c) === message;
  has('bookBus', 'book: a member asking', (c) => c.allowed && !straight(c));
  has('bookBus', 'book: a recovery booked straight away', (c) => c.allowed && c.purpose === 'recovery' && straight(c));
  has('bookBus', 'book: a clash on straight away', (c) => straight(c) && says(BUS_CLASH)(c));
  has('bookBus', 'book: a past start', says(BUS_PAST_START));
  has('bookBus', 'book: an FNG refused', (c) => me(c)?.status === 'fng' && says(NOT_BUS_BOOKER)(c));
  has('decideBus', 'decide: a yes', (c) => c.allowed && c.yes === true);
  has('decideBus', 'decide: a clashing yes', (c) => c.yes === true && says(BUS_CLASH)(c));
  has('decideBus', 'decide: a non-manager', says(NOT_BUS_MANAGER));
  const bookedBy = (key: unknown) => (fixture.busBookings ?? []).find((b) => b.key === key)?.bookedBy;
  has('cancelBus', 'cancel: by the booker', (c) => c.allowed && bookedBy(c.booking) === c.as);
  has('cancelBus', 'cancel: by a stranger', says(NOT_BUS_CANCELLER));
  has('cancelBus', 'cancel: already off', says(ALREADY_OFF));
});

for (const c of fixture.cases) {
  test(`demo: ${c.name} → ${c.allowed ? 'allowed' : 'refused'}`, () => {
    const refusal = demoAnswer(c);
    if (c.allowed) assert.equal(refusal, null, `refused: ${refusal}`);
    else assert.notEqual(refusal, null, 'was allowed');
  });
}
