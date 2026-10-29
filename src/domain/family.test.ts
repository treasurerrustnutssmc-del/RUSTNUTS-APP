import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATA } from '../data/demoData';
import { accessLevel, canSeeDirectory, canSeeMember, canSeePhone, isFamily, visibleMembers } from './access';
import { approvalProblem, directProblem, readProblem, type Conversation } from './chat';
import { asksToSign } from './roadRules';
import { askedToSignDocument } from './documents';
import type { ClubDocument } from './types';
import { nextRides } from './family';

const d = DEMO_DATA;
const m = (id: string) => d.members.find((x) => x.id === id)!;
const kerry = m('m-kerry');

test('an approved Family person has the family access level', () => {
  assert.equal(accessLevel(kerry, d.positions), 'family');
  assert.equal(isFamily(kerry), true);
  assert.equal(isFamily(m('m-spanner')), false);
  assert.equal(isFamily({ ...kerry, approval: 'pending' }), false);
  assert.equal(accessLevel({ ...kerry, approval: 'pending' }, d.positions), 'pending');
});

test('family see themselves, not the directory or anyone’s phone', () => {
  assert.equal(canSeeDirectory(kerry), false);
  assert.equal(canSeeMember(kerry, kerry, d.positions), true);
  assert.equal(canSeeMember(kerry, m('m-spanner'), d.positions), false);
  assert.equal(canSeePhone(kerry, m('m-spanner'), d.positions), false); // Spanner shares his number
  assert.deepEqual(visibleMembers(kerry, d).map((x) => x.id), ['m-kerry']);
});

test('members still see family in the directory', () => {
  assert.equal(canSeeMember(m('m-spanner'), kerry, d.positions), true);
});

test('family don’t use the club chats, and nobody opens a private chat with them', () => {
  const club: Conversation = { id: 'c-club', kind: 'club', chapterId: null, rideId: null, committee: null, pinnedMessageId: null, memberIds: [] };
  assert.equal(approvalProblem(kerry), 'Only approved members can do that.');
  assert.equal(readProblem(kerry, club, d), 'Only approved members can do that.');
  assert.equal(directProblem(m('m-spanner'), kerry), 'Family don’t use the club chats.');
});

test('family aren’t asked to sign the Road Rules or club documents', () => {
  assert.equal(asksToSign(kerry), false);
  const doc = { id: 'doc', chapterId: null, asksSignOff: true } as unknown as ClubDocument;
  const asked = askedToSignDocument(doc, d).map((x) => x.id);
  assert.ok(!asked.includes('m-kerry'));
});

test('Home shows the next few rides on the calendar, in date order, cancelled ones included', () => {
  const ride = (id: string, startsAt: string, cancelledAt: string | null = null) => ({
    id, title: id, startsAt, endsAt: null, allDay: false, location: null, notes: null, category: 'club' as const, cancelledAt,
  });
  const rides = [
    ride('later', '2026-11-20T00:00:00.000Z'),
    ride('past', '2026-10-01T00:00:00.000Z'),
    ride('soon', '2026-11-02T00:00:00.000Z', '2026-10-30T00:00:00.000Z'),
    ride('next', '2026-11-01T00:00:00.000Z'),
    ride('last', '2026-12-20T00:00:00.000Z'),
  ];
  assert.deepEqual(nextRides(rides, '2026-10-29').map((r) => r.id), ['next', 'soon', 'later']);
  assert.deepEqual(nextRides(rides, '2026-10-29', 5).map((r) => r.id), ['next', 'soon', 'later', 'last']);
  assert.deepEqual(nextRides([], '2026-10-29'), []);
});
