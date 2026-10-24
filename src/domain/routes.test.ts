import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveRouteProblem,
  NO_ROUTE,
  NOT_MANAGER,
  formatClimb,
  formatKm,
  libraryFor,
  managesChapterRoutes,
  rideRouteChapters,
  rideRouteProblem,
  routeChapterName,
  routeFileName,
  routeOf,
  ridesUsingRoute,
  saveRouteProblem,
  signedInProblem,
} from './routes';
import { endOfFirstDay } from './rides';
import type { Chapter, ClubData, Member, Position, PositionRole, Ride, Route } from './types';

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

const route = (id: string, over: Partial<Route> = {}): Route => ({
  id, name: id, chapterId: null, notes: '', distanceM: 1000, climbM: null, line: [[-37.8, 144.9], [-37.7, 145]],
  stops: [], bounds: { minLat: -37.8, minLng: 144.9, maxLat: -37.7, maxLng: 145 }, archivedAt: null,
  updatedAt: '2026-10-01T00:00:00.000Z', ...over,
});

// Cast of characters. westVp is a board seat that is not on the NEC (a President would be).
const westVp = member('west-vp');
const northRc = member('north-rc', { chapterId: 'ch-north' });
const westComm = member('west-comm');
const nec = member('nec', { chapterId: 'ch-north' });
const rider = member('rider');
const pending = member('pending', { approval: 'pending' });

const WEST_RIDE = ride('west-ride'); // Sat 7 Nov 2026, 7 pm Melbourne
const CLUB_RIDE = ride('club-ride', { category: 'club' });
const CANCELLED = ride('cancelled', { cancelledAt: '2026-11-01T00:00:00.000Z' });

