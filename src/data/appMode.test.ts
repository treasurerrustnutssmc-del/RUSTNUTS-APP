import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppMode } from './appMode';
import type { KeyValue } from './liveQueue';

function memoryStore(): KeyValue & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: async (k) => raw.get(k) ?? null,
    setItem: async (k, v) => void raw.set(k, v),
    removeItem: async (k) => void raw.delete(k),
  };
}

test('a phone starts on the live club', async () => {
  const mode = createAppMode(memoryStore(), true);
  await mode.load();
  assert.equal(mode.reviewing(), false);
  assert.equal(mode.liveDataOn(), true);
});

test('review mode turns the live database off, and stays on after the app is closed', async () => {
  const store = memoryStore();
  const mode = createAppMode(store, true);
  await mode.load();
  await mode.startReview();
  assert.equal(mode.reviewing(), true);
  assert.equal(mode.liveDataOn(), false);

  const reopened = createAppMode(store, true);
  assert.equal(reopened.liveDataOn(), false, 'nothing live before the saved mode is read');
  await reopened.load();
  assert.equal(reopened.reviewing(), true);
  assert.equal(reopened.liveDataOn(), false);
});

test('ending review mode goes back to the live club', async () => {
  const store = memoryStore();
  const mode = createAppMode(store, true);
  await mode.load();
  await mode.startReview();
  await mode.endReview();
  assert.equal(mode.liveDataOn(), true);
  const reopened = createAppMode(store, true);
  await reopened.load();
  assert.equal(reopened.reviewing(), false);
});

test('a demo build is never live, review mode or not', async () => {
  const mode = createAppMode(memoryStore(), false);
  await mode.load();
  assert.equal(mode.liveDataOn(), false);
});

test('listeners hear each change', async () => {
  const mode = createAppMode(memoryStore(), true);
  await mode.load();
  let heard = 0;
  const stop = mode.subscribe(() => heard++);
  await mode.startReview();
  await mode.endReview();
  stop();
  await mode.startReview();
  assert.equal(heard, 2);
});

test('a phone store that fails leaves the app on the live club', async () => {
  const broken: KeyValue = {
    getItem: async () => {
      throw new Error('disk');
    },
    setItem: async () => {
      throw new Error('disk');
    },
    removeItem: async () => {
      throw new Error('disk');
    },
  };
  const mode = createAppMode(broken, true);
  await mode.load();
  assert.equal(mode.liveDataOn(), true);
  await mode.startReview(); // still turns on for this run, even if it can't be kept
  assert.equal(mode.liveDataOn(), false);
});

test('the saved mode is read once, however many ask', async () => {
  const store = memoryStore();
  await store.setItem('app.review-mode.v1', '1');
  let reads = 0;
  const counting: KeyValue = { ...store, getItem: async (k) => (reads++, store.getItem(k)) };
  const mode = createAppMode(counting, true);
  await Promise.all([mode.load(), mode.load(), mode.load()]);
  assert.equal(reads, 1);
  assert.equal(mode.reviewing(), true);
});
