import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_TRACK, NOT_GPX, readGpx } from '../domain/gpx';
import { libraryFor, routeOf } from '../domain/routes';
import type { ClubData } from '../domain/types';
import type { RouteInput } from './clubContext';
import { archiveRoute, routeGpx, runDemoAction, saveRoute, setRideRoute, storedGpx, type DemoCtx } from './demoActions';
import { DEMO_DATA, DEMO_ROUTE_GPX } from './demoData';

const NOW = '2026-10-24T00:00:00.000Z';
const LATER = '2026-10-25T00:00:00.000Z';
const ctxFor = (meId: string | null, data: ClubData = DEMO_DATA, now = NOW): DemoCtx => ({
  data,
  me: data.members.find((m) => m.id === meId) ?? null,
  today: now.slice(0, 10),
  now,
});
const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('was allowed');
};

const FILE = `<?xml version="1.0"?><gpx version="1.1" creator="test"><wpt lat="-37.7" lon="144.6"><name>Pie stop</name></wpt>
<trk><trkseg><trkpt lat="-37.80" lon="144.60"><ele>10</ele></trkpt><trkpt lat="-37.70" lon="144.60"><ele>60</ele></trkpt></trkseg></trk></gpx>`;
const add = (over: Partial<RouteInput> = {}): RouteInput => ({
  id: null, name: 'Werribee Gorge loop', chapterId: 'ch-west', notes: '', gpx: FILE, ...over,
});
const files = () => new Map(Object.entries(DEMO_ROUTE_GPX));

test('the demo has three routes, filled in by the GPX reader from their files', () => {
  const routes = DEMO_DATA.routes ?? [];
  assert.equal(routes.length, 3);
  assert.deepEqual(routes.map((r) => r.chapterId).sort(), ['ch-north', 'ch-west', null].sort());
  for (const r of routes) {
    const text = DEMO_ROUTE_GPX[r.id];
    assert.ok(text, `${r.name} has a file`);
    const s = readGpx(text);
    assert.equal(typeof s, 'object', `${r.name}: ${String(s)}`);
    if (typeof s === 'string') continue;
    assert.deepEqual(
      { name: r.name, distanceM: r.distanceM, climbM: r.climbM, line: r.line, stops: r.stops, bounds: r.bounds },
      s,
      `${r.name}'s summary is the reader's, and its file carries its name`,
    );
    assert.ok(r.line.length >= 24, `${r.name} has a few dozen points`);
    assert.ok(r.distanceM > 30000, `${r.name} is a real ride`);
    assert.ok(r.stops.length > 0, `${r.name} has stops`);
    assert.equal(r.archivedAt, null);
  }
});

test('demo ride r-1 uses the West loop, r-2 has no route', () => {
  const west = routeOf('r-1', DEMO_DATA);
  assert.equal(west?.chapterId, 'ch-west');
  assert.equal(routeOf('r-2', DEMO_DATA), undefined);
});

test('a manager adds a route: the summary is read from the file, and the name and notes are trimmed', () => {
  const { data, id } = saveRoute(ctxFor('m-torque'), add({ name: '  Werribee Gorge loop  ', notes: '  Fuel at Bacchus Marsh. ' }));
  const r = data.routes!.find((x) => x.id === id)!;
  const s = readGpx(FILE);
  assert.ok(typeof s === 'object');
  assert.equal(r.name, 'Werribee Gorge loop');
  assert.equal(r.notes, 'Fuel at Bacchus Marsh.');
  assert.equal(r.chapterId, 'ch-west');
  assert.equal(r.distanceM, s.distanceM);
  assert.equal(r.climbM, 50);
  assert.deepEqual(r.stops, [{ name: 'Pie stop', lat: -37.7, lng: 144.6 }]);
  assert.equal(r.archivedAt, null);
  assert.equal(r.updatedAt, NOW);
  assert.equal(data.routes!.length, (DEMO_DATA.routes ?? []).length + 1);
  assert.equal(libraryFor(data, ['ch-west'])[0].id, id, 'newest first');
});

