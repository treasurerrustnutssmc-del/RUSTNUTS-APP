import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCharity, saveCharityArgs, signUpCharityArgs } from './charityLive';

/** A stand-in client: each table answers its rows, or an error. */
const fakeDb = (tables: Record<string, { data: unknown[] | null; error: { message: string; code?: string } | null }>) => {
  const q = (name: string) => {
    const chain = { select: () => chain, order: () => chain, range: async () => tables[name] };
    return chain;
  };
  return { from: q } as unknown as Parameters<typeof loadCharity>[0];
};

test('the two tables load as the app’s records, blanks as empty text', async () => {
  const got = await loadCharity(fakeDb({
    charity_rides: { data: [{ ride_id: 'r', cause: 'RCH', about: null, closes_on: '2026-11-07', places: 40, jobs: ['BBQ'], website: true, updated_by: 'm', updated_at: '2026-10-29T01:00:00+00:00' }], error: null },
    charity_signups: { data: [{ ride_id: 'r', member_id: 'm', riding: true, pillion: false, guests: 2, guest_names: null, job: null, notes: null, signed_at: '2026-10-29T02:00:00+00:00', withdrawn_at: null }], error: null },
    website_signups: { data: [{ id: 'w1', ride_id: 'r', name: 'Sam Rider', email: 'sam@example.com', phone: null, riding: true, pillion: false, guests: 0, guest_names: null, job: 'BBQ', notes: null, created_at: '2026-10-30T02:00:00+00:00', updated_at: '2026-10-30T02:00:00+00:00' }], error: null },
  }));
  assert.deepEqual(got.charityRides, [{ rideId: 'r', cause: 'RCH', about: '', closesOn: '2026-11-07', places: 40, jobs: ['BBQ'], website: true, updatedBy: 'm', updatedAt: '2026-10-29T01:00:00.000Z' }]);
  assert.deepEqual(got.charitySignups, [{ rideId: 'r', memberId: 'm', riding: true, pillion: false, guests: 2, guestNames: '', job: null, notes: '', signedAt: '2026-10-29T02:00:00.000Z', withdrawnAt: null }]);
  assert.deepEqual(got.websiteSignups, [{ id: 'w1', rideId: 'r', name: 'Sam Rider', email: 'sam@example.com', phone: '', riding: true, pillion: false, guests: 0, guestNames: '', job: 'BBQ', notes: '', createdAt: '2026-10-30T02:00:00.000Z', updatedAt: '2026-10-30T02:00:00.000Z' }]);
});

test('before the SQL is pasted the tables load as none; any other error stops the load', async () => {
  const missing = { data: null, error: { message: 'no table', code: 'PGRST205' } };
  assert.deepEqual(await loadCharity(fakeDb({ charity_rides: missing, charity_signups: missing, website_signups: missing })), { charityRides: [], charitySignups: [], websiteSignups: [] });
  await assert.rejects(loadCharity(fakeDb({ charity_rides: { data: null, error: { message: 'boom', code: 'X' } }, charity_signups: missing, website_signups: missing })), /boom/);
});

test('the actions’ arguments: blanks as null, jobs trimmed', () => {
  assert.deepEqual(saveCharityArgs('r', { cause: ' RCH ', about: ' ', closesOn: null, places: null, jobs: [' BBQ ', '', 'Marshal'] }), {
    p_ride: 'r', p_cause: 'RCH', p_about: null, p_closes_on: null, p_places: null, p_jobs: ['BBQ', 'Marshal'], p_website: false,
  });
  assert.equal(saveCharityArgs('r', { cause: 'RCH', about: '', closesOn: null, places: null, jobs: [], website: true }).p_website, true);
  assert.deepEqual(signUpCharityArgs('r', { riding: false, pillion: false, guests: 1, guestNames: ' Bec ', job: ' BBQ ', notes: '' }), {
    p_ride: 'r', p_riding: false, p_pillion: false, p_guests: 1, p_guest_names: 'Bec', p_job: 'BBQ', p_notes: null,
  });
});
