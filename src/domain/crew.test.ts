import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crewChangeProblem,
  crewFor,
  crewNeeded,
  crewProblem,
  crewRows,
  canVolunteer,
  eligibilityProblem,
  leaveProblem,
  managesRide,
  pickGroups,
  pickList,
  showsCrewNeeded,
  spotOf,
} from './crew';
import { endOfFirstDay } from './rides';
import type { Chapter, ClubData, CrewRole, CrewSpot, Member, MemberPrivate, Position, PositionRole, Ride, Rsvp } from './types';

const chapters: Chapter[] = [
  { id: 'ch-west', slug: 'west', name: 'West', area: 'Western Melbourne', state: 'VIC' },
  { id: 'ch-north', slug: 'north', name: 'North', area: 'Northern Melbourne', state: 'VIC' },
];

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id, chapterId: 'ch-west', fullName: `Full ${id}`, roadName: id, status: 'full', approval: 'approved',
  joinedOn: '2024-01-01', patchedOn: null, fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null,
  onHiatus: false, ...over,
});

const position = (memberId: string, role: PositionRole, chapterId: string | null, over: Partial<Position> = {}): Position => ({
  id: `p-${memberId}-${role}`, memberId, chapterId, role, startedOn: '2025-01-01', endedOn: null, ...over,
});

const ride = (id: string, over: Partial<Ride> = {}): Ride => ({
  id, title: id, startsAt: '2026-11-07T08:00:00.000Z', endsAt: null, allDay: false, location: null, notes: null,
  category: 'west', cancelledAt: null, ...over,
});

const priv = (memberId: string, firstAidExpiry: string | null): MemberPrivate => ({
  memberId, email: null, phone: null, licenceClass: null, licenceExpiry: null, firstAidExpiry,
  introducedBy: null, applicationNote: null,
});

// Cast of characters.
const westPres = member('west-pres');
const northRc = member('north-rc', { chapterId: 'ch-north' });
const westComm = member('west-comm');
const nec = member('nec', { chapterId: 'ch-north' });
const rider = member('rider');
const fng = member('fng', { status: 'fng' });
const hiatus = member('hiatus', { status: 'nomad', onHiatus: true });
const aidEdge = member('aid-edge');
const pending = member('pending', { approval: 'pending' });

const WEST_RIDE = ride('west-ride'); // Sat 7 Nov 2026, 7 pm Melbourne
const CLUB_RIDE = ride('club-ride', { category: 'club' });
const CANCELLED = ride('cancelled', { cancelledAt: '2026-11-01T00:00:00.000Z' });
// Sun 4 Oct 2026 is the daylight saving day (clocks go forward at 2 am).
const DST_ALL_DAY = ride('dst-all-day', { allDay: true, startsAt: '2026-10-03T14:00:00.000Z', endsAt: '2026-10-04T13:00:00.000Z' });
const DST_TIMED = ride('dst-timed', { startsAt: '2026-10-04T09:00:00.000Z' }); // 8 pm Sunday AEDT

const data = (over: Partial<ClubData> = {}): ClubData => ({
  chapters,
  members: [westPres, northRc, westComm, nec, rider, fng, hiatus, aidEdge, pending],
  privates: [priv('aid-edge', '2026-11-07')], // expires on the ride's Melbourne date
  bikes: [], registrations: [], emergencyContacts: [],
  positions: [
    position('west-pres', 'president', 'ch-west'),
    position('north-rc', 'road_captain', 'ch-north'),
    position('west-comm', 'ride_committee', 'ch-west'),
    position('nec', 'nec_chair', null),
  ],
  rides: [WEST_RIDE, CLUB_RIDE, CANCELLED, DST_ALL_DAY, DST_TIMED],
  rsvps: [],
  crew: [],
  ...over,
});

const NOW = '2026-11-01T00:00:00.000Z';
const spot = (rideId: string, memberId: string, role: CrewRole, assignedAt = '2026-11-01T00:00:00.000Z'): CrewSpot => ({
  rideId, memberId, role, assignedBy: null, assignedAt,
});
const rsvp = (rideId: string, memberId: string, answer: Rsvp['answer']): Rsvp => ({ rideId, memberId, answer, updatedAt: '' });

