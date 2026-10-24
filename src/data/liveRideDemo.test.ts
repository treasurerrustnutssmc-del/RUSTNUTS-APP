import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWarning } from '../domain/liveRide';
import type { ClubData, Member } from '../domain/types';
import { DEMO_DATA, demoTodayRide } from './demoData';
import { createDemoLiveBackend } from './liveRideDemo';

const NOW = new Date('2026-11-06T23:00:00.000Z');
const today = demoTodayRide(NOW);
const data: ClubData = { ...DEMO_DATA, rides: [...DEMO_DATA.rides, today] };
const who = (id: string) => data.members.find((m) => m.id === id) as Member;

function backend() {
  let me: Member | null = who('m-throttle');
  const b = createDemoLiveBackend(() => ({ data, me }), () => NOW.toISOString());
  return { b, as: (id: string) => (me = who(id)) };
}

const FIX = { lat: -37.77, lng: 144.75, accuracyM: 10, heading: null, speedKmh: null };

test('the demo ride is always on today, so live mode can be shown', () => {
  assert.equal(today.id, 'r-today');
  assert.ok(new Date(today.startsAt) < NOW && new Date(today.endsAt as string) > NOW);
});

test('demo live ride: same refusals as the database', async () => {
  const { b } = backend();
  await assert.rejects(b.start('r-1'), /Live ride opens 2 hours before the start\./);
  await assert.rejects(b.state('r-today'), /Share your location first\./);
});

test('demo live ride: made-up riders around you, and a split the leader sees', async () => {
  const { b, as } = backend();
  const stops = await b.start('r-today');
  assert.ok(new Date(stops) > NOW);
  const s = await b.update('r-today', FIX);
  assert.equal(s.riders.length, 5, 'me and four others');
  assert.ok(s.riders.some((r) => r.name === 'Diesel' && r.leader));
  assert.equal(s.riders.find((r) => r.name === 'Diesel')?.phone, '0438 555 377', 'a leader’s number shows');
  assert.equal(s.riders.find((r) => r.name === 'Throttle')?.phone, null, 'mine does not');
  assert.ok(splitWarning(s.riders, NOW.toISOString()), 'Chook is well back');
  as('m-diesel');
  await b.start('r-today');
  const d = await b.update('r-today', FIX);
  assert.equal(d.riders.filter((r) => r.name === 'Diesel').length, 1, 'no made-up copy of a real sharer');
});

test('demo live ride: alerts follow the same rules', async () => {
  const { b, as } = backend();
  await b.start('r-today');
  await b.update('r-today', FIX);
  await assert.rejects(b.raise('r-today', 'regroup', FIX), /Only ride leaders can set a regroup pin\./);
  const id = await b.raise('r-today', 'emergency', FIX);
  assert.equal(await b.raise('r-today', 'emergency', null), id, 'a resend is the same alert');
  assert.deepEqual((await b.state('r-today')).contacts, [], 'a plain rider sees no contacts');
  as('m-diesel');
  await b.start('r-today');
  const d = await b.state('r-today');
  assert.deepEqual(d.contacts.map((c) => c.name), ['Carol Barnes'], 'the leader sees Throttle’s contact');
  assert.equal(d.alerts[0].phone, '0409 555 826');
  await b.resolve(id);
  as('m-throttle');
  await assert.rejects(b.resolve(id), /Already cleared\./);
  await b.raise('r-today', 'out', FIX);
  await assert.rejects(b.state('r-today'), /Share your location first\./, 'dropping out stops sharing');
});

test('demo live ride: a resent press is the same alert, even once cleared', async () => {
  const { b } = backend();
  await b.start('r-today');
  const pressed = new Date(NOW.getTime() - 5 * 60_000).toISOString();
  const id = await b.raise('r-today', 'emergency', { lat: -37.77, lng: 144.75 }, pressed);
  await b.resolve(id);
  assert.equal(await b.raise('r-today', 'emergency', null, pressed), id);
  const s = await b.state('r-today');
  assert.equal(s.alerts.filter((a) => a.kind === 'emergency' && !a.resolvedAt).length, 0);
});
