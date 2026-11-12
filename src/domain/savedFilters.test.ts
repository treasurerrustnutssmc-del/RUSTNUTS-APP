import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFilters, saveFilters, sameColours, type FilterStorage } from './savedFilters';

const memory = (): FilterStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
};

test('nothing saved gives no filters', async () => {
  assert.deepEqual(await readFilters(memory(), 'm1'), {});
});

test('what you choose comes back next time, and saving one filter keeps the other', async () => {
  const s = memory();
  await saveFilters(s, 'm1', { rideColours: ['west', 'club'] });
  await saveFilters(s, 'm1', { memberChapter: 'ch-north' });
  assert.deepEqual(await readFilters(s, 'm1'), { rideColours: ['west', 'club'], memberChapter: 'ch-north' });
});

test('each member on a shared phone keeps their own', async () => {
  const s = memory();
  await saveFilters(s, 'm1', { memberChapter: 'ch-north' });
  assert.deepEqual(await readFilters(s, 'm2'), {});
});

test('a broken or old copy is ignored, and unknown ride colours are dropped', async () => {
  const s = memory();
  s.data.set('filters:m1', '{not json');
  assert.deepEqual(await readFilters(s, 'm1'), {});
  s.data.set('filters:m1', JSON.stringify({ rideColours: ['west', 'purple'], memberChapter: 42 }));
  assert.deepEqual(await readFilters(s, 'm1'), { rideColours: ['west'] });
});

test('a phone whose storage fails never breaks the screen', async () => {
  const bad: FilterStorage = { getItem: async () => { throw new Error('no storage'); }, setItem: async () => { throw new Error('no storage'); } };
  assert.deepEqual(await readFilters(bad, 'm1'), {});
  await saveFilters(bad, 'm1', { memberChapter: 'x' });
});

test('choosing no colours at all is a real choice and is kept', async () => {
  const st = memory();
  await saveFilters(st, 'm1', { rideColours: [] });
  assert.deepEqual(await readFilters(st, 'm1'), { rideColours: [] });
});

test('two colour lists are the same whatever their order', () => {
  assert.equal(sameColours(['west', 'club'], ['club', 'west']), true);
  assert.equal(sameColours(['west'], ['west', 'club']), false);
  assert.equal(sameColours([], []), true);
});
