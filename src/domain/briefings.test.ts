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
  BRIEFING_UPDATED,
  READ_OUTDATED,
  RIDE_CANCELLED,
  SAFETY_ORDER,
  SAVE_CONFLICT,
  TEXT_TOO_LONG,
  TOO_MANY_HAZARDS,
  SAFETY_LINE,
  STOPPED_RIDER,
  briefingCrew,
  briefingOf,
  cleanBriefing,
  editBriefingProblem,
  editStart,
  hazardSummary,
  isVersionRefusal,
  oneLine,
  pinnedBriefing,
  hazardTooLong,
  moreLabel,
  readBriefingProblem,
  readCount,
  readCountLine,
  readLine,
  readState,
  saveBriefingProblem,
  stampLine,
  textTooLong,
  unreadGoing,
  updatedLine,
  writesBriefing,
} from './briefings';
import * as briefings from './briefings';
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
  assert.equal(saveBriefingProblem(null, WEST_RIDE, OK, d, NOW, null), 'Sign in first.');
  assert.equal(saveBriefingProblem(pending, WEST_RIDE, OK, d, NOW, null), 'Only approved members can do that.');
  assert.equal(saveBriefingProblem(westVp, undefined, OK, d, NOW, null), NO_RIDE);
  assert.equal(saveBriefingProblem(westVp, CANCELLED, OK, d, NOW, null), RIDE_CANCELLED);
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, OK, d, '2026-11-08T00:00:00.000Z', null), BRIEFING_LOCKED);
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, OK, d, NOW, null), NOT_WRITER);
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, OK, d, NOW, null), null, 'board');
  assert.equal(saveBriefingProblem(westComm, WEST_RIDE, OK, d, NOW, null), null, 'ride committee');
  assert.equal(saveBriefingProblem(crewRc, WEST_RIDE, OK, d, NOW, null), null, 'non-board RC crew writer');
  assert.equal(saveBriefingProblem(crewRc, WEST_RIDE, OK, data({ crew: [] }), NOW, null), NOT_WRITER, 'an RC who stepped down');
});

test('saving: an earlier check wins over a later one', () => {
  const d = data();
  const bad = { hazards: [], changes: '', notes: '' };
  // Sign-in beats everything, even with no ride.
  assert.equal(saveBriefingProblem(null, undefined, bad, d, NOW, null), 'Sign in first.');
  assert.equal(saveBriefingProblem(pending, undefined, bad, d, NOW, null), 'Only approved members can do that.');
  // No ride beats a non-writer.
  assert.equal(saveBriefingProblem(rider, undefined, bad, d, NOW, null), NO_RIDE);
  // Cancelled beats past-ride-day and not-a-writer.
  const cancelledPast = ride('c2', { cancelledAt: '2026-10-01T00:00:00.000Z' });
  assert.equal(saveBriefingProblem(rider, cancelledPast, bad, d, '2026-12-01T00:00:00.000Z', null), RIDE_CANCELLED);
  // Ride day beats not-a-writer.
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, bad, d, '2026-11-08T00:00:00.000Z', null), BRIEFING_LOCKED);
  // Not-a-writer beats every content check.
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, bad, d, NOW, null), NOT_WRITER);
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, { ...bad, hazards: Array(13).fill('x') }, d, NOW, null), NOT_WRITER);
  // Too many hazards beats a long hazard, long text and empty.
  const many = Array.from({ length: 13 }, () => 'x'.repeat(MAX_HAZARD + 1));
  assert.equal(
    saveBriefingProblem(westVp, WEST_RIDE, { hazards: many, changes: 'y'.repeat(MAX_TEXT + 1), notes: '' }, d, NOW, null),
    TOO_MANY_HAZARDS,
  );
  // A long hazard beats long text.
  assert.equal(
    saveBriefingProblem(westVp, WEST_RIDE, { hazards: ['x'.repeat(MAX_HAZARD + 1)], changes: 'y'.repeat(MAX_TEXT + 1), notes: '' }, d, NOW, null),
    HAZARD_TOO_LONG,
  );
  // Nothing to save comes last.
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, bad, d, NOW, null), BRIEFING_EMPTY);
});

