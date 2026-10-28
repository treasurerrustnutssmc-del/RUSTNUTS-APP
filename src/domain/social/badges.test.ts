import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeCount, badgesFor, toGoLine, stateAt, statesOnRoute, type AuState, type TrackBadge } from './badges';
import type { Attendance, Big4Ride, CheckinSession, Member, Route } from '../types';

const member = (id: string, chapterId = 'ch-west'): Member => ({
  id, chapterId, fullName: id, roadName: null, status: 'full', approval: 'approved', joinedOn: '2020-01-01', patchedOn: null,
  fngStartedOn: null, bio: null, sharePhone: false, appliedOn: null, onHiatus: false,
});
const session = (id: string, rideId: string | null, kind: 'ride' | 'meeting' = 'ride'): CheckinSession => ({
  id, kind, chapterId: null, rideId, title: id, heldOn: '2026-05-01', openedBy: null, closedAt: null,
});
const came = (sessionId: string, memberId: string): Attendance => ({ sessionId, memberId, checkedInAt: '2026-05-01T01:00:00.000Z', markedBy: null });
const route = (id: string, km: number, line: [number, number][], stops: [number, number][] = []): Route => ({
  id, name: id, chapterId: null, notes: '', distanceM: km * 1000, climbM: null, line, stops: stops.map(([lat, lng]) => ({ name: 'x', lat, lng })),
  bounds: { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 }, archivedAt: null, updatedAt: '2026-01-01T00:00:00.000Z',
});
const track = (tracks: TrackBadge[], key: TrackBadge['track']) => tracks.find((t) => t.track === key)!;

test('the state or territory a point is in', () => {
  const towns: [string, number, number, AuState][] = [
    ['Melbourne', -37.81, 144.96, 'VIC'],
    ['Daylesford', -37.34, 144.14, 'VIC'],
    ['Wodonga', -36.12, 146.89, 'VIC'],
    ['Albury', -36.08, 146.92, 'NSW'],
    ['Mildura', -34.19, 142.16, 'VIC'],
    ['Echuca', -36.14, 144.75, 'VIC'],
    ['Moama', -36.11, 144.76, 'NSW'],
    ['Corryong', -36.2, 147.9, 'VIC'],
    ['Cudgewa', -36.19, 147.77, 'VIC'],
    ['Tintaldra', -36.05, 147.93, 'VIC'],
    ['Towong', -36.13, 147.99, 'VIC'],
    ['Walwa', -35.97, 147.73, 'VIC'],
    ['Rutherglen', -36.05, 146.46, 'VIC'],
    ['Cobram', -35.92, 145.65, 'VIC'],
    ['Barooga', -35.91, 145.69, 'NSW'],
    ['Strathmerton', -35.93, 145.48, 'VIC'],
    ['Barmah', -36.02, 144.96, 'VIC'],
    ['Picola', -35.99, 145.12, 'VIC'],
    ['Koondrook', -35.64, 144.12, 'VIC'],
    ['Barham', -35.63, 144.13, 'NSW'],
    ['Piangil', -35.06, 143.31, 'VIC'],
    ['Boundary Bend', -34.72, 143.15, 'VIC'],
    ['Robinvale', -34.58, 142.77, 'VIC'],
    ['Euston', -34.58, 142.75, 'NSW'],
    ['Tocumwal', -35.81, 145.57, 'NSW'],
    ['Corowa', -35.99, 146.39, 'NSW'],
    ['Khancoban', -36.22, 148.13, 'NSW'],
    ['Mallacoota', -37.56, 149.75, 'VIC'],
    ['Eden', -37.07, 149.9, 'NSW'],
    ['Broken Hill', -31.95, 141.47, 'NSW'],
    ['Sydney', -33.87, 151.21, 'NSW'],
    ['Bourke', -30.09, 145.94, 'NSW'],
    ['Moree', -29.47, 149.84, 'NSW'],
    ['Boggabilla', -28.6, 150.36, 'NSW'],
    ['Goondiwindi', -28.55, 150.31, 'QLD'],
    ['Tenterfield', -29.05, 152.02, 'NSW'],
    ['Stanthorpe', -28.66, 151.93, 'QLD'],
    ['Tweed Heads', -28.18, 153.54, 'NSW'],
    ['Coolangatta', -28.17, 153.53, 'QLD'],
    ['Byron Bay', -28.64, 153.61, 'NSW'],
    ['Canberra', -35.28, 149.13, 'ACT'],
    ['Queanbeyan', -35.35, 149.23, 'NSW'],
    ['Brisbane', -27.47, 153.03, 'QLD'],
    ['Surfers Paradise', -28.0, 153.43, 'QLD'],
    ['Birdsville', -25.9, 139.35, 'QLD'],
    ['Cunnamulla', -28.07, 145.68, 'QLD'],
    ['Adelaide', -34.93, 138.6, 'SA'],
    ['Mount Gambier', -37.83, 140.78, 'SA'],
    ['Coober Pedy', -29.01, 134.75, 'SA'],
    ['Renmark', -34.17, 140.75, 'SA'],
    ['Darwin', -12.46, 130.84, 'NT'],
    ['Alice Springs', -23.7, 133.88, 'NT'],
    ['Uluru', -25.34, 131.04, 'NT'],
    ['Perth', -31.95, 115.86, 'WA'],
    ['Kununurra', -15.77, 128.74, 'WA'],
    ['Eucla', -31.68, 128.88, 'WA'],
    ['Hobart', -42.88, 147.33, 'TAS'],
    ['Devonport', -41.18, 146.35, 'TAS'],
  ];
  for (const [name, lat, lng, state] of towns) assert.equal(stateAt(lat, lng), state, name);
  assert.equal(stateAt(-39.88, 143.9), 'TAS', 'King Island');
  assert.equal(stateAt(-38.15, 145.9), 'VIC', 'Gippsland');
  assert.equal(stateAt(-40.0, 150.0), null, 'out in the Tasman');
  assert.equal(stateAt(1.29, 103.85), null, 'Singapore');
});

