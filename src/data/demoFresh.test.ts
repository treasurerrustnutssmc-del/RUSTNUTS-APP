// The demo club on every instant: built for the day it is opened, never for the machine clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClubData } from '../domain/types';
import { buildDemoData } from './demoData';
import { DEMO_DATA, INSTANTS, builtFor } from './demoStory.testkit';

test('the demo is built for the instant it is given, not for the machine clock', () => {
  const a = buildDemoData(new Date('2027-03-10T02:00:00.000Z'));
  const b = buildDemoData(new Date('2027-03-10T02:00:00.000Z'));
  assert.deepEqual(a, b);
  assert.notEqual(a, b); // a fresh object each time: the provider owns its copy
  assert.equal(a.checkinSessions!.find((s) => s.id === 'cs-today')!.heldOn, '2027-03-10');
  assert.equal(a.busBookings!.find((x) => x.id === 'bus-2')!.firstDay, '2027-03-10');
});

test('same ids, same order, same keys, whatever the instant', () => {
  const shape = (data: ClubData) => Object.fromEntries(Object.entries(data).map(([key, rows]) =>
    [key, Array.isArray(rows) ? rows.map((row, i) => (row as { id?: string }).id ?? i) : typeof rows]));
  for (const instant of INSTANTS) assert.deepEqual(shape(builtFor(instant)), shape(DEMO_DATA), instant);
  assert.equal(DEMO_DATA.rides.some((r) => r.id === 'r-today'), false);
});
