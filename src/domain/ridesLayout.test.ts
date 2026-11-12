import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIDE_TOOLS } from './ridesLayout';

test('the folded Rides tools name every place they hold', () => {
  assert.equal(RIDE_TOOLS.title, 'Ride tools');
  for (const w of ['route library', 'rusty bus', 'other clubs']) assert.ok(RIDE_TOOLS.summary.toLowerCase().includes(w), w);
});
