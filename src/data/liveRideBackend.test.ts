import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateFromJson } from './liveRideBackend';

test('the database state becomes the app’s live state', () => {
  const s = stateFromJson('r-1', {
    me: { stops_at: '2026-11-07T04:00:00+00:00' },
    riders: [
      { member_id: 'm-1', name: 'Rita', leader: false, lat: -37.8, lng: 144.9, accuracy_m: 12, updated_at: '2026-11-06T23:00:00+00:00', phone: null },
      { member_id: 'm-2', name: 'Tommo', leader: true, lat: null, lng: null, accuracy_m: null, updated_at: null, phone: '0400 000 002' },
    ],
    alerts: [
      { id: 'a-1', ride_id: 'r-1', member_id: 'm-1', kind: 'emergency', name: 'Rita', lat: null, lng: null,
        created_at: '2026-11-06T23:01:00+00:00', resolved_at: null, phone: '0400 000 001' },
    ],
    contacts: [{ id: 'c-1', member_id: 'm-1', name: 'Rob', relationship: 'Husband', phone: '0400 111 111' }],
  });
  assert.deepEqual(s.me, { stopsAt: '2026-11-07T04:00:00.000Z' });
  assert.deepEqual(s.riders[0].position, { lat: -37.8, lng: 144.9 });
  assert.equal(s.riders[0].updatedAt, '2026-11-06T23:00:00.000Z');
  assert.equal(s.riders[1].position, null, 'no fix yet');
  assert.equal(s.riders[1].leader, true);
  assert.equal(s.alerts[0].position, null);
  assert.equal(s.alerts[0].createdAt, '2026-11-06T23:01:00.000Z');
  assert.equal(s.alerts[0].phone, '0400 000 001');
  assert.deepEqual(s.contacts, [{ id: 'c-1', memberId: 'm-1', name: 'Rob', relationship: 'Husband', phone: '0400 111 111' }]);
  assert.deepEqual(stateFromJson('r-1', { me: null, riders: [], alerts: [], contacts: [] }).me, null);
});
