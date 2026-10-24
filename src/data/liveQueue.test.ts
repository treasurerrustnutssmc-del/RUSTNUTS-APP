import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertNotice, drainQueue, queueAlert, unseenAlerts, type QueuedAlert } from './liveQueue';
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
  q = queueAlert(q, item({ kind: 'out' }));
  assert.equal(q.length, 2);

  const sent: string[] = [];
  const left = await drainQueue(q, async (a) => {
    if (a.kind === 'out') throw new Error('Network request failed');
    sent.push(a.kind);
  });
  assert.deepEqual(sent, ['emergency']);
  assert.deepEqual(left.map((a) => a.kind), ['out'], 'a failure stays queued');
});

test('a queued alert the server refuses for good is not retried forever', async () => {
  const left = await drainQueue([item()], async () => {
    throw new Error('Share your location first.');
  });
  assert.deepEqual(left, []);
});
