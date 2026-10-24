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
  const rpc = (name: string) =>
    Promise.resolve({ data: name === 'shared_phones' ? phones : name === 'ride_calendar' ? tables.ride_calendar ?? null : null, error: null });
  return { from: query, rpc } as never;
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

test('signed in: the calendar loads in one piece, with when every feed last synced', async () => {
  const ride = (id: string, over: object = {}) => ({
    id, source: 'feed', feed_id: 'f1', external_uid: `${id}@x`, starts_at: '2026-11-07T21:30:00+00:00',
    ends_at: null, all_day: false, title: 'Coffee run', location: 'Laverton', notes: null, category: 'west',
    cancelled_at: null, synced_at: '2026-10-24T10:00:00+00:00', ...over,
  });
  const data = await loadClub(
    stubClient({
      chapters: [west],
      ride_calendar: {
        rides: [ride('r1'), ride('r2', { cancelled_at: '2026-10-24T10:15:00+00:00', all_day: true })],
        rsvps: [{ ride_id: 'r1', member_id: 'm1', answer: 'going', updated_at: '2026-10-24T11:00:00+00:00' }],
        synced_at: '2026-10-24T09:45:00+00:00',
      },
    } as never),
    true,
  );
  assert.deepEqual(data.rides[0], {
    id: 'r1', title: 'Coffee run', startsAt: '2026-11-07T21:30:00.000Z', endsAt: null, allDay: false,
    location: 'Laverton', notes: null, category: 'west', cancelledAt: null,
  });
  assert.equal(data.rides[1].allDay, true);
  assert.equal(data.rides[1].cancelledAt, '2026-10-24T10:15:00.000Z');
  assert.deepEqual(data.rsvps, [{ rideId: 'r1', memberId: 'm1', answer: 'going', updatedAt: '2026-10-24T11:00:00.000Z' }]);
  assert.equal(data.ridesSyncedAt, '2026-10-24T09:45:00.000Z', 'the oldest feed, from the database');
});

test('signed in: a calendar not synced yet loads empty', async () => {
  const data = await loadClub(stubClient({ chapters: [west], ride_calendar: { rides: [], rsvps: [], synced_at: null } } as never), true);
  assert.deepEqual([data.rides, data.rsvps, data.ridesSyncedAt], [[], [], null]);
});

test('signed in: the crew rows become crew spots', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      ride_calendar: {
        rides: [],
        rsvps: [],
        crew: [
          { ride_id: 'r1', member_id: 'm1', role: 'road_captain', assigned_by: 'm2', assigned_at: '2026-10-24T11:00:00+00:00' },
          { ride_id: 'r1', member_id: 'm3', role: 'officer', assigned_by: null, assigned_at: '2026-10-24T12:30:00.123+00:00' },
        ],
        synced_at: null,
      },
    } as never),
    true,
  );
  assert.deepEqual(data.crew, [
    { rideId: 'r1', memberId: 'm1', role: 'road_captain', assignedBy: 'm2', assignedAt: '2026-10-24T11:00:00.000Z' },
    { rideId: 'r1', memberId: 'm3', role: 'officer', assignedBy: null, assignedAt: '2026-10-24T12:30:00.123Z' },
  ]);
});

test('signed in: no crew key (not approved, or an older calendar) loads an empty crew', async () => {
  const data = await loadClub(stubClient({ chapters: [west], ride_calendar: { rides: [], rsvps: [], synced_at: null } } as never), true);
  assert.deepEqual(data.crew, []);
});

test('signed in: the library is read with named columns, never the GPX files, and rows become routes', async () => {
  const selects: Record<string, string> = {};
  const routeRow = {
    id: 'rt1', name: 'West loop', chapter_id: 'c1', notes: null, distance_m: 182000, climb_m: null,
    line: [[-37.8, 144.7], [-37.6, 144.4]], stops: [{ name: 'Fuel', lat: -37.7, lng: 144.5 }],
    bounds: { minLat: -37.8, minLng: 144.4, maxLat: -37.6, maxLng: 144.7 },
    archived_at: '2026-10-24T10:15:00+00:00', updated_at: '2026-10-24T09:00:00.5+00:00',
  };
  const client = {
    from: (name: string) => ({
      select: (cols = '*') => {
        selects[name] = cols;
        const r = { data: name === 'chapters' ? [west] : name === 'routes' ? [routeRow, { ...routeRow, id: 'rt2', notes: 'Twisty', climb_m: 2400, chapter_id: null, archived_at: null, bounds: null }] : [], error: null };
        const chain = { order: () => Promise.resolve(r), then: (f: (v: typeof r) => unknown) => Promise.resolve(r).then(f) };
        return chain;
      },
    }),
    rpc: (name: string) =>
      Promise.resolve({ data: name === 'ride_calendar' ? { rides: [], rsvps: [], synced_at: null } : [], error: null }),
  } as never;
  const data = await loadClub(client, true);
  assert.ok(selects.routes, 'the library is read');
  const cols = selects.routes.split(',').map((c) => c.trim());
  assert.ok(!cols.includes('*') && !cols.includes('gpx'), `named columns without the file: ${selects.routes}`);
  assert.deepEqual(data.routes?.[0], {
    id: 'rt1', name: 'West loop', chapterId: 'c1', notes: '', distanceM: 182000, climbM: null,
    line: [[-37.8, 144.7], [-37.6, 144.4]], stops: [{ name: 'Fuel', lat: -37.7, lng: 144.5 }],
    bounds: { minLat: -37.8, minLng: 144.4, maxLat: -37.6, maxLng: 144.7 },
    archivedAt: '2026-10-24T10:15:00.000Z', updatedAt: '2026-10-24T09:00:00.500Z',
  });
  const second = data.routes?.[1];
  assert.equal(second?.notes, 'Twisty');
  assert.equal(second?.climbM, 2400);
  assert.equal(second?.chapterId, null);
  assert.equal(second?.archivedAt, null);
  assert.deepEqual(second?.bounds, { minLat: -37.8, minLng: 144.4, maxLat: -37.6, maxLng: 144.7 }, 'no bounds stored: taken from the line');
});

test('signed in: the calendar’s ride_routes become ride routes', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      ride_calendar: {
        rides: [],
        rsvps: [],
        ride_routes: [{ ride_id: 'r1', route_id: 'rt1' }, { ride_id: 'r2', route_id: 'rt2' }],
        synced_at: null,
      },
    } as never),
    true,
  );
  assert.deepEqual(data.rideRoutes, [{ rideId: 'r1', routeId: 'rt1' }, { rideId: 'r2', routeId: 'rt2' }]);
});

test('signed in: a cleared ride route (no route) is left out', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      ride_calendar: {
        rides: [],
        rsvps: [],
        ride_routes: [{ ride_id: 'r1', route_id: 'rt1' }, { ride_id: 'r3', route_id: null }],
        synced_at: null,
      },
    } as never),
    true,
  );
  assert.deepEqual(data.rideRoutes, [{ rideId: 'r1', routeId: 'rt1' }]);
});

test('signed in: no ride_routes key (not approved) loads no ride routes, and no library rows loads an empty library', async () => {
  const data = await loadClub(stubClient({ chapters: [west], ride_calendar: { rides: [], rsvps: [], synced_at: null } } as never), true);
  assert.deepEqual(data.rideRoutes, []);
  assert.deepEqual(data.routes, []);
});
