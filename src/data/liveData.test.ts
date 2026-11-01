import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_OUTDATED, SAVE_CONFLICT, NOT_WRITER } from '../domain/briefings';
import { isRoadRulesVersionRefusal, NO_RULES, NOT_PUBLISHER, PUBLISH_CONFLICT, SIGN_OUTDATED } from '../domain/roadRules';
import { EMPTY_DATA } from './clubContext';
import {
  bookBusArgs,
  cancelBusArgs,
  decideBusArgs,
  loadClub,
  publishRoadRulesArgs,
  readBriefingArgs,
  reloadOnNewerVersion,
  saveBriefingArgs,
  signRoadRulesArgs,
} from './liveData';

/** A query result that can be awaited at any step: after select, order or range (paged reads). */
type Chain<R> = { order: () => Chain<R>; range: () => Promise<R>; then: (f: (v: R) => unknown) => Promise<unknown> };
function chainOf<R>(r: R): Chain<R> {
  const chain: Chain<R> = { order: () => chain, range: () => Promise.resolve(r), then: (f) => Promise.resolve(r).then(f) };
  return chain;
}

// A stand-in for the Supabase client: hands back fixed rows per table.
function stubClient(tables: Record<string, unknown[]>, phones: unknown[] = []) {
  const result = (name: string) => ({ data: tables[name] ?? [], error: null });
  const query = (name: string) => {
    const r = result(name);
    const chain = chainOf(r);
    return { select: () => chain };
  };
  const rpc = (name: string) =>
    Promise.resolve({
      data:
        name === 'shared_phones'
          ? phones
          : name === 'ride_calendar' || name === 'members_money' || name === 'unclaimed_roster_counts'
            ? tables[name] ?? null
            : null,
      error: null,
    });
  return { from: query, rpc } as never;
}