test('who manages a ride', () => {
  const d = data();
  assert.equal(managesRide(westPres, WEST_RIDE, d), true, 'West board on a West ride');
  assert.equal(managesRide(westComm, WEST_RIDE, d), true, 'West ride committee on a West ride');
  assert.equal(managesRide(northRc, WEST_RIDE, d), false, 'North board is not West');
  assert.equal(managesRide(northRc, CLUB_RIDE, d), true, 'any board seat on a club ride');
  assert.equal(managesRide(westComm, CLUB_RIDE, d), true, 'any ride committee on a club ride');
  assert.equal(managesRide(nec, WEST_RIDE, d), true, 'NEC manages all');
  assert.equal(managesRide(nec, CLUB_RIDE, d), true);
  assert.equal(managesRide(rider, WEST_RIDE, d), false);
  assert.equal(managesRide(rider, CLUB_RIDE, d), false);
  assert.equal(managesRide(null, WEST_RIDE, d), false);
  assert.equal(managesRide({ ...westPres, approval: 'pending' }, WEST_RIDE, d), false, 'approved only');
  assert.equal(managesRide(northRc, ride('s', { category: 'supported' }), d), true, 'supported is "any other category"');
  const ended = data({ positions: [position('west-comm', 'ride_committee', 'ch-west', { endedOn: '2026-01-01' })] });
  assert.equal(managesRide(westComm, WEST_RIDE, ended), false, 'ended terms do not count');
});

test('who is eligible to crew', () => {
  const d = data();
  assert.equal(eligibilityProblem(rider, 'road_captain', WEST_RIDE, d), null);
  assert.equal(eligibilityProblem(member('nomad', { status: 'nomad' }), 'officer', WEST_RIDE, d), null);
  assert.equal(eligibilityProblem(fng, 'officer', WEST_RIDE, d), 'Only Full and Nomad members can crew a ride.');
  assert.equal(eligibilityProblem(pending, 'officer', WEST_RIDE, d), 'Only Full and Nomad members can crew a ride.');
  assert.equal(eligibilityProblem(hiatus, 'officer', WEST_RIDE, d), 'Members on hiatus can’t crew a ride.');
  assert.equal(
    eligibilityProblem({ ...fng, onHiatus: true }, 'officer', WEST_RIDE, d),
    'Only Full and Nomad members can crew a ride.',
    'status is checked before hiatus',
  );
});

test('first aid for tail gunners', () => {
  const msg = 'Tail Gunners need a current first aid certificate on file.';
  const onTheDay = data({ privates: [priv('aid-edge', '2026-11-07')] });
  assert.equal(eligibilityProblem(aidEdge, 'tail_gunner', WEST_RIDE, onTheDay), null, 'expiry equal to the ride date passes');
  assert.equal(eligibilityProblem(aidEdge, 'assistant_tail_gunner', WEST_RIDE, onTheDay), null);
  const dayBefore = data({ privates: [priv('aid-edge', '2026-11-06')] });
  assert.equal(eligibilityProblem(aidEdge, 'tail_gunner', WEST_RIDE, dayBefore), msg, 'the day before fails');
  assert.equal(eligibilityProblem(aidEdge, 'assistant_tail_gunner', WEST_RIDE, dayBefore), msg);
  const noDate = data({ privates: [priv('aid-edge', null)] });
  assert.equal(eligibilityProblem(aidEdge, 'tail_gunner', WEST_RIDE, noDate), msg, 'a row with no date fails');
  assert.equal(eligibilityProblem(rider, 'tail_gunner', WEST_RIDE, onTheDay), null, 'no private row passes');
  assert.equal(eligibilityProblem(aidEdge, 'road_captain', WEST_RIDE, dayBefore), null, 'only TG and ATG need first aid');
  assert.equal(eligibilityProblem(aidEdge, 'officer', WEST_RIDE, dayBefore), null);
});

