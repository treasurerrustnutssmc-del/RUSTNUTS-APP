import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNotificationPrefs, saveNotificationPrefs } from './notificationsApi';

function stub(rows: unknown[], error: { message: string; code?: string } | null = null, errorFor?: (args: object) => boolean) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error }) }) }),
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve({ error: errorFor && !errorFor(args as object) ? null : error });
    },
  };
  return { client: client as never, calls };
}

test('the saved row becomes the app’s settings; no row means the defaults', async () => {
  const row = { member_id: 'm1', ride_reminders: false, ride_changes: true, new_rides: true, approvals: false, rev_sound: false, updated_at: '' };
  assert.deepEqual(await loadNotificationPrefs(stub([row]).client), { rideReminders: false, rideChanges: true, newRides: true, approvals: false, revSound: false });
  // Before the rev_sound column is live, the rev is on.
  const { rev_sound: _rev, ...older } = row;
  assert.equal((await loadNotificationPrefs(stub([older]).client))?.revSound, true);
  assert.equal(await loadNotificationPrefs(stub([]).client), null);
});

test('a failed read fails the load, so saved settings are never mistaken for the defaults', async () => {
  await assert.rejects(loadNotificationPrefs(stub([], { message: 'Failed to fetch' }).client), /fetch/);
});

test('saving sends all five', async () => {
  const { client, calls } = stub([]);
  await saveNotificationPrefs(client, { rideReminders: true, rideChanges: false, newRides: true, approvals: false, revSound: false });
  assert.deepEqual(calls, [{
    fn: 'save_notification_prefs',
    args: { p_ride_reminders: true, p_ride_changes: false, p_new_rides: true, p_approvals: false, p_rev_sound: false },
  }]);
});

test('before rev-sound.sql is live, saving falls back to the four settings', async () => {
  const missing = { message: 'Could not find the function public.save_notification_prefs(...)', code: 'PGRST202' };
  const { client, calls } = stub([], missing, (args) => 'p_rev_sound' in args);
  await saveNotificationPrefs(client, { rideReminders: true, rideChanges: false, newRides: true, approvals: false, revSound: false });
  assert.deepEqual(calls.map((c) => Object.keys(c.args as object).length), [5, 4]);
});

test('any other failure is not retried', async () => {
  const { client, calls } = stub([], { message: 'Only approved members can do that.', code: 'P0001' });
  await assert.rejects(saveNotificationPrefs(client, { rideReminders: true, rideChanges: false, newRides: true, approvals: false, revSound: true }), /approved/);
  assert.equal(calls.length, 1);
});