test('a route’s states, from its line and stops, in a fixed order', () => {
  const murray = route('murray', 600, [[-37.81, 144.96], [-36.12, 146.89], [-36.08, 146.92]]);
  assert.deepEqual(statesOnRoute(murray), ['VIC', 'NSW']);
  assert.deepEqual(statesOnRoute(route('stop', 10, [[-37.81, 144.96]], [[-34.93, 138.6]])), ['VIC', 'SA'], 'a stop counts');
  assert.deepEqual(statesOnRoute(route('none', 0, [])), []);
});

test('rides: each ride checked in to counts once, meetings don’t', () => {
  const spanner = member('spanner');
  const data = {
    checkinSessions: [session('s1', 'r1'), session('s1b', 'r1'), session('s2', 'r2'), session('m1', null, 'meeting'), session('s3', null)],
    attendance: [came('s1', 'spanner'), came('s1b', 'spanner'), came('s2', 'spanner'), came('m1', 'spanner'), came('s3', 'spanner'), came('s2', 'other')],
  };
  const rides = track(badgesFor(spanner, data, []).tracks, 'rides');
  assert.equal(rides.value, 3, 'r1 once, r2, and a ride check-in with no calendar ride');
  assert.equal(rides.earned, 'First ride');
  assert.equal(rides.next, 10);
  assert.equal(rides.nextLabel, '10 rides');
  assert.ok(Math.abs(rides.progress - 2 / 9) < 1e-9, 'from 1 to 10');
  assert.equal(track(badgesFor(member('nobody'), data, []).tracks, 'rides').earned, null, 'none yet');
});

test('the tiers', () => {
  const many = (n: number) => ({
    checkinSessions: Array.from({ length: n }, (_, i) => session(`s${i}`, `r${i}`)),
    attendance: Array.from({ length: n }, (_, i) => came(`s${i}`, 'spanner')),
  });
  const at = (n: number) => track(badgesFor(member('spanner'), many(n), []).tracks, 'rides');
  assert.deepEqual([at(9).earned, at(10).earned, at(25).earned, at(50).earned, at(100).earned], ['First ride', '10 rides', '25 rides', '50 rides', '100 rides']);
  assert.equal(at(100).next, null, 'the top');
  assert.equal(at(100).nextLabel, null);
  assert.equal(at(100).progress, 1);
  assert.equal(at(0).progress, 0);
});

