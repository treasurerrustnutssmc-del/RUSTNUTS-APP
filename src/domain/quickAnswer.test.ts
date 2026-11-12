import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canQuickAnswer } from './quickAnswer';
import { club, member, ride } from './stage4.testkit';

const today = '2026-11-12';
const now = '2026-11-12T00:00:00.000Z';

const data = (r = ride('r1')) => club({ members: [member('rider')], rides: [r] });
const me = (d: ReturnType<typeof data>) => d.members[0];

test('a coming ride that takes answers can be answered in one tap from Home', () => {
  const d = data(ride('r1', { startsAt: '2026-11-20T00:00:00.000Z' }));
  assert.equal(canQuickAnswer(me(d), d.rides[0], d, today, now), true);
});

test('a cancelled ride cannot', () => {
  const d = data(ride('r1', { startsAt: '2026-11-20T00:00:00.000Z', cancelledAt: '2026-11-10T00:00:00.000Z' }));
  assert.equal(canQuickAnswer(me(d), d.rides[0], d, today, now), false);
});

test('a ride that has already started cannot', () => {
  const d = data(ride('r1', { startsAt: '2026-11-11T00:00:00.000Z' }));
  assert.equal(canQuickAnswer(me(d), d.rides[0], d, today, now), false);
});