const west = { id: 'c1', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC', created_at: '' };

test('signed out: chapters only', async () => {
  const data = await loadClub(stubClient({ chapters: [west] }), false);
  assert.equal(data.chapters.length, 1);
  assert.equal(data.members.length, 0);
});

test('signed in: unclaimed roster places come through for the club counts', async () => {
  const data = await loadClub(
    stubClient({ chapters: [west], unclaimed_roster_counts: [{ chapter_id: 'c1', status: 'fng', n: 6 }] }),
    true,
  );
  assert.deepEqual(data.unclaimedRoster, [{ chapterId: 'c1', status: 'fng', count: 6 }]);
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
      const chain = chainOf(r);
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
      const chain = chainOf(r);
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
      const chain = chainOf(r);
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

// Stage 4
test('signed in: check-ins, decisions and fees load in one piece and become app records', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      members_money: {
        sessions: [{ id: 's1', kind: 'meeting', chapter_id: 'c1', ride_id: null, title: 'Club meeting', held_on: '2026-10-24',
          opened_by: 'm1', closed_at: null }],
        attendance: [{ session_id: 's1', member_id: 'm1', checked_in_at: '2026-10-24T09:00:00+00:00', marked_by: null }],
        decisions: [{ id: 'd1', member_id: 'm2', kind: 'fng_review', at_months: 6, outcome: 'continue', status: null, votes_for: 5,
          votes_against: 0, votes_abstained: null, note: null, decided_on: '2026-10-24', recorded_by: 'm1', created_at: '' }],
        rates: [{ chapter_id: 'c1', fy: 2026, status: 'full', amount_cents: 25000, due_on: '2026-07-31' }],
        charges: [{ id: 'c1', member_id: 'm1', chapter_id: 'c1', fy: 2026, kind: 'annual', description: null, amount_cents: 25000,
          due_on: '2026-07-31', raised_by: 'm9', created_at: '2026-07-01T00:00:00+00:00', waived_at: null, waived_by: null }],
        payments: [{ id: 'p1', charge_id: 'c1', amount_cents: 10000, paid_on: '2026-07-10', method: 'payid', reference: 'X',
          state: 'confirmed', claimed_by: 'm1', decided_by: 'm9', decided_at: '2026-07-11T00:00:00+00:00', receipt_no: 'W26-0001',
          created_at: '' }],
        details: [{ chapter_id: 'c1', payid: 'west@example.com', payid_name: 'Rustnuts West', bsb: null, account_no: null, updated_at: '' }],
      },
    } as never),
    true,
  );
  assert.deepEqual(data.checkinSessions, [{ id: 's1', kind: 'meeting', chapterId: 'c1', rideId: null, title: 'Club meeting',
    heldOn: '2026-10-24', openedBy: 'm1', closedAt: null, meetingType: null }]);
  assert.deepEqual(data.attendance, [{ sessionId: 's1', memberId: 'm1', checkedInAt: '2026-10-24T09:00:00.000Z', markedBy: null }]);
  assert.deepEqual(data.decisions, [{ id: 'd1', memberId: 'm2', kind: 'fng_review', atMonths: 6, outcome: 'continue', status: null,
    votesFor: 5, votesAgainst: 0, votesAbstained: null, note: null, decidedOn: '2026-10-24', recordedBy: 'm1' }]);
  assert.deepEqual(data.feeRates, [{ chapterId: 'c1', fy: 2026, status: 'full', amountCents: 25000, dueOn: '2026-07-31' }]);
  assert.deepEqual(data.charges, [{ id: 'c1', memberId: 'm1', chapterId: 'c1', fy: 2026, kind: 'annual', description: null,
    amountCents: 25000, dueOn: '2026-07-31', createdAt: '2026-07-01T00:00:00.000Z', waivedAt: null }]);
  assert.deepEqual(data.payments, [{ id: 'p1', chargeId: 'c1', amountCents: 10000, paidOn: '2026-07-10', method: 'payid',
    reference: 'X', state: 'confirmed', claimedBy: 'm1', receiptNo: 'W26-0001', decidedAt: '2026-07-11T00:00:00.000Z' }]);
  assert.deepEqual(data.paymentDetails, [{ chapterId: 'c1', payid: 'west@example.com', payidName: 'Rustnuts West', bsb: null, accountNo: null }]);
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

function moneyFails(error: { code: string; message: string }) {
  const base = stubClient({ chapters: [west] }) as unknown as { from: unknown; rpc: (n: string) => Promise<unknown> };
  return {
    from: base.from,
    rpc: (name: string) => (name === 'members_money' ? Promise.resolve({ data: null, error }) : base.rpc(name)),
  } as never;
}

test('before the fees and check-ins are live, the rest of the club still loads', async () => {
  const data = await loadClub(moneyFails({ code: 'PGRST202', message: 'Could not find the function public.members_money' }), true);
  assert.equal(data.chapters.length, 1);
  assert.deepEqual([data.checkinSessions, data.charges], [[], []]);
});

test('any other failure loading fees and check-ins is an error, not an empty list', async () => {
  await assert.rejects(loadClub(moneyFails({ code: '57014', message: 'canceling statement due to statement timeout' }), true));
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
        const chain = chainOf(r);
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

test('signed in: the calendar’s briefings and reads become app records, null texts as empty', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      ride_calendar: {
        rides: [],
        rsvps: [],
        briefings: [
          {
            ride_id: 'r1', hazards: ['Gravel', 'Kangaroos'], changes: 'Single file', notes: null,
            updated_by: 'm1', updated_at: '2026-10-23T09:15:00.25+00:00',
          },
          { ride_id: 'r2', hazards: [], changes: null, notes: 'Cash only', updated_by: null, updated_at: '2026-10-23T10:00:00+00:00' },
        ],
        briefing_reads: [{ ride_id: 'r1', member_id: 'm2', read_at: '2026-10-23T20:42:00+00:00' }],
        synced_at: null,
      },
    } as never),
    true,
  );
  assert.deepEqual(data.briefings, [
    {
      rideId: 'r1', hazards: ['Gravel', 'Kangaroos'], changes: 'Single file', notes: '',
      updatedBy: 'm1', updatedAt: '2026-10-23T09:15:00.250Z',
    },
    { rideId: 'r2', hazards: [], changes: '', notes: 'Cash only', updatedBy: null, updatedAt: '2026-10-23T10:00:00.000Z' },
  ]);
  assert.deepEqual(data.briefingReads, [{ rideId: 'r1', memberId: 'm2', readAt: '2026-10-23T20:42:00.000Z' }]);
});

test('signed in: no briefings keys (not approved) loads no briefings and no reads', async () => {
  const data = await loadClub(stubClient({ chapters: [west], ride_calendar: { rides: [], rsvps: [], synced_at: null } } as never), true);
  assert.deepEqual(data.briefings, []);
  assert.deepEqual(data.briefingReads, []);
});