test('the ride day: the last millisecond is allowed, the midnight after is not', () => {
  const d = data();
  const end = endOfFirstDay(WEST_RIDE);
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, OK, d, new Date(end - 1).toISOString(), null), null);
  assert.equal(saveBriefingProblem(westVp, WEST_RIDE, OK, d, new Date(end).toISOString(), null), BRIEFING_LOCKED);
});

test('hazard count: blank lines are dropped first, then twelve is the most', () => {
  const d = data();
  const twelve = Array.from({ length: 12 }, (_, i) => `Hazard ${i}`);
  const save = (hazards: string[]) => saveBriefingProblem(westVp, WEST_RIDE, { hazards, changes: '', notes: '' }, d, NOW, null);
  assert.equal(save(twelve), null, '12 is allowed');
  assert.equal(save([...twelve, 'One more']), TOO_MANY_HAZARDS, '13 is not');
  assert.equal(save([...twelve, '', '   ', '\n']), null, 'blank lines do not count');
  assert.equal(save([...twelve, '', 'Real one']), TOO_MANY_HAZARDS, 'a real one does');
});

test('hazard length: counted in code points, after trimming', () => {
  const d = data();
  const save = (hazard: string) => saveBriefingProblem(westVp, WEST_RIDE, { hazards: [hazard], changes: '', notes: '' }, d, NOW, null);
  assert.equal(save('x'.repeat(120)), null);
  assert.equal(save('x'.repeat(121)), HAZARD_TOO_LONG);
  assert.equal(save(`  ${'x'.repeat(120)}  `), null, 'padding is trimmed away');
  assert.equal(save('😀'.repeat(120)), null, '120 emoji are 120 characters, though 240 UTF-16 units');
  assert.equal(save('😀'.repeat(121)), HAZARD_TOO_LONG);
});

test('changes and notes: 2000 code points each, after trimming', () => {
  const d = data();
  const save = (changes: string, notes: string) =>
    saveBriefingProblem(westVp, WEST_RIDE, { hazards: ['x'], changes, notes }, d, NOW, null);
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
    saveBriefingProblem(westVp, WEST_RIDE, { hazards, changes, notes }, d, NOW, null);
  assert.equal(save([], '', ''), BRIEFING_EMPTY);
  assert.equal(save(['', '  '], ' \n', '\t'), BRIEFING_EMPTY, 'all blank after trimming');
  assert.equal(save([], '', 'Nothing special'), null);
  assert.equal(save([], 'Single file', ''), null);
  assert.equal(save(['Gravel'], '', ''), null);
});

// The version every test briefing is at, unless a test says otherwise.
const SEEN = '2026-10-20T00:00:00.000Z';

test('reading Got it: the checks in order', () => {
  const d = data({ briefings: [briefing('west-ride'), briefing('cancelled')] });
  assert.equal(readBriefingProblem(null, WEST_RIDE, d, SEEN), 'Sign in first.');
  assert.equal(readBriefingProblem(pending, WEST_RIDE, d, SEEN), 'Only approved members can do that.');
  assert.equal(readBriefingProblem(rider, undefined, d, SEEN), NO_RIDE);
  assert.equal(readBriefingProblem(rider, ride('no-briefing'), d, SEEN), NO_BRIEFING);
  assert.equal(readBriefingProblem(rider, WEST_RIDE, d, SEEN), null, 'any approved member');
  assert.equal(readBriefingProblem(rider, CANCELLED, d, SEEN), null, 'a cancelled ride still reads');
  // Sign-in beats no ride; approval beats no briefing.
  assert.equal(readBriefingProblem(null, undefined, d, SEEN), 'Sign in first.');
  assert.equal(readBriefingProblem(pending, ride('no-briefing'), d, SEEN), 'Only approved members can do that.');
});

test('reading works on a ride that has finished', () => {
  const d = data({ briefings: [briefing('west-ride')] });
  // The rule takes no clock, so nothing about the ride day can refuse a read.
  assert.equal(readBriefingProblem(rider, ride('west-ride', { startsAt: '2020-01-01T00:00:00.000Z' }), d, SEEN), null);
});

