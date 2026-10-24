import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from './demoData';
import type { KeyValue } from './liveQueue';
import { createClubCache, isConnectionError, offlineText, startupUser } from './offlineCache';

function memoryStore(): KeyValue & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: async (k) => raw.get(k) ?? null,
    setItem: async (k, v) => void raw.set(k, v),
    removeItem: async (k) => void raw.delete(k),
  };
}

const SAVED = '2026-10-23T20:30:00.000Z';

test('the saved copy comes back for the same person', async () => {
  const cache = createClubCache(memoryStore());
  await cache.save('u-1', DEMO_DATA, SAVED);
  const got = await cache.load('u-1');
  assert.equal(got?.savedAt, SAVED);
  assert.equal(got?.data.members.length, DEMO_DATA.members.length);
});

test('never someone else’s copy on a shared phone', async () => {
  const cache = createClubCache(memoryStore());
  await cache.save('u-1', DEMO_DATA, SAVED);
  assert.equal(await cache.load('u-2'), null);
});

test('a broken or old-shaped copy is ignored', async () => {
  const store = memoryStore();
  const cache = createClubCache(store);
  store.raw.set('club.cache.v1', '{not json');
  assert.equal(await cache.load('u-1'), null);
  store.raw.set('club.cache.v1', JSON.stringify({ userId: 'u-1', savedAt: SAVED, data: { rides: [] } }));
  assert.equal(await cache.load('u-1'), null, 'no members list');
});

test('a copy saved before a new kind of data was added still loads, with that part empty', async () => {
  const store = memoryStore();
  const cache = createClubCache(store);
  const { rsvps: _gone, ...older } = DEMO_DATA;
  store.raw.set('club.cache.v1', JSON.stringify({ userId: 'u-1', savedAt: SAVED, data: older }));
  const got = await cache.load('u-1');
  assert.deepEqual(got?.data.rsvps, []);
});

test('clear empties it', async () => {
  const cache = createClubCache(memoryStore());
  await cache.save('u-1', DEMO_DATA, SAVED);
  await cache.clear();
  assert.equal(await cache.load('u-1'), null);
});

test('a phone whose storage fails never breaks the app', async () => {
  const broken: KeyValue = {
    getItem: async () => { throw new Error('disk'); },
    setItem: async () => { throw new Error('disk'); },
    removeItem: async () => { throw new Error('disk'); },
  };
  const cache = createClubCache(broken);
  await cache.save('u-1', DEMO_DATA, SAVED);
  assert.equal(await cache.load('u-1'), null);
  await cache.clear();
});

test('what the offline strip says', () => {
  assert.equal(offlineText(SAVED), 'Offline. Showing what was saved 24/10/2026 7:30 am.');
});

test('the last person signed in on this phone, for opening offline once their login has run out', async () => {
  const cache = createClubCache(memoryStore());
  assert.equal(await cache.lastUser(), null);
  await cache.save('u-1', DEMO_DATA, SAVED);
  assert.equal(await cache.lastUser(), 'u-1');
  await cache.clear();
  assert.equal(await cache.lastUser(), null, 'nobody once they sign out');
});

test('who the app opens as', () => {
  const offline = { message: 'Failed to fetch' };
  assert.equal(startupUser('u-1', null, 'u-2'), 'u-1', 'a good login wins');
  assert.equal(startupUser(null, offline, 'u-1'), 'u-1', 'login ran out with no signal: the person whose copy this is');
  assert.equal(startupUser(null, null, 'u-1'), null, 'signed out');
  assert.equal(startupUser(null, { message: 'Invalid Refresh Token' }, 'u-1'), null, 'a login refused by the club is signed out');
});

test('only a lost connection counts as offline', () => {
  assert.equal(isConnectionError({ message: 'TypeError: Failed to fetch' }), true);
  assert.equal(isConnectionError({ message: 'Network request failed' }), true);
  assert.equal(isConnectionError({ message: 'permission denied for table rides', code: '42501' }), false);
  assert.equal(isConnectionError({ message: 'Internal server error' }), false);
});
