import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRST_RUN_STEPS, firstRunSteps, hasSeenFirstRun, isRecentMember, markFirstRunSeen, resetFirstRun } from './firstRun';
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
  assert.equal(await hasSeenFirstRun(s, 'm1', true), false);
  await markFirstRunSeen(s, 'm1');
  assert.equal(await hasSeenFirstRun(s, 'm1', true), true);
  assert.equal(await hasSeenFirstRun(s, 'm2', true), false);
});

test('Help can bring it back', async () => {
  const s = memory();
  await markFirstRunSeen(s, 'm1');
  await resetFirstRun(s, 'm1');
  assert.equal(await hasSeenFirstRun(s, 'm1', true), false);
});

test('a phone whose storage fails shows nothing rather than nagging or breaking', async () => {
  const bad: FilterStorage = { getItem: async () => { throw new Error('x'); }, setItem: async () => { throw new Error('x'); } };
  assert.equal(await hasSeenFirstRun(bad, 'm1', true), true);
  await markFirstRunSeen(bad, 'm1');
});

test('long-standing members are not shown it unprompted, but Help can still bring it back for them', async () => {
  const s = memory();
  assert.equal(await hasSeenFirstRun(s, 'old', false), true, 'a veteran who never saw it is treated as having seen it');
  await resetFirstRun(s, 'old');
  assert.equal(await hasSeenFirstRun(s, 'old', false), false, 'asking for the tour shows it');
});

test('a member counts as new for 60 days after joining, and one with no join date counts as new', () => {
  assert.equal(isRecentMember('2026-11-01', '2026-11-12'), true);
  assert.equal(isRecentMember('2026-09-14', '2026-11-12'), true);
  assert.equal(isRecentMember('2026-09-01', '2026-11-12'), false);
  assert.equal(isRecentMember(null, '2026-11-12'), true);
});

test('a board member also gets a line about the Board, before Me; everyone else sees the four', () => {
  assert.deepEqual(firstRunSteps(false).map((s) => s.title), ['Rides', 'Chat', 'Members', 'Me']);
  assert.deepEqual(firstRunSteps(true).map((s) => s.title), ['Rides', 'Chat', 'Members', 'Board', 'Me']);
  assert.ok(firstRunSteps(true).find((s) => s.title === 'Board')!.text.includes('Needs you'));
});
