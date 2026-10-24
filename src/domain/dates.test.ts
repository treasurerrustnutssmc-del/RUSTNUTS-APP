import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween,
  describeExpiry,
  expiryState,
  formatAuDate,
  formatLongDate,
  monthsBetween,
  parseAuDate,
  typeDate,
} from './dates';

test('reads Australian dates', () => {
  assert.equal(parseAuDate('8/11/2026'), '2026-11-08');
  assert.equal(parseAuDate('08-11-2026'), '2026-11-08');
  assert.equal(parseAuDate(' 29/02/2028 '), '2028-02-29'); // leap year
  assert.equal(parseAuDate('29/02/2027'), null);
  assert.equal(parseAuDate('31/04/2027'), null);
  assert.equal(parseAuDate('11/2026'), null);
  assert.equal(parseAuDate('2026-11-08'), null);
});

test('shows dates the Australian way', () => {
  assert.equal(formatAuDate('2026-11-08'), '08/11/2026');
  assert.equal(formatLongDate('2026-11-08'), '8 Nov 2026');
  assert.equal(formatAuDate(null), '');
});

test('counts days and months', () => {
  assert.equal(daysBetween('2026-10-24', '2026-11-08'), 15);
  assert.equal(daysBetween('2026-10-24', '2026-10-12'), -12);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(monthsBetween('2026-03-21', '2026-10-24'), 7);
  assert.equal(monthsBetween('2026-03-21', '2026-10-20'), 6);
});

test('flags expiries', () => {
  const today = '2026-10-24';
  assert.equal(expiryState('2026-10-12', today), 'expired');
  assert.equal(expiryState('2026-11-08', today), 'soon');
  assert.equal(expiryState('2026-11-23', today), 'soon'); // day 30
  assert.equal(expiryState('2026-11-24', today), 'ok');
  assert.equal(expiryState(null, today), 'missing');
  assert.equal(describeExpiry('2026-11-08', today), 'Expires in 15 days');
  assert.equal(describeExpiry('2026-10-12', today), 'Expired 12 Oct 2026');
  assert.equal(describeExpiry('2026-10-25', today), 'Expires tomorrow');
  assert.equal(describeExpiry('2027-03-02', today), 'Expires 2 Mar 2027');
});

test('typing a date on the number pad puts the slashes in for you', () => {
  assert.equal(typeDate(''), '');
  assert.equal(typeDate('0'), '0');
  assert.equal(typeDate('08'), '08');
  assert.equal(typeDate('081'), '08/1');
  assert.equal(typeDate('0811'), '08/11');
  assert.equal(typeDate('08112026'), '08/11/2026');
  assert.equal(typeDate('08/11/2026'), '08/11/2026', 'already formatted stays put');
  assert.equal(typeDate('08/11/20267'), '08/11/2026', 'no more than eight digits');
  assert.equal(typeDate('08/1'), '08/1', 'backspacing works digit by digit');
  assert.equal(typeDate('ab08x11'), '08/11', 'only digits count');
  assert.equal(typeDate('8/11/2026'), '8/11/2026', 'a pasted date with its own slashes is left alone');
  assert.equal(typeDate('08/1/2026'), '08/1/2026', 'deleting a digit in the middle doesn\'t shuffle the rest');
});
