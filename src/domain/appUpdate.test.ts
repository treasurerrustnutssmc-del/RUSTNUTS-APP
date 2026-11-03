import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_CHECK_MS,
  NO_DOWNLOAD,
  NO_SIGNAL,
  REOPEN,
  RESUME_CHECK_GAP_MS,
  UPDATE_READY_ACTION,
  UPDATE_READY_TEXT,
  UPDATE_READY_TITLE,
  checkAndUpdate,
  describeRunning,
  fetchQuietly,
  restartNow,
  shortUpdateId,
  shouldCheckOnResume,
  statusLine,
  type UpdateApi,
} from './appUpdate';

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
  assert.equal(describeRunning({ isEnabled: true, updateId: null, isEmbeddedLaunch: true, createdAt: null }), 'Built-in version (no update yet)');
  assert.equal(describeRunning({ isEnabled: false, updateId: null, isEmbeddedLaunch: true, createdAt: null }), 'Updates are off in this version');
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
  });
  api.fetch = async () => {
    api.calls.push('fetch');
    return { isNew: false, isRollBackToEmbedded: true };
  };
  const out = await checkAndUpdate(api, () => {});
  assert.deepEqual(out, { kind: 'restarting' });
  assert.deepEqual(api.calls, ['fetch', 'reload']);
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
  assert.deepEqual(out, { kind: 'failed', message: NO_SIGNAL });
});

test('checkAndUpdate: switched off (web, dev) never calls the server', async () => {
  const api = fakeApi({ isEnabled: false });
  const out = await checkAndUpdate(api, () => {});
  assert.deepEqual(out, { kind: 'off' });
  assert.deepEqual(api.calls, []);
});

test('checkAndUpdate: a failed download says so, not “no signal”', async () => {
  const api = fakeApi({
    check: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
    fetch: async () => {
      throw new Error('asset hash mismatch');
    },
  });
  assert.deepEqual(await checkAndUpdate(api, () => {}), { kind: 'failed', message: NO_DOWNLOAD });
});

test('checkAndUpdate: downloaded but the restart fails says to reopen the app', async () => {
  const api = fakeApi({
    check: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
    reload: async () => {
      throw new Error('cannot find a reference to the JS runtime');
    },
  });
  assert.deepEqual(await checkAndUpdate(api, () => {}), { kind: 'downloaded' });
});

test('statusLine: every state fits one phone line (36 characters or fewer)', () => {
  const lines = [
    statusLine(null, null),
    statusLine('checking', null),
    statusLine('downloading', null),
    statusLine('restarting', null),
    statusLine(null, { kind: 'current' }),
    statusLine(null, { kind: 'failed', message: NO_SIGNAL }),
    statusLine(null, { kind: 'failed', message: NO_DOWNLOAD }),
    statusLine(null, { kind: 'downloaded' }),
    statusLine(null, { kind: 'off' }),
  ];
  assert.equal(statusLine(null, { kind: 'downloaded' }), REOPEN);
  for (const l of lines) assert.ok(l.length <= 37, `too long: ${l}`);
});

test('the check is held long enough to read', () => {
  assert.ok(MIN_CHECK_MS >= 600);
});

// "Update ready" strip: the update the phone fetched by itself (on opening, or on coming back to the
// front) is offered with one tap, instead of closing and opening the app twice.

test('shouldCheckOnResume: checks on the first return, then at most every 10 minutes', () => {
  const t0 = Date.parse('2026-11-03T03:00:00Z');
  assert.equal(shouldCheckOnResume(null, t0), true);
  assert.equal(shouldCheckOnResume(t0, t0 + RESUME_CHECK_GAP_MS - 1), false);
  assert.equal(shouldCheckOnResume(t0, t0 + RESUME_CHECK_GAP_MS), true);
  assert.ok(RESUME_CHECK_GAP_MS >= 5 * 60_000);
});

test('fetchQuietly: something new downloads and says so, without restarting', async () => {
  const api = fakeApi({ check: async () => ({ isAvailable: true, isRollBackToEmbedded: false }) });
  assert.equal(await fetchQuietly(api), true);
  assert.deepEqual(api.calls, ['fetch']);
});

test('fetchQuietly: nothing new, no signal or updates off all stay quiet', async () => {
  assert.equal(await fetchQuietly(fakeApi()), false);
  assert.equal(await fetchQuietly(fakeApi({ isEnabled: false })), false);
  const offline = fakeApi({
    check: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(await fetchQuietly(offline), false);
  const badDownload = fakeApi({
    check: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
    fetch: async () => {
      throw new Error('hash');
    },
  });
  assert.equal(await fetchQuietly(badDownload), false);
  assert.ok(!badDownload.calls.includes('reload'));
});

test('restartNow: restarts into the waiting update; a failed restart says to reopen', async () => {
  const api = fakeApi();
  assert.deepEqual(await restartNow(api), { kind: 'restarting' });
  assert.deepEqual(api.calls, ['reload']);
  const stuck = fakeApi({
    reload: async () => {
      throw new Error('no runtime');
    },
  });
  assert.deepEqual(await restartNow(stuck), { kind: 'downloaded' });
});

test('the strip’s words are short and say what one tap does', () => {
  assert.equal(UPDATE_READY_TITLE, 'Update ready');
  assert.equal(UPDATE_READY_ACTION, 'Restart');
  assert.ok(UPDATE_READY_TEXT.length <= 40);
});
