// The demo club on every instant: built for the day it is opened, never for the machine clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClubData } from '../domain/types';
import { buildDemoData, demoTodayRide } from './demoData';
import { DEMO_DATA, INSTANTS, builtFor } from './demoStory.testkit';

test('the demo is built for the instant it is given, not for the machine clock', () => {
  const a = buildDemoData(new Date('2027-03-10T02:00:00.000Z'));
  const b = buildDemoData(new Date('2027-03-10T02:00:00.000Z'));
  assert.deepEqual(a, b);
  assert.notEqual(a, b); // a fresh object each time: the provider owns its copy
  assert.equal(a.checkinSessions!.find((s) => s.id === 'cs-today')!.heldOn, '2027-03-10');
  assert.equal(a.busBookings!.find((x) => x.id === 'bus-2')!.firstDay, '2027-03-10');
});

test('building the demo never reads the machine clock', () => {
  // A Date that throws on the two ways to read the clock: `new Date()` with nothing, and `Date.now()`.
  // Built for every instant, since a clock read can hide on an arm that only runs on some days.
  const RealDate = Date;
  class NoClock extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) throw new Error('read the machine clock: new Date()');
      super(...(args as [number]));
    }
    static now(): number { throw new Error('read the machine clock: Date.now()'); }
  }
  // The Dates are made before the clock is taken away.
  const nows = INSTANTS.map((instant) => ({ instant, now: new RealDate(instant) }));
  globalThis.Date = NoClock as DateConstructor;
  try {
    for (const { instant, now } of nows) {
      assert.doesNotThrow(() => buildDemoData(now), `buildDemoData for ${instant}`);
      assert.doesNotThrow(() => demoTodayRide(now), `demoTodayRide for ${instant}`);
    }
  } finally {
    globalThis.Date = RealDate;
  }
});

test('same ids, same order, same keys, whatever the instant', () => {
  const shape = (data: ClubData) => Object.fromEntries(Object.entries(data).map(([key, rows]) =>
    [key, Array.isArray(rows) ? rows.map((row, i) => (row as { id?: string }).id ?? i) : typeof rows]));
  for (const instant of INSTANTS) assert.deepEqual(shape(builtFor(instant)), shape(DEMO_DATA), instant);
  assert.equal(DEMO_DATA.rides.some((r) => r.id === 'r-today'), false);
});
