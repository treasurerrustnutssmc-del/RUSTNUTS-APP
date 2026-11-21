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
    to: 'ExponentPushToken[a]', title: 'Ride cancelled', body: 'West run · Sat 07/11/2026', sound: 'v_twin_rev_2.wav',
    channelId: 'club-rev2', data: { kind: 'ride', rideId: 'r1' }, priority: 'high', outboxId: 1,
  });
  assert.equal(msgs[2].priority, 'high');
  assert.equal(msgs[2].channelId, 'ride-alerts');
  assert.equal(msgs[2].sound, 'default');
});

test('only live ride alerts are time-sensitive on iPhone, so they break through Focus; club news and chat stay ordinary', () => {
  const [alert] = toExpoMessages([row({ data: { kind: 'live-alert', rideId: 'r2' }, tokens: ['t'] })]);
  assert.equal(alert.interruptionLevel, 'time-sensitive');
  for (const kind of ['ride', 'applicant', 'chat', undefined]) {
    const [m] = toExpoMessages([row({ data: { kind }, tokens: ['t'] })]);
    assert.equal('interruptionLevel' in m, false, `${kind}`);
  }
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

test('chat stacks one notification per chat, like Messenger: each new one replaces the last for that chat on both phones', () => {
  const [a, b] = toExpoMessages([
    row({ id: 1, data: { kind: 'chat', chatId: 'c1' }, tokens: ['t'] }),
    row({ id: 2, data: { kind: 'chat', chatId: 'c2' }, tokens: ['t'] }),
  ]);
  assert.deepEqual([a.tag, a.collapseId], ['chat-c1', 'chat-c1']);
  assert.deepEqual([b.tag, b.collapseId], ['chat-c2', 'chat-c2']);
  for (const data of [{ kind: 'ride', rideId: 'r1' }, { kind: 'live-alert', rideId: 'r2' }, { kind: 'chat' }]) {
    const [m] = toExpoMessages([row({ data, tokens: ['t'] })]);
    assert.equal('tag' in m || 'collapseId' in m, false, `${JSON.stringify(data)} keeps one notification each`);
  }
});

test('when a round holds several pushes for the same chat and phone, only the newest goes (it holds the whole stack); the rest count as sent with it', async () => {
  const posted: { title: string; to: string }[] = [];
  const result = await sendAll({
    take: async () => ({ enabled: true, messages: [
      row({ id: 1, title: 'one', data: { kind: 'chat', chatId: 'c1' }, tokens: ['a'] }),
      row({ id: 2, title: 'ride', data: { kind: 'ride', rideId: 'r1' }, tokens: ['a'] }),
      row({ id: 3, title: 'two', data: { kind: 'chat', chatId: 'c1' }, tokens: ['a'] }),
      row({ id: 4, title: 'other chat', data: { kind: 'chat', chatId: 'c2' }, tokens: ['a'] }),
      row({ id: 5, title: 'someone else', data: { kind: 'chat', chatId: 'c1' }, tokens: ['b'] }),
    ] }),
    post: async (batch) => { posted.push(...batch.map((m) => ({ title: m.title, to: m.to }))); return batch.map(() => ({ status: 'ok' })); },
    done: async (sent, failed) => { assert.deepEqual([sent, failed], [[1, 2, 3, 4, 5], []]); },
  });
  assert.deepEqual(posted.map((p) => p.title), ['ride', 'two', 'other chat', 'someone else']);
  assert.equal(result.sent, 5);
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
