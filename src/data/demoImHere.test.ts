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

test('demo: the board goes straight in, the crew waits for someone else, and Not here leaves no attendance', () => {
  let data = base();
  const sec = askCheckIn({ data, me: who(data, 'sec'), today, now }, { rideId: 'r-today' });
  data = sec.data;
  assert.deepEqual(data.attendance, [{ sessionId: sec.id, memberId: 'sec', checkedInAt: now, markedBy: null }]);
  data = askCheckIn({ data, me: who(data, 'rc'), today, now }, { rideId: 'r-today' }).data;
  assert.deepEqual(data.checkinRequests!.map((r) => r.memberId), ['rc']);
  assert.throws(() => answerCheckin({ data, me: who(data, 'rc'), today, now }, sec.id, 'rc', true), /Someone else has to confirm you/);
  data = askCheckIn({ data, me: who(data, 'fng'), today, now }, { sessionId: sec.id }).data;
  data = answerCheckin({ data, me: who(data, 'rc'), today, now }, sec.id, 'fng', false);
  assert.deepEqual(data.checkinRequests!.map((r) => r.memberId), ['rc']);
  assert.equal(data.attendance!.length, 1);
  assert.throws(() => askCheckIn({ data, me: who(data, 'rider'), today, now }, { sessionId: 'nope' }), /That check-in no longer exists/);
  assert.throws(() => askCheckIn({ data: club({ checkinSessions: [session('m', { heldOn: '2026-10-30' })] }), me: who(data, 'rider'), today, now }, { sessionId: 'm' }), /on the day/);
});