test('reading: Got it on an older version than the one stored is refused, last of the checks', () => {
  const d = data({ briefings: [briefing('west-ride', { updatedAt: '2026-10-20T10:00:00.000Z' })] });
  const got = (who: Member | null, r: Ride | undefined, seen: string | null) => readBriefingProblem(who, r, d, seen);
  assert.equal(got(rider, WEST_RIDE, '2026-10-20T10:00:00.000Z'), null, 'the version stored');
  assert.equal(got(rider, WEST_RIDE, '2026-10-20T09:59:59.999Z'), null, 'within the 1 ms the database rounds to');
  assert.equal(got(rider, WEST_RIDE, '2026-10-20T09:59:59.998Z'), READ_OUTDATED, 'more than 1 ms older');
  assert.equal(got(rider, WEST_RIDE, '2026-10-19T10:00:00.000Z'), READ_OUTDATED, 'a day older');
  assert.equal(got(rider, WEST_RIDE, null), READ_OUTDATED, 'no version seen at all');
  assert.equal(got(rider, WEST_RIDE, '2026-10-20T11:00:00.000Z'), null, 'a newer stamp is not refused');
  assert.equal(got(rider, WEST_RIDE, '2026-10-20T21:00:00+11:00'), null, 'instants, not text');
  // Every earlier check beats it.
  assert.equal(got(null, WEST_RIDE, null), 'Sign in first.');
  assert.equal(got(pending, WEST_RIDE, null), 'Only approved members can do that.');
  assert.equal(got(rider, undefined, null), NO_RIDE);
  assert.equal(got(rider, ride('no-briefing'), null), NO_BRIEFING, 'no briefing comes before an old version');
});

test('saving: a briefing saved by someone else since the editor opened is refused, right after the writer check', () => {
  const STORED = '2026-10-20T10:00:00.000Z';
  const d = data({ briefings: [briefing('west-ride', { updatedAt: STORED })] });
  const save = (who: Member | null, r: Ride | undefined, seen: string | null, input = OK, now = NOW) =>
    saveBriefingProblem(who, r, input, d, now, seen);
  assert.equal(save(westVp, WEST_RIDE, STORED), null, 'opened on the version stored');
  assert.equal(save(westVp, WEST_RIDE, '2026-10-20T09:59:59.999Z'), null, 'within 1 ms');
  assert.equal(save(westVp, WEST_RIDE, '2026-10-20T09:59:59.998Z'), SAVE_CONFLICT, 'more than 1 ms older');
  assert.equal(save(westVp, WEST_RIDE, null), SAVE_CONFLICT, 'opened with no briefing, but there is one now');
  assert.equal(save(westVp, ride('fresh'), null), null, 'still no briefing: a new one');
  assert.equal(save(westVp, ride('fresh'), STORED), null, 'no briefing stored, so nothing to clash with');
  // The first six checks beat it.
  assert.equal(save(null, WEST_RIDE, null), 'Sign in first.');
  assert.equal(save(pending, WEST_RIDE, null), 'Only approved members can do that.');
  assert.equal(save(westVp, undefined, null), NO_RIDE);
  const cancelled = { ...CANCELLED, id: 'west-ride' };
  assert.equal(save(westVp, cancelled, null), RIDE_CANCELLED);
  assert.equal(save(westVp, WEST_RIDE, null, OK, '2026-11-08T00:00:00.000Z'), BRIEFING_LOCKED);
  assert.equal(save(rider, WEST_RIDE, null), NOT_WRITER, 'who may write comes before a clash');
  // And it beats every content check.
  const empty = { hazards: [], changes: '', notes: '' };
  assert.equal(save(westVp, WEST_RIDE, null, { ...empty, hazards: Array(13).fill('x') }), SAVE_CONFLICT, 'before too many');
  assert.equal(save(westVp, WEST_RIDE, null, { ...empty, hazards: ['x'.repeat(MAX_HAZARD + 1)] }), SAVE_CONFLICT, 'before too long');
  assert.equal(save(westVp, WEST_RIDE, null, { ...empty, notes: 'x'.repeat(MAX_TEXT + 1) }), SAVE_CONFLICT, 'before long text');
  assert.equal(save(westVp, WEST_RIDE, null, empty), SAVE_CONFLICT, 'before empty');
  // Offering Write and Edit doesn't look at versions.
  assert.equal(editBriefingProblem(westVp, WEST_RIDE, d, NOW), null);
});