test('editing without a file keeps the file’s summary; with a file replaces it', () => {
  const before = DEMO_DATA.routes!.find((r) => r.chapterId === 'ch-west')!;
  const renamed = saveRoute(ctxFor('m-torque', DEMO_DATA, LATER), add({ id: before.id, name: 'Renamed', gpx: null, notes: '' }));
  assert.equal(renamed.id, before.id);
  const r = renamed.data.routes!.find((x) => x.id === before.id)!;
  assert.equal(r.name, 'Renamed');
  assert.equal(r.notes, '');
  assert.deepEqual(r.line, before.line);
  assert.equal(r.distanceM, before.distanceM);
  assert.equal(r.updatedAt, LATER);
  assert.equal(renamed.data.routes!.length, DEMO_DATA.routes!.length, 'no new route');

  const replaced = saveRoute(ctxFor('m-torque'), add({ id: before.id, gpx: FILE })).data.routes!.find((x) => x.id === before.id)!;
  assert.equal(replaced.line.length, 2);
  assert.deepEqual(replaced.stops, [{ name: 'Pie stop', lat: -37.7, lng: 144.6 }]);
});

test('saving a route: the rule checks come first, then the file', () => {
  assert.equal(refusal(() => saveRoute(ctxFor(null), add())), 'Sign in first.');
  assert.equal(refusal(() => saveRoute(ctxFor('m-dylan'), add())), 'Only approved members can do that.');
  assert.equal(refusal(() => saveRoute(ctxFor('m-torque'), add({ id: 'rt-gone' }))), 'That route no longer exists.');
  assert.equal(refusal(() => saveRoute(ctxFor('m-chook'), add())), 'Only the board or ride committee can change routes.');
  // A North manager can't take a West route to the whole club.
  const westRoute = DEMO_DATA.routes!.find((r) => r.chapterId === 'ch-west')!;
  assert.equal(
    refusal(() => saveRoute(ctxFor('m-crank'), add({ id: westRoute.id, chapterId: null, gpx: null }))),
    'Only the board or ride committee can change routes.',
  );
  // The name before the file: a blank name and a broken file is a name problem.
  assert.equal(refusal(() => saveRoute(ctxFor('m-torque'), add({ name: ' ', gpx: '<gpx><trk>' }))), 'Give the route a name.');
  assert.equal(refusal(() => saveRoute(ctxFor('m-torque'), add({ gpx: '<gpx><trk>' }))), NOT_GPX);
  assert.equal(refusal(() => saveRoute(ctxFor('m-torque'), add({ gpx: '<gpx version="1.1"></gpx>' }))), NO_TRACK);
  // A new route needs a file, as the database says.
  assert.equal(refusal(() => saveRoute(ctxFor('m-torque'), add({ gpx: null }))), NO_TRACK);
});

test('the NEC can save a route in any chapter, and a North Road Captain a whole-club one', () => {
  assert.ok(saveRoute(ctxFor('m-rusty'), add({ chapterId: 'ch-north' })).id);
  assert.ok(saveRoute(ctxFor('m-crank'), add({ chapterId: null })).id);
});

test('archiving hides a route from the library, but the ride using it keeps it', () => {
  const west = routeOf('r-1', DEMO_DATA)!;
  const data = archiveRoute(ctxFor('m-torque'), west.id);
  const r = data.routes!.find((x) => x.id === west.id)!;
  assert.equal(r.archivedAt, NOW);
  assert.equal(r.updatedAt, NOW);
  assert.ok(!libraryFor(data, 'all').some((x) => x.id === west.id));
  assert.equal(routeOf('r-1', data)?.id, west.id);
  // Archiving again changes nothing.
  const again = archiveRoute(ctxFor('m-torque', data, LATER), west.id);
  assert.equal(again.routes!.find((x) => x.id === west.id)!.archivedAt, NOW);
});

test('archiving: who may', () => {
  const west = routeOf('r-1', DEMO_DATA)!;
  assert.equal(refusal(() => archiveRoute(ctxFor(null), west.id)), 'Sign in first.');
  assert.equal(refusal(() => archiveRoute(ctxFor('m-dylan'), west.id)), 'Only approved members can do that.');
  assert.equal(refusal(() => archiveRoute(ctxFor('m-torque'), 'rt-gone')), 'That route no longer exists.');
  assert.equal(refusal(() => archiveRoute(ctxFor('m-crank'), west.id)), 'Only the board or ride committee can change routes.');
  assert.equal(refusal(() => archiveRoute(ctxFor('m-spanner'), west.id)), 'Only the board or ride committee can change routes.');
});

