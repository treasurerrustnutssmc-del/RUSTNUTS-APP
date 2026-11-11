import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MORE_FROM_CLUB } from './membersLayout';

test('the folded group names every place it holds, so nobody has to open it to know what is inside', () => {
  const words = ['chapters', 'history', 'who can help', 'swap and sell', 'garage builds', 'bragging rights'];
  for (const w of words) assert.ok(MORE_FROM_CLUB.summary.toLowerCase().includes(w), w);
  assert.equal(MORE_FROM_CLUB.title, 'More from the club');
});