test('the first checks come in order', () => {
  const d = data();
  assert.equal(crewProblem(null, WEST_RIDE, rider, 'tail_gunner', d, NOW), 'Sign in first.');
  assert.equal(crewProblem(pending, WEST_RIDE, rider, 'tail_gunner', d, NOW), 'Only approved members can do that.');
  assert.equal(crewProblem(rider, undefined, rider, 'tail_gunner', d, NOW), 'No such ride.');
  assert.equal(crewProblem(rider, CANCELLED, rider, 'tail_gunner', d, NOW), 'That ride was cancelled.');
  assert.equal(
    crewProblem(rider, WEST_RIDE, rider, 'tail_gunner', d, new Date(endOfFirstDay(WEST_RIDE)).toISOString()),
    'The crew can’t change after the ride day.',
  );
  assert.equal(crewProblem(westPres, WEST_RIDE, undefined, 'tail_gunner', d, NOW), 'That member no longer exists.');
  assert.equal(
    crewProblem(rider, WEST_RIDE, westComm, 'tail_gunner', d, NOW),
    'Only the board or ride committee can put someone else on the crew.',
  );
  assert.equal(
    crewProblem(westPres, WEST_RIDE, fng, 'tail_gunner', d, NOW),
    'Only Full and Nomad members can crew a ride.',
    'eligibility comes after the manager check',
  );
  assert.equal(
    crewProblem(rider, WEST_RIDE, fng, 'tail_gunner', d, NOW),
    'Only the board or ride committee can put someone else on the crew.',
    'the manager check comes before eligibility',
  );
  assert.equal(
    crewProblem(westPres, WEST_RIDE, rider, 'tail_gunner', data({ rsvps: [rsvp('west-ride', 'rider', 'no')] }), NOW),
    'They said they can’t make it.',
  );
  assert.equal(
    crewProblem(westPres, WEST_RIDE, hiatus, 'tail_gunner', data({ rsvps: [rsvp('west-ride', 'hiatus', 'no')] }), NOW),
    'Members on hiatus can’t crew a ride.',
    'eligibility before the RSVP check',
  );
  assert.equal(
    crewProblem(westPres, WEST_RIDE, rider, 'tail_gunner', data({ rsvps: [rsvp('club-ride', 'rider', 'no')] }), NOW),
    null,
    'an answer to another ride does not count',
  );
});

test('volunteering for a spot, and a missing crew list', () => {
  const open = data();
  assert.equal(crewProblem(rider, WEST_RIDE, rider, 'tail_gunner', open, NOW), null, 'open TG');
  assert.equal(crewProblem(rider, WEST_RIDE, rider, 'tail_gunner', data({ crew: undefined }), NOW), null, 'no crew list means open');
  const taken = data({ crew: [spot('west-ride', 'west-pres', 'tail_gunner')] });
  assert.equal(crewProblem(rider, WEST_RIDE, rider, 'tail_gunner', taken, NOW), 'That spot’s taken.');
  assert.equal(crewProblem(westPres, WEST_RIDE, rider, 'tail_gunner', taken, NOW), null, 'a manager can replace');
  assert.equal(crewProblem(rider, WEST_RIDE, rider, 'road_captain', taken, NOW), null, 'a different spot is open');
  const onOtherRide = data({ crew: [spot('club-ride', 'west-pres', 'tail_gunner')] });
  assert.equal(crewProblem(rider, WEST_RIDE, rider, 'tail_gunner', onOtherRide, NOW), null, 'other rides do not count');
  const mine = data({ crew: [spot('west-ride', 'rider', 'tail_gunner')] });
  assert.equal(crewProblem(rider, WEST_RIDE, rider, 'tail_gunner', mine, NOW), null, 'your own spot is not taken against you');
  assert.equal(crewProblem(rider, WEST_RIDE, rider, 'assistant_tail_gunner', mine, NOW), null, 'moving spots');
  const officers = data({ crew: [spot('west-ride', 'a', 'officer'), spot('west-ride', 'b', 'officer')] });
  assert.equal(crewProblem(rider, WEST_RIDE, rider, 'officer', officers, NOW), null, 'an officer spot is never taken');
  assert.equal(
    crewProblem(rider, WEST_RIDE, rider, 'tail_gunner', data({ rsvps: [rsvp('west-ride', 'rider', 'no')] }), NOW),
    null,
    'volunteering yourself skips the RSVP check (joining sets Going)',
  );
});

