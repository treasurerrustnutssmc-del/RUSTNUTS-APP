import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceCount,
  canCheckIn,
  canRunCheckin,
  canSeeAttendance,
  checkInProblem,
  closeProblem,
  exemptionProblem,
  isExcused,
  meetingTypeOf,
  meetingTypeProblem,
  markProblem,
  normalizeCode,
  openCheckinProblem,
  qrPayload,
  rideChapterId,
} from './attendance';
import { club, member, ride, session, who } from './stage4.testkit';

const today = '2026-10-24';

test('codes are read however they were typed or scanned', () => {
  assert.equal(normalizeCode('rustnuts: ab c12 3'), 'ABC123');
  assert.equal(normalizeCode(qrPayload('RN2026')), 'RN2026');
  assert.equal(normalizeCode(' rn2026 '), 'RN2026');
});

test('a ride belongs to its chapter, or to the whole club', () => {
  const data = club();
  assert.equal(rideChapterId(ride('a', { category: 'north' }), data.chapters), 'north');
  assert.equal(rideChapterId(ride('b', { category: 'west' }), data.chapters), 'west');
  assert.equal(rideChapterId(ride('c', { category: 'club' }), data.chapters), null);
  assert.equal(rideChapterId(ride('d', { category: 'supported' }), data.chapters), null);
});

test('who runs a check-in: that chapter’s board; any board or the NEC for a whole-club ride', () => {
  const data = club();
  assert.equal(canRunCheckin(who(data, 'sec'), 'west', data.positions), true);
  assert.equal(canRunCheckin(who(data, 'northsec'), 'west', data.positions), false);
  assert.equal(canRunCheckin(who(data, 'northsec'), null, data.positions), true);
  assert.equal(canRunCheckin(who(data, 'chair'), 'west', data.positions), false, 'no West seat');
  assert.equal(canRunCheckin(who(data, 'chair'), null, data.positions), true);
  assert.equal(canRunCheckin(who(data, 'rider'), null, data.positions), false);
  assert.equal(canRunCheckin(null, null, data.positions), false);
});

test('who can check in: approved members and applicants in their introduction phase', () => {
  const data = club();
  assert.equal(canCheckIn(who(data, 'rider')), true);
  assert.equal(canCheckIn(who(data, 'legacy')), true);
  assert.equal(canCheckIn(who(data, 'applicant')), true);
  assert.equal(canCheckIn(who(data, 'supporterapp')), false);
  assert.equal(canCheckIn(member('gone', { approval: 'declined', status: 'introduced' })), false);
  assert.equal(canCheckIn(null), false);
});

test('opening a check-in', () => {
  const data = club({ checkinSessions: [session('s-ride', { kind: 'ride', rideId: 'r-club', chapterId: null })] });
  const sec = who(data, 'sec');
  const meeting = { kind: 'meeting' as const, rideId: null, chapterId: 'west', title: 'Club meeting', heldOn: today };
  assert.equal(openCheckinProblem(null, meeting, data, today), 'Sign in first.');
  assert.equal(openCheckinProblem(who(data, 'applicant'), meeting, data, today), 'Only approved members can do that.');
  assert.equal(openCheckinProblem(sec, meeting, data, today), null);
  assert.equal(openCheckinProblem(sec, { ...meeting, heldOn: '2026-11-02' }, data, today), null);
  assert.equal(openCheckinProblem(sec, { ...meeting, chapterId: null }, data, today), 'Pick a chapter.');
  assert.equal(openCheckinProblem(sec, { ...meeting, title: '  ' }, data, today), 'Add a title.');
  assert.equal(openCheckinProblem(sec, { ...meeting, heldOn: '2026-10-23' }, data, today), 'Pick today or a later date.');
  assert.equal(openCheckinProblem(who(data, 'rider'), meeting, data, today), 'Only that chapter’s board can open a check-in.');
  assert.equal(openCheckinProblem(who(data, 'northsec'), meeting, data, today), 'Only that chapter’s board can open a check-in.');

  const forRide = (rideId: string) => ({ kind: 'ride' as const, rideId, chapterId: null, title: '', heldOn: today });
  assert.equal(openCheckinProblem(sec, forRide('r-west'), data, today), null);
  assert.equal(openCheckinProblem(sec, forRide('nope'), data, today), 'No such ride.');
  assert.equal(openCheckinProblem(sec, forRide('r-off'), data, today), 'That ride was cancelled.');
  assert.equal(openCheckinProblem(sec, forRide('r-club'), data, today), 'Check-in for this ride is already open.');
  assert.equal(openCheckinProblem(who(data, 'northsec'), forRide('r-west'), data, today), 'Only that chapter’s board can open a check-in.');
});

