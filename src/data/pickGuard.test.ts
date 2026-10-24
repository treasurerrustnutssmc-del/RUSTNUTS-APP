import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPickGuard, releaseAfterReturn, RETURN_GRACE_MS, type ReturnWatch } from './pickGuard';

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

/** A stand-in window: focus fired by hand, a clock moved by hand, and a count of file choices. */
function fakeWindow() {
  let now = 0;
  let focusFns: (() => void)[] = [];
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const w = {
    changes: 0,
    env: {
      onFocusOnce(fn: () => void) {
        focusFns.push(fn);
        return () => {
          focusFns = focusFns.filter((f) => f !== fn);
        };
      },
      changes: () => w.changes,
      setTimeout(fn: () => void, ms: number) {
        const id = nextId++;
        timers.push({ at: now + ms, fn, id });
        return id;
      },
      clearTimeout(id: unknown) {
        timers = timers.filter((t) => t.id !== id);
      },
    } satisfies ReturnWatch,
    focus() {
      const fns = focusFns;
      focusFns = [];
      fns.forEach((f) => f());
    },
    advance(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      due.forEach((t) => t.fn());
    },
    get pending() {
      return timers.length + focusFns.length;
    },
  };
  return w;
}

test('web: the window getting focus back frees the pick a moment later, when no file came', () => {
  const w = fakeWindow();
  let released = 0;
  releaseAfterReturn(w.env, () => released++);
  w.advance(1000);
  assert.equal(released, 0, 'nothing before focus');
  w.focus();
  w.advance(RETURN_GRACE_MS - 1);
  assert.equal(released, 0, 'not straight away: the file may still be on its way');
  w.advance(1);
  assert.equal(released, 1);
  w.focus();
  w.advance(1000);
  assert.equal(released, 1, 'once only');
});

test('web: a file arriving just after focus keeps the guard until the pick itself settles', () => {
  const w = fakeWindow();
  let released = 0;
  releaseAfterReturn(w.env, () => released++);
  w.focus(); // some browsers give focus back before the input's change
  w.advance(50);
  w.changes++;
  w.advance(1000);
  assert.equal(released, 0);
});

test('web: a file chosen before focus also keeps the guard', () => {
  const w = fakeWindow();
  let released = 0;
  releaseAfterReturn(w.env, () => released++);
  w.changes++;
  w.focus();
  w.advance(1000);
  assert.equal(released, 0);
});

test('web: a choice from an earlier pick does not count for this one', () => {
  const w = fakeWindow();
  w.changes = 3;
  let released = 0;
  releaseAfterReturn(w.env, () => released++);
  w.focus();
  w.advance(RETURN_GRACE_MS);
  assert.equal(released, 1);
});

test('web: stopping the watch before the moment is up cancels it, and leaves nothing behind', () => {
  const w = fakeWindow();
  let released = 0;
  const stop = releaseAfterReturn(w.env, () => released++);
  w.focus();
  w.advance(100);
  stop();
  w.advance(1000);
  assert.equal(released, 0);
  assert.equal(w.pending, 0, 'no timer or listener left');
  const stopEarly = releaseAfterReturn(w.env, () => released++);
  stopEarly();
  assert.equal(w.pending, 0, 'the focus listener goes too');
});