test('Big 4s: only those that counted for the member', () => {
  const big4: Big4Ride[] = [
    { rideId: 'r1', chapterId: null, designatedBy: null, designatedAt: '2026-01-01T00:00:00.000Z' },
    { rideId: 'r2', chapterId: 'ch-west', designatedBy: null, designatedAt: '2026-01-01T00:00:00.000Z' },
    { rideId: 'r3', chapterId: 'ch-north', designatedBy: null, designatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const data = {
    big4Rides: big4,
    checkinSessions: [session('s1', 'r1'), session('s2', 'r2'), session('s3', 'r3'), session('s4', 'r4')],
    attendance: ['s1', 's2', 's3', 's4'].map((s) => came(s, 'spanner')),
  };
  const b = track(badgesFor(member('spanner', 'ch-west'), data, []).tracks, 'big4');
  assert.equal(b.value, 2, 'the whole club’s and West’s, not North’s, not an ordinary ride');
  assert.equal(b.earned, 'First Big 4');
  assert.equal(b.next, 4);
});

test('kilometres and states come from the routes of rides checked in to', () => {
  const data = {
    routes: [
      route('vic', 180, [[-37.81, 144.96], [-37.34, 144.14]]),
      route('murray', 650, [[-37.81, 144.96], [-36.08, 146.92]]),
      route('coorong', 900, [[-37.81, 144.96], [-37.83, 140.78], [-34.93, 138.6]]),
    ],
    checkinSessions: [session('s1', 'r1'), session('s2', 'r2'), session('s3', 'r3'), session('s4', 'r4'), session('s5', 'r5')],
    attendance: ['s1', 's2', 's3', 's4'].map((s) => came(s, 'spanner')),
  };
  const rideRoutes = [
    { rideId: 'r1', routeId: 'vic' }, { rideId: 'r2', routeId: 'murray' }, { rideId: 'r3', routeId: 'vic' },
    { rideId: 'r5', routeId: 'coorong' }, // not checked in to
  ];
  const b = badgesFor(member('spanner'), data, rideRoutes);
  const km = track(b.tracks, 'km');
  assert.equal(km.value, 1010, 'vic twice and the Murray; r4 had no route');
  assert.equal(km.earned, '1,000 km');
  assert.deepEqual(b.states, ['VIC', 'NSW']);
  const states = track(b.tracks, 'states');
  assert.equal(states.value, 2);
  assert.equal(states.earned, 'Two states');
  assert.equal(states.next, 3);
  const missing = badgesFor(member('spanner'), { ...data, routes: [] }, rideRoutes);
  assert.equal(track(missing.tracks, 'km').value, 0, 'a route that isn’t there adds nothing');
});

test('the four tracks, always in the same order', () => {
  assert.deepEqual(badgesFor(member('x'), {}, []).tracks.map((t) => [t.track, t.value, t.earned]), [
    ['rides', 0, null], ['big4', 0, null], ['km', 0, null], ['states', 0, null],
  ]);
});

test('how a count reads', () => {
  assert.deepEqual(
    [badgeCount('rides', 1), badgeCount('rides', 23), badgeCount('big4', 1), badgeCount('big4', 3), badgeCount('km', 3788), badgeCount('km', 12), badgeCount('states', 1), badgeCount('states', 3)],
    ['1 ride', '23 rides', '1 Big 4', '3 Big 4s', '3,788 km', '12 km', '1 state', '3 states'],
  );
});

test('what’s left to the next badge', () => {
  const t = (value: number, next: number | null, nextLabel: string | null) => ({ track: 'km' as const, value, earned: null, next, nextLabel, progress: 0 });
  assert.equal(toGoLine(t(2710, 5000, '5,000 km')), '2,290 more for 5,000 km');
  assert.equal(toGoLine({ ...t(3, 4, '4 Big 4s'), track: 'big4' }), '1 more for 4 Big 4s');
  assert.equal(toGoLine(t(30000, null, null)), 'Top badge');
});