test('checking in', () => {
  const data = club();
  const open = session('s1');
  assert.equal(checkInProblem(null, open, today), 'Sign in first.');
  assert.equal(checkInProblem(who(data, 'rider'), open, today), null);
  assert.equal(checkInProblem(who(data, 'applicant'), open, today), null);
  assert.equal(checkInProblem(who(data, 'supporterapp'), open, today), 'Only members and applicants can check in.');
  assert.equal(checkInProblem(who(data, 'rider'), undefined, today), 'That code doesn’t match a check-in.');
  assert.equal(checkInProblem(who(data, 'rider'), session('s2', { closedAt: '2026-10-24T09:00:00.000Z' }), today), 'That check-in has closed.');
  assert.equal(checkInProblem(who(data, 'rider'), session('s3', { heldOn: '2026-10-23' }), today), 'That check-in isn’t for today.');
});

test('ticking people off by hand', () => {
  const data = club();
  const s = session('s1');
  const sec = who(data, 'sec');
  assert.equal(markProblem(sec, s, who(data, 'rider'), data, today), null);
  assert.equal(markProblem(sec, s, who(data, 'applicant'), data, today), null);
  assert.equal(markProblem(sec, session('old', { heldOn: '2026-10-01', closedAt: '2026-10-01T10:00:00.000Z' }), who(data, 'rider'), data, today), null);
  assert.equal(markProblem(who(data, 'rider'), s, who(data, 'rider'), data, today), 'Only that chapter’s board can run this check-in.');
  assert.equal(markProblem(sec, s, undefined, data, today), 'That member no longer exists.');
  assert.equal(markProblem(sec, s, who(data, 'supporterapp'), data, today), 'They can’t be checked in.');
  // North's board can't tick a West applicant, even at a whole-club ride it runs.
  const clubRide = session('cr', { kind: 'ride', chapterId: null, rideId: 'r-club' });
  assert.equal(markProblem(who(data, 'northsec'), clubRide, who(data, 'applicant'), data, today), 'They can’t be checked in.');
  assert.equal(markProblem(who(data, 'northsec'), clubRide, who(data, 'rider'), data, today), null);
  assert.equal(markProblem(sec, session('later', { heldOn: '2026-11-01' }), who(data, 'rider'), data, today), 'That check-in hasn’t started yet.');
});

test('closing a check-in', () => {
  const data = club();
  assert.equal(closeProblem(who(data, 'sec'), session('s1'), data), null);
  assert.equal(closeProblem(who(data, 'rider'), session('s1'), data), 'Only that chapter’s board can run this check-in.');
  assert.equal(closeProblem(who(data, 'sec'), session('s1', { closedAt: '2026-10-24T09:00:00.000Z' }), data), 'That check-in is already closed.');
});

test('attendance counts rides and meetings by the date they were held', () => {
  const data = club({
    checkinSessions: [
      session('m1', { heldOn: '2026-07-10' }),
      session('m2', { heldOn: '2026-08-10' }),
      session('r1', { kind: 'ride', rideId: 'r-west', heldOn: '2026-09-01' }),
      session('old', { heldOn: '2026-06-30' }),
    ],
    attendance: ['m1', 'm2', 'r1', 'old'].map((sessionId) => ({
      sessionId, memberId: 'rider', checkedInAt: '2026-07-10T09:00:00.000Z', markedBy: null,
    })),
  });
  assert.deepEqual(attendanceCount('rider', data, '2026-07-01'), { rides: 1, meetings: 2 });
  assert.deepEqual(attendanceCount('rider', data, '2026-07-01', '2026-08-31'), { rides: 0, meetings: 2 });
  assert.deepEqual(attendanceCount('sec', data, '2026-07-01'), { rides: 0, meetings: 0 });
});

test('a meeting check-in says what it counts towards when it’s opened', () => {
  const data = club();
  const sec = who(data, 'sec');
  const meeting = { kind: 'meeting' as const, rideId: null, chapterId: 'west', title: 'Club meeting', heldOn: today };
  assert.equal(openCheckinProblem(sec, { ...meeting, meetingType: 'event' }, data, today), null);
  assert.equal(openCheckinProblem(sec, { ...meeting, meetingType: 'bbq' as never }, data, today), 'Pick what kind of meeting it is.');
  assert.equal(meetingTypeOf(session('a')), 'ordinary');
  assert.equal(meetingTypeOf(session('a', { meetingType: 'special' })), 'special');
  assert.equal(meetingTypeOf(session('a', { kind: 'ride', rideId: 'r-west', meetingType: null })), null);
});

