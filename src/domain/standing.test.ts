import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atLeast, standingOf } from './standing';
import { club, member, ride, session } from './stage4.testkit';
import type { Attendance, AttendanceExemption, Big4Ride, CheckinSession, ClubData, Member } from './types';

const came = (sessionId: string, memberId = 'm'): Attendance => ({ sessionId, memberId, checkedInAt: '2026-10-01T09:00:00Z', markedBy: null });
const excused = (sessionId: string, memberId = 'm'): AttendanceExemption => ({ sessionId, memberId, reason: 'Work', grantedBy: 'sec', grantedAt: '2026-10-01T00:00:00Z' });
const big4 = (rideId: string, chapterId: string | null = null): Big4Ride => ({ rideId, chapterId, designatedBy: 'chair', designatedAt: '2026-08-02T00:00:00Z' });
const monthly = (id: string, heldOn: string, over: Partial<CheckinSession> = {}) => session(id, { heldOn, ...over });

/** Club year 2026 (AGM assumed 1 Aug 2026 to 1 Aug 2027). */
function world(m: Member, over: Partial<ClubData> = {}): ClubData {
  return club({ members: [...club().members, m], ...over });
}

const line = (s: ReturnType<typeof standingOf>, key: string) => s?.lines.find((l) => l.key === key);

test('percentages round up to the smallest whole number (2.4)', () => {
  assert.equal(atLeast(9, 4, 5), 8); // 80% of nine is eight
  assert.equal(atLeast(9, 1, 2), 5); // 50% of nine is five
  assert.equal(atLeast(10, 4, 5), 8);
  assert.equal(atLeast(3, 2, 3), 2);
  assert.equal(atLeast(4, 2, 3), 3);
  assert.equal(atLeast(0, 4, 5), 0);
});

test('a Full Member needs 80% of this year’s ordinary home meetings', () => {
  const m = member('m', { patchedOn: '2020-01-01' });
  const sessions = [
    monthly('old', '2026-07-15'), // last club year
    monthly('a', '2026-08-20'),
    monthly('b', '2026-09-17'),
    monthly('c', '2026-10-15', { meetingType: null }), // older check-ins have no type: ordinary
    monthly('d', '2026-10-20', { meetingType: 'special' }),
    monthly('e', '2026-10-21', { meetingType: 'event' }),
    monthly('f', '2026-10-22', { chapterId: 'north' }),
    monthly('g', '2026-11-19'), // not yet held
    monthly('x', '2026-10-23'), // excused
  ];
  const data = world(m, { checkinSessions: sessions, attendance: [came('a'), came('b'), came('old'), came('d')], exemptions: [excused('x')] });
  const s = standingOf(m, data, '2026-10-24');
  assert.equal(s?.kind, 'full');
  assert.equal(s?.from, '2026-08-01');
  assert.deepEqual(line(s, 'meetings'), { key: 'meetings', label: 'Monthly meetings · 80%', attended: 2, held: 3, needed: 3, upcoming: 0, state: 'behind' });
  const met = standingOf(m, { ...data, attendance: [...data.attendance!, came('c')] }, '2026-10-24');
  assert.equal(line(met, 'meetings')?.state, 'met');
  const none = standingOf(m, { ...data, checkinSessions: [] }, '2026-10-24');
  assert.equal(line(none, 'meetings')?.state, 'none');
});

test('only meetings held while Full count', () => {
  const m = member('m', { patchedOn: '2026-09-01' });
  const data = world(m, { checkinSessions: [monthly('a', '2026-08-20'), monthly('b', '2026-09-17')], attendance: [came('b')] });
  const s = standingOf(m, data, '2026-10-24');
  assert.equal(s?.from, '2026-09-01');
  assert.equal(line(s, 'meetings')?.held, 1);
  assert.equal(line(s, 'meetings')?.state, 'met');
});

