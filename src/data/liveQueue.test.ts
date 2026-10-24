import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertNotice, createAlertQueue, drainQueue, queueAlert, smsUrl, unseenAlerts, type QueuedAlert } from './liveQueue';
import type { RideAlert } from '../domain/types';

const alert = (over: Partial<RideAlert> = {}): RideAlert => ({
  id: 'a-1', rideId: 'r-1', memberId: 'm-rusty', kind: 'emergency', name: 'Rusty', position: { lat: -37.83, lng: 144.9 },
  phone: null, createdAt: '2026-11-06T22:42:00.000Z', resolvedAt: null, ...over,
});

test('only new alerts from other riders raise a notification', () => {
  const alerts = [
    alert(),
    alert({ id: 'a-2', memberId: 'm-me' }),
    alert({ id: 'a-3', resolvedAt: '2026-11-06T22:50:00.000Z' }),
    alert({ id: 'a-4', kind: 'out' }),
  ];
  assert.deepEqual(unseenAlerts(['a-4'], alerts, 'm-me').map((a) => a.id), ['a-1']);
});

test('what the notification says', () => {
  const me = { lat: -37.811, lng: 144.9 };
  assert.deepEqual(alertNotice(alert(), me), { title: 'EMERGENCY: Rusty needs help', body: '2.1 km S · 9:42 am' });
  assert.deepEqual(alertNotice(alert({ kind: 'out' }), me), { title: 'Rusty has dropped out', body: '2.1 km S · 9:42 am' });
  assert.deepEqual(alertNotice(alert({ kind: 'regroup' }), me), { title: 'Regroup here', body: '2.1 km S · 9:42 am' });
  assert.deepEqual(alertNotice(alert({ position: null }), me), { title: 'EMERGENCY: Rusty needs help', body: 'Location unknown · 9:42 am' });
  assert.deepEqual(alertNotice(alert(), null), { title: 'EMERGENCY: Rusty needs help', body: 'Location unknown · 9:42 am' });
});

const item = (over: Partial<QueuedAlert> = {}): QueuedAlert => ({
  rideId: 'r-1', kind: 'emergency', at: null, queuedAt: '2026-11-06T22:42:00.000Z', ...over,
});

test('alerts raised with no signal wait, once each, until they send', async () => {
  let q = queueAlert([], item());
  q = queueAlert(q, item({ at: { lat: 1, lng: 2 }, queuedAt: '2026-11-06T22:43:00.000Z' }));
  assert.equal(q.length, 1, 'pressing again replaces the waiting one');
  assert.deepEqual(q[0].at, { lat: 1, lng: 2 });
  assert.equal(q[0].queuedAt, '2026-11-06T22:42:00.000Z', 'but keeps when it was first pressed');
  q = queueAlert(q, item({ kind: 'out' }));
  assert.equal(q.length, 2);

  const sent: string[] = [];
  const { left, refused } = await drainQueue(q, async (a) => {
    if (a.kind === 'out') throw new Error('No connection. Check your signal and try again.');
    sent.push(a.kind);
  });
  assert.deepEqual(sent, ['emergency']);
  assert.deepEqual(left.map((a) => a.kind), ['out'], 'a failure stays queued');
  assert.deepEqual(refused, []);
});

test('an alert the club refuses for good is handed back, never dropped quietly', async () => {
  const { left, refused } = await drainQueue([item()], async () => {
    throw new Error('This ride’s finished.');
  });
  assert.deepEqual(left, []);
  assert.deepEqual(refused.map((r) => [r.item.kind, r.reason]), [['emergency', 'This ride’s finished.']]);
});

test('not signed in yet (the app is still starting) is worth another go', async () => {
  const { left } = await drainQueue([item()], async () => {
    throw new Error('Sign in first.');
  });
  assert.equal(left.length, 1);
});

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
}

test('holding an alert while the queue is being sent never loses it', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const sent: string[] = [];
  const q = createAlertQueue(memoryStore(), async (a) => {
    await gate;
    sent.push(a.kind);
  });
  await q.hold(item());
  const flushing = q.flush();
  const holding = q.hold(item({ kind: 'out' }));
  release();
  await Promise.all([flushing, holding]);
  assert.deepEqual(sent, ['emergency']);
  assert.deepEqual((await q.list()).map((a) => a.kind), ['out'], 'the one held mid-send is still waiting');
  await q.flush();
  assert.deepEqual(sent, ['emergency', 'out']);
  assert.deepEqual(await q.list(), []);
});

test('a stop that couldn’t reach the club waits like an alert', async () => {
  const q = queueAlert([], item({ kind: 'stop' }));
  assert.equal(q[0].kind, 'stop');
});

test('the text-my-location link suits the phone', () => {
  const body = 'Rustnuts emergency. I’m here: https://maps.google.com/?q=-37.8,144.9';
  assert.equal(smsUrl('android', ['0400 000 002', '+61 400 000 003'], body), `sms:0400000002,+61400000003?body=${encodeURIComponent(body)}`);
  assert.equal(smsUrl('ios', ['0400 000 002', '0400 000 003'], body), `sms:0400000002&body=${encodeURIComponent(body)}`);
  assert.equal(smsUrl('android', [], body), null);
});

test('sharing again forgets a stop still waiting for signal, so it can’t switch the new share off', async () => {
  const sent: string[] = [];
  const q = createAlertQueue(memoryStore(), async (a) => {
    sent.push(a.kind);
  });
  await q.hold(item({ kind: 'stop' }));
  await q.hold(item({ kind: 'stop', rideId: 'r-2' }));
  await q.hold(item());
  await q.forget('r-1', 'stop');
  assert.deepEqual((await q.list()).map((a) => `${a.rideId}:${a.kind}`), ['r-2:stop', 'r-1:emergency']);
  await q.flush();
  assert.deepEqual(sent, ['stop', 'emergency']);
});