const WEST_ROUTE = route('west-route', { chapterId: 'ch-west', updatedAt: '2026-10-02T00:00:00.000Z' });
const NORTH_ROUTE = route('north-route', { chapterId: 'ch-north', updatedAt: '2026-10-03T00:00:00.000Z' });
const CLUB_ROUTE = route('club-route', { updatedAt: '2026-10-01T00:00:00.000Z' });
const OLD_ROUTE = route('old-route', { archivedAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' });

const data = (over: Partial<ClubData> = {}): ClubData => ({
  chapters,
  members: [westVp, northRc, westComm, nec, rider, pending],
  privates: [], bikes: [], registrations: [], emergencyContacts: [],
  positions: [
    position('west-vp', 'vice_president', 'ch-west'),
    position('north-rc', 'road_captain', 'ch-north'),
    position('west-comm', 'ride_committee', 'ch-west'),
    position('nec', 'nec_chair', null),
  ],
  rides: [WEST_RIDE, CLUB_RIDE, CANCELLED],
  rsvps: [],
  crew: [],
  routes: [WEST_ROUTE, NORTH_ROUTE, CLUB_ROUTE, OLD_ROUTE],
  rideRoutes: [],
  ...over,
});

const NOW = '2026-11-01T00:00:00.000Z';
const WORDS = 'Only the board or ride committee can change routes.';
const WORDS_RIDE = 'Only the board or ride committee can choose this ride’s route.';
const GONE = 'That route no longer exists.';

test('who manages a chapter’s routes', () => {
  const d = data();
  assert.equal(managesChapterRoutes(westVp, 'ch-west', d), true, 'West board on a West route');
  assert.equal(managesChapterRoutes(westComm, 'ch-west', d), true, 'West ride committee on a West route');
  assert.equal(managesChapterRoutes(northRc, 'ch-west', d), false, 'North board is not West');
  assert.equal(managesChapterRoutes(westComm, 'ch-north', d), false, 'West committee is not North');
  assert.equal(managesChapterRoutes(nec, 'ch-west', d), true, 'NEC manages every chapter');
  assert.equal(managesChapterRoutes(nec, null, d), true, 'NEC manages whole-club routes');
  assert.equal(managesChapterRoutes(northRc, null, d), true, 'any board seat on a whole-club route');
  assert.equal(managesChapterRoutes(westComm, null, d), true, 'any ride committee on a whole-club route');
  assert.equal(managesChapterRoutes(rider, 'ch-west', d), false);
  assert.equal(managesChapterRoutes(rider, null, d), false);
  assert.equal(managesChapterRoutes(null, null, d), false);
  assert.equal(managesChapterRoutes({ ...westVp, approval: 'pending' }, 'ch-west', d), false, 'approved only');
  assert.equal(managesChapterRoutes({ ...nec, approval: 'pending' }, null, d), false, 'approved only, NEC too');
  const ended = data({ positions: [position('west-comm', 'ride_committee', 'ch-west', { endedOn: '2026-01-01' })] });
  assert.equal(managesChapterRoutes(westComm, 'ch-west', ended), false, 'ended terms do not count');
  assert.equal(managesChapterRoutes(westComm, null, ended), false);
});

test('saving a route: the checks in order', () => {
  const d = data();
  const ok = { name: 'Warburton loop', chapterId: 'ch-west' as string | null };
  assert.equal(saveRouteProblem(null, undefined, ok, d), 'Sign in first.');
  assert.equal(saveRouteProblem(pending, undefined, ok, d), 'Only approved members can do that.');
  assert.equal(saveRouteProblem(westVp, undefined, ok, d), null);
  assert.equal(saveRouteProblem(westComm, undefined, ok, d), null);
  assert.equal(saveRouteProblem(nec, undefined, { ...ok, chapterId: null }, d), null);
  assert.equal(saveRouteProblem(rider, undefined, ok, d), WORDS);
  assert.equal(saveRouteProblem(northRc, undefined, ok, d), WORDS, 'North board can’t add a West route');
  assert.equal(saveRouteProblem(northRc, undefined, { ...ok, chapterId: null }, d), null, 'but can add a whole-club one');
  // Sign in and approval come before everything, then the manager check before the name.
  assert.equal(saveRouteProblem(null, undefined, { name: '', chapterId: 'ch-west' }, d), 'Sign in first.');
  assert.equal(saveRouteProblem(pending, undefined, { name: '', chapterId: 'ch-west' }, d), 'Only approved members can do that.');
  assert.equal(saveRouteProblem(rider, undefined, { name: '', chapterId: 'ch-west' }, d), WORDS);
});

test('saving a route: name', () => {
  const d = data();
  const input = (name: string) => ({ name, chapterId: 'ch-west' as string | null });
  assert.equal(saveRouteProblem(westVp, undefined, input(''), d), 'Give the route a name.');
  assert.equal(saveRouteProblem(westVp, undefined, input('   '), d), 'Give the route a name.', 'blank is blank');
  assert.equal(saveRouteProblem(westVp, undefined, input('x'.repeat(80)), d), null, '80 is fine');
  assert.equal(saveRouteProblem(westVp, undefined, input('x'.repeat(81)), d), 'Give the route a name.');
  assert.equal(saveRouteProblem(westVp, undefined, input(`  ${'x'.repeat(80)}  `), d), null, 'trimmed before counting');
  // Counted in characters (code points), as the database's char_length does, not UTF-16 units.
  assert.equal(saveRouteProblem(westVp, undefined, input('😀'.repeat(80)), d), null, '80 emoji are fine');
  assert.equal(saveRouteProblem(westVp, undefined, input('😀'.repeat(81)), d), 'Give the route a name.', '81 emoji are too many');
});

test('saving a route: editing', () => {
  const d = data();
  const same = { name: 'Renamed', chapterId: 'ch-west' as string | null };
  assert.equal(saveRouteProblem(westVp, WEST_ROUTE, same, d), null);
  assert.equal(saveRouteProblem(null, WEST_ROUTE, same, d), 'Sign in first.');
  assert.equal(saveRouteProblem(pending, WEST_ROUTE, same, d), 'Only approved members can do that.');
  assert.equal(saveRouteProblem(rider, WEST_ROUTE, same, d), WORDS);
  // Re-filing: must manage both the new chapter and the old one.
  assert.equal(saveRouteProblem(westVp, WEST_ROUTE, { ...same, chapterId: 'ch-north' }, d), WORDS, 'no right to North');
  assert.equal(saveRouteProblem(northRc, WEST_ROUTE, { ...same, chapterId: 'ch-north' }, d), WORDS, 'no right to the old West route');
  assert.equal(saveRouteProblem(northRc, WEST_ROUTE, { ...same, chapterId: null }, d), WORDS, 'can’t take a West route to the whole club');
  assert.equal(saveRouteProblem(nec, WEST_ROUTE, { ...same, chapterId: 'ch-north' }, d), null, 'NEC can re-file');
  assert.equal(saveRouteProblem(westVp, CLUB_ROUTE, same, d), null, 'any board seat manages a whole-club route');
  assert.equal(saveRouteProblem(westVp, OLD_ROUTE, same, d), null, 'an archived route can still be edited');
});

test('saving a route: a route that has vanished', () => {
  const d = data();
  const gone = { id: 'west-route', name: 'Renamed', chapterId: 'ch-west' as string | null };
  assert.equal(saveRouteProblem(westVp, undefined, gone, d), GONE, 'an id with no route behind it');
  assert.equal(saveRouteProblem(null, undefined, gone, d), 'Sign in first.', 'sign in first');
  assert.equal(saveRouteProblem(pending, undefined, gone, d), 'Only approved members can do that.');
  assert.equal(saveRouteProblem(rider, undefined, gone, d), GONE, 'missing before manager');
  assert.equal(saveRouteProblem(westVp, undefined, { ...gone, name: '' }, d), GONE, 'missing before name');
  assert.equal(saveRouteProblem(westVp, WEST_ROUTE, { ...gone, name: 'Fine' }, d), null, 'found, so fine');
  assert.equal(saveRouteProblem(westVp, undefined, { name: 'New', chapterId: 'ch-west' }, d), null, 'no id means adding');
  assert.equal(saveRouteProblem(westVp, undefined, { id: null, name: 'New', chapterId: 'ch-west' }, d), null, 'null id means adding');
});

test('archiving a route', () => {
  const d = data();
  assert.equal(archiveRouteProblem(null, WEST_ROUTE, d), 'Sign in first.');
  assert.equal(archiveRouteProblem(pending, WEST_ROUTE, d), 'Only approved members can do that.');
  assert.equal(archiveRouteProblem(westVp, undefined, d), GONE);
  assert.equal(archiveRouteProblem(rider, undefined, d), GONE, 'missing before manager');
  assert.equal(archiveRouteProblem(rider, WEST_ROUTE, d), WORDS);
  assert.equal(archiveRouteProblem(northRc, WEST_ROUTE, d), WORDS);
  assert.equal(archiveRouteProblem(westVp, WEST_ROUTE, d), null);
  assert.equal(archiveRouteProblem(westComm, WEST_ROUTE, d), null);
  assert.equal(archiveRouteProblem(nec, NORTH_ROUTE, d), null);
  assert.equal(archiveRouteProblem(northRc, CLUB_ROUTE, d), null, 'any board seat on a whole-club route');
  assert.equal(archiveRouteProblem(rider, CLUB_ROUTE, d), WORDS);
  assert.equal(archiveRouteProblem(westVp, OLD_ROUTE, d), null, 'archiving twice is harmless');
});

test('choosing a ride’s route: the checks in order', () => {
  const d = data();
  const p = (me: Member | null, r: Ride | undefined, rt: Route | undefined | null, now = NOW) =>
    rideRouteProblem(me, r, rt, d, now);
  const AFTER = '2026-11-08T00:00:00.000Z';
  assert.equal(p(null, WEST_RIDE, WEST_ROUTE), 'Sign in first.');
  assert.equal(p(pending, WEST_RIDE, WEST_ROUTE), 'Only approved members can do that.');
  assert.equal(p(westVp, undefined, WEST_ROUTE), 'No such ride.');
  assert.equal(p(westVp, CANCELLED, WEST_ROUTE), 'That ride was cancelled.');
  assert.equal(p(rider, CANCELLED, WEST_ROUTE), 'That ride was cancelled.', 'cancelled before manager');
  assert.equal(p(westVp, WEST_RIDE, WEST_ROUTE, AFTER), 'The route can’t change after the ride day.');
  assert.equal(p(rider, WEST_RIDE, WEST_ROUTE, AFTER), 'The route can’t change after the ride day.', 'window before manager');
  assert.equal(p(westVp, CANCELLED, WEST_ROUTE, AFTER), 'That ride was cancelled.', 'cancelled before window');
  assert.equal(p(rider, WEST_RIDE, WEST_ROUTE), WORDS_RIDE);
  assert.equal(p(rider, WEST_RIDE, undefined), WORDS_RIDE, 'manager before missing route');
  assert.equal(p(rider, WEST_RIDE, OLD_ROUTE), WORDS_RIDE, 'manager before archived');
  assert.equal(p(westVp, WEST_RIDE, undefined), GONE);
  assert.equal(p(westVp, WEST_RIDE, OLD_ROUTE), 'That route has been archived.');
  assert.equal(p(westVp, WEST_RIDE, WEST_ROUTE), null);
});

test('choosing a ride’s route: who may', () => {
  const d = data();
  const p = (me: Member, r: Ride, rt: Route | null) => rideRouteProblem(me, r, rt, d, NOW);
  assert.equal(p(westComm, WEST_RIDE, WEST_ROUTE), null);
  assert.equal(p(northRc, WEST_RIDE, WEST_ROUTE), WORDS_RIDE, 'North board on a West ride');
  assert.equal(p(northRc, CLUB_RIDE, WEST_ROUTE), null, 'any board seat on a club ride');
  assert.equal(p(nec, WEST_RIDE, NORTH_ROUTE), null, 'NEC manages every ride');
  assert.equal(p(westVp, WEST_RIDE, NORTH_ROUTE), null, 'a West ride can use a North route');
});

test('clearing a ride’s route', () => {
  const d = data();
  assert.equal(rideRouteProblem(westVp, WEST_RIDE, null, d, NOW), null, 'a null route clears it');
  assert.equal(rideRouteProblem(rider, WEST_RIDE, null, d, NOW), WORDS_RIDE);
  assert.equal(rideRouteProblem(westVp, CANCELLED, null, d, NOW), 'That ride was cancelled.');
});

test('the ride-day window ends at the first Melbourne midnight after the start', () => {
  const d = data();
  const end = endOfFirstDay(WEST_RIDE);
  const before = new Date(end - 1).toISOString();
  const at = new Date(end).toISOString();
  assert.equal(rideRouteProblem(westVp, WEST_RIDE, WEST_ROUTE, d, before), null, 'last millisecond of the ride day');
  assert.equal(rideRouteProblem(westVp, WEST_RIDE, WEST_ROUTE, d, at), 'The route can’t change after the ride day.');
});

test('a ride’s route', () => {
  const d = data({ rideRoutes: [{ rideId: 'west-ride', routeId: 'west-route' }, { rideId: 'club-ride', routeId: 'old-route' }] });
  assert.equal(routeOf('west-ride', d)?.id, 'west-route');
  assert.equal(routeOf('club-ride', d)?.id, 'old-route', 'an archived route stays on the ride');
  assert.equal(routeOf('cancelled', d), undefined, 'no row, no route');
  assert.equal(routeOf('west-ride', data()), undefined);
  const dangling = data({ rideRoutes: [{ rideId: 'west-ride', routeId: 'gone' }] });
  assert.equal(routeOf('west-ride', dangling), undefined, 'a route that isn’t in the data');
  assert.equal(routeOf('west-ride', data({ routes: undefined, rideRoutes: undefined })), undefined, 'missing lists');
});

test('the library', () => {
  const d = data();
  assert.deepEqual(libraryFor(d, 'all').map((r) => r.id), ['north-route', 'west-route', 'club-route'], 'newest first, archived left out');
  assert.deepEqual(libraryFor(d, ['ch-west', null]).map((r) => r.id), ['west-route', 'club-route'], 'a chapter plus whole-club');
  assert.deepEqual(libraryFor(d, ['ch-west']).map((r) => r.id), ['west-route']);
  assert.deepEqual(libraryFor(d, [null]).map((r) => r.id), ['club-route']);
  assert.deepEqual(libraryFor(d, []).map((r) => r.id), []);
  assert.deepEqual(libraryFor(data({ routes: undefined }), 'all'), []);
  const before = d.routes!.map((r) => r.id);
  libraryFor(d, 'all');
  assert.deepEqual(d.routes!.map((r) => r.id), before, 'does not reorder the data');
});

test('a route’s file name is safe to save', () => {
  assert.equal(routeFileName('Daylesford breakfast loop'), 'Daylesford breakfast loop.gpx');
  assert.equal(routeFileName('Kinglake / Healesville (v2)'), 'Kinglake  Healesville v2.gpx', 'slashes and brackets go');
  assert.equal(routeFileName('  Two-chapters_run  '), 'Two-chapters_run.gpx', 'trimmed; hyphens and underscores stay');
  assert.equal(routeFileName('../../etc/passwd'), 'etcpasswd.gpx', 'no path tricks');
  assert.equal(routeFileName('☕️ ☕️'), 'route.gpx', 'nothing left: route');
  assert.equal(routeFileName(''), 'route.gpx');
});

test('distance in km to one decimal place', () => {
  assert.equal(formatKm(84213), '84.2 km');
  assert.equal(formatKm(84250), '84.3 km', 'rounds half up');
  assert.equal(formatKm(0), '0.0 km');
  assert.equal(formatKm(960), '1.0 km');
  assert.equal(formatKm(312049), '312.0 km');
});

test('climb in whole metres', () => {
  assert.equal(formatClimb(642.6), '643 m');
  assert.equal(formatClimb(0), '0 m');
  assert.equal(formatClimb(1240), '1,240 m', 'thousands grouped');
  assert.equal(formatClimb(12345), '12,345 m');
  assert.equal(formatClimb(null), null, 'no elevation in the file');
});

test('a route’s chapter name', () => {
  const d = data();
  assert.equal(routeChapterName('ch-west', d), 'West');
  assert.equal(routeChapterName(null, d), 'Whole club');
  assert.equal(routeChapterName('ch-gone', d), 'Whole club', 'an unknown chapter reads as the whole club');
});

test('the routes a ride chooses from', () => {
  const d = data();
  assert.deepEqual(rideRouteChapters(WEST_RIDE, d), ['ch-west', null], 'its chapter plus whole-club');
  assert.deepEqual(rideRouteChapters(ride('n', { category: 'north' }), d), ['ch-north', null]);
  assert.deepEqual(rideRouteChapters(CLUB_RIDE, d), [null], 'a club ride: whole-club routes');
  assert.deepEqual(rideRouteChapters(ride('s', { category: 'supported' }), d), [null]);
  assert.deepEqual(rideRouteChapters(WEST_RIDE, data({ chapters: [] })), [null], 'a chapter that isn’t in the data');
});

test('the upcoming rides that use a route', () => {
  const later = ride('later', { startsAt: '2026-12-01T08:00:00.000Z' });
  const past = ride('past', { startsAt: '2026-10-01T08:00:00.000Z' });
  const d = data({
    rides: [later, WEST_RIDE, CLUB_RIDE, CANCELLED, past],
    rideRoutes: [
      { rideId: 'later', routeId: 'west-route' },
      { rideId: 'west-ride', routeId: 'west-route' },
      { rideId: 'club-ride', routeId: 'club-route' },
      { rideId: 'cancelled', routeId: 'west-route' },
      { rideId: 'past', routeId: 'west-route' },
    ],
  });
  assert.deepEqual(ridesUsingRoute('west-route', d, '2026-11-01').map((r) => r.id), ['west-ride', 'later'], 'soonest first; past and cancelled left out');
  assert.deepEqual(ridesUsingRoute('west-route', d, '2026-11-08').map((r) => r.id), ['later']);
  assert.deepEqual(ridesUsingRoute('west-route', d, '2026-11-07').map((r) => r.id), ['west-ride', 'later'], 'still upcoming on the day');
  assert.deepEqual(ridesUsingRoute('north-route', d, '2026-11-01'), []);
  assert.deepEqual(ridesUsingRoute('west-route', data({ rideRoutes: undefined }), '2026-11-01'), []);
});

test('the library sorts by time, not by the text of the timestamp', () => {
  // 09:00 at +10:00 is 23:00 the day before in UTC, so it's older, though its text sorts later.
  const early = route('early', { updatedAt: '2026-10-02T09:00:00+10:00' });
  const late = route('late', { updatedAt: '2026-10-02T00:00:00.000Z' });
  assert.deepEqual(libraryFor(data({ routes: [early, late] }), 'all').map((r) => r.id), ['late', 'early']);
});

test('the opening checks and shared refusals', () => {
  assert.equal(signedInProblem(null), 'Sign in first.');
  assert.equal(signedInProblem(pending), 'Only approved members can do that.');
  assert.equal(signedInProblem(rider), null);
  assert.equal(NOT_MANAGER, WORDS);
  assert.equal(NO_ROUTE, GONE);
});
