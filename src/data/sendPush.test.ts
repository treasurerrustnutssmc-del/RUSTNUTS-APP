import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, deadTokens, sendAll, toExpoMessages, type OutboxMessage } from '../../supabase/functions/_shared/sendPush';
import { soundFor } from '../domain/notifications';

const row = (over: Partial<OutboxMessage> = {}): OutboxMessage => ({
  id: 1, title: 'Ride cancelled', body: 'West run · Sat 07/11/2026', data: { kind: 'ride', rideId: 'r1' },
  tokens: ['ExponentPushToken[a]', 'ExponentPushToken[b]'], ...over,
});

test('one message per phone, all sent high priority so a sleeping Android shows them straight away; live ride alerts use the alerts channel', () => {
  const msgs = toExpoMessages([row(), row({ id: 2, title: 'EMERGENCY: Rusty needs help', data: { kind: 'live-alert', rideId: 'r2' }, tokens: ['ExponentPushToken[c]'] })]);
  assert.equal(msgs.length, 3);
  assert.deepEqual(msgs[0], {
    to: 'ExponentPushToken[a]', title: 'Ride cancelled', body: 'West run · Sat 07/11/2026', sound: 'v_twin_rev.wav',
    channelId: 'club-rev', data: { kind: 'ride', rideId: 'r1' }, priority: 'high', outboxId: 1,
  });
  assert.equal(msgs[2].priority, 'high');
  assert.equal(msgs[2].channelId, 'ride-alerts');
  assert.equal(msgs[2].sound, 'default');
});

test('the Harley rev follows the member’s setting, except on live ride alerts, and matches the phone’s channels', () => {
  const [off] = toExpoMessages([row({ rev: false, tokens: ['t'] })]);
  assert.deepEqual([off.channelId, off.sound], ['club', 'default']);
  const [alertOn] = toExpoMessages([row({ rev: true, data: { kind: 'live-alert' }, tokens: ['t'] })]);
  assert.deepEqual([alertOn.channelId, alertOn.sound], ['ride-alerts', 'default']);
  for (const rev of [true, false, undefined]) {
    for (const kind of ['ride', 'applicant', 'chat', 'live-alert']) {
      const [m] = toExpoMessages([row({ rev, data: { kind }, tokens: ['t'] })]);
      const as = kind === 'live-alert' || kind === 'chat' ? kind : 'club';
      assert.deepEqual({ channelId: m.channelId, sound: m.sound }, soundFor(as, rev ?? true), `${kind} ${rev}`);
    }
  }
});

test('sent 100 at a time (Expo’s limit)', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(chunk(Array.from({ length: 250 }, (_, i) => i), 100).length, 3);
});

test('tokens Expo says are gone get removed', () => {
  const msgs = toExpoMessages([row()]);
  const tickets = [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }];
  assert.deepEqual(deadTokens(msgs, tickets), ['ExponentPushToken[b]']);
  assert.deepEqual(deadTokens(msgs, [{ status: 'error', details: { error: 'MessageRateExceeded' } }, { status: 'ok' }]), []);
});

test('switch off: nothing is posted', async () => {
  let posted = 0;
  const result = await sendAll({
    take: async () => ({ enabled: false, messages: [] }),
    post: async () => { posted++; return []; },
    done: async () => {},
  });
  assert.deepEqual(result, { enabled: false, sent: 0, failed: 0 });
  assert.equal(posted, 0);
});

test('switch on: posts, then records what went, what failed and dead phones', async () => {
  const done: unknown[] = [];
  const result = await sendAll({
    take: async () => ({ enabled: true, messages: [row(), row({ id: 2, tokens: ['ExponentPushToken[c]'] })] }),
    post: async (batch) => batch.map((m) => (m.to === 'ExponentPushToken[b]' ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })),
    done: async (sent, failed, dead) => { done.push({ sent, failed, dead }); },
  });
  assert.deepEqual(result, { enabled: true, sent: 2, failed: 0 });
  assert.deepEqual(done, [{ sent: [1, 2], failed: [], dead: ['ExponentPushToken[b]'] }]);
});

test('a row counts as sent if any of its phones got it; a failed post fails the whole batch', async () => {
  const done: { sent: number[]; failed: number[] }[] = [];
  await sendAll({
    take: async () => ({ enabled: true, messages: [row({ tokens: ['ExponentPushToken[x]'] })] }),
    post: async () => { throw new Error('Expo is down'); },
    done: async (sent, failed) => { done.push({ sent, failed }); },
  });
  assert.deepEqual(done, [{ sent: [], failed: [1] }]);
});
