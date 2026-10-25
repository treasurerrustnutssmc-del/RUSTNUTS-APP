import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agmAssumed, agmOn, clubYearLabel, clubYearOf, patchInCharge, proRata, recordAgmProblem, RECORD_AGM_ONLY } from './clubYear';
import type { ClubData, Member, Position } from './types';

const agms = [{ year: 2026, heldOn: '2026-08-20' }];

test('the club year runs from one AGM to the next, assuming 1 August until one is recorded', () => {
  assert.equal(agmOn(2026, agms), '2026-08-20');
  assert.equal(agmOn(2027, agms), '2027-08-01');
  assert.equal(agmAssumed(2026, agms), false);
  assert.equal(agmAssumed(2027, agms), true);
  assert.equal(clubYearOf('2026-08-10', agms), 2025, 'before the recorded AGM is still last year');
  assert.equal(clubYearOf('2026-08-20', agms), 2026, 'the AGM day starts the new year');
  assert.equal(clubYearOf('2027-03-01', agms), 2026);
  assert.equal(clubYearOf('2027-08-01', agms), 2027, 'the assumed 1 August');
  assert.equal(clubYearOf('2027-07-31', []), 2026);
  assert.equal(clubYearLabel(2026), '2026–27');
  assert.equal(clubYearLabel(2099), '2099–00');
});

test('patched partway through a year pays for the whole months left, to the nearest dollar', () => {
  assert.deepEqual(proRata(36000, '2026-10-15', 2026, agms), { cents: 30000, months: 10 }, 'October to August');
  assert.deepEqual(proRata(36000, '2027-01-02', 2026, agms), { cents: 21000, months: 7 });
  assert.deepEqual(proRata(36000, '2027-07-31', 2026, agms), { cents: 3000, months: 1 });
  assert.deepEqual(proRata(10000, '2026-10-15', 2026, agms), { cents: 8300, months: 10 }, '$83.33 rounds to $83');
});

test('patched on or before the AGM, or in the AGM’s own month, pays the full year', () => {
  assert.deepEqual(proRata(36000, '2026-08-20', 2026, agms), { cents: 36000, months: 12 });
  assert.deepEqual(proRata(36000, '2020-04-18', 2026, agms), { cents: 36000, months: 12 });
  assert.deepEqual(proRata(36000, '2026-08-25', 2026, agms), { cents: 36000, months: 12 });
});

const member = (over: Partial<Member>): Member => ({
  id: 'fred', chapterId: 'west', fullName: 'Fred Nash', roadName: null, status: 'fng', approval: 'approved', joinedOn: '2025-01-01',
  patchedOn: null, fngStartedOn: '2025-09-01', bio: null, sharePhone: false, appliedOn: '2025-01-01', onHiatus: false, ...over,
} as Member);

const data = (over: Partial<ClubData> = {}): ClubData => ({
  chapters: [], members: [], privates: [], bikes: [], registrations: [], emergencyContacts: [], positions: [], rides: [], rsvps: [],
  agms,
  feeRates: [{ chapterId: 'west', fy: 2026, status: 'full', amountCents: 36000, dueOn: '2026-12-31' }],
  charges: [],
  ...over,
} as ClubData);

test('being patched in adds that year’s Full fee, pro rata', () => {
  const before = member({});
  const after = member({ status: 'full', patchedOn: '2026-10-15' });
  assert.deepEqual(patchInCharge(before, after, data(), '2026-10-15'), {
    memberId: 'fred', chapterId: 'west', fy: 2026, kind: 'annual', description: 'Pro rata, 10 of 12 months',
    amountCents: 30000, dueOn: '2026-12-31', waivedAt: null,
  });
});

test('a patch-in late in the year is due 30 days on, not on a date already gone', () => {
  const after = member({ status: 'full', patchedOn: '2027-03-01' });
  assert.equal(patchInCharge(member({}), after, data(), '2027-03-01')?.dueOn, '2027-03-31');
});

test('no patch-in fee without a Full rate, when already charged, from Nomad, or on hiatus', () => {
  const after = member({ status: 'full', patchedOn: '2026-10-15' });
  assert.equal(patchInCharge(member({}), after, data({ feeRates: [] }), '2026-10-15'), null);
  const charged = data({ charges: [{ id: 'c1', memberId: 'fred', chapterId: 'west', fy: 2026, kind: 'annual', description: null,
    amountCents: 5000, dueOn: '2026-12-31', createdAt: '', waivedAt: null }] });
  assert.equal(patchInCharge(member({}), after, charged, '2026-10-15'), null);
  assert.equal(patchInCharge(member({ status: 'nomad' }), after, data(), '2026-10-15'), null);
  assert.equal(patchInCharge(member({ onHiatus: true }), member({ status: 'full', onHiatus: true }), data(), '2026-10-15'), null);
  assert.equal(patchInCharge(member({}), member({ status: 'supporter' }), data(), '2026-10-15'), null);
});

test('only the National Chairman or Secretary records the AGM', () => {
  const pos = (role: Position['role']): Position[] => [{ id: 'p', memberId: 'm', chapterId: null, role, startedOn: '2025-01-01', endedOn: null }];
  const me = member({ id: 'm', status: 'full' });
  assert.equal(recordAgmProblem(me, pos('nec_chair')), null);
  assert.equal(recordAgmProblem(me, pos('nec_secretary')), null);
  assert.equal(recordAgmProblem(me, pos('treasurer')), RECORD_AGM_ONLY);
  assert.equal(recordAgmProblem(null, []), RECORD_AGM_ONLY);
  assert.equal(RECORD_AGM_ONLY, 'Only the National Chairman or Secretary records the AGM.');
});
