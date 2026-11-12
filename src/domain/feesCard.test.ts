import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feesCardMode } from './feesCard';

const today = '2026-11-12';

test('an overdue fee gets the full card', () => {
  assert.equal(feesCardMode('2026-11-01', today), 'full');
});

test('a fee due within 30 days gets the full card', () => {
  assert.equal(feesCardMode('2026-11-12', today), 'full', 'due today');
  assert.equal(feesCardMode('2026-12-12', today), 'full', '30 days away');
});

test('a fee that is not due for a while is one calm row, not a big card', () => {
  assert.equal(feesCardMode('2026-12-13', today), 'compact', '31 days away');
  assert.equal(feesCardMode('2026-12-31', today), 'compact');
});
