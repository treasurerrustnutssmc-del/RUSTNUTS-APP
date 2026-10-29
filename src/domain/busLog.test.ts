import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALREADY_HAS_KEYS,
  ALREADY_STRUCK,
  BAD_AMOUNT,
  BAD_KM,
  BAD_LITRES,
  BUS_COST_KINDS,
  KEYS_BAD_MEMBER,
  KM_OUT_OF_ORDER,
  LITRES_NOT_FUEL,
  LOG_BAD_DAY,
  LOG_NOTE_TOO_LONG,
  LOG_NOT_BOOKED,
  NOT_BUS_HAND,
  NOT_STRIKER,
  NO_COST_KIND,
  NO_ENTRY,
  bookingKm,
  busCostKindLabel,
  costYears,
  handKeysProblem,
  isBusHand,
  keyHolder,
  latestReading,
  logCostProblem,
  logKmProblem,
  roundLitres,
  strikeCostProblem,
  strikeKmProblem,
  visibleCosts,
  yearSummary,
  type CostInput,
  type KmInput,
} from './busLog';
import type { BusBooking, BusCost, BusKeyHandover, BusKm, ClubData, Member, Position, PositionRole } from './types';

const TODAY = '2026-10-29';

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'ch-west', fullName: `Full ${id}`, roadName: id, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});
const position = (memberId: string, role: PositionRole, chapterId: string | null): Position => ({
  id: `p-${memberId}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null,
});
const booking = (id: string, status: BusBooking['status']): BusBooking => ({
  id, firstDay: '2026-10-20', lastDay: '2026-10-21', purpose: 'recovery', rideId: null, driverId: 'rider', notes: '',
  status, bookedBy: 'rider', bookedAt: '2026-10-01T00:00:00.000Z', decidedBy: null, decidedAt: null, declineReason: '',
  cancelledBy: null, cancelledAt: null,
});
const handover = (id: string, toId: string | null, loggedAt: string): BusKeyHandover => ({
  id, toId, note: '', loggedBy: 'treasurer', loggedAt,
});
const reading = (id: string, km: number, readOn: string, over: Partial<BusKm> = {}): BusKm => ({
  id, km, readOn, bookingId: null, note: '', loggedBy: 'rider', loggedAt: `${readOn}T01:00:00.000Z`, struckBy: null, struckAt: null, ...over,
});
const cost = (id: string, kind: BusCost['kind'], amountCents: number, spentOn: string, over: Partial<BusCost> = {}): BusCost => ({
  id, spentOn, kind, amountCents, litres: null, bookingId: null, note: '', loggedBy: 'rider', loggedAt: `${spentOn}T01:00:00.000Z`,
  struckBy: null, struckAt: null, ...over,
});

// The cast: treasurer holds a board seat (a bus manager); rider and nomad can book; fng holds the
// keys (so is a bus hand); supporter and pending can do nothing.
const treasurer = member('treasurer', { status: 'supporter' });
const rider = member('rider');
const nomad = member('nomad', { status: 'nomad' });
const fng = member('fng', { status: 'fng' });
const supporter = member('supporter', { status: 'supporter' });
const pending = member('pending', { approval: 'pending' });

const data = (over: Partial<ClubData> = {}): ClubData => ({
  chapters: [], members: [treasurer, rider, nomad, fng, supporter, pending],
  privates: [], bikes: [], registrations: [], emergencyContacts: [],
  positions: [position('treasurer', 'treasurer', 'ch-west')],
  rides: [], rsvps: [],
  busBookings: [booking('booked', 'approved'), booking('waiting', 'requested'), booking('off', 'cancelled')],
  busKeys: [handover('k-1', 'rider', '2026-09-01T00:00:00.000Z'), handover('k-2', 'fng', '2026-10-20T00:00:00.000Z')],
  busKm: [reading('km-1', 120_000, '2026-08-01'), reading('km-2', 120_500, '2026-09-01'), reading('km-3', 121_000, '2026-10-01')],
  busCosts: [],
  ...over,
});

const KM: KmInput = { km: 121_200, readOn: TODAY, bookingId: null, note: '' };
const COST: CostInput = { spentOn: TODAY, kind: 'fuel', amountCents: 9_850, litres: 52.4, bookingId: null, note: 'Shell Bacchus Marsh' };

test('the messages are the spec’s words, with the curly ’', () => {
  assert.equal(NOT_BUS_HAND, 'Only Full and Nomad members, the board or whoever has the keys can log the Rusty Bus.');
  assert.equal(KEYS_BAD_MEMBER, 'Pick someone who’s an approved member.');
  assert.equal(ALREADY_HAS_KEYS, 'They already have the keys.');
  assert.equal(LOG_NOTE_TOO_LONG, 'Keep the note to 200 characters at most.');
  assert.equal(LOG_BAD_DAY, 'Pick the day, today or earlier.');
  assert.equal(BAD_KM, 'The odometer is in whole km, up to 2,000,000.');
  assert.equal(KM_OUT_OF_ORDER, 'That reading is out of order with the ones before and after it.');
  assert.equal(LOG_NOT_BOOKED, 'Pick a Booked booking.');
  assert.equal(NO_COST_KIND, 'Pick what it was for.');
  assert.equal(BAD_AMOUNT, 'Enter an amount from $0.01 to $100,000.');
  assert.equal(LITRES_NOT_FUEL, 'Only fuel takes litres.');
  assert.equal(BAD_LITRES, 'Litres: more than 0, up to 1000.');
  assert.equal(NO_ENTRY, 'No such entry.');
  assert.equal(NOT_STRIKER, 'Only whoever logged it or the board can strike it out.');
  assert.equal(ALREADY_STRUCK, 'That’s already struck out.');
});

test('the cost kinds and their labels', () => {
  assert.deepEqual(BUS_COST_KINDS, ['fuel', 'service', 'repairs', 'tyres', 'rego', 'insurance', 'tolls', 'cleaning', 'other']);
  assert.deepEqual(BUS_COST_KINDS.map(busCostKindLabel), ['Fuel', 'Service', 'Repairs', 'Tyres', 'Rego', 'Insurance', 'Tolls', 'Cleaning', 'Other']);
});

test('bus hands: Full, Nomad, bus managers and whoever has the keys', () => {
  const d = data();
  assert.equal(isBusHand(rider, d), true);
  assert.equal(isBusHand(nomad, d), true);
  assert.equal(isBusHand(treasurer, d), true);
  assert.equal(isBusHand(fng, d), true, 'has the keys');
  assert.equal(isBusHand(fng, data({ busKeys: [] })), false, 'no keys, no hand');
  assert.equal(isBusHand(supporter, d), false);
  assert.equal(isBusHand(pending, d), false);
  assert.equal(isBusHand(pending, data({ busKeys: [handover('k', 'pending', '2026-10-28T00:00:00.000Z')] })), false, 'not approved');
  assert.equal(isBusHand(null, d), false);
});

test('the key holder is the newest handover’s, or nobody', () => {
  assert.equal(keyHolder(data())?.toId, 'fng');
  assert.equal(keyHolder(data({ busKeys: [handover('a', 'rider', '2026-10-25T00:00:00.000Z'), handover('b', 'nomad', '2026-10-01T00:00:00.000Z')] }))?.toId, 'rider');
  assert.equal(keyHolder(data({ busKeys: [] })), undefined);
  assert.equal(keyHolder(data({ busKeys: undefined })), undefined);
});

test('handing over the keys: the checks in order', () => {
  const d = data();
  assert.equal(handKeysProblem(null, 'rider', '', d), 'Sign in first.');
  assert.equal(handKeysProblem(pending, 'rider', '', d), 'Only approved members can do that.');
  assert.equal(handKeysProblem(supporter, 'rider', '', d), NOT_BUS_HAND);
  assert.equal(handKeysProblem(rider, null, '', d), KEYS_BAD_MEMBER);
  assert.equal(handKeysProblem(rider, 'pending', '', d), KEYS_BAD_MEMBER);
  assert.equal(handKeysProblem(rider, 'nobody', '', d), KEYS_BAD_MEMBER);
  assert.equal(handKeysProblem(rider, 'fng', '', d), ALREADY_HAS_KEYS);
  assert.equal(handKeysProblem(rider, 'nomad', 'x'.repeat(201), d), LOG_NOTE_TOO_LONG);
  assert.equal(handKeysProblem(rider, 'nomad', `  ${'x'.repeat(200)}  `, d), null, 'trimmed first');
  assert.equal(handKeysProblem(rider, 'nomad', '🔑'.repeat(200), d), null, 'counts code points');
  assert.equal(handKeysProblem(fng, 'supporter', '', d), null, 'the holder hands them to anyone approved');
  assert.equal(handKeysProblem(rider, 'rider', '', data({ busKeys: [] })), null, 'the first handover');
});

test('logging km: the checks in order', () => {
  const d = data();
  assert.equal(logKmProblem(null, KM, d, TODAY), 'Sign in first.');
  assert.equal(logKmProblem(pending, KM, d, TODAY), 'Only approved members can do that.');
  assert.equal(logKmProblem(supporter, KM, d, TODAY), NOT_BUS_HAND);
  assert.equal(logKmProblem(rider, { ...KM, readOn: '' }, d, TODAY), LOG_BAD_DAY);
  assert.equal(logKmProblem(rider, { ...KM, readOn: '2026-02-30' }, d, TODAY), LOG_BAD_DAY);
  assert.equal(logKmProblem(rider, { ...KM, readOn: '2026-10-30' }, d, TODAY), LOG_BAD_DAY);
  for (const km of [0, -5, 1.5, 2_000_001, Number.NaN]) assert.equal(logKmProblem(rider, { ...KM, km }, d, TODAY), BAD_KM, String(km));
  assert.equal(logKmProblem(rider, { ...KM, km: 2_000_000 }, d, TODAY), null);
  assert.equal(logKmProblem(rider, { ...KM, km: 120_999 }, d, TODAY), KM_OUT_OF_ORDER, 'lower than one before');
  assert.equal(logKmProblem(rider, { ...KM, km: 121_000, readOn: '2026-10-01' }, d, TODAY), null, 'equal on the same day');
  assert.equal(logKmProblem(rider, { ...KM, km: 120_400, readOn: '2026-08-15' }, d, TODAY), null, 'fits between');
  assert.equal(logKmProblem(rider, { ...KM, km: 120_600, readOn: '2026-08-15' }, d, TODAY), KM_OUT_OF_ORDER, 'higher than one after');
  assert.equal(logKmProblem(rider, { ...KM, km: 120_500, readOn: '2026-08-31' }, d, TODAY), null, 'equal to one after');
  const struck = data({ busKm: [reading('km-x', 999_999, '2026-10-01', { struckBy: 'treasurer', struckAt: '2026-10-02T00:00:00.000Z' })] });
  assert.equal(logKmProblem(rider, KM, struck, TODAY), null, 'struck ones don’t count');
  assert.equal(logKmProblem(rider, { ...KM, bookingId: 'waiting' }, d, TODAY), LOG_NOT_BOOKED);
  assert.equal(logKmProblem(rider, { ...KM, bookingId: 'off' }, d, TODAY), LOG_NOT_BOOKED);
  assert.equal(logKmProblem(rider, { ...KM, bookingId: 'gone' }, d, TODAY), LOG_NOT_BOOKED);
  assert.equal(logKmProblem(rider, { ...KM, bookingId: 'booked' }, d, TODAY), null);
  assert.equal(logKmProblem(rider, { ...KM, note: 'x'.repeat(201) }, d, TODAY), LOG_NOTE_TOO_LONG);
  assert.equal(logKmProblem(fng, KM, d, TODAY), null, 'the key holder');
});

test('logging a cost: the checks in order', () => {
  const d = data();
  assert.equal(logCostProblem(null, COST, d, TODAY), 'Sign in first.');
  assert.equal(logCostProblem(pending, COST, d, TODAY), 'Only approved members can do that.');
  assert.equal(logCostProblem(supporter, COST, d, TODAY), NOT_BUS_HAND);
  assert.equal(logCostProblem(rider, { ...COST, spentOn: '2026-10-30' }, d, TODAY), LOG_BAD_DAY);
  assert.equal(logCostProblem(rider, { ...COST, kind: null }, d, TODAY), NO_COST_KIND);
  for (const c of [0, -1, 10_000_001, 1.5, Number.NaN]) assert.equal(logCostProblem(rider, { ...COST, amountCents: c }, d, TODAY), BAD_AMOUNT, String(c));
  assert.equal(logCostProblem(rider, { ...COST, amountCents: 1 }, d, TODAY), null);
  assert.equal(logCostProblem(rider, { ...COST, amountCents: 10_000_000 }, d, TODAY), null);
  assert.equal(logCostProblem(rider, { ...COST, kind: 'rego', litres: 5 }, d, TODAY), LITRES_NOT_FUEL);
  assert.equal(logCostProblem(rider, { ...COST, kind: 'rego', litres: null }, d, TODAY), null);
  for (const l of [0, -1, 1000.01, Number.NaN]) assert.equal(logCostProblem(rider, { ...COST, litres: l }, d, TODAY), BAD_LITRES, String(l));
  assert.equal(logCostProblem(rider, { ...COST, litres: 1000 }, d, TODAY), null);
  assert.equal(logCostProblem(rider, { ...COST, litres: null }, d, TODAY), null);
  assert.equal(logCostProblem(rider, { ...COST, bookingId: 'waiting' }, d, TODAY), LOG_NOT_BOOKED);
  assert.equal(logCostProblem(rider, { ...COST, note: 'x'.repeat(201) }, d, TODAY), LOG_NOTE_TOO_LONG);
  assert.equal(logCostProblem(fng, COST, d, TODAY), null);
});

test('litres are rounded to two decimals before the checks and the database', () => {
  assert.equal(roundLitres(52.456), 52.46);
  assert.equal(roundLitres(0.004), 0);
  assert.equal(roundLitres(null), null);
});

test('striking out: the checks in order', () => {
  const mine = reading('mine', 121_100, '2026-10-10', { loggedBy: 'rider' });
  const theirs = reading('theirs', 121_100, '2026-10-10', { loggedBy: 'nomad' });
  const struck = reading('struck', 1, '2026-10-10', { loggedBy: 'rider', struckBy: 'rider', struckAt: '2026-10-11T00:00:00.000Z' });
  const d = data({ busKm: [mine, theirs, struck] });
  assert.equal(strikeKmProblem(null, mine, d), 'Sign in first.');
  assert.equal(strikeKmProblem(pending, mine, d), 'Only approved members can do that.');
  assert.equal(strikeKmProblem(rider, undefined, d), NO_ENTRY);
  assert.equal(strikeKmProblem(rider, theirs, d), NOT_STRIKER);
  assert.equal(strikeKmProblem(rider, struck, d), ALREADY_STRUCK);
  assert.equal(strikeKmProblem(rider, mine, d), null);
  assert.equal(strikeKmProblem(treasurer, theirs, d), null, 'the board');
  // A member who logged it and has since lost the right to log can still strike their own.
  assert.equal(strikeKmProblem(supporter, reading('s', 1, '2026-10-10', { loggedBy: 'supporter' }), d), null);
  const c = cost('c', 'fuel', 100, '2026-10-10', { loggedBy: 'nomad' });
  assert.equal(strikeCostProblem(rider, c, d), NOT_STRIKER);
  assert.equal(strikeCostProblem(nomad, c, d), null);
  assert.equal(strikeCostProblem(nomad, { ...c, struckAt: '2026-10-11T00:00:00.000Z', struckBy: 'nomad' }, d), ALREADY_STRUCK);
  assert.equal(strikeCostProblem(nomad, undefined, d), NO_ENTRY);
});

test('the latest reading skips struck ones', () => {
  assert.equal(latestReading(data())?.id, 'km-3');
  const d = data({ busKm: [...data().busKm!, reading('km-4', 9_999_999, '2026-10-20', { struckBy: 'r', struckAt: '2026-10-21T00:00:00.000Z' })] });
  assert.equal(latestReading(d)?.id, 'km-3');
  assert.equal(latestReading(data({ busKm: [] })), undefined);
});

test('km run on a booking needs two readings', () => {
  const d = data({
    busKm: [
      reading('a', 121_000, '2026-10-20', { bookingId: 'booked' }),
      reading('b', 121_333, '2026-10-21', { bookingId: 'booked' }),
      reading('c', 130_000, '2026-10-21', { bookingId: 'booked', struckBy: 'x', struckAt: '2026-10-22T00:00:00.000Z' }),
    ],
  });
  assert.equal(bookingKm('booked', d), 333);
  assert.equal(bookingKm('waiting', d), null);
  assert.equal(bookingKm('booked', data({ busKm: [reading('a', 1, '2026-10-20', { bookingId: 'booked' })] })), null);
});

test('who sees which costs', () => {
  const costs = [cost('a', 'fuel', 100, '2026-10-01', { loggedBy: 'rider' }), cost('b', 'rego', 90_000, '2026-08-01', { loggedBy: 'nomad' })];
  const d = data({ busCosts: costs });
  assert.deepEqual(visibleCosts(treasurer, d).map((c) => c.id), ['a', 'b']);
  assert.deepEqual(visibleCosts(rider, d).map((c) => c.id), ['a']);
  assert.deepEqual(visibleCosts(supporter, d), []);
  assert.deepEqual(visibleCosts(null, d), []);
});

test('the years offered: this one plus any with a cost, newest first', () => {
  assert.deepEqual(costYears(data(), TODAY), [2026]);
  const d = data({ busCosts: [cost('a', 'fuel', 1, '2025-03-01'), cost('b', 'fuel', 1, '2026-06-30'), cost('c', 'fuel', 1, '2026-07-01')] });
  assert.deepEqual(costYears(d, TODAY), [2026, 2025, 2024]);
  assert.deepEqual(costYears(d, TODAY, [d.busCosts![0]]), [2026, 2024], 'only the costs given');
});

test('a year’s summary: totals by kind, litres, km run and cost per km', () => {
  const d = data({
    busCosts: [
      cost('rego', 'rego', 92_000, '2026-07-15'),
      cost('f1', 'fuel', 9_000, '2026-08-01', { litres: 50 }),
      cost('f2', 'fuel', 10_000, '2026-09-01', { litres: 55.5 }),
      cost('svc', 'service', 45_000, '2026-09-10'),
      cost('struck', 'repairs', 1_000_000, '2026-09-10', { struckBy: 'x', struckAt: '2026-09-11T00:00:00.000Z' }),
      cost('last-year', 'fuel', 7_000, '2026-06-30', { litres: 40 }),
    ],
    busKm: [
      reading('before', 119_000, '2026-06-20'),
      reading('in-1', 120_000, '2026-08-01'),
      reading('in-2', 121_000, '2026-10-01'),
    ],
  });
  const s = yearSummary(d, 2026);
  assert.equal(s.totalCents, 156_000);
  assert.deepEqual(s.byKind, [{ kind: 'rego', cents: 92_000 }, { kind: 'service', cents: 45_000 }, { kind: 'fuel', cents: 19_000 }]);
  assert.equal(s.litres, 105.5);
  assert.equal(s.kmRun, 2_000, 'from the last reading before the year');
  assert.equal(s.centsPerKm, 78);
  assert.equal(s.count, 4);
  // No reading before the year: from the year's first.
  const noBefore = yearSummary(data({ busCosts: [], busKm: [reading('a', 100, '2026-08-01'), reading('b', 400, '2026-09-01')] }), 2026);
  assert.equal(noBefore.kmRun, 300);
  assert.equal(noBefore.centsPerKm, null, 'nothing spent');
  // No readings in the year: no km run, no cost per km.
  const none = yearSummary(data({ busCosts: [cost('a', 'fuel', 100, '2026-08-01')], busKm: [reading('a', 100, '2026-05-01')] }), 2026);
  assert.equal(none.kmRun, null);
  assert.equal(none.centsPerKm, null);
  // One reading in the year, none before: 0 km, no cost per km.
  const one = yearSummary(data({ busCosts: [cost('a', 'fuel', 100, '2026-08-01')], busKm: [reading('a', 100, '2026-08-01')] }), 2026);
  assert.equal(one.kmRun, 0);
  assert.equal(one.centsPerKm, null);
});
