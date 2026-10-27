import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onThisDay, yearsAgoLabel, type DatedItem } from './onThisDay';

// Instants in UTC; Melbourne is UTC+11 in late October (daylight saving).
const item = (id: string, createdAt: string): DatedItem => ({ id, createdAt });

test('items from this day in earlier years, grouped newest year first, newest first within a year', () => {
  const items = [
    item('a', '2025-10-27T22:00:00.000Z'), // 28/10/2025 in Melbourne
    item('b', '2023-10-28T01:00:00.000Z'), // 28/10/2023
    item('c', '2025-10-28T05:00:00.000Z'), // 28/10/2025, later in the day
    item('d', '2025-10-27T10:00:00.000Z'), // 27/10/2025 in Melbourne: not today
    item('e', '2026-10-28T00:00:00.000Z'), // today: not an earlier year
    item('f', '2027-10-28T00:00:00.000Z'), // a future year: never
  ];
  const groups = onThisDay(items, '2026-10-28');
  assert.deepEqual(
    groups.map((g) => [g.date, g.yearsAgo, g.items.map((i) => i.id)]),
    [
      ['2025-10-28', 1, ['c', 'a']],
      ['2023-10-28', 3, ['b']],
    ],
  );
});

test('the Melbourne date decides, not the UTC one', () => {
  // 13:30 UTC on 27 October is 00:30 on 28 October in Melbourne.
  assert.equal(onThisDay([item('x', '2024-10-27T13:30:00.000Z')], '2026-10-28').length, 1);
  assert.equal(onThisDay([item('x', '2024-10-28T13:30:00.000Z')], '2026-10-28').length, 0);
});

test('29 February shows on 28 February in other years, and on the day in leap years', () => {
  const leapDay = item('l', '2024-02-29T02:00:00.000Z');
  const feb28 = item('m', '2023-02-28T02:00:00.000Z');
  assert.deepEqual(onThisDay([leapDay, feb28], '2027-02-28').map((g) => g.items[0].id), ['l', 'm']);
  assert.deepEqual(onThisDay([leapDay, feb28], '2028-02-29').map((g) => g.items[0].id), ['l']);
  assert.deepEqual(onThisDay([leapDay, feb28], '2028-02-28').map((g) => g.items[0].id), ['m']);
});

test('years-ago labels', () => {
  assert.equal(yearsAgoLabel(1), 'A year ago');
  assert.equal(yearsAgoLabel(4), '4 years ago');
});