test('the crew can change until the first Melbourne day is over', () => {
  for (const r of [DST_TIMED, DST_ALL_DAY]) {
    const end = endOfFirstDay(r);
    const d = data();
    assert.equal(crewProblem(rider, r, rider, 'officer', d, new Date(end - 1).toISOString()), null, `${r.id}: just before`);
    assert.equal(
      crewProblem(rider, r, rider, 'officer', d, new Date(end).toISOString()),
      'The crew can’t change after the ride day.',
      `${r.id}: at the boundary`,
    );
    const on = data({ crew: [spot(r.id, 'rider', 'officer')] });
    assert.equal(leaveProblem(rider, r, 'rider', on, new Date(end - 1).toISOString()), null, `${r.id}: leave just before`);
    assert.equal(
      leaveProblem(rider, r, 'rider', on, new Date(end).toISOString()),
      'The crew can’t change after the ride day.',
      `${r.id}: leave at the boundary`,
    );
  }
  // 4 Oct 2026 is 23 hours long in Melbourne: midnight on the 5th is 13:00Z on the 4th.
  assert.equal(new Date(endOfFirstDay(DST_TIMED)).toISOString(), '2026-10-04T13:00:00.000Z');
  assert.equal(new Date(endOfFirstDay(DST_ALL_DAY)).toISOString(), '2026-10-04T13:00:00.000Z');
  // An ordinary 7 pm ride on 7 Nov (AEDT): midnight on the 8th is 13:00Z on the 7th.
  assert.equal(new Date(endOfFirstDay(WEST_RIDE)).toISOString(), '2026-11-07T13:00:00.000Z');
});

test('stepping off the crew', () => {
  const d = data({ crew: [spot('west-ride', 'rider', 'tail_gunner')] });
  assert.equal(leaveProblem(null, WEST_RIDE, 'rider', d, NOW), 'Sign in first.');
  assert.equal(leaveProblem(pending, WEST_RIDE, 'rider', d, NOW), 'Only approved members can do that.');
  assert.equal(leaveProblem(rider, undefined, 'rider', d, NOW), 'No such ride.');
  assert.equal(leaveProblem(rider, CANCELLED, 'rider', d, NOW), 'That ride was cancelled.');
  assert.equal(
    leaveProblem(rider, WEST_RIDE, 'rider', d, new Date(endOfFirstDay(WEST_RIDE)).toISOString()),
    'The crew can’t change after the ride day.',
  );
  assert.equal(leaveProblem(rider, WEST_RIDE, 'rider', d, NOW), null, 'step down from your own spot');
  assert.equal(
    leaveProblem(fng, WEST_RIDE, 'rider', d, NOW),
    'Only the board or ride committee can take someone else off the crew.',
  );
  assert.equal(leaveProblem(westPres, WEST_RIDE, 'rider', d, NOW), null, 'a manager can take anyone off');
  assert.equal(leaveProblem(westPres, WEST_RIDE, 'fng', d, NOW), 'They’re not on the crew.');
  assert.equal(leaveProblem(rider, WEST_RIDE, 'rider', data(), NOW), 'They’re not on the crew.');
  assert.equal(leaveProblem(rider, WEST_RIDE, 'rider', data({ crew: undefined }), NOW), 'They’re not on the crew.');
  assert.equal(leaveProblem(rider, CLUB_RIDE, 'rider', d, NOW), 'They’re not on the crew.', 'a spot on another ride is not this ride’s');
});

