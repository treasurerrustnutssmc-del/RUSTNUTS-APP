import { test } from 'node:test';
import assert from 'node:assert/strict';
import { club, member, ride, session, who } from '../domain/stage4.testkit';
import { answerCheckin, askCheckIn } from './demoStage4';

const today = '2026-10-24';
const now = '2026-10-24T01:00:00.000Z';
const base = () =>
  club({
    members: [...club().members, member('rc')],
    rides: [ride('r-today', { startsAt: '2026-10-24T00:00:00.000Z' })],
    crew: [{ rideId: 'r-today', memberId: 'rc', role: 'road_captain' }],
  });

test('demo: I’m here opens the ride’s check-in, waits, and a leader confirms it', () => {
  let data = base();
  const asked = askCheckIn({ data, me: who(data, 'rider'), today, now }, { rideId: 'r-today' });
  data = asked.data;
  const s = data.checkinSessions!.find((x) => x.id === asked.id)!;
  assert.equal(s.rideId, 'r-today');
  assert.equal(s.openedBy, null, 'opened itself');
  assert.equal(s.heldOn, today);
  assert.deepEqual(data.checkinRequests, [{ sessionId: s.id, memberId: 'rider', askedAt: now }]);
  assert.equal((data.attendance ?? []).length, 0);

  // Asking again does nothing new; asking at the same ride uses the same check-in.
  const again = askCheckIn({ data, me: who(data, 'rider'), today, now }, { rideId: 'r-today' });
  assert.equal(again.id, s.id);
  assert.equal(again.data.checkinRequests!.length, 1);

  assert.throws(() => answerCheckin({ data, me: who(data, 'rider'), today, now }, s.id, 'rider', true), /Only the ride crew or the board/);
  data = answerCheckin({ data, me: who(data, 'rc'), today, now }, s.id, 'rider', true);
  assert.deepEqual(data.checkinRequests, []);
  assert.deepEqual(data.attendance, [{ sessionId: s.id, memberId: 'rider', checkedInAt: now, markedBy: 'rc' }]);
});

test('demo: the crew goes straight in, and Not here leaves no attendance', () => {
  let data = base();
  const rc = askCheckIn({ data, me: who(data, 'rc'), today, now }, { rideId: 'r-today' });
  data = rc.data;
  assert.deepEqual(data.attendance, [{ sessionId: rc.id, memberId: 'rc', checkedInAt: now, markedBy: null }]);
  data = askCheckIn({ data, me: who(data, 'fng'), today, now }, { sessionId: rc.id }).data;
  data = answerCheckin({ data, me: who(data, 'rc'), today, now }, rc.id, 'fng', false);
  assert.deepEqual(data.checkinRequests, []);
  assert.equal(data.attendance!.length, 1);
  assert.throws(() => askCheckIn({ data, me: who(data, 'rider'), today, now }, { sessionId: 'nope' }), /That check-in no longer exists/);
  assert.throws(() => askCheckIn({ data: club({ checkinSessions: [session('m', { heldOn: '2026-10-30' })] }), me: who(data, 'rider'), today, now }, { sessionId: 'm' }), /on the day/);
});
