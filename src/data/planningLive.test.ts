import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allRows, callRideArgs } from './planningLive';

test('a table longer than one page is read in full, page by page', async () => {
  const table = Array.from({ length: 2345 }, (_, i) => i);
  const asked: [number, number][] = [];
  const r = await allRows(async (from, to) => {
    asked.push([from, to]);
    return { data: table.slice(from, to + 1), error: null };
  });
  assert.equal(r.data?.length, 2345);
  assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('an error on any page is the result', async () => {
  const r = await allRows(async (from) => (from === 0 ? { data: Array(1000).fill(0), error: null } : { data: null, error: { message: 'boom', code: 'X' } }));
  assert.equal(r.error?.message, 'boom');
});

test('a call sends the new day as given, so the database refuses one on the wrong state in its own words', () => {
  assert.deepEqual(callRideArgs('r', 'off', ' Rain ', '2026-11-15'), { p_ride: 'r', p_state: 'off', p_reason: 'Rain', p_new_day: '2026-11-15' });
  assert.deepEqual(callRideArgs('r', 'on', 'x', null), { p_ride: 'r', p_state: 'on', p_reason: null, p_new_day: null });
});
