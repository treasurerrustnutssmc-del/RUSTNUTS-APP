import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BIG4_AHEAD,
  BIG4_CLUB_ONLY,
  BIG4_CLUB_STATUS,
  BIG4_GROUND,
  BIG4_NEC_ONLY,
  SUPPORTERS_NO_BIG4,
  appliesTo,
  big4Board,
  big4CrewProblem,
  big4Eligibility,
  big4GoingProblem,
  big4WaiverProblem,
  isBig4Waived,
  needsMeetingsText,
  canDesignateBig4,
  designateBig4Problem,
  isBig4,
  undesignateBig4Problem,
} from './big4';
import { club, member, ride, session, who } from './stage4.testkit';
import type { Attendance, Big4Ground, Big4Ride, Big4Waiver, ClubData, Position } from './types';

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

// ---------------------------------------------------------------------------
// Who can say Going on a Big 4 (5.4, 5.8), and the board's excuse for one Big 4
// ---------------------------------------------------------------------------

const waiver = (rideId: string, memberId: string, ground: Big4Ground = 'work'): Big4Waiver => ({
  rideId, memberId, ground, grantedBy: 'sec', grantedAt: '2026-10-20T00:00:00Z',
});
// Three West meetings before the Big 4 on 7 Nov; "rider" made one, "sec" two.
const big4Club = (over: Partial<ClubData> = {}) =>
  club({
    members: [...club().members, member('sup', { status: 'supporter' }), member('fam', { status: 'family' }), member('nomad', { status: 'nomad' })],
    checkinSessions: [session('m1', { heldOn: '2026-08-20' }), session('m2', { heldOn: '2026-09-20' }), session('m3', { heldOn: '2026-10-20' })],
    attendance: [came('m3', 'rider'), came('m3', 'sec'), came('m2', 'sec')],
    big4Rides: [big4('r-club')],
    ...over,
  });

test('needsMeetingsText says how many of how many', () => {
  assert.equal(needsMeetingsText({ needed: 2, of: 3 }), '2 of the last 3 meetings');
  assert.equal(needsMeetingsText({ needed: 2, of: 2 }), '2 of the last 2 meetings');
  assert.equal(needsMeetingsText({ needed: 1, of: 1 }), 'the last meeting');
});

test('Going on a Big 4: FNGs, Full Members and Nomads with 2 of the last 3 meetings (5.4)', () => {
  const data = big4Club();
  assert.equal(big4GoingProblem(who(data, 'sec'), 'r-club', 'going', data, today), null);
  assert.equal(
    big4GoingProblem(who(data, 'rider'), 'r-club', 'going', data, today),
    'You need 2 of the last 3 meetings to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance.',
  );
  // Maybe and Can't make it always work.
  assert.equal(big4GoingProblem(who(data, 'rider'), 'r-club', 'maybe', data, today), null);
  assert.equal(big4GoingProblem(who(data, 'rider'), 'r-club', 'no', data, today), null);
  // Not a Big 4: no rule.
  assert.equal(big4GoingProblem(who(data, 'rider'), 'r-west', 'going', data, today), null);
  // North has held no meetings: nothing needed.
  assert.equal(big4GoingProblem(who(data, 'northsec'), 'r-club', 'going', data, today), null);
  // A Big 4 for another chapter still needs it.
  const westOnly = big4Club({ big4Rides: [big4('r-club', 'north')] });
  assert.notEqual(big4GoingProblem(who(westOnly, 'rider'), 'r-club', 'going', westOnly, today), null);
});

test('Supporters and anyone without Club status can’t say Going on a Big 4 (5.8)', () => {
  const data = big4Club();
  assert.equal(big4GoingProblem(who(data, 'sup'), 'r-club', 'going', data, today), SUPPORTERS_NO_BIG4);
  assert.equal(big4GoingProblem(who(data, 'fam'), 'r-club', 'going', data, today), BIG4_CLUB_STATUS);
  assert.equal(big4GoingProblem(who(data, 'legacy'), 'r-club', 'going', data, today), BIG4_CLUB_STATUS);
  assert.equal(big4GoingProblem(who(data, 'sup'), 'r-club', 'maybe', data, today), null);
  // An excuse doesn't make a Supporter eligible.
  const excused = big4Club({ big4Waivers: [waiver('r-club', 'sup')] });
  assert.equal(big4GoingProblem(who(excused, 'sup'), 'r-club', 'going', excused, today), SUPPORTERS_NO_BIG4);
});

