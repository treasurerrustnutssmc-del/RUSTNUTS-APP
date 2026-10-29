// Big 4 RSVP rules and the 5.5 notice in the demo: what each action changes. Who may do them is
// checked against the database by the shared parity cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { club, member, ride, session, who } from '../domain/stage4.testkit';
import type { ClubData } from '../domain/types';
import { NotAllowedError } from './clubContext';
import { setRsvp, type DemoCtx } from './demoActions';
import { closeStatusNotice, giveStatusNotice, respondToNotice, setBig4Waiver } from './demoAttendance';

const today = '2026-10-24';
const now = '2026-10-24T01:00:00.000Z';
const base = club({
  rides: [...club().rides, ride('r-big4', { category: 'club', startsAt: '2026-11-07T21:30:00.000Z' })],
  big4Rides: [{ rideId: 'r-big4', chapterId: null, designatedBy: 'chair', designatedAt: '2026-10-01T00:00:00Z' }],
  checkinSessions: [session('m1', { heldOn: '2026-10-20' })],
  members: [...club().members, member('fran')],
});
const ctx = (id: string, data: ClubData = base): DemoCtx => ({ data, me: who(data, id), today, now });

test('an excuse lets them say Going on a Big 4; clearing it takes that away again', () => {
  assert.throws(() => setRsvp(ctx('fran'), 'r-big4', 'going'), NotAllowedError);
  const excused = setBig4Waiver(ctx('sec'), 'r-big4', 'fran', 'health');
  assert.deepEqual(excused.big4Waivers, [{ rideId: 'r-big4', memberId: 'fran', ground: 'health', grantedBy: 'sec', grantedAt: now }]);
  const going = setRsvp(ctx('fran', excused), 'r-big4', 'going');
  assert.equal(going.rsvps.find((r) => r.memberId === 'fran')?.answer, 'going');
  const cleared = setBig4Waiver(ctx('sec', going), 'r-big4', 'fran', null);
  assert.deepEqual(cleared.big4Waivers, []);
  // The Going already given stays.
  assert.equal(cleared.rsvps.find((r) => r.memberId === 'fran')?.answer, 'going');
});

test('a notice is given, replied to and closed', () => {
  const given = giveStatusNotice(ctx('sec'), 'fran', { about: 'attendance', record: ' Meetings 0 of 1 ', proposal: ' Supporter ', respondBy: '2026-11-07' });
  const n = given.data.statusNotices!.find((x) => x.id === given.id)!;
  assert.deepEqual(
    { memberId: n.memberId, chapterId: n.chapterId, record: n.record, proposal: n.proposal, givenOn: n.givenOn, givenBy: n.givenBy, outcome: n.outcome },
    { memberId: 'fran', chapterId: 'west', record: 'Meetings 0 of 1', proposal: 'Supporter', givenOn: today, givenBy: 'sec', outcome: null },
  );
  const replied = respondToNotice(ctx('fran', given.data), given.id, ' I was in hospital. ');
  assert.equal(replied.statusNotices![0].response, 'I was in hospital.');
  assert.equal(replied.statusNotices![0].respondedAt, now);
  const withdrawn = closeStatusNotice(ctx('sec', replied), given.id, 'withdrawn', ' Relief granted (4.12) ');
  assert.deepEqual(
    { outcome: withdrawn.statusNotices![0].outcome, note: withdrawn.statusNotices![0].outcomeNote, on: withdrawn.statusNotices![0].closedOn, by: withdrawn.statusNotices![0].closedBy },
    { outcome: 'withdrawn', note: 'Relief granted (4.12)', on: today, by: 'sec' },
  );
});
