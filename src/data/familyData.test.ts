import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from './demoData';
import { forFamily } from './familyData';

const kerry = DEMO_DATA.members.find((m) => m.id === 'm-kerry')!;

test('family get the chapters, the rides and their own records, nothing else', () => {
  const view = forFamily(DEMO_DATA, kerry);
  assert.deepEqual(view.chapters, DEMO_DATA.chapters);
  assert.deepEqual(view.rides, DEMO_DATA.rides);
  assert.deepEqual(view.members.map((m) => m.id), ['m-kerry']);
  assert.ok(view.privates.every((p) => p.memberId === 'm-kerry'));
  assert.ok(view.privates.length > 0);
  assert.ok(view.emergencyContacts.every((c) => c.memberId === 'm-kerry'));
  assert.ok(view.bikes.every((b) => b.memberId === 'm-kerry'));
  assert.ok(view.registrations.every((r) => view.bikes.some((b) => b.id === r.bikeId)));
});

test('family see no answers, crew, positions, money, business or conduct', () => {
  const view = forFamily(DEMO_DATA, kerry);
  assert.equal(view.rsvps.length, 0);
  assert.equal(view.positions.length, 0);
  assert.equal((view.crew ?? []).length, 0);
  assert.equal((view.briefings ?? []).length, 0);
  assert.equal((view.charges ?? []).length, 0);
  assert.equal((view.attendance ?? []).length, 0);
  assert.equal((view.checkinSessions ?? []).length, 0);
  assert.equal((view.meetings ?? []).length, 0);
  assert.equal((view.votes ?? []).length, 0);
  assert.equal((view.documents ?? []).length, 0);
  assert.equal((view.conduct ?? []).length, 0);
  assert.equal((view.ledger ?? []).length, 0);
  assert.equal(view.unclaimedRoster, undefined);
});
