import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIG4_AHEAD,
  BIG4_CLUB_ONLY,
  BIG4_NEC_ONLY,
  appliesTo,
  big4Eligibility,
  canDesignateBig4,
  designateBig4Problem,
  isBig4,
  undesignateBig4Problem,
} from './big4';
import { club, member, ride, session, who } from './stage4.testkit';
import type { Attendance, Big4Ride, Position } from './types';

const today = '2026-10-24';
const big4 = (rideId: string, chapterId: string | null = null): Big4Ride => ({ rideId, chapterId, designatedBy: 'chair', designatedAt: '2026-10-01T00:00:00Z' });
const pres: Position = { id: 'p-pres', memberId: 'rider', chapterId: 'west', role: 'president', startedOn: '2026-08-01', endedOn: null };
const came = (sessionId: string, memberId: string): Attendance => ({ sessionId, memberId, checkedInAt: '2026-10-01T09:00:00Z', markedBy: null });

test('a Big 4 is a designated ride, for the whole club or one chapter', () => {
  const data = club({ big4Rides: [big4('r-club'), big4('r-west', 'west')] });
  assert.equal(isBig4('r-club', data), true);
  assert.equal(isBig4('r-off', data), false);
  assert.equal(appliesTo(big4('r-club'), who(data, 'northsec')), true);
  assert.equal(appliesTo(big4('r-west', 'west'), who(data, 'northsec')), false);
  assert.equal(appliesTo(big4('r-west', 'west'), who(data, 'rider')), true);
});

test('the NEC designates: the Chair, a President or the National Secretary', () => {
  const data = club({ positions: [...club().positions, pres, { id: 'p-ns', memberId: 'tre', chapterId: null, role: 'nec_secretary', startedOn: '2026-08-01', endedOn: null }] });
  assert.equal(canDesignateBig4(who(data, 'chair'), data.positions), true);
  assert.equal(canDesignateBig4(who(data, 'rider'), data.positions), true);
  assert.equal(canDesignateBig4(who(data, 'tre'), data.positions), true);
  assert.equal(canDesignateBig4(who(data, 'sec'), data.positions), false);
  assert.equal(canDesignateBig4(who(data, 'auditor'), data.positions), false);
  assert.equal(canDesignateBig4(null, data.positions), false);
});

test('designating a Big 4: Club-only rides, ahead of time', () => {
  const data = club({
    rides: [...club().rides, ride('r-sup', { category: 'supported' }), ride('r-past', { startsAt: '2026-10-20T21:00:00.000Z' }), ride('r-today', { startsAt: '2026-10-23T21:00:00.000Z' })],
  });
  const chair = who(data, 'chair');
  assert.equal(designateBig4Problem(chair, 'r-club', null, data, today), null);
  assert.equal(designateBig4Problem(chair, 'r-west', 'west', data, today), null);
  assert.equal(designateBig4Problem(who(data, 'sec'), 'r-club', null, data, today), BIG4_NEC_ONLY);
  assert.equal(designateBig4Problem(chair, 'nope', null, data, today), 'No such ride.');
  assert.equal(designateBig4Problem(chair, 'r-off', null, data, today), 'That ride was cancelled.');
  assert.equal(designateBig4Problem(chair, 'r-sup', null, data, today), BIG4_CLUB_ONLY);
  assert.equal(designateBig4Problem(chair, 'r-past', null, data, today), BIG4_AHEAD);
  // 21:00Z on the 23rd is 8 am on the 24th in Melbourne: today, too late.
  assert.equal(designateBig4Problem(chair, 'r-today', null, data, today), BIG4_AHEAD);
  assert.equal(designateBig4Problem(chair, 'r-club', 'nowhere', data, today), 'No such chapter.');
});

