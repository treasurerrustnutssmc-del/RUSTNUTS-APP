import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUS_ADD_DAYS } from '../domain/bus';
import { ALREADY_HAS_KEYS, KM_OUT_OF_ORDER, LITRES_NOT_FUEL, NOT_STRIKER } from '../domain/busLog';
import type { BusBooking, ClubData, Member } from '../domain/types';
import { changeBus, handBusKeys, logBusCost, logBusKm, strikeBusCost, strikeBusKm } from './busExtrasActions';
import { changeBusArgs, handBusKeysArgs, loadBusExtras, logBusCostArgs, logBusKmArgs } from './busExtrasLive';
import { DEMO_DATA } from './demoData';
import type { DemoCtx } from './demoActions';

const TODAY = '2026-10-29';
const NOW = '2026-10-29T01:00:00.000Z';

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'ch-west', fullName: `Full ${id}`, roadName: id, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});
const rider = member('rider');
const other = member('other');
const held: BusBooking = {
  id: 'held', firstDay: '2026-11-08', lastDay: '2026-11-09', purpose: 'charity_ride', rideId: null, driverId: 'rider', notes: '',
  status: 'approved', bookedBy: 'rider', bookedAt: '2026-10-01T00:00:00.000Z', decidedBy: 'nec', decidedAt: '2026-10-02T00:00:00.000Z',
  declineReason: '', cancelledBy: null, cancelledAt: null,
};
const data: ClubData = {
  chapters: [], members: [rider, other], privates: [], bikes: [], registrations: [], emergencyContacts: [], positions: [],
  rides: [], rsvps: [], busBookings: [held],
};
const ctx = (me: Member, d: ClubData = data): DemoCtx => ({ me, data: d, today: TODAY, now: NOW } as DemoCtx);

test('demo: changing a booking keeps its status and says who changed it', () => {
  const after = changeBus(ctx(rider), 'held', {
    firstDay: '2026-11-09', lastDay: '2026-11-09', purpose: 'other', rideId: null, driverId: 'other', notes: '  Just the Sunday.  ',
  });
  const b = after.busBookings![0];
  assert.equal(b.status, 'approved');
  assert.deepEqual([b.firstDay, b.lastDay, b.purpose, b.driverId, b.notes], ['2026-11-09', '2026-11-09', 'other', 'other', 'Just the Sunday.']);
  assert.deepEqual([b.changedBy, b.changedAt], ['rider', NOW]);
  assert.throws(
    () => changeBus(ctx(rider), 'held', { firstDay: '2026-11-08', lastDay: '2026-11-10', purpose: 'other', rideId: null, driverId: 'rider', notes: '' }),
    { message: BUS_ADD_DAYS },
  );
});

test('demo: keys, km and costs are logged, trimmed and rounded; mistakes struck out', () => {
  let d = handBusKeys(ctx(rider), 'other', ' At Spanner’s ').data;
  assert.deepEqual(d.busKeys, [{ id: d.busKeys![0].id, toId: 'other', note: 'At Spanner’s', loggedBy: 'rider', loggedAt: NOW }]);
  assert.throws(() => handBusKeys(ctx(rider, d), 'other', ''), { message: ALREADY_HAS_KEYS });

  d = logBusKm(ctx(rider, d), { km: 1000, readOn: TODAY, bookingId: 'held', note: '' }).data;
  assert.throws(() => logBusKm(ctx(rider, d), { km: 999, readOn: TODAY, bookingId: null, note: '' }), { message: KM_OUT_OF_ORDER });
  const kmId = d.busKm![0].id;
  assert.throws(() => strikeBusKm(ctx(other, d), kmId), { message: NOT_STRIKER });
  d = strikeBusKm(ctx(rider, d), kmId);
  assert.deepEqual([d.busKm![0].struckBy, d.busKm![0].struckAt], ['rider', NOW]);
  d = logBusKm(ctx(rider, d), { km: 999, readOn: TODAY, bookingId: null, note: '' }).data;
  assert.equal(d.busKm!.length, 2, 'the struck one no longer blocks');

  d = logBusCost(ctx(rider, d), { spentOn: TODAY, kind: 'fuel', amountCents: 9850, litres: 52.456, bookingId: null, note: ' Shell ' }).data;
  assert.equal(d.busCosts![0].litres, 52.46);
  assert.equal(d.busCosts![0].note, 'Shell');
  assert.throws(
    () => logBusCost(ctx(rider, d), { spentOn: TODAY, kind: 'rego', amountCents: 1, litres: 2, bookingId: null, note: '' }),
    { message: LITRES_NOT_FUEL },
  );
  d = strikeBusCost(ctx(rider, d), d.busCosts![0].id);
  assert.equal(d.busCosts![0].struckBy, 'rider');
});