test('the board’s excuse for one Big 4 lets them say Going', () => {
  const data = big4Club({ big4Waivers: [waiver('r-club', 'rider', 'family')] });
  assert.equal(big4GoingProblem(who(data, 'rider'), 'r-club', 'going', data, today), null);
  assert.equal(isBig4Waived('r-club', 'rider', data), true);
  assert.equal(isBig4Waived('r-west', 'rider', data), false);
});

test('a manager can’t put someone ineligible on a Big 4 crew', () => {
  const data = big4Club();
  assert.equal(big4CrewProblem(who(data, 'rider'), 'r-club', data, today), 'They need 2 of the last 3 meetings to ride this Big 4 (5.4).');
  assert.equal(big4CrewProblem(who(data, 'sec'), 'r-club', data, today), null);
  assert.equal(big4CrewProblem(who(data, 'rider'), 'r-west', data, today), null);
  const excused = big4Club({ big4Waivers: [waiver('r-club', 'rider')] });
  assert.equal(big4CrewProblem(who(excused, 'rider'), 'r-club', excused, today), null);
});

test('meetings on the same day: the ones they came to count first, whatever the ids', () => {
  const data = club({
    checkinSessions: [
      session('a', { heldOn: '2026-10-20' }), session('b', { heldOn: '2026-10-20' }), session('c', { heldOn: '2026-10-20' }),
      session('d', { heldOn: '2026-10-20' }),
    ],
    attendance: [came('d', 'rider'), came('a', 'rider')],
  });
  assert.deepEqual(big4Eligibility(member('rider'), '2026-11-07', data, today), { attended: 2, of: 3, needed: 2, ok: true });
});

test('excusing someone from 5.4 for one Big 4: their chapter’s board, before the ride', () => {
  const now = '2026-10-24T00:00:00.000Z';
  const data = big4Club({
    rides: [...club().rides, ride('r-gone', { category: 'club', startsAt: '2026-10-20T21:00:00.000Z' })],
    big4Rides: [big4('r-club'), big4('r-off'), big4('r-gone')],
  });
  const sec = who(data, 'sec');
  assert.equal(big4WaiverProblem(sec, 'r-club', 'rider', 'work', data, now), null);
  assert.equal(big4WaiverProblem(sec, 'r-club', 'rider', null, data, now), null);
  assert.equal(big4WaiverProblem(sec, 'nope', 'rider', 'work', data, now), 'No such ride.');
  assert.equal(big4WaiverProblem(sec, 'r-west', 'rider', 'work', data, now), 'That ride isn’t a Big 4.');
  assert.equal(big4WaiverProblem(sec, 'r-off', 'rider', 'work', data, now), 'That ride was cancelled.');
  assert.equal(big4WaiverProblem(sec, 'r-gone', 'rider', 'work', data, now), 'That ride has already started.');
  assert.equal(big4WaiverProblem(sec, 'r-club', 'ghost', 'work', data, now), 'That member no longer exists.');
  assert.equal(big4WaiverProblem(who(data, 'northsec'), 'r-club', 'rider', 'work', data, now), 'Only their chapter’s board can excuse them.');
  assert.equal(big4WaiverProblem(who(data, 'rider'), 'r-club', 'rider', 'work', data, now), 'Only their chapter’s board can excuse them.');
  assert.equal(big4WaiverProblem(sec, 'r-club', 'sec', 'work', data, now), 'Someone else on the board has to excuse you.');
  assert.equal(big4WaiverProblem(sec, 'r-club', 'rider', 'bored' as Big4Ground, data, now), BIG4_GROUND);
  assert.equal(big4WaiverProblem(null, 'r-club', 'rider', 'work', data, now), 'Only their chapter’s board can excuse them.');
});

test('the board sees which of its members aren’t eligible for a Big 4 yet', () => {
  const data = big4Club({
    members: [...big4Club().members, member('fresh', { status: 'fng' }), member('away', { status: 'nomad', chapterId: 'north' })],
    big4Waivers: [waiver('r-club', 'fng')],
  });
  const { notYet, excused } = big4Board('r-club', 'west', data, today);
  // rider made 1 of 3; fresh and nomad made none; fng is excused; sup and fam aren't Club status.
  assert.deepEqual(notYet.map((m) => m.id).sort(), ['fresh', 'nomad', 'rider', 'tre']);
  assert.deepEqual(excused.map((w) => w.memberId), ['fng']);
});
