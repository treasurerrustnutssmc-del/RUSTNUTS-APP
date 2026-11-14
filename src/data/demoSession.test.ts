// One demo instant per session: read lazily, kept until the mode changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSession } from './demoSession';

test('one instant per session; a mode change starts a new one', () => {
  const listeners: (() => void)[] = [];
  const clock = [new Date('2026-11-14T02:00:00.000Z'), new Date('2026-11-17T02:00:00.000Z')];
  let reads = 0;
  const session = createDemoSession((l) => listeners.push(l), () => clock[reads++]);
  assert.equal(reads, 0, 'nothing is read until someone asks');
  assert.equal(session.now().toISOString(), '2026-11-14T02:00:00.000Z');
  assert.equal(session.now(), session.now());
  assert.equal(reads, 1);
  listeners.forEach((l) => l());
  assert.equal(reads, 1, 'still lazy after a mode change');
  assert.equal(session.now().toISOString(), '2026-11-17T02:00:00.000Z');
});