test('saving a briefing sends it cleaned, with the version the editor opened on', () => {
  const input = { hazards: ['  Gravel ', '', 'Roos'], changes: ' Single file ', notes: '' };
  assert.deepEqual(saveBriefingArgs('r1', input, '2026-10-23T09:15:00.000Z'), {
    p_ride: 'r1', p_hazards: ['Gravel', 'Roos'], p_changes: 'Single file', p_notes: '', p_seen: '2026-10-23T09:15:00.000Z',
  });
  assert.equal(saveBriefingArgs('r1', input, null).p_seen, null, 'a new briefing: no version');
});

test('Got it sends the version on screen', () => {
  assert.deepEqual(readBriefingArgs('r1', '2026-10-23T09:15:00.000Z'), { p_ride: 'r1', p_seen: '2026-10-23T09:15:00.000Z' });
});

test('after a newer-version refusal the calendar reloads, then the refusal still reaches the screen', async () => {
  for (const message of [READ_OUTDATED, SAVE_CONFLICT]) {
    let reloads = 0;
    await assert.rejects(
      reloadOnNewerVersion(async () => {
        throw new Error(message);
      }, async () => {
        reloads += 1;
      }),
      { message },
    );
    assert.equal(reloads, 1, `one reload after "${message}"`);
  }
  // Any other refusal doesn't reload.
  let reloads = 0;
  const reload = async () => {
    reloads += 1;
  };
  await assert.rejects(reloadOnNewerVersion(async () => {
    throw new Error(NOT_WRITER);
  }, reload), { message: NOT_WRITER });
  // Nor does success (the action reloads by itself).
  await reloadOnNewerVersion(async () => {}, reload);
  assert.equal(reloads, 0);
});

// ---------------------------------------------------------------------------
// Road Rules
// ---------------------------------------------------------------------------

test('signed in: the Road Rules versions and sign-offs are read with the rest, and become app records', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      road_rules_versions: [
        {
          number: 1, body: '# Road Rules', changes: null, fresh: true, published_by: 'm1',
          published_at: '2025-06-24T01:30:00.123456+00:00',
        },
        {
          number: 2, body: '# Road Rules, fixed', changes: 'A typo', fresh: false, published_by: null,
          published_at: '2026-09-30T02:00:00+00:00',
        },
      ],
      road_rules_signoffs: [{ member_id: 'm2', version: 2, signed_at: '2026-10-19T03:04:05.678901+00:00' }],
    }),
    true,
  );
  assert.deepEqual(data.roadRules, [
    { number: 1, body: '# Road Rules', changes: '', fresh: true, publishedBy: 'm1', publishedAt: '2025-06-24T01:30:00.123Z' },
    { number: 2, body: '# Road Rules, fixed', changes: 'A typo', fresh: false, publishedBy: null, publishedAt: '2026-09-30T02:00:00.000Z' },
  ]);
  assert.deepEqual(data.roadRulesSignoffs, [{ memberId: 'm2', version: 2, signedAt: '2026-10-19T03:04:05.678Z' }]);
});

test('signed in: no Road Rules rows (not approved, or none yet) loads none', async () => {
  const data = await loadClub(stubClient({ chapters: [west], ride_calendar: { rides: [], rsvps: [], synced_at: null } } as never), true);
  assert.deepEqual(data.roadRules, []);
  assert.deepEqual(data.roadRulesSignoffs, []);
});

test('signed out: no Road Rules are read', async () => {
  const data = await loadClub(stubClient({ chapters: [west], road_rules_versions: [{ number: 1 }] } as never), false);
  assert.deepEqual(data.roadRules, []);
  assert.deepEqual(data.roadRulesSignoffs, []);
});

/** stubClient, with one table's read failing (with a PostgREST or Postgres code when given). */
function tableFails(table: string, message: string, code?: string) {
  const base = stubClient({ chapters: [west] }) as unknown as { from: (n: string) => unknown; rpc: unknown };
  const r = { data: null, error: { message, code } };
  const chain = chainOf(r);
  return { from: (name: string) => (name === table ? { select: () => chain } : base.from(name)), rpc: base.rpc } as never;
}

