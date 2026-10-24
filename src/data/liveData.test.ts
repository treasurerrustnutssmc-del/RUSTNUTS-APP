import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClub } from './liveData';

// A stand-in for the Supabase client: hands back fixed rows per table.
function stubClient(tables: Record<string, unknown[]>, phones: unknown[] = []) {
  const result = (name: string) => ({ data: tables[name] ?? [], error: null });
  const query = (name: string) => {
    const r = result(name);
    const chain = { order: () => Promise.resolve(r), then: (f: (v: typeof r) => unknown) => Promise.resolve(r).then(f) };
    return { select: () => chain };
  };
  return { from: query, rpc: () => Promise.resolve({ data: phones, error: null }) } as never;
}

const west = { id: 'c1', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC', created_at: '' };

test('signed out: chapters only', async () => {
  const data = await loadClub(stubClient({ chapters: [west] }), false);
  assert.equal(data.chapters.length, 1);
  assert.equal(data.members.length, 0);
});

test('signed in: rows become app records, shared phones merge in', async () => {
  const data = await loadClub(
    stubClient(
      {
        chapters: [west],
        members: [
          {
            id: 'm1', chapter_id: 'c1', full_name: 'Mick Doherty', road_name: 'Spanner', status: 'full',
            approval: 'approved', joined_on: '2022-03-12', patched_on: null, fng_started_on: null, bio: null,
            share_phone: true, applied_on: '2022-03-01', created_at: '', updated_at: '', on_hiatus: false,
          },
          {
            id: 'm2', chapter_id: 'c1', full_name: 'Gary K', road_name: 'Rusty', status: 'full',
            approval: 'approved', joined_on: null, patched_on: null, fng_started_on: null, bio: null,
            share_phone: true, applied_on: '2022-03-01', created_at: '', updated_at: '', on_hiatus: false,
          },
        ],
        member_private: [
          {
            member_id: 'm1', email: 'me@example.com', phone: '0400 000 001', licence_class: 'full_open',
            licence_expiry: '2028-01-01', first_aid_expiry: null, introduced_by: null, application_note: null, updated_at: '',
          },
        ],
        bikes: [{ id: 'b1', member_id: 'm1', make: 'Harley-Davidson', model: 'Softail Slim', year: 2016, nickname: null, is_project: false, created_at: '' }],
        bike_registrations: [{ bike_id: 'b1', rego: '3MD 5SS', rego_expiry: '2026-11-08' }],
        emergency_contacts: [{ id: 'e1', member_id: 'm1', name: 'Jen', relationship: 'Wife', phone: '0400 111 222', created_at: '' }],
        positions: [{ id: 'p1', member_id: 'm1', chapter_id: 'c1', role: 'tail_gunner', started_on: '2025-08-16', ended_on: null }],
      },
      [
        { member_id: 'm1', phone: '0400 000 001' },
        { member_id: 'm2', phone: '0400 000 002' },
      ],
    ),
    true,
  );
  assert.equal(data.members[0].roadName, 'Spanner');
  assert.equal(data.members[0].chapterId, 'c1');
  assert.equal(data.registrations[0].regoExpiry, '2026-11-08');
  assert.equal(data.positions[0].role, 'tail_gunner');
  assert.equal(data.emergencyContacts[0].memberId, 'm1');
  // own private row kept whole; Rusty's shared phone added with nothing else
  assert.equal(data.privates.find((p) => p.memberId === 'm1')?.email, 'me@example.com');
  const rusty = data.privates.find((p) => p.memberId === 'm2');
  assert.equal(rusty?.phone, '0400 000 002');
  assert.equal(rusty?.email, null);
  assert.equal(data.privates.length, 2);
});

test('signed in: a roster place is claimed before the club is read, so a new member sees their own record', async () => {
  const calls: string[] = [];
  const client = {
    from: (name: string) => {
      calls.push(`from:${name}`);
      const r = { data: name === 'chapters' ? [west] : [], error: null };
      const chain = { order: () => Promise.resolve(r), then: (f: (v: typeof r) => unknown) => Promise.resolve(r).then(f) };
      return { select: () => chain };
    },
    rpc: (name: string) => {
      calls.push(`rpc:${name}`);
      return Promise.resolve({ data: name === 'claim_roster' ? true : [], error: null });
    },
  } as never;
  await loadClub(client, true);
  assert.ok(calls.includes('rpc:claim_roster'));
  assert.ok(calls.indexOf('rpc:claim_roster') < calls.indexOf('from:members'));
});

test('signed in: a failed roster claim never stops the club loading', async () => {
  const client = {
    from: () => {
      const r = { data: [], error: null };
      const chain = { order: () => Promise.resolve(r), then: (f: (v: typeof r) => unknown) => Promise.resolve(r).then(f) };
      return { select: () => chain };
    },
    rpc: (name: string) =>
      Promise.resolve(name === 'claim_roster' ? { data: null, error: { message: 'function does not exist' } } : { data: [], error: null }),
  } as never;
  const data = await loadClub(client, true);
  assert.equal(data.members.length, 0);
});

test('signed out: no roster claim is tried', async () => {
  const calls: string[] = [];
  const client = {
    from: () => {
      const r = { data: [west], error: null };
      const chain = { order: () => Promise.resolve(r), then: (f: (v: typeof r) => unknown) => Promise.resolve(r).then(f) };
      return { select: () => chain };
    },
    rpc: (name: string) => {
      calls.push(name);
      return Promise.resolve({ data: [], error: null });
    },
  } as never;
  await loadClub(client, false);
  assert.deepEqual(calls, []);
});