test('crew listed in role order, then by when they joined', () => {
  const crew = [
    spot('west-ride', 'o2', 'officer', '2026-11-02T00:00:00.000Z'),
    spot('west-ride', 'atg', 'assistant_tail_gunner'),
    spot('club-ride', 'other', 'road_captain'),
    spot('west-ride', 'o1', 'officer', '2026-11-01T00:00:00.000Z'),
    spot('west-ride', 'tg', 'tail_gunner'),
    spot('west-ride', 'rc', 'road_captain'),
  ];
  assert.deepEqual(crewFor('west-ride', crew).map((s) => s.memberId), ['rc', 'tg', 'atg', 'o1', 'o2']);
  assert.deepEqual(crewFor('nothing', crew), []);
  assert.equal(crew[0].memberId, 'o2', 'does not reorder the input');
});

test('when a ride still needs crew', () => {
  assert.equal(crewNeeded(WEST_RIDE, []), true);
  assert.equal(crewNeeded(WEST_RIDE, [spot('west-ride', 'a', 'road_captain')]), true, 'no TG');
  assert.equal(crewNeeded(WEST_RIDE, [spot('west-ride', 'a', 'tail_gunner')]), true, 'no RC');
  assert.equal(crewNeeded(WEST_RIDE, [spot('west-ride', 'a', 'road_captain'), spot('west-ride', 'b', 'tail_gunner')]), false);
  assert.equal(
    crewNeeded(WEST_RIDE, [spot('west-ride', 'a', 'road_captain'), spot('west-ride', 'b', 'assistant_tail_gunner')]),
    true,
    'an ATG is not a TG',
  );
  assert.equal(
    crewNeeded(WEST_RIDE, [spot('club-ride', 'a', 'road_captain'), spot('club-ride', 'b', 'tail_gunner')]),
    true,
    'other rides do not count',
  );
  assert.equal(crewNeeded(CANCELLED, []), false, 'a cancelled ride needs no crew');
});

test('the pick list: going first, then standing holders, then the rest', () => {
  const people = [
    member('zed', { roadName: null, fullName: 'Zed Last' }),
    member('amy', { roadName: 'amy' }),
    member('bob', { roadName: 'Bob' }),
    member('cat', { roadName: 'Cat' }),
    member('dan', { roadName: 'Dan' }),
    member('eve', { roadName: 'Eve', chapterId: 'ch-north' }),
    member('fay', { roadName: 'Fay' }),
    member('gus', { roadName: 'Gus' }),
    member('aaron', { roadName: 'Aaron' }),
    member('abe', { roadName: 'Abe', status: 'fng' }),
    member('abel', { roadName: 'Abel', onHiatus: true }),
  ];
  const me = people[0];
  const d = data({
    members: people,
    privates: [],
    positions: [
      position('bob', 'tail_gunner', 'ch-west'),
      position('cat', 'tail_gunner', 'ch-west'),
      position('eve', 'tail_gunner', 'ch-north'),
      position('fay', 'tail_gunner', 'ch-west', { endedOn: '2026-01-01' }),
      position('dan', 'road_captain', 'ch-west'),
    ],
    rsvps: [
      rsvp('west-ride', 'cat', 'going'),
      rsvp('west-ride', 'amy', 'going'),
      rsvp('west-ride', 'aaron', 'no'),
      rsvp('west-ride', 'dan', 'maybe'),
      rsvp('club-ride', 'gus', 'going'),
    ],
  });
  assert.deepEqual(
    pickList(WEST_RIDE, 'tail_gunner', me, d).map((x) => x.id),
    ['amy', 'cat', 'bob', 'dan', 'eve', 'fay', 'gus', 'zed'],
    'going (amy, cat), then West TG holders (bob), then the rest by road name; FNG, hiatus and "no" left out',
  );
  // A club ride uses the chapter of whoever is picking.
  assert.deepEqual(
    pickList(CLUB_RIDE, 'tail_gunner', me, d).map((x) => x.id),
    ['gus', 'bob', 'cat', 'aaron', 'amy', 'dan', 'eve', 'fay', 'zed'],
    'going (gus), then West holders (bob, cat), then the rest',
  );
  assert.deepEqual(
    pickList(CLUB_RIDE, 'tail_gunner', member('nrider', { chapterId: 'ch-north' }), d).map((x) => x.id)[1],
    'eve',
    'for a club ride the picker’s own chapter holders come second',
  );
  // First aid is part of eligibility for TG.
  const stale = data({ members: people, positions: [], privates: [priv('amy', '2026-01-01')], rsvps: [] });
  assert.equal(pickList(WEST_RIDE, 'tail_gunner', me, stale).some((x) => x.id === 'amy'), false);
  assert.equal(pickList(WEST_RIDE, 'road_captain', me, stale).some((x) => x.id === 'amy'), true);
});