test('a failure loading the Road Rules is an error, not an empty list', async () => {
  await assert.rejects(loadClub(tableFails('road_rules_versions', 'boom'), true), { message: 'boom' });
  await assert.rejects(loadClub(tableFails('road_rules_signoffs', 'bang'), true), { message: 'bang' });
});

test('publishing the Road Rules sends them cleaned, with the version the editor opened on', () => {
  const data = { ...EMPTY_DATA, roadRules: [] };
  assert.deepEqual(publishRoadRulesArgs({ body: '  # Road Rules \n', changes: '  ', fresh: false }, 0, data), {
    p_body: '# Road Rules', p_changes: '', p_fresh: true, p_seen: 0,
  }, 'version 1 is always fresh');
  const withOne = {
    ...EMPTY_DATA,
    roadRules: [{ number: 1, body: 'x', changes: '', fresh: true, publishedAt: '2026-01-01T00:00:00.000Z', publishedBy: null }],
  };
  assert.deepEqual(publishRoadRulesArgs({ body: 'Fixed', changes: ' A typo ', fresh: false }, 1, withOne), {
    p_body: 'Fixed', p_changes: 'A typo', p_fresh: false, p_seen: 1,
  });
});

test('signing the Road Rules sends the version on screen', () => {
  assert.deepEqual(signRoadRulesArgs(2), { p_version: 2 });
});

test('after a Road Rules version refusal the club reloads, then the refusal still reaches the screen', async () => {
  for (const message of [PUBLISH_CONFLICT, SIGN_OUTDATED]) {
    assert.equal(isRoadRulesVersionRefusal(new Error(message)), true, message);
    let reloads = 0;
    await assert.rejects(
      reloadOnNewerVersion(
        async () => {
          throw new Error(message);
        },
        async () => {
          reloads += 1;
        },
        isRoadRulesVersionRefusal,
      ),
      { message },
    );
    assert.equal(reloads, 1, `one reload after "${message}"`);
  }
  for (const message of [NOT_PUBLISHER, NO_RULES, READ_OUTDATED]) {
    assert.equal(isRoadRulesVersionRefusal(new Error(message)), false, message);
  }
});

// ---------------------------------------------------------------------------
// The Rusty Bus
// ---------------------------------------------------------------------------

test('signed in: the Rusty Bus bookings are read with the rest, and become app records', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      bus_bookings: [
        {
          id: 'bus1', first_day: '2026-11-07', last_day: '2026-11-08', purpose: 'charity_ride', ride_id: 'r1', driver_id: 'm1',
          notes: 'Spares and water', status: 'approved', booked_by: 'm2', booked_at: '2026-10-19T03:04:05.678901+00:00',
          decided_by: 'm2', decided_at: '2026-10-19T03:04:05.678901+00:00', decline_reason: null, cancelled_by: null, cancelled_at: null,
          changed_by: 'm1', changed_at: '2026-10-20T00:00:00+00:00',
        },
        {
          id: 'bus2', first_day: '2026-10-20', last_day: '2026-10-20', purpose: 'other', ride_id: null, driver_id: null,
          notes: null, status: 'cancelled', booked_by: null, booked_at: '2026-10-01T00:00:00+00:00',
          decided_by: 'm3', decided_at: '2026-10-02T01:00:00+00:00', decline_reason: 'Not that day', cancelled_by: 'm3',
          cancelled_at: '2026-10-03T02:00:00.5+00:00',
        },
      ],
    } as never),
    true,
  );
  assert.deepEqual(data.busBookings, [
    {
      id: 'bus1', firstDay: '2026-11-07', lastDay: '2026-11-08', purpose: 'charity_ride', rideId: 'r1', driverId: 'm1',
      notes: 'Spares and water', status: 'approved', bookedBy: 'm2', bookedAt: '2026-10-19T03:04:05.678Z',
      decidedBy: 'm2', decidedAt: '2026-10-19T03:04:05.678Z', declineReason: '', cancelledBy: null, cancelledAt: null,
      changedBy: 'm1', changedAt: '2026-10-20T00:00:00.000Z',
    },
    {
      id: 'bus2', firstDay: '2026-10-20', lastDay: '2026-10-20', purpose: 'other', rideId: null, driverId: null,
      notes: '', status: 'cancelled', bookedBy: null, bookedAt: '2026-10-01T00:00:00.000Z',
      decidedBy: 'm3', decidedAt: '2026-10-02T01:00:00.000Z', declineReason: 'Not that day', cancelledBy: 'm3',
      cancelledAt: '2026-10-03T02:00:00.500Z',
      // A row from before the Rusty Bus extras migration has no changed columns.
      changedBy: null, changedAt: null,
    },
  ]);
});