test('a Full Member needs two applicable Big 4 rides, or as many as there are', () => {
  const m = member('m', { patchedOn: '2020-01-01' });
  const rides = [
    ride('b1', { startsAt: '2026-09-05T23:00:00.000Z', category: 'club' }), // held, came
    ride('b2', { startsAt: '2026-10-03T23:00:00.000Z', category: 'club' }), // held, missed
    ride('b3', { startsAt: '2026-10-10T23:00:00.000Z', category: 'club' }), // past, no check-in: drops out
    ride('b4', { startsAt: '2027-03-06T23:00:00.000Z', category: 'club' }), // to come
    ride('bn', { startsAt: '2027-02-06T23:00:00.000Z', category: 'north' }), // North's own
    ride('bc', { startsAt: '2027-04-06T23:00:00.000Z', category: 'club', cancelledAt: '2026-10-01T00:00:00Z' }),
    ride('bx', { startsAt: '2027-08-07T23:00:00.000Z', category: 'club' }), // next club year
  ];
  const sessions = [
    session('s1', { kind: 'ride', rideId: 'b1', chapterId: null, heldOn: '2026-09-06' }),
    session('s2', { kind: 'ride', rideId: 'b2', chapterId: null, heldOn: '2026-10-04' }),
  ];
  const designations = [big4('b1'), big4('b2'), big4('b3'), big4('b4'), big4('bn', 'north'), big4('bc'), big4('bx')];
  const data = world(m, { rides, checkinSessions: sessions, big4Rides: designations, attendance: [came('s1')] });
  const s = standingOf(m, data, '2026-10-24');
  assert.deepEqual(line(s, 'big4'), { key: 'big4', label: 'Big 4 rides', attended: 1, held: 2, needed: 2, upcoming: 1, state: 'to_go' });
  // With b4 gone too, one more can't be found: behind.
  const fewer = standingOf(m, { ...data, big4Rides: designations.filter((d) => d.rideId !== 'b4') }, '2026-10-24');
  assert.deepEqual(line(fewer, 'big4'), { key: 'big4', label: 'Big 4 rides', attended: 1, held: 2, needed: 2, upcoming: 0, state: 'behind' });
  // Excused from b2: only b1 and b4 are applicable.
  const ex = standingOf(m, { ...data, exemptions: [excused('s2')] }, '2026-10-24');
  assert.equal(line(ex, 'big4')?.needed, 2);
  assert.equal(line(ex, 'big4')?.state, 'to_go');
  const both = standingOf(m, { ...data, exemptions: [excused('s2')], big4Rides: [big4('b1'), big4('b2')] }, '2026-10-24');
  assert.deepEqual(line(both, 'big4'), { key: 'big4', label: 'Big 4 rides', attended: 1, held: 1, needed: 1, upcoming: 0, state: 'met' });
  // Patched after b1 and b2: only b4 remains, so one is enough (5.11 part-year).
  const late = { ...m, patchedOn: '2026-10-10' };
  const part = standingOf(late, world(late, { rides, checkinSessions: sessions, big4Rides: designations }), '2026-10-24');
  assert.equal(line(part, 'big4')?.needed, 1);
  assert.equal(line(part, 'big4')?.state, 'to_go');
  // No Big 4s designated: nothing owed.
  assert.equal(line(standingOf(m, { ...data, big4Rides: [] }, '2026-10-24'), 'big4')?.state, 'none');
});

test('a Nomad needs two in three meetings and one Big 4', () => {
  const m = member('m', { status: 'nomad', patchedOn: '2020-01-01' });
  const data = world(m, {
    checkinSessions: [monthly('a', '2026-08-20'), monthly('b', '2026-09-17'), monthly('c', '2026-10-15'), monthly('d', '2026-10-22')],
    attendance: [came('a'), came('b')],
    rides: [ride('b1', { startsAt: '2027-03-06T23:00:00.000Z', category: 'club' })],
    big4Rides: [big4('b1')],
  });
  const s = standingOf(m, data, '2026-10-24');
  assert.equal(s?.kind, 'nomad');
  assert.deepEqual(line(s, 'meetings'), { key: 'meetings', label: 'Meetings · two in three', attended: 2, held: 4, needed: 3, upcoming: 0, state: 'behind' });
  assert.equal(line(s, 'big4')?.needed, 1);
});

test('an FNG needs 50% of each category since their trial began', () => {
  const m = member('m', { status: 'fng', fngStartedOn: '2026-07-01', patchedOn: null });
  const data = world(m, {
    checkinSessions: [
      monthly('before', '2026-06-20'),
      monthly('a', '2026-07-16'),
      monthly('b', '2026-08-20'),
      monthly('c', '2026-09-17'),
      monthly('sp', '2026-09-20', { meetingType: 'special' }),
      monthly('ev', '2026-09-27', { meetingType: 'event' }),
      session('rw', { kind: 'ride', rideId: 'r-west', chapterId: 'west', heldOn: '2026-08-02' }),
      session('rc', { kind: 'ride', rideId: 'r-club', chapterId: null, heldOn: '2026-09-02' }),
      session('rn', { kind: 'ride', rideId: 'r-n', chapterId: 'north', heldOn: '2026-09-03' }),
    ],
    attendance: [came('a'), came('b'), came('rw'), came('rn')],
  });
  const s = standingOf(m, data, '2026-10-24');
  assert.equal(s?.kind, 'fng');
  assert.equal(s?.from, '2026-07-01');
  assert.deepEqual(s?.lines.map((l) => [l.key, l.attended, l.held, l.needed, l.state]), [
    ['rides', 1, 2, 1, 'met'],
    ['meetings', 2, 3, 2, 'met'],
    ['events', 0, 1, 1, 'behind'],
  ]);
});

test('no requirement for other statuses, or on hiatus', () => {
  assert.equal(standingOf(member('m', { status: 'supporter' }), world(member('m')), '2026-10-24'), null);
  assert.equal(standingOf(member('m', { status: 'legacy' }), world(member('m')), '2026-10-24'), null);
  assert.equal(standingOf(member('m', { approval: 'pending', status: 'introduced' }), world(member('m')), '2026-10-24'), null);
  const away = member('m', { onHiatus: true });
  assert.deepEqual(standingOf(away, world(away), '2026-10-24'), { kind: 'full', from: '2026-08-01', onHiatus: true, lines: [] });
});
