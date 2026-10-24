import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPickGuard } from './pickGuard';

test('one pick at a time: a second tap while picking is ignored', () => {
  const seen: boolean[] = [];
  const guard = createPickGuard((busy) => seen.push(busy));
  const first = guard.start();
  assert.notEqual(first, null);
  assert.equal(guard.start(), null, 'a double tap does not start a second pick');
  assert.equal(guard.busy, true);
  guard.release(first!);
  assert.equal(guard.busy, false);
  assert.deepEqual(seen, [true, false]);
  assert.notEqual(guard.start(), null, 'free again once the pick settles');
});

test('a stale pick settling late does not free a newer one', () => {
  const guard = createPickGuard(() => {});
  const old = guard.start()!;
  guard.release(old); // released early, as the web does on the next window focus
  const fresh = guard.start()!;
  guard.release(old); // the old pick's promise settles at last
  assert.equal(guard.busy, true, 'the fresh pick is still guarded');
  guard.release(fresh);
  assert.equal(guard.busy, false);
});

test('releasing twice is harmless', () => {
  const seen: boolean[] = [];
  const guard = createPickGuard((busy) => seen.push(busy));
  const t = guard.start()!;
  guard.release(t);
  guard.release(t);
  assert.deepEqual(seen, [true, false]);
});