test('the pick list in its three groups', () => {
  const people = [
    member('amy', { roadName: 'Amy' }),
    member('bob', { roadName: 'Bob' }),
    member('cat', { roadName: 'Cat' }),
    member('dan', { roadName: 'Dan', status: 'fng' }),
  ];
  const d = data({
    members: people,
    privates: [],
    positions: [position('bob', 'road_captain', 'ch-west')],
    rsvps: [rsvp('west-ride', 'cat', 'going')],
  });
  const groups = pickGroups(WEST_RIDE, 'road_captain', people[0], d);
  assert.deepEqual(groups.going.map((m) => m.id), ['cat']);
  assert.deepEqual(groups.holders.map((m) => m.id), ['bob']);
  assert.deepEqual(groups.rest.map((m) => m.id), ['amy']);
  assert.equal(groups.chapterId, 'ch-west', 'a West ride uses the West chapter');
  assert.equal(pickGroups(CLUB_RIDE, 'road_captain', member('n', { chapterId: 'ch-north' }), d).chapterId, 'ch-north', 'a club ride uses the picker’s');
  assert.deepEqual(
    pickList(WEST_RIDE, 'road_captain', people[0], d).map((m) => m.id),
    [...groups.going, ...groups.holders, ...groups.rest].map((m) => m.id),
    'the list is the groups in order',
  );
});

test('whose spot a member holds on a ride', () => {
  const crew = [spot('west-ride', 'rider', 'tail_gunner'), spot('club-ride', 'rider', 'officer')];
  assert.equal(spotOf('west-ride', 'rider', crew), 'tail_gunner');
  assert.equal(spotOf('club-ride', 'rider', crew), 'officer');
  assert.equal(spotOf('west-ride', 'nobody', crew), null);
  assert.equal(spotOf('west-ride', 'rider', undefined), null, 'a missing crew list is empty');
});

test('when the crew can still change at all', () => {
  assert.equal(crewChangeProblem(rider, WEST_RIDE, NOW), null);
  assert.equal(crewChangeProblem(null, WEST_RIDE, NOW), 'Sign in first.');
  assert.equal(crewChangeProblem(rider, CANCELLED, NOW), 'That ride was cancelled.');
  assert.equal(
    crewChangeProblem(rider, WEST_RIDE, new Date(endOfFirstDay(WEST_RIDE)).toISOString()),
    'The crew can’t change after the ride day.',
  );
});

test('the Crew needed tag: managers only, open RC or TG, starting in the next 14 days', () => {
  const d = data(); // WEST_RIDE starts on Sat 7 Nov 2026 (Melbourne)
  assert.equal(showsCrewNeeded(westPres, WEST_RIDE, d, '2026-10-24'), true, '14 days out');
  assert.equal(showsCrewNeeded(westPres, WEST_RIDE, d, '2026-10-23'), false, '15 days out');
  assert.equal(showsCrewNeeded(westPres, WEST_RIDE, d, '2026-11-07'), true, 'on the day');
  assert.equal(showsCrewNeeded(westPres, WEST_RIDE, d, '2026-11-08'), false, 'once it has started');
  assert.equal(showsCrewNeeded(rider, WEST_RIDE, d, '2026-11-01'), false, 'not for members who can’t pick');
  assert.equal(showsCrewNeeded(northRc, WEST_RIDE, d, '2026-11-01'), false, 'not for another chapter’s board');
  assert.equal(showsCrewNeeded(null, WEST_RIDE, d, '2026-11-01'), false);
  const crewed = data({ crew: [spot('west-ride', 'a', 'road_captain'), spot('west-ride', 'b', 'tail_gunner')] });
  assert.equal(showsCrewNeeded(westPres, WEST_RIDE, crewed, '2026-11-01'), false, 'RC and TG filled');
  assert.equal(showsCrewNeeded(westPres, WEST_RIDE, data({ crew: undefined }), '2026-11-01'), true, 'a missing crew list is empty');
  assert.equal(showsCrewNeeded(nec, CANCELLED, d, '2026-11-01'), false, 'not on a cancelled ride');
});