test('a ride’s route: set, change and clear', () => {
  const north = DEMO_DATA.routes!.find((r) => r.chapterId === 'ch-north')!;
  const set = setRideRoute(ctxFor('m-crank'), 'r-2', north.id);
  assert.equal(routeOf('r-2', set)?.id, north.id);
  const club = DEMO_DATA.routes!.find((r) => r.chapterId === null)!;
  const changed = setRideRoute(ctxFor('m-torque'), 'r-1', club.id);
  assert.equal(routeOf('r-1', changed)?.id, club.id);
  assert.equal(changed.rideRoutes!.filter((x) => x.rideId === 'r-1').length, 1, 'one route per ride');
  const cleared = setRideRoute(ctxFor('m-torque'), 'r-1', null);
  assert.equal(routeOf('r-1', cleared), undefined);
  assert.ok(!cleared.rideRoutes!.some((x) => x.rideId === 'r-1'));
});

test('a ride’s route: who may, and which routes', () => {
  const west = routeOf('r-1', DEMO_DATA)!;
  assert.equal(refusal(() => setRideRoute(ctxFor(null), 'r-1', west.id)), 'Sign in first.');
  assert.equal(refusal(() => setRideRoute(ctxFor('m-torque'), 'r-nope', west.id)), 'No such ride.');
  assert.equal(refusal(() => setRideRoute(ctxFor('m-torque'), 'r-5', west.id)), 'That ride was cancelled.');
  assert.equal(
    refusal(() => setRideRoute(ctxFor('m-torque', DEMO_DATA, '2026-11-09T00:00:00.000Z'), 'r-1', west.id)),
    'The route can’t change after the ride day.',
  );
  assert.equal(refusal(() => setRideRoute(ctxFor('m-spanner'), 'r-1', null)), 'Only the board or ride committee can choose this ride’s route.');
  assert.equal(refusal(() => setRideRoute(ctxFor('m-torque'), 'r-1', 'rt-gone')), 'That route no longer exists.');
  const archived = archiveRoute(ctxFor('m-torque'), west.id);
  assert.equal(refusal(() => setRideRoute(ctxFor('m-torque', archived), 'r-1', west.id)), 'That route has been archived.');
});

test('a route’s GPX file comes from the demo’s files, for members only', () => {
  const west = routeOf('r-1', DEMO_DATA)!;
  assert.equal(routeGpx(ctxFor('m-spanner'), files(), west.id), DEMO_ROUTE_GPX[west.id]);
  assert.equal(refusal(() => routeGpx(ctxFor(null), files(), west.id)), 'Sign in first.');
  assert.equal(refusal(() => routeGpx(ctxFor('m-dylan'), files(), west.id)), 'Only approved members can do that.');
  assert.equal(refusal(() => routeGpx(ctxFor('m-spanner'), files(), 'rt-gone')), 'That route no longer exists.');
  // An archived route's file still reads.
  const archived = archiveRoute(ctxFor('m-torque'), west.id);
  assert.equal(routeGpx(ctxFor('m-spanner', archived), files(), west.id), DEMO_ROUTE_GPX[west.id]);
});

test('the parity actions run the route actions', () => {
  const west = routeOf('r-1', DEMO_DATA)!;
  const saved = runDemoAction(ctxFor('m-torque'), {
    action: 'saveRoute', route: null, routeName: 'Loop', chapter: 'ch-west', gpx: FILE,
  });
  assert.equal(saved.routes!.length, DEMO_DATA.routes!.length + 1);
  const archived = runDemoAction(ctxFor('m-torque'), { action: 'archiveRoute', route: west.id });
  assert.ok(archived.routes!.find((r) => r.id === west.id)!.archivedAt);
  const cleared = runDemoAction(ctxFor('m-torque'), { action: 'setRideRoute', ride: 'r-1', route: null });
  assert.equal(routeOf('r-1', cleared), undefined);
});

test('a saved file is kept without a leading byte order mark, as the database keeps it', () => {
  assert.equal(storedGpx(`\uFEFF${FILE}`), FILE);
  assert.equal(storedGpx(FILE), FILE);
  assert.ok(saveRoute(ctxFor('m-torque'), add({ gpx: `\uFEFF${FILE}` })).id, 'a file with a BOM reads');
});