test('signed in: no Rusty Bus rows (not approved, or none yet) loads none', async () => {
  const data = await loadClub(stubClient({ chapters: [west], ride_calendar: { rides: [], rsvps: [], synced_at: null } } as never), true);
  assert.deepEqual(data.busBookings, []);
});

test('signed out: no Rusty Bus bookings are read', async () => {
  const data = await loadClub(stubClient({ chapters: [west], bus_bookings: [{ id: 'bus1' }] } as never), false);
  assert.deepEqual(data.busBookings, []);
});

test('a failure loading the Rusty Bus is an error, not an empty list', async () => {
  await assert.rejects(loadClub(tableFails('bus_bookings', 'boom'), true), { message: 'boom' });
  await assert.rejects(loadClub(tableFails('bus_bookings', 'canceling statement due to statement timeout', '57014'), true), {
    message: 'canceling statement due to statement timeout',
  });
  await assert.rejects(loadClub(tableFails('bus_bookings', 'permission denied for table bus_bookings', '42501'), true), {
    message: 'permission denied for table bus_bookings',
  });
});

test('before the database has the Rusty Bus table, the rest of the club still loads with no bookings', async () => {
  for (const [code, message] of [
    ['PGRST205', 'Could not find the table \'public.bus_bookings\' in the schema cache'],
    ['42P01', 'relation "public.bus_bookings" does not exist'],
  ]) {
    const data = await loadClub(tableFails('bus_bookings', message, code), true);
    assert.equal(data.chapters.length, 1, code);
    assert.deepEqual(data.busBookings, [], code);
  }
  // Another table missing is still an error.
  await assert.rejects(loadClub(tableFails('road_rules_versions', 'relation "public.road_rules_versions" does not exist', '42P01'), true));
});

test('booking the Rusty Bus sends the days, purpose, ride, driver and the notes trimmed', () => {
  assert.deepEqual(
    bookBusArgs({ firstDay: '2026-11-07', lastDay: '2026-11-08', purpose: 'recovery', rideId: 'r1', driverId: 'm1', notes: '  Trailer too  ' }),
    { p_first: '2026-11-07', p_last: '2026-11-08', p_purpose: 'recovery', p_ride: 'r1', p_driver: 'm1', p_notes: 'Trailer too' },
  );
  assert.deepEqual(
    bookBusArgs({ firstDay: '', lastDay: '', purpose: null, rideId: null, driverId: null, notes: '   ' }),
    { p_first: null, p_last: null, p_purpose: null, p_ride: null, p_driver: null, p_notes: null },
    'missing days and blank notes go as none',
  );
});

test('a yes or no on a booking sends the reason trimmed, and none on a yes', () => {
  assert.deepEqual(decideBusArgs('bus1', false, '  Out that day  '), { p_booking: 'bus1', p_yes: false, p_reason: 'Out that day' });
  assert.deepEqual(decideBusArgs('bus1', false, '  '), { p_booking: 'bus1', p_yes: false, p_reason: null });
  assert.deepEqual(decideBusArgs('bus1', true, 'kept?'), { p_booking: 'bus1', p_yes: true, p_reason: null });
});

test('cancelling a booking sends its id', () => {
  assert.deepEqual(cancelBusArgs('bus1'), { p_booking: 'bus1' });
});

// Attendance rules and Big 4 rides
test('signed in: Big 4 rides, exemptions and meeting kinds load', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      members_money: { sessions: [{ id: 's1', kind: 'meeting', chapter_id: 'c1', ride_id: null, title: 'BBQ', held_on: '2026-10-24',
        opened_by: 'm1', opened_at: '', closed_at: null }] },
      checkin_sessions: [{ id: 's1', meeting_type: 'event' }],
      big4_rides: [{ ride_id: 'r1', chapter_id: null, designated_by: 'm1', designated_at: '2026-08-02T00:00:00+00:00' }],
      attendance_exemptions: [{ session_id: 's1', member_id: 'm2', reason: 'Work', granted_by: 'm1', granted_at: '2026-10-24T00:00:00+00:00' }],
    } as never),
    true,
  );
  assert.equal(data.checkinSessions?.[0].meetingType, 'event');
  assert.deepEqual(data.big4Rides, [{ rideId: 'r1', chapterId: null, designatedBy: 'm1', designatedAt: '2026-08-02T00:00:00.000Z' }]);
  assert.deepEqual(data.exemptions, [{ sessionId: 's1', memberId: 'm2', reason: 'Work', grantedBy: 'm1', grantedAt: '2026-10-24T00:00:00.000Z' }]);
});