test('who gets “I’ll do it” on a spot', () => {
  const open = data();
  assert.equal(canVolunteer(rider, WEST_RIDE, 'tail_gunner', open, NOW), true, 'an open spot you can take');
  assert.equal(canVolunteer(rider, WEST_RIDE, 'officer', open, NOW), true, 'an Officer spot');
  assert.equal(canVolunteer(null, WEST_RIDE, 'officer', open, NOW), false, 'signed out');
  assert.equal(canVolunteer(fng, WEST_RIDE, 'officer', open, NOW), false, 'not eligible');
  assert.equal(canVolunteer(rider, CANCELLED, 'officer', open, NOW), false, 'a cancelled ride');
  const taken = data({ crew: [spot('west-ride', 'west-pres', 'tail_gunner')] });
  assert.equal(canVolunteer(rider, WEST_RIDE, 'tail_gunner', taken, NOW), false, 'a taken spot');
  const mine = data({ crew: [spot('west-ride', 'rider', 'tail_gunner')] });
  assert.equal(canVolunteer(rider, WEST_RIDE, 'road_captain', mine, NOW), false, 'not when you already hold a spot on the ride');
  assert.equal(canVolunteer(rider, WEST_RIDE, 'officer', mine, NOW), false, 'nor an Officer spot');
  assert.equal(canVolunteer(rider, WEST_RIDE, 'tail_gunner', mine, NOW), false, 'nor your own');
  const managerOn = data({ crew: [spot('west-ride', 'west-pres', 'officer')] });
  assert.equal(canVolunteer(westPres, WEST_RIDE, 'road_captain', managerOn, NOW), false, 'a manager on the crew moves with Pick');
  const elsewhere = data({ crew: [spot('club-ride', 'rider', 'tail_gunner')] });
  assert.equal(canVolunteer(rider, WEST_RIDE, 'tail_gunner', elsewhere, NOW), true, 'a spot on another ride does not count');
});

test('the rows of the Crew section', () => {
  const crew = [
    spot('west-ride', 'o1', 'officer'),
    spot('west-ride', 'tg', 'tail_gunner'),
    spot('club-ride', 'other', 'road_captain'),
  ];
  const rows = (locked: boolean, offerOfficer: boolean, list = crew) =>
    crewRows('west-ride', list, locked, offerOfficer).map((r) => `${r.key}=${r.memberId ?? 'open'}`);
  assert.deepEqual(
    rows(false, false),
    ['road_captain=open', 'tail_gunner=tg', 'assistant_tail_gunner=open', 'officer:o1=o1'],
    'every single spot, then the Officers; no open Officer row with nothing to offer',
  );
  assert.deepEqual(
    rows(false, true),
    ['road_captain=open', 'tail_gunner=tg', 'assistant_tail_gunner=open', 'officer:o1=o1', 'officer:new=open'],
    'an open Officer row when there is an offer on it',
  );
  assert.deepEqual(
    rows(false, false, []),
    ['road_captain=open', 'tail_gunner=open', 'assistant_tail_gunner=open', 'officer:new=open'],
    'an open Officer row says there are none yet',
  );
  assert.deepEqual(rows(true, true), ['tail_gunner=tg', 'officer:o1=o1'], 'a locked ride lists only who crewed');
  assert.deepEqual(rows(true, true, []), [], 'and nothing when nobody did');
  assert.deepEqual(
    crewRows('west-ride', crew, false, false).map((r) => r.role),
    ['road_captain', 'tail_gunner', 'assistant_tail_gunner', 'officer'],
  );
});
