import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIEFING_EMPTY,
  BRIEFING_LOCKED,
  HAZARD_TOO_LONG,
  MAX_HAZARD,
  MAX_HAZARDS,
  MAX_TEXT,
  NOT_WRITER,
  NO_BRIEFING,
  NO_RIDE,
  RIDE_CANCELLED,
  SAFETY_ORDER,
  TEXT_TOO_LONG,
  TOO_MANY_HAZARDS,
  briefingOf,
  cleanBriefing,
  readBriefingProblem,
  readCount,
  readState,
  saveBriefingProblem,
  unreadGoing,
  writesBriefing,
} from './briefings';
import { endOfFirstDay } from './rides';
import type {
  Briefing, BriefingRead, Chapter, ClubData, CrewRole, CrewSpot, Member, Position, PositionRole, Ride, Rsvp, RsvpAnswer,
} from './types';

const chapters: Chapter[] = [
  { id: 'ch-west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
  { id: 'ch-north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
];

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'ch-west', fullName: `Full ${id}`, roadName: id, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});

const position = (memberId: string, role: PositionRole, chapterId: string | null): Position => ({
  id: `p-${memberId}-${role}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null,
});

const ride = (id: string, over: Partial<Ride> = {}): Ride => ({
  id, title: id, startsAt: '2026-11-07T08:00:00.000Z', endsAt: null, allDay: false, location: null, notes: null,
  category: 'west', cancelledAt: null, ...over,
});

const spot = (rideId: string, memberId: string, role: CrewRole): CrewSpot => ({
  rideId, memberId, role, assignedBy: null, assignedAt: '2026-10-01T00:00:00.000Z',
});

const rsvp = (rideId: string, memberId: string, answer: RsvpAnswer): Rsvp => ({
  rideId, memberId, answer, updatedAt: '2026-10-01T00:00:00.000Z',
});

const briefing = (rideId: string, over: Partial<Briefing> = {}): Briefing => ({
  rideId, hazards: ['Gravel at the Bacchus Marsh turn'], changes: '', notes: '', updatedAt: '2026-10-20T00:00:00.000Z',
  updatedBy: null, ...over,
});

const read = (rideId: string, memberId: string, readAt: string): BriefingRead => ({ rideId, memberId, readAt });

// Cast of characters. westVp is a board seat; crewRc is a plain Full member picked as RC.
const westVp = member('west-vp');
const westComm = member('west-comm');
const northRc = member('north-rc', { chapterId: 'ch-north' });
const nec = member('nec', { chapterId: 'ch-north' });
const crewRc = member('crew-rc');
const tailGunner = member('tail-gunner');
const rider = member('rider');
const pending = member('pending', { approval: 'pending' });

const WEST_RIDE = ride('west-ride'); // Sat 7 Nov 2026, 7 pm Melbourne
const CANCELLED = ride('cancelled', { cancelledAt: '2026-11-01T00:00:00.000Z' });

const data = (over: Partial<ClubData> = {}): ClubData => ({
  chapters,
  members: [westVp, westComm, northRc, nec, crewRc, tailGunner, rider, pending],
  privates: [], bikes: [], registrations: [], emergencyContacts: [],
  positions: [
    position('west-vp', 'vice_president', 'ch-west'),
    position('west-comm', 'ride_committee', 'ch-west'),
    position('north-rc', 'road_captain', 'ch-north'),
    position('nec', 'nec_chair', null),
  ],
  rides: [WEST_RIDE, CANCELLED],
  rsvps: [],
  crew: [spot('west-ride', 'crew-rc', 'road_captain'), spot('west-ride', 'tail-gunner', 'tail_gunner')],
  briefings: [],
  briefingReads: [],
  ...over,
});

const NOW = '2026-11-01T00:00:00.000Z';
const OK = { hazards: ['Gravel on the corner'], changes: '', notes: '' };

test('the limits and the safety order', () => {
  assert.equal(MAX_HAZARDS, 12);
  assert.equal(MAX_HAZARD, 120);
  assert.equal(MAX_TEXT, 2000);
  assert.deepEqual(SAFETY_ORDER, ['Road Captain', 'Sergeant-at-Arms', 'Vice President', 'President', 'NEC']);
});

test('the refusal messages are the spec’s words, with the curly apostrophe', () => {
  assert.equal(NO_RIDE, 'No such ride.');
  assert.equal(RIDE_CANCELLED, 'That ride was cancelled.');
  assert.equal(BRIEFING_LOCKED, 'The briefing can’t change after the ride day.');
  assert.equal(NOT_WRITER, 'Only the board, ride committee or this ride’s Road Captain can write the briefing.');
  assert.equal(TOO_MANY_HAZARDS, 'That’s too many hazards (12 at most).');
  assert.equal(HAZARD_TOO_LONG, 'Keep each hazard to one short line (120 characters at most).');
  assert.equal(TEXT_TOO_LONG, 'That’s too long (2000 characters at most).');
  assert.equal(BRIEFING_EMPTY, 'Write at least one hazard, change or note.');
  assert.equal(NO_BRIEFING, 'There’s no briefing for this ride yet.');
  for (const m of [BRIEFING_LOCKED, NOT_WRITER, TOO_MANY_HAZARDS, TEXT_TOO_LONG, NO_BRIEFING]) {
    assert.ok(!m.includes("'"), 'no straight apostrophe');
  }
});

test('cleaning a briefing: trim, and drop blank hazards', () => {
  assert.deepEqual(
    cleanBriefing({ hazards: ['  Gravel  ', '', '   ', '\t\n', 'Roadworks'], changes: '  one at a time \n', notes: ' \n ' }),
    { hazards: ['Gravel', 'Roadworks'], changes: 'one at a time', notes: '' },
  );
  assert.deepEqual(cleanBriefing({ hazards: [], changes: '', notes: '' }), { hazards: [], changes: '', notes: '' });
});

test('who writes a briefing', () => {
  const d = data();
  assert.equal(writesBriefing(westVp, WEST_RIDE, d), true, 'chapter board');
  assert.equal(writesBriefing(westComm, WEST_RIDE, d), true, 'ride committee');
  assert.equal(writesBriefing(nec, WEST_RIDE, d), true, 'NEC');
  assert.equal(writesBriefing(crewRc, WEST_RIDE, d), true, 'a non-board member holding this ride’s RC spot');
  assert.equal(writesBriefing(northRc, WEST_RIDE, d), false, 'North board is not West');
  assert.equal(writesBriefing(tailGunner, WEST_RIDE, d), false, 'a Tail Gunner is not the RC');
  assert.equal(writesBriefing(rider, WEST_RIDE, d), false);
  assert.equal(writesBriefing(null, WEST_RIDE, d), false);
  assert.equal(writesBriefing({ ...crewRc, approval: 'pending' }, WEST_RIDE, d), false, 'approved only');
  assert.equal(writesBriefing(crewRc, ride('other'), d), false, 'RC of a different ride');
  assert.equal(writesBriefing(crewRc, WEST_RIDE, data({ crew: undefined })), false, 'missing crew means none');
  // The RC steps down: the spot is gone, and so is the right to write.
  const left = data({ crew: [spot('west-ride', 'tail-gunner', 'tail_gunner')] });
  assert.equal(writesBriefing(crewRc, WEST_RIDE, left), false, 'an RC who stepped down');
});

test('saving a briefing: the checks in order', () => {
  const d = data();
  assert.equal(saveBriefingProblem(null, WEST_RIDE, OK, d, NOW), 'Sign in first.');
  assert.equal(saveBriefingProblem(pending, WEST_RIDE, OK, d, NOW), 'Only approved members can do that.');
  assert.equal(saveBriefingProblem(westVp, undefined, OK, d, NOW), NO_RIDE);
  assert.equal(saveBriefingProblem(westVp, CANCELLED, OK, d, NOW), RIDE_CANCELLED);
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, OK, d, '2026-11-08T00:00:00.000Z'), BRIEFING_LOCKED);
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, OK, d, NOW), NOT_WRITER);
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, OK, d, NOW), null, 'board');
  assert.equal(saveBriefingProblem(westComm, WEST_RIDE, OK, d, NOW), null, 'ride committee');
  assert.equal(saveBriefingProblem(crewRc, WEST_RIDE, OK, d, NOW), null, 'non-board RC crew writer');
  assert.equal(saveBriefingProblem(crewRc, WEST_RIDE, OK, data({ crew: [] }), NOW), NOT_WRITER, 'an RC who stepped down');
});

test('saving: an earlier check wins over a later one', () => {
  const d = data();
  const bad = { hazards: [], changes: '', notes: '' };
  // Sign-in beats everything, even with no ride.
  assert.equal(saveBriefingProblem(null, undefined, bad, d, NOW), 'Sign in first.');
  assert.equal(saveBriefingProblem(pending, undefined, bad, d, NOW), 'Only approved members can do that.');
  // No ride beats a non-writer.
  assert.equal(saveBriefingProblem(rider, undefined, bad, d, NOW), NO_RIDE);
  // Cancelled beats past-ride-day and not-a-writer.
  const cancelledPast = ride('c2', { cancelledAt: '2026-10-01T00:00:00.000Z' });
  assert.equal(saveBriefingProblem(rider, cancelledPast, bad, d, '2026-12-01T00:00:00.000Z'), RIDE_CANCELLED);
  // Ride day beats not-a-writer.
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, bad, d, '2026-11-08T00:00:00.000Z'), BRIEFING_LOCKED);
  // Not-a-writer beats every content check.
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, bad, d, NOW), NOT_WRITER);
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, { ...bad, hazards: Array(13).fill('x') }, d, NOW), NOT_WRITER);
  // Too many hazards beats a long hazard, long text and empty.
  const many = Array.from({ length: 13 }, () => 'x'.repeat(MAX_HAZARD + 1));
  assert.equal(
    saveBriefingProblem(westVp, WEST_RIDE, { hazards: many, changes: 'y'.repeat(MAX_TEXT + 1), notes: '' }, d, NOW),
    TOO_MANY_HAZARDS,
  );
  // A long hazard beats long text.
  assert.equal(
    saveBriefingProblem(westVp, WEST_RIDE, { hazards: ['x'.repeat(MAX_HAZARD + 1)], changes: 'y'.repeat(MAX_TEXT + 1), notes: '' }, d, NOW),
    HAZARD_TOO_LONG,
  );
  // Nothing to save comes last.
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, bad, d, NOW), BRIEFING_EMPTY);
});

test('the ride day: the last millisecond is allowed, the midnight after is not', () => {
  const d = data();
  const end = endOfFirstDay(WEST_RIDE);
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, OK, d, new Date(end - 1).toISOString()), null);
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, OK, d, new Date(end).toISOString()), BRIEFING_LOCKED);
});

test('hazard count: blank lines are dropped first, then twelve is the most', () => {
  const d = data();
  const twelve = Array.from({ length: 12 }, (_, i) => `Hazard ${i}`);
  const save = (hazards: string[]) => saveBriefingProblem(westVp, WEST_RIDE, { hazards, changes: '', notes: '' }, d, NOW);
  assert.equal(save(twelve), null, '12 is allowed');
  assert.equal(save([...twelve, 'One more']), TOO_MANY_HAZARDS, '13 is not');
  assert.equal(save([...twelve, '', '   ', '\n']), null, 'blank lines do not count');
  assert.equal(save([...twelve, '', 'Real one']), TOO_MANY_HAZARDS, 'a real one does');
});

test('hazard length: counted in code points, after trimming', () => {
  const d = data();
  const save = (hazard: string) => saveBriefingProblem(westVp, WEST_RIDE, { hazards: [hazard], changes: '', notes: '' }, d, NOW);
  assert.equal(save('x'.repeat(120)), null);
  assert.equal(save('x'.repeat(121)), HAZARD_TOO_LONG);
  assert.equal(save(`  ${'x'.repeat(120)}  `), null, 'padding is trimmed away');
  assert.equal(save('😀'.repeat(120)), null, '120 emoji are 120 characters, though 240 UTF-16 units');
  assert.equal(save('😀'.repeat(121)), HAZARD_TOO_LONG);
});

test('changes and notes: 2000 code points each, after trimming', () => {
  const d = data();
  const save = (changes: string, notes: string) =>
    saveBriefingProblem(westVp, WEST_RIDE, { hazards: ['x'], changes, notes }, d, NOW);
  assert.equal(save('y'.repeat(2000), ''), null);
  assert.equal(save('y'.repeat(2001), ''), TEXT_TOO_LONG);
  assert.equal(save('', 'y'.repeat(2001)), TEXT_TOO_LONG);
  assert.equal(save(` ${'y'.repeat(2000)} `, ''), null, 'padding is trimmed away');
  assert.equal(save('😀'.repeat(2000), '😀'.repeat(2000)), null, 'emoji count once');
  assert.equal(save('😀'.repeat(2001), ''), TEXT_TOO_LONG);
});

test('an empty briefing is refused; any one part with something is enough', () => {
  const d = data();
  const save = (hazards: string[], changes: string, notes: string) =>
    saveBriefingProblem(westVp, WEST_RIDE, { hazards, changes, notes }, d, NOW);
  assert.equal(save([], '', ''), BRIEFING_EMPTY);
  assert.equal(save(['', '  '], ' \n', '\t'), BRIEFING_EMPTY, 'all blank after trimming');
  assert.equal(save([], '', 'Nothing special'), null);
  assert.equal(save([], 'Single file', ''), null);
  assert.equal(save(['Gravel'], '', ''), null);
});

test('reading Got it: the checks in order', () => {
  const d = data({ briefings: [briefing('west-ride'), briefing('cancelled')] });
  assert.equal(readBriefingProblem(null, WEST_RIDE, d), 'Sign in first.');
  assert.equal(readBriefingProblem(pending, WEST_RIDE, d), 'Only approved members can do that.');
  assert.equal(readBriefingProblem(rider, undefined, d), NO_RIDE);
  assert.equal(readBriefingProblem(rider, ride('no-briefing'), d), NO_BRIEFING);
  assert.equal(readBriefingProblem(rider, WEST_RIDE, d), null, 'any approved member');
  assert.equal(readBriefingProblem(rider, CANCELLED, d), null, 'a cancelled ride still reads');
  // Sign-in beats no ride; approval beats no briefing.
  assert.equal(readBriefingProblem(null, undefined, d), 'Sign in first.');
  assert.equal(readBriefingProblem(pending, ride('no-briefing'), d), 'Only approved members can do that.');
});

test('reading works on a ride that has finished', () => {
  const d = data({ briefings: [briefing('west-ride')] });
  // The rule takes no clock, so nothing about the ride day can refuse a read.
  assert.equal(readBriefingProblem(rider, ride('west-ride', { startsAt: '2020-01-01T00:00:00.000Z' }), d), null);
});

test('finding a ride’s briefing', () => {
  const mine = briefing('west-ride', { hazards: ['A'] });
  const d = data({ briefings: [briefing('other'), mine] });
  assert.equal(briefingOf('west-ride', d), mine);
  assert.equal(briefingOf('nothing', d), undefined);
  assert.equal(briefingOf('west-ride', data({ briefings: undefined })), undefined);
});

test('read states: none, current, stale, and equal counts as current', () => {
  const b = briefing('west-ride', { updatedAt: '2026-10-20T10:00:00.000Z' });
  const reads = [
    read('west-ride', 'current', '2026-10-20T11:00:00.000Z'),
    read('west-ride', 'equal', '2026-10-20T10:00:00.000Z'),
    read('west-ride', 'stale', '2026-10-20T09:59:59.999Z'),
    read('other', 'other-ride', '2026-10-21T00:00:00.000Z'),
  ];
  const d = data({ briefings: [b], briefingReads: reads });
  const state = (id: string) => readState(member(id), 'west-ride', d);
  assert.equal(state('current'), 'current');
  assert.equal(state('equal'), 'current', 'equal timestamps count as current');
  assert.equal(state('stale'), 'stale');
  assert.equal(state('nobody'), 'none');
  assert.equal(state('other-ride'), 'none', 'a read of another ride’s briefing');
  assert.equal(readState(null, 'west-ride', d), 'none');
  assert.equal(readState(member('current'), 'other', d), 'none', 'no briefing on that ride');
});

test('read states compare instants, not text', () => {
  const b = briefing('west-ride', { updatedAt: '2026-10-20T10:00:00.000Z' });
  const d = data({
    briefings: [b],
    briefingReads: [
      read('west-ride', 'same', '2026-10-20T20:00:00+10:00'),
      read('west-ride', 'later', '2026-10-20T21:00:00+10:00'),
      read('west-ride', 'earlier', '2026-10-20T19:59:59+10:00'),
    ],
  });
  const state = (id: string) => readState(member(id), 'west-ride', d);
  assert.equal(state('same'), 'current', 'the same instant written another way is equal');
  assert.equal(state('later'), 'current');
  assert.equal(state('earlier'), 'stale');
});

test('counting reads: Going riders only, current reads only', () => {
  const b = briefing('west-ride', { updatedAt: '2026-10-20T10:00:00.000Z' });
  const d = data({
    briefings: [b],
    rsvps: [
      rsvp('west-ride', 'rider', 'going'),
      rsvp('west-ride', 'west-vp', 'going'),
      rsvp('west-ride', 'west-comm', 'going'),
      rsvp('west-ride', 'nec', 'maybe'),
      rsvp('west-ride', 'north-rc', 'no'),
      rsvp('other', 'crew-rc', 'going'),
    ],
    briefingReads: [
      read('west-ride', 'rider', '2026-10-20T10:00:00.000Z'), // equal: current
      read('west-ride', 'west-vp', '2026-10-19T10:00:00.000Z'), // stale
      read('west-ride', 'nec', '2026-10-21T10:00:00.000Z'), // current, but only Maybe
      read('west-ride', 'north-rc', '2026-10-21T10:00:00.000Z'), // current, but a No
      read('west-ride', 'crew-rc', '2026-10-21T10:00:00.000Z'), // current, but no answer on this ride
    ],
  });
  assert.deepEqual(readCount(WEST_RIDE, d), { read: 1, going: 3 });
  assert.deepEqual(readCount(ride('other'), d), { read: 0, going: 1 }, 'no briefing: nobody has read it');
  assert.deepEqual(readCount(ride('empty'), d), { read: 0, going: 0 });
  assert.deepEqual(readCount(WEST_RIDE, data({ briefings: undefined, briefingReads: undefined })), { read: 0, going: 0 });
});

test('the unread list: Going riders with no read or a stale one, by name', () => {
  const b = briefing('west-ride', { updatedAt: '2026-10-20T10:00:00.000Z' });
  const named = [
    member('m1', { roadName: 'Zed', fullName: 'Aaron Zed' }),
    member('m2', { roadName: null, fullName: 'bob Brown' }), // no road name: the full name, case ignored
    member('m3', { roadName: 'Anvil' }),
    member('m4', { roadName: 'Diesel' }),
    member('m5', { roadName: 'Spanner' }),
    member('m6', { roadName: 'Maybe Mick' }),
  ];
  const d = data({
    members: named,
    briefings: [b],
    rsvps: [
      rsvp('west-ride', 'm1', 'going'),
      rsvp('west-ride', 'm2', 'going'),
      rsvp('west-ride', 'm3', 'going'),
      rsvp('west-ride', 'm4', 'going'),
      rsvp('west-ride', 'm5', 'going'),
      rsvp('west-ride', 'm6', 'maybe'),
    ],
    briefingReads: [
      read('west-ride', 'm4', '2026-10-19T00:00:00.000Z'), // stale: listed
      read('west-ride', 'm5', '2026-10-20T10:00:00.000Z'), // current: not listed
    ],
  });
  assert.deepEqual(unreadGoing(WEST_RIDE, d).map((m) => m.id), ['m3', 'm2', 'm4', 'm1']);
  // The count and the list agree.
  assert.deepEqual(readCount(WEST_RIDE, d), { read: 1, going: 5 });
});

test('the unread list: nothing when there is no briefing', () => {
  const d = data({ rsvps: [rsvp('west-ride', 'rider', 'going')] });
  assert.deepEqual(unreadGoing(WEST_RIDE, d), [], 'no briefing, nothing to have read');
});
