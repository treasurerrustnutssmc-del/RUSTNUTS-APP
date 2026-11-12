import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLUB_NUMBERS, showProfileCard } from './homeLayout';

test('the profile card shows only while something is left to do', () => {
  assert.equal(showProfileCard(3, 5), true);
  assert.equal(showProfileCard(5, 5), false, 'all done: it takes a card for nothing');
  assert.equal(showProfileCard(0, 0), false);
});

test('the club numbers are one folded group with a plain summary', () => {
  assert.equal(CLUB_NUMBERS.title, 'The club in numbers');
  assert.match(CLUB_NUMBERS.summary, /chapter/i);
});
