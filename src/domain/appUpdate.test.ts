import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAndUpdate, describeRunning, shortUpdateId, type UpdateApi } from './appUpdate';

test('shortUpdateId keeps the first 8 characters, upper case', () => {
  assert.equal(shortUpdateId('1a2b3c4d-5e6f-7a8b-9c0d-112233445566'), '1A2B3C4D');
});

test('describeRunning: a downloaded update shows its id and when it was published (Melbourne)', () => {
  const line = describeRunning({
    isEnabled: true,
    updateId: '1a2b3c4d-5e6f-7a8b-9c0d-112233445566',
    isEmbeddedLaunch: false,
    createdAt: new Date('2026-11-02T09:26:00Z'),
  });
  assert.equal(line, 'Update 1A2B3C4D · 02/11/2026 8:26 pm');
});

test('describeRunning: the build’s own code, and updates switched off', () => {
  assert.equal(describeRunning({ isEnabled: true, updateId: null, isEmbeddedLaunch: true, createdAt: null }), 'The build’s own code (no update yet)');
  assert.equal(describeRunning({ isEnabled: false, updateId: null, isEmbeddedLaunch: true, createdAt: null }), 'Updates don’t run in this version');
});

const fakeApi = (over: Partial<UpdateApi> & { calls?: string[] } = {}): UpdateApi & { calls: string[] } => {
  const calls = over.calls ?? [];
  return {
    calls,
    isEnabled: true,
    check: async () => {
      calls.push('check');
      return { isAvailable: false, isRollBackToEmbedded: false };
    },
    fetch: async () => {
      calls.push('fetch');
      return { isNew: true, isRollBackToEmbedded: false };
    },
    reload: async () => {
      calls.push('reload');
    },
    ...over,
  };
};

test('checkAndUpdate: nothing new says up to date and never downloads', async () => {
  const api = fakeApi();
  const steps: string[] = [];
  const out = await checkAndUpdate(api, (s) => steps.push(s));
  assert.deepEqual(out, { kind: 'current' });
  assert.deepEqual(api.calls, ['check']);
  assert.deepEqual(steps, ['checking']);
});

test('checkAndUpdate: a new update downloads, then restarts the app', async () => {
  const api = fakeApi({ check: async () => ({ isAvailable: true, isRollBackToEmbedded: false }) });
  const steps: string[] = [];
  const out = await checkAndUpdate(api, (s) => steps.push(s));
  assert.deepEqual(out, { kind: 'restarting' });
  assert.deepEqual(api.calls, ['fetch', 'reload']);
  assert.deepEqual(steps, ['checking', 'downloading', 'restarting']);
});

test('checkAndUpdate: a roll-back to the build’s own code also downloads and restarts', async () => {
  const api = fakeApi({
    check: async () => ({ isAvailable: false, isRollBackToEmbedded: true }),
    fetch: async () => ({ isNew: false, isRollBackToEmbedded: true }),
  });
  const out = await checkAndUpdate(api, () => {});
  assert.deepEqual(out, { kind: 'restarting' });
  assert.deepEqual(api.calls, ['reload']);
});

test('checkAndUpdate: a download that turns out not new says up to date, no restart', async () => {
  const api = fakeApi({
    check: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
    fetch: async () => ({ isNew: false, isRollBackToEmbedded: false }),
  });
  const out = await checkAndUpdate(api, () => {});
  assert.deepEqual(out, { kind: 'current' });
  assert.ok(!api.calls.includes('reload'));
});

test('checkAndUpdate: no signal gives a plain message, not the raw error', async () => {
  const api = fakeApi({
    check: async () => {
      throw new Error('java.net.UnknownHostException: u.expo.dev');
    },
  });
  const out = await checkAndUpdate(api, () => {});
  assert.deepEqual(out, { kind: 'failed', message: 'Couldn’t reach the update server. Check your signal and try again.' });
});

test('checkAndUpdate: switched off (web, dev) never calls the server', async () => {
  const api = fakeApi({ isEnabled: false });
  const out = await checkAndUpdate(api, () => {});
  assert.deepEqual(out, { kind: 'off' });
  assert.deepEqual(api.calls, []);
});