test('live: the arguments trim notes, send blanks as none and round litres', () => {
  assert.deepEqual(
    changeBusArgs('b', { firstDay: '', lastDay: '2026-11-09', purpose: null, rideId: null, driverId: 'd', notes: '  ' }),
    { p_booking: 'b', p_first: null, p_last: '2026-11-09', p_purpose: null, p_ride: null, p_driver: 'd', p_notes: null },
  );
  assert.deepEqual(handBusKeysArgs('m', ' hi '), { p_to: 'm', p_note: 'hi' });
  assert.deepEqual(logBusKmArgs({ km: 5, readOn: '', bookingId: null, note: '' }), { p_km: 5, p_on: null, p_booking: null, p_note: null });
  assert.deepEqual(
    logBusCostArgs({ spentOn: TODAY, kind: 'fuel', amountCents: 100, litres: 10.005, bookingId: 'b', note: 'x' }),
    { p_on: TODAY, p_kind: 'fuel', p_cents: 100, p_litres: 10.01, p_booking: 'b', p_note: 'x' },
  );
});

/** A client whose tables answer with the rows given, or an error. */
const stub = (tables: Record<string, unknown[] | { message: string; code: string }>) => ({
  from: (name: string) => {
    const answer = tables[name] ?? [];
    const chain = {
      select: () => chain,
      order: () => chain,
      range: async (from: number) =>
        Array.isArray(answer) ? { data: from === 0 ? answer : [], error: null } : { data: null, error: answer },
    };
    return chain;
  },
});

test('live: the rows become app records, and a table not there yet loads as none', async () => {
  const loaded = await loadBusExtras(stub({
    bus_key_handovers: [{ id: 'k', to_id: 'm1', note: null, logged_by: 'm2', logged_at: '2026-10-20T00:00:00+00:00' }],
    bus_km: [{
      id: 'r', km: 121000, read_on: '2026-10-20', booking_id: null, note: 'Out', logged_by: 'm1', logged_at: '2026-10-20T00:00:00+00:00',
      struck_by: 'm2', struck_at: '2026-10-21T00:00:00.5+00:00',
    }],
    bus_costs: { message: 'relation "public.bus_costs" does not exist', code: '42P01' },
  }) as never);
  assert.deepEqual(loaded.busKeys, [{ id: 'k', toId: 'm1', note: '', loggedBy: 'm2', loggedAt: '2026-10-20T00:00:00.000Z' }]);
  assert.deepEqual(loaded.busKm, [{
    id: 'r', km: 121000, readOn: '2026-10-20', bookingId: null, note: 'Out', loggedBy: 'm1', loggedAt: '2026-10-20T00:00:00.000Z',
    struckBy: 'm2', struckAt: '2026-10-21T00:00:00.500Z',
  }]);
  assert.deepEqual(loaded.busCosts, []);
  const costs = await loadBusExtras(stub({
    bus_costs: [{
      id: 'c', spent_on: '2026-10-20', kind: 'fuel', amount_cents: 9850, litres: '52.46', booking_id: 'b', note: null, logged_by: 'm1',
      logged_at: '2026-10-20T00:00:00+00:00', struck_by: null, struck_at: null,
    }],
  }) as never);
  assert.equal(costs.busCosts![0].litres, 52.46, 'numeric comes back as a string');
  await assert.rejects(loadBusExtras(stub({ bus_km: { message: 'boom', code: 'X' } }) as never), { message: 'boom' });
});

test('demo data: Diesel has the keys, the readings are in order, and the costs are in the summary', () => {
  assert.ok((DEMO_DATA.busKeys ?? []).length > 0);
  const live = (DEMO_DATA.busKm ?? []).filter((r) => !r.struckAt).sort((a, b) => (a.readOn < b.readOn ? -1 : 1));
  for (let i = 1; i < live.length; i++) assert.ok(live[i].km >= live[i - 1].km, 'in order');
  assert.ok((DEMO_DATA.busCosts ?? []).length > 0);
});
