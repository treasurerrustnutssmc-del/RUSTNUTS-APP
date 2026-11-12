import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POSTING_RULES_SUMMARY } from './postingRules';

test('the in-short summary has four short points', () => {
  assert.equal(POSTING_RULES_SUMMARY.length, 4);
  for (const p of POSTING_RULES_SUMMARY) assert.ok(p.length > 20 && p.length <= 170, p);
});

test('the summary says what the full rules say: banter is fine, reporting within 24 hours, blocking, and your own posts', () => {
  const all = POSTING_RULES_SUMMARY.join(' ');
  for (const bit of ['Banter is fine', 'Report', '24 hours', 'block', 'responsible', 'can be removed']) assert.ok(all.includes(bit), bit);
});

test('the summary uses no em dashes', () => {
  assert.ok(!POSTING_RULES_SUMMARY.join(' ').includes('—'));
});

test('the summary does not promise more than the full rules do (they say the club can remove a post, not that it always does)', () => {
  const all = POSTING_RULES_SUMMARY.join(' ');
  assert.ok(!/is removed/.test(all));
  assert.ok(!/Every post/.test(all), 'the full rules list what has a Report button; do not shorten it to every post');
});