test('the two version refusals, and telling them apart from the rest', () => {
  assert.equal(READ_OUTDATED, 'The briefing changed while you had it open. Read the new version, then tap Got it.');
  assert.equal(
    SAVE_CONFLICT,
    'Someone else saved this briefing while you were editing. Your changes aren’t saved: copy them, then open the briefing again.',
  );
  assert.ok(!SAVE_CONFLICT.includes("'"), 'no straight apostrophe');
  assert.equal(isVersionRefusal(new Error(READ_OUTDATED)), true);
  assert.equal(isVersionRefusal(new Error(SAVE_CONFLICT)), true);
  assert.equal(isVersionRefusal(new Error(NOT_WRITER)), false);
  assert.equal(isVersionRefusal(READ_OUTDATED), false, 'only errors');
  assert.equal(isVersionRefusal(null), false);
});

test('the safety order has one name only', () => {
  assert.equal('safetyOrder' in briefings, false, 'no alias for SAFETY_ORDER');
});

test('a hazard stays on one line: line breaks become spaces', () => {
  assert.equal(oneLine('Gravel\nat the turn'), 'Gravel at the turn');
  assert.equal(oneLine('Gravel\r\n\r\nat the turn'), 'Gravel at the turn');
  assert.equal(oneLine('Gravel at the turn\n'), 'Gravel at the turn ');
  assert.equal(oneLine('No breaks'), 'No breaks');
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

// ---------------------------------------------------------------------------
// What the screens show
// ---------------------------------------------------------------------------

test('who can edit right now: the first six save checks, with no input to check', () => {
  const d = data();
  const BEFORE = '2026-11-01T00:00:00.000Z';
  assert.equal(editBriefingProblem(null, WEST_RIDE, d, BEFORE), 'Sign in first.');
  assert.equal(editBriefingProblem(pending, WEST_RIDE, d, BEFORE), 'Only approved members can do that.');
  assert.equal(editBriefingProblem(westVp, undefined, d, BEFORE), NO_RIDE);
  assert.equal(editBriefingProblem(westVp, CANCELLED, d, BEFORE), RIDE_CANCELLED);
  assert.equal(editBriefingProblem(westVp, WEST_RIDE, d, new Date(endOfFirstDay(WEST_RIDE)).toISOString()), BRIEFING_LOCKED);
  assert.equal(editBriefingProblem(rider, WEST_RIDE, d, BEFORE), NOT_WRITER);
  assert.equal(editBriefingProblem(westVp, WEST_RIDE, d, BEFORE), null);
  assert.equal(editBriefingProblem(crewRc, WEST_RIDE, d, BEFORE), null, 'the ride’s own RC');
  // Saving runs the same checks first, so an empty form from a non-writer says who can write.
  assert.equal(saveBriefingProblem(rider, WEST_RIDE, { hazards: [], changes: '', notes: '' }, d, BEFORE, null), NOT_WRITER);
});

test('the ride screen’s summary: the first hazard, then how many more', () => {
  assert.deepEqual(hazardSummary(['Gravel', 'Roos', 'Roadworks']), { first: 'Gravel', more: 2 });
  assert.deepEqual(hazardSummary(['Gravel']), { first: 'Gravel', more: 0 });
  assert.equal(hazardSummary([]), null);
  assert.equal(moreLabel(2), '+2 more');
  assert.equal(moreLabel(1), '+1 more');
  assert.equal(moreLabel(0), null);
});

test('the read count line', () => {
  assert.equal(readCountLine({ read: 6, going: 9 }), '6 of 9 going have read it');
  assert.equal(readCountLine({ read: 0, going: 1 }), '0 of 1 going have read it');
  assert.equal(readCountLine({ read: 0, going: 0 }), 'Nobody’s said Going yet');
});

test('times: Melbourne time today, with the date on another Melbourne day', () => {
  // 20:42 UTC on 23 Oct is 7:42 am on 24 Oct in Melbourne (daylight saving, UTC+11).
  const READ = '2026-10-23T20:42:00.000Z';
  assert.equal(stampLine(READ, '2026-10-24T05:00:00.000Z'), 'at 7:42 am');
  assert.equal(stampLine(READ, '2026-10-24T12:59:59.000Z'), 'at 7:42 am', 'still the 24th in Melbourne');
  assert.equal(stampLine(READ, '2026-10-24T13:00:00.000Z'), 'on 24/10/2026 at 7:42 am', 'midnight in Melbourne: the 25th');
  assert.equal(stampLine(READ, '2026-10-23T21:00:00.000Z'), 'at 7:42 am', 'the 23rd in UTC, but the 24th in Melbourne');
  assert.equal(readLine(READ, '2026-10-24T05:00:00.000Z'), 'You read this at 7:42 am');
  assert.equal(readLine(READ, '2026-10-30T05:00:00.000Z'), 'You read this on 24/10/2026 at 7:42 am');
});

test('the updated line names who changed it last, when they’re known', () => {
  const NOW_24 = '2026-10-24T05:00:00.000Z';
  const d = data({ members: [member('m-torque', { roadName: 'Torque' })] });
  const b = briefing('west-ride', { updatedAt: '2026-10-23T09:15:00.000Z', updatedBy: 'm-torque' });
  assert.equal(updatedLine(b, d, NOW_24), 'Updated on 23/10/2026 at 8:15 pm by Torque');
  assert.equal(updatedLine({ ...b, updatedAt: '2026-10-23T20:00:00.000Z' }, d, NOW_24), 'Updated at 7:00 am by Torque');
  assert.equal(updatedLine({ ...b, updatedBy: null }, d, NOW_24), 'Updated on 23/10/2026 at 8:15 pm');
  assert.equal(updatedLine({ ...b, updatedBy: 'gone' }, d, NOW_24), 'Updated on 23/10/2026 at 8:15 pm', 'a former member');
});

test('the safety lines, built from the safety order', () => {
  assert.equal(
    SAFETY_LINE,
    'Safety calls, in order: Road Captain → Sergeant-at-Arms → Vice President → President → NEC (constitution 7.6).',
  );
  assert.equal(STOPPED_RIDER, 'Stopped rider? The TG stops with them. An Officer takes the rear.');
});

test('the card’s crew: RC, TG, ATG, then Officers, with names and first aid', () => {
  const named = [
    member('rc', { roadName: 'Diesel' }),
    member('tg', { roadName: 'Spanner' }),
    member('o1', { roadName: 'Chook' }),
  ];
  const d = data({
    members: named,
    crew: [
      { ...spot('west-ride', 'o1', 'officer'), assignedAt: '2026-10-02T00:00:00.000Z' },
      spot('west-ride', 'tg', 'tail_gunner'),
      spot('west-ride', 'rc', 'road_captain'),
      spot('west-ride', 'gone', 'officer'),
      spot('other', 'rc', 'tail_gunner'),
    ],
  });
  assert.deepEqual(briefingCrew('west-ride', d), {
    rows: [
      { role: 'road_captain', name: 'Diesel' },
      { role: 'tail_gunner', name: 'Spanner' },
      { role: 'officer', name: 'A former member' },
      { role: 'officer', name: 'Chook' },
    ],
    firstAid: 'Spanner',
  });
  assert.deepEqual(briefingCrew('other', data({ members: named, crew: [spot('other', 'rc', 'road_captain')] })), {
    rows: [{ role: 'road_captain', name: 'Diesel' }],
    firstAid: null,
  });
  assert.deepEqual(briefingCrew('none', data({ crew: undefined })), { rows: [], firstAid: null });
});

test('the edit form starts from the briefing, with at least one hazard line', () => {
  assert.deepEqual(editStart(undefined), { hazards: [''], changes: '', notes: '' });
  assert.deepEqual(editStart(briefing('r', { hazards: [], changes: 'One at a time', notes: '' })), {
    hazards: [''],
    changes: 'One at a time',
    notes: '',
  });
  assert.deepEqual(editStart(briefing('r', { hazards: ['A', 'B'], notes: 'N' })), { hazards: ['A', 'B'], changes: '', notes: 'N' });
});

test('marking a field that’s too long, counted in code points after trimming', () => {
  assert.equal(hazardTooLong('x'.repeat(MAX_HAZARD)), false);
  assert.equal(hazardTooLong(`  ${'x'.repeat(MAX_HAZARD)}  `), false, 'trimmed first');
  assert.equal(hazardTooLong('x'.repeat(MAX_HAZARD + 1)), true);
  assert.equal(hazardTooLong('🏍'.repeat(MAX_HAZARD)), false, 'an emoji is one character');
  assert.equal(textTooLong('x'.repeat(MAX_TEXT)), false);
  assert.equal(textTooLong('🏍'.repeat(MAX_TEXT)), false);
  assert.equal(textTooLong('x'.repeat(MAX_TEXT + 1)), true);
});

test('the card keeps the version it opened on: a newer one is offered, not swapped in', () => {
  const opened = briefing('west-ride', { hazards: ['Gravel'], updatedAt: '2026-10-20T10:00:00.000Z', updatedBy: 'west-vp' });
  const newer = briefing('west-ride', { hazards: ['Gravel', 'Roadworks'], updatedAt: '2026-10-20T11:00:00.000Z', updatedBy: 'west-vp' });
  assert.deepEqual(pinnedBriefing(opened, opened, 'rider'), { shown: opened, update: null }, 'nothing new');
  assert.deepEqual(pinnedBriefing(opened, newer, 'rider'), { shown: opened, update: newer }, 'newer: keep the pinned one, offer the update');
  const reloaded = { ...opened, updatedAt: '2026-10-20T21:00:00.000+11:00' };
  assert.deepEqual(pinnedBriefing(opened, reloaded, 'rider'), { shown: opened, update: null }, 'the same instant, written another way');
  const micro = { ...opened, updatedAt: '2026-10-20T10:00:00.001Z' };
  assert.deepEqual(pinnedBriefing(opened, micro, 'rider'), { shown: opened, update: null }, 'within the 1 ms the database rounds to');
  const later = { ...opened, updatedAt: '2026-10-20T10:00:00.002Z' };
  assert.deepEqual(pinnedBriefing(opened, later, 'rider'), { shown: opened, update: later }, 'more than 1 ms apart is another version');
  const older = { ...opened, updatedAt: '2026-10-20T09:00:00.000Z' };
  assert.deepEqual(pinnedBriefing(opened, older, 'rider'), { shown: opened, update: older }, 'any other version, older too, is offered');
});

test('the card: nothing pinned yet takes what is stored, and your own save is taken without asking', () => {
  const stored = briefing('west-ride', { updatedAt: '2026-10-20T10:00:00.000Z', updatedBy: 'west-vp' });
  assert.deepEqual(pinnedBriefing(undefined, undefined, 'rider'), { shown: undefined, update: null }, 'no briefing at all');
  assert.deepEqual(pinnedBriefing(undefined, stored, 'rider'), { shown: stored, update: null }, 'the first one to arrive is pinned');
  const opened = briefing('west-ride', { updatedAt: '2026-10-19T10:00:00.000Z', updatedBy: 'crew-rc' });
  assert.deepEqual(pinnedBriefing(opened, undefined, 'rider'), { shown: opened, update: null }, 'gone from the data: keep what was read');
  assert.deepEqual(pinnedBriefing(opened, stored, 'west-vp'), { shown: stored, update: null }, 'you saved it yourself (Edit, then back)');
  assert.deepEqual(pinnedBriefing(opened, stored, 'crew-rc'), { shown: opened, update: stored }, 'someone else saved it');
  const unknown = { ...stored, updatedBy: null };
  assert.deepEqual(pinnedBriefing(opened, unknown, null), { shown: opened, update: unknown }, 'nobody known is never you');
});

test('the card’s update notice', () => {
  assert.equal(BRIEFING_UPDATED, 'The RC updated this briefing while you had it open.');
});
