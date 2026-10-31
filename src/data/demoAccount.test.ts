// Delete my account in the demo: the member becomes "Former member", their personal rows go, and the
// club's records stay against the same id. The database does the same (account_deletion_test.sql).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { club, who } from '../domain/stage4.testkit';
import { FORMER_MEMBER, STEP_DOWN_FIRST } from '../domain/account';
import type { ClubData } from '../domain/types';
import { NotAllowedError } from './clubContext';
import { deleteMyAccount, type DemoCtx } from './demoActions';

const today = '2026-10-31';
const base = club({
  members: club().members.map((m) => (m.id === 'rider' ? { ...m, roadName: 'Rusty', bio: 'Rides a Shovel', sharePhone: true, onHiatus: true } : m)),
  privates: [{ memberId: 'rider', email: 'r@example.com', phone: '0400 000 000', licenceClass: 'full_open', licenceExpiry: null, firstAidExpiry: null }],
  bikes: [{ id: 'b1', memberId: 'rider', make: 'Harley', model: 'Shovel', year: 1978, nickname: null, isProject: false }],
  registrations: [{ bikeId: 'b1', rego: '1AB2CD', regoExpiry: null }],
  emergencyContacts: [{ id: 'e1', memberId: 'rider', name: 'Mum', relationship: 'Mum', phone: '0400 111 111' }],
  rsvps: [{ rideId: 'r-west', memberId: 'rider', answer: 'going' }],
  positions: [...club().positions, { id: 'p-tg', memberId: 'rider', chapterId: 'west', role: 'tail_gunner', startedOn: '2025-01-01', endedOn: null }],
  charges: [{ id: 'c1', memberId: 'rider', chapterId: 'west', kind: 'annual', amountCents: 36000, description: 'Fees', fy: '2026-27', raisedOn: today, waivedAt: null } as never],
});
const ctx = (id: string, data: ClubData = base): DemoCtx => ({ data, me: who(data, id), today });

test('deleting your account leaves a nameless "Former member" in the club’s records', () => {
  const after = deleteMyAccount(ctx('rider'));
  const gone = who(after, 'rider');
  assert.equal(gone.fullName, FORMER_MEMBER);
  assert.equal(gone.roadName, null);
  assert.equal(gone.bio, null);
  assert.equal(gone.sharePhone, false);
  assert.equal(gone.onHiatus, false);
  assert.equal(gone.approval, 'declined', 'out of the directory and every member check');
  assert.equal(after.privates.length, 0);
  assert.equal(after.bikes.length, 0);
  assert.equal(after.registrations.length, 0);
  assert.equal(after.emergencyContacts.length, 0);
  assert.equal(after.rsvps.length, 0);
  assert.equal(after.charges?.length, 1, 'the books keep the charge');
  assert.equal(after.positions.find((p) => p.id === 'p-tg')?.endedOn, today, 'a role that isn’t a seat ends that day');
});

test('a seat holder steps down first, and nothing changes', () => {
  assert.throws(() => deleteMyAccount(ctx('sec')), (e: unknown) => e instanceof NotAllowedError && e.message === STEP_DOWN_FIRST);
  assert.throws(() => deleteMyAccount({ data: base, me: null, today }), NotAllowedError);
});