test('undesignating a Big 4 has the same limits', () => {
  const data = club({
    rides: [...club().rides, ride('r-past', { startsAt: '2026-10-20T21:00:00.000Z' })],
    big4Rides: [big4('r-club'), big4('r-past')],
  });
  const chair = who(data, 'chair');
  assert.equal(undesignateBig4Problem(chair, 'r-club', data, today), null);
  assert.equal(undesignateBig4Problem(who(data, 'rider'), 'r-club', data, today), BIG4_NEC_ONLY);
  assert.equal(undesignateBig4Problem(chair, 'r-west', data, today), 'That ride isn’t a Big 4.');
  assert.equal(undesignateBig4Problem(chair, 'r-past', data, today), BIG4_AHEAD);
});

test('Big 4 eligibility: two of the three most recent official meetings (5.4)', () => {
  const meetings = [
    session('m1', { heldOn: '2026-07-20' }),
    session('m2', { heldOn: '2026-08-20' }),
    session('m3', { heldOn: '2026-09-20', meetingType: 'special' }),
    session('m4', { heldOn: '2026-10-20' }),
    session('ev', { heldOn: '2026-10-21', meetingType: 'event' }),
    session('nm', { heldOn: '2026-10-21', chapterId: 'north' }),
    session('later', { heldOn: '2026-11-20' }),
  ];
  const rider = member('rider');
  const base = club({ checkinSessions: meetings });
  // Last three before 7 Nov: m4, m3, m2. Events and other chapters don't count.
  let r = big4Eligibility(rider, '2026-11-07', { ...base, attendance: [came('m4', 'rider'), came('m1', 'rider'), came('ev', 'rider'), came('nm', 'rider')] }, today);
  assert.deepEqual(r, { attended: 1, of: 3, needed: 2, ok: false });
  r = big4Eligibility(rider, '2026-11-07', { ...base, attendance: [came('m4', 'rider'), came('m3', 'rider')] }, today);
  assert.deepEqual(r, { attended: 2, of: 3, needed: 2, ok: true });
  // An excused meeting is skipped: the three become m4, m2, m1.
  r = big4Eligibility(rider, '2026-11-07', {
    ...base,
    attendance: [came('m4', 'rider'), came('m1', 'rider')],
    exemptions: [{ sessionId: 'm3', memberId: 'rider', reason: 'Work', grantedBy: 'sec', grantedAt: '2026-09-21T00:00:00Z' }],
  }, today);
  assert.deepEqual(r, { attended: 2, of: 3, needed: 2, ok: true });
  // Only one meeting held so far: that one is needed.
  r = big4Eligibility(rider, '2026-07-25', { ...base, attendance: [] }, today);
  assert.deepEqual(r, { attended: 0, of: 1, needed: 1, ok: false });
  // A meeting still to come doesn't count: on 15 Oct, m4 (20 Oct) hasn't happened.
  r = big4Eligibility(rider, '2026-11-07', { ...base, attendance: [came('m3', 'rider'), came('m2', 'rider')] }, '2026-10-15');
  assert.deepEqual(r, { attended: 2, of: 3, needed: 2, ok: true });
  // None held: nothing needed.
  r = big4Eligibility(rider, '2026-07-01', { ...base, attendance: [] }, today);
  assert.deepEqual(r, { attended: 0, of: 0, needed: 0, ok: true });
});

test('a meeting they were excused from but came to still counts (5.4)', () => {
  const data = club({
    checkinSessions: [session('m1', { heldOn: '2026-08-20' }), session('m2', { heldOn: '2026-09-20' }), session('m3', { heldOn: '2026-10-20' })],
    attendance: [came('m3', 'rider'), came('m2', 'rider')],
    exemptions: [{ sessionId: 'm3', memberId: 'rider', reason: 'Work', grantedBy: 'sec', grantedAt: '2026-10-01T00:00:00Z' }],
  });
  assert.deepEqual(big4Eligibility(member('rider'), '2026-11-07', data, today), { attended: 2, of: 3, needed: 2, ok: true });
});
