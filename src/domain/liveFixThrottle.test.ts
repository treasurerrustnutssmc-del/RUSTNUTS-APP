import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIX_POST_GAP_MS, NO_POSTS, afterPost, beforePost, shouldPostFix } from './liveFixThrottle';

const T = 1_000_000;

test('the first fix of a share always posts', () => {
  assert.equal(shouldPostFix(NO_POSTS, T, false), true);
});

test('a fix is skipped while a post is in flight, and until 25 s after the last attempt', () => {
  const posting = beforePost(NO_POSTS, T);
  assert.equal(posting.inFlight, true);
  assert.equal(shouldPostFix(posting, T + 5_000, false), false);
  const landed = afterPost(posting);
  assert.equal(landed.inFlight, false);
  assert.equal(shouldPostFix(landed, T + FIX_POST_GAP_MS - 1, false), false);
  assert.equal(shouldPostFix(landed, T + FIX_POST_GAP_MS, false), true);
});

test('the gap counts from the attempt, so a post that failed is retried on the same clock', () => {
  const failed = afterPost(beforePost(NO_POSTS, T));
  assert.equal(failed.lastAttemptAt, T);
  assert.equal(shouldPostFix(failed, T + 10_000, false), false);
  assert.equal(shouldPostFix(failed, T + 30_000, false), true);
});

test('a queued alert or stop skips the gap, but still waits for the post in flight', () => {
  const posting = beforePost(NO_POSTS, T);
  assert.equal(shouldPostFix(posting, T + 1, true), false);
  assert.equal(shouldPostFix(afterPost(posting), T + 1, true), true);
});

test('the gap matches the iOS deferral so the two never fight', () => {
  assert.equal(FIX_POST_GAP_MS, 25_000);
});
