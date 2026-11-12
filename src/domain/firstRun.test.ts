import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRST_RUN_STEPS, hasSeenFirstRun, markFirstRunSeen, resetFirstRun } from './firstRun';
import type { FilterStorage } from './savedFilters';

const memory = (): FilterStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
};

test('the guide points at the four tabs a new member uses, in a line each', () => {
  assert.deepEqual(FIRST_RUN_STEPS.map((s) => s.title), ['Rides', 'Chat', 'Members', 'Me']);
  for (const s of FIRST_RUN_STEPS) assert.ok(s.text.length > 20 && s.text.length <= 110, s.title);
});

test('it shows until it is dismissed, then not again, and each member has their own', async () => {
  const s = memory();
  assert.equal(await hasSeenFirstRun(s, 'm1'), false);
  await markFirstRunSeen(s, 'm1');
  assert.equal(await hasSeenFirstRun(s, 'm1'), true);
  assert.equal(await hasSeenFirstRun(s, 'm2'), false);
});

test('Help can bring it back', async () => {
  const s = memory();
  await markFirstRunSeen(s, 'm1');
  await resetFirstRun(s, 'm1');
  assert.equal(await hasSeenFirstRun(s, 'm1'), false);
});

test('a phone whose storage fails shows nothing rather than nagging or breaking', async () => {
  const bad: FilterStorage = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('x'); } };
  assert.equal(await hasSeenFirstRun(bad, 'm1'), true);
  await markFirstRunSeen(bad, 'm1');
});