test('signed in: before the live database has the attendance tables, the club still loads without them', async () => {
  const data = await loadClub(tableFails('big4_rides', 'Could not find the table', 'PGRST205'), true);
  assert.deepEqual(data.big4Rides, []);
  assert.deepEqual(data.exemptions, []);
});

// Big 4 RSVP rules and the 5.5 notice
test('signed in: Big 4 excuses and 5.5 notices load, blank texts as empty', async () => {
  const data = await loadClub(
    stubClient({
      chapters: [west],
      big4_waivers: [{ ride_id: 'r1', member_id: 'm2', ground: 'work', granted_by: 'm1', granted_at: '2026-10-24T00:00:00+00:00' }],
      status_notices: [{
        id: 'n1', member_id: 'm2', chapter_id: 'c1', about: 'attendance', record: 'Meetings 2 of 6', proposal: 'Move to Supporter',
        given_on: '2026-10-01', respond_by: '2026-10-15', given_by: 'm1', response: null, responded_at: null,
        outcome: null, outcome_note: null, closed_on: null, closed_by: null,
      }],
    } as never),
    true,
  );
  assert.deepEqual(data.big4Waivers, [{ rideId: 'r1', memberId: 'm2', ground: 'work', grantedBy: 'm1', grantedAt: '2026-10-24T00:00:00.000Z' }]);
  assert.deepEqual(data.statusNotices, [{
    id: 'n1', memberId: 'm2', chapterId: 'c1', about: 'attendance', record: 'Meetings 2 of 6', proposal: 'Move to Supporter',
    givenOn: '2026-10-01', respondBy: '2026-10-15', givenBy: 'm1', response: '', respondedAt: null,
    outcome: null, outcomeNote: '', closedOn: null, closedBy: null,
  }]);
});

test('signed in: before the live database has the notice tables, the club still loads without them', async () => {
  const data = await loadClub(tableFails('status_notices', 'Could not find the table', 'PGRST205'), true);
  assert.deepEqual(data.statusNotices, []);
  assert.deepEqual(data.big4Waivers, []);
});

test('signup_counts loads as the numbers behind each ride’s sign-ups; a database without it yet loads none', async () => {
  const row = {
    ride_id: 'r1', hub_riders: 4, hub_pillions: 1, hub_group: 2, hub_own: 1, hub_camping: 1, hub_day: 0, hub_group_beds: 3,
    charity_riding: 2, charity_pillions: 1, charity_guests: 2, charity_helping: 1, charity_people: 5,
    website_riding: 1, website_pillions: 0, website_guests: 1, website_helping: 1, website_people: 2,
  };
  const base = stubClient({ chapters: [west] }) as unknown as { from: unknown; rpc: (n: string) => Promise<unknown> };
  const withCounts = { ...base, rpc: (name: string) => (name === 'signup_counts' ? Promise.resolve({ data: [row], error: null }) : base.rpc(name)) } as never;
  const data = await loadClub(withCounts, true);
  assert.deepEqual(data.signupCounts, [{
    rideId: 'r1', hubRiders: 4, hubPillions: 1, hubGroup: 2, hubOwn: 1, hubCamping: 1, hubDay: 0, hubGroupBeds: 3,
    charityRiding: 2, charityPillions: 1, charityGuests: 2, charityHelping: 1, charityPeople: 5,
    websiteRiding: 1, websitePillions: 0, websiteGuests: 1, websiteHelping: 1, websitePeople: 2,
  }]);
  const missing = {
    ...base,
    rpc: (name: string) =>
      name === 'signup_counts'
        ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.signup_counts' } })
        : base.rpc(name),
  } as never;
  assert.equal((await loadClub(missing, true)).signupCounts, undefined);
});