test('excusing someone from a check-in (4.12, 5.3)', () => {
  const data = club({
    checkinSessions: [session('s1')],
    attendance: [{ sessionId: 's1', memberId: 'tre', checkedInAt: '2026-10-24T09:00:00Z', markedBy: null }],
    exemptions: [{ sessionId: 's1', memberId: 'fng', reason: 'Work', grantedBy: 'sec', grantedAt: '2026-10-24T09:00:00Z' }],
  });
  const sec = who(data, 'sec');
  assert.equal(exemptionProblem(sec, 's1', 'rider', 'Work trip', data), null);
  assert.equal(exemptionProblem(sec, 's1', 'fng', null, data), null);
  assert.equal(exemptionProblem(who(data, 'chair'), 's1', 'rider', 'Work trip', data), 'Only their chapter’s board can excuse them.');
  assert.equal(exemptionProblem(sec, 'nope', 'rider', 'Work trip', data), 'That check-in no longer exists.');
  assert.equal(exemptionProblem(sec, 's1', 'nobody', 'Work trip', data), 'That member no longer exists.');
  assert.equal(exemptionProblem(who(data, 'rider'), 's1', 'fng', 'Work trip', data), 'Only their chapter’s board can excuse them.');
  assert.equal(exemptionProblem(who(data, 'northsec'), 's1', 'rider', 'Work trip', data), 'Only their chapter’s board can excuse them.');
  assert.equal(exemptionProblem(sec, 's1', 'sec', 'Work trip', data), 'Someone else on the board has to excuse you.');
  assert.equal(exemptionProblem(sec, 's1', 'tre', 'Work trip', data), 'They checked in, so there’s nothing to excuse.');
  assert.equal(isExcused('s1', 'fng', data), true);
  assert.equal(isExcused('s1', 'rider', data), false);
});

test('a meeting’s kind can be changed by its runners until it’s held', () => {
  const data = club({
    checkinSessions: [session('s1'), session('soon', { heldOn: '2026-10-25' }), session('old', { heldOn: '2026-10-20' }), session('ride', { kind: 'ride', rideId: 'r-west' })],
  });
  const sec = who(data, 'sec');
  assert.equal(meetingTypeProblem(sec, 'soon', 'special', data, today), null);
  assert.equal(meetingTypeProblem(sec, 'nope', 'special', data, today), 'That check-in no longer exists.');
  assert.equal(meetingTypeProblem(who(data, 'rider'), 's1', 'special', data, today), 'Only that chapter’s board can run this check-in.');
  assert.equal(meetingTypeProblem(sec, 'ride', 'special', data, today), 'Only a meeting check-in has a kind.');
  assert.equal(meetingTypeProblem(sec, 's1', 'bbq' as never, data, today), 'Pick what kind of meeting it is.');
  assert.equal(meetingTypeProblem(sec, 'old', 'event', data, today), 'A meeting’s kind is set before the day it’s held (4.6).');
  assert.equal(meetingTypeProblem(sec, 's1', 'event', data, today), 'A meeting’s kind is set before the day it’s held (4.6).');
});

test('whose meeting check-ins you see: your own, your chapter’s as its board or a national role, and the Auditor’s (5.5, 11.8)', () => {
  const data = club();
  assert.equal(canSeeAttendance(who(data, 'rider'), who(data, 'rider'), data.positions), true, 'your own');
  assert.equal(canSeeAttendance(who(data, 'rider'), who(data, 'fng'), data.positions), false, 'not another member’s');
  assert.equal(canSeeAttendance(who(data, 'sec'), who(data, 'rider'), data.positions), true, 'the chapter board');
  assert.equal(canSeeAttendance(who(data, 'northsec'), who(data, 'rider'), data.positions), false, 'not another chapter’s board');
  assert.equal(canSeeAttendance(who(data, 'chair'), who(data, 'rider'), data.positions), true, 'the national roles');
  assert.equal(canSeeAttendance(who(data, 'auditor'), who(data, 'rider'), data.positions), true, 'the Auditor');
  assert.equal(canSeeAttendance(null, who(data, 'rider'), data.positions), false);
});
