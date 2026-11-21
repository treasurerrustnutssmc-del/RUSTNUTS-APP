import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundsAround, fitCamera, followApps, followRouteOptions, mapsAvailable, wazeAheadUrl, navigateOptions, placeSearchUrl, riderPins, routeAhead } from './rideMap';
import type { LiveRider } from './types';

const NOW = '2026-11-08T01:00:00.000Z';
const rider = (memberId: string, over: Partial<LiveRider> = {}): LiveRider => ({
  memberId,
  name: memberId,
  leader: false,
  position: { lat: -37.8, lng: 144.9 },
  accuracyM: 10,
  updatedAt: '2026-11-08T00:59:00.000Z',
  phone: null,
  ...over,
});

test('maps show on iPhones from iOS 17, never on the web', () => {
  assert.equal(mapsAvailable({ os: 'ios', version: '17.0', androidKey: false }), true);
  assert.equal(mapsAvailable({ os: 'ios', version: '18.2.1', androidKey: false }), true);
  assert.equal(mapsAvailable({ os: 'ios', version: '16.7', androidKey: false }), false);
  assert.equal(mapsAvailable({ os: 'web', version: '', androidKey: true }), false);
});

test('Android shows the map only once the build has a Google Maps key', () => {
  assert.equal(mapsAvailable({ os: 'android', version: 35, androidKey: false }), false);
  assert.equal(mapsAvailable({ os: 'android', version: 35, androidKey: true }), true);
});

test('the camera centres on the bounds and zooms so they fit', () => {
  const b = { minLat: -37.9, minLng: 144.6, maxLat: -37.6, maxLng: 145.0 };
  const cam = fitCamera(b, 390, 260, 24);
  assert.ok(Math.abs(cam.lat - -37.75) < 0.01);
  assert.ok(Math.abs(cam.lng - 144.8) < 1e-9);
  // The 0.3° of latitude in ~212 px is the tighter fit (about zoom 9.6); it rounds down so nothing is cut off.
  assert.ok(cam.zoom >= 9 && cam.zoom < 10, `zoom ${cam.zoom}`);
  // A bigger box zooms in no less.
  assert.ok(fitCamera(b, 780, 520, 24).zoom > cam.zoom);
});

test('a single point gets a street-level zoom, and a world-sized box stays above zoom 2', () => {
  const p = { minLat: -37.8, minLng: 144.9, maxLat: -37.8, maxLng: 144.9 };
  assert.equal(fitCamera(p, 390, 260, 24).zoom, 14);
  assert.equal(fitCamera({ minLat: -80, minLng: -179, maxLat: 80, maxLng: 179 }, 390, 260, 24).zoom, 2);
  // Before the view is measured there is nothing to fit, so it falls back to the point zoom.
  assert.equal(fitCamera({ minLat: -37.9, minLng: 144.6, maxLat: -37.6, maxLng: 145 }, 0, 0, 24).zoom, 14);
});

test('boundsAround takes in the route and every placed point', () => {
  const route = { minLat: -37.9, minLng: 144.6, maxLat: -37.6, maxLng: 145.0 };
  assert.deepEqual(boundsAround(route, [{ lat: -38.1, lng: 145.2 }]), { minLat: -38.1, minLng: 144.6, maxLat: -37.6, maxLng: 145.2 });
  assert.deepEqual(boundsAround(null, [{ lat: -37.8, lng: 144.9 }]), { minLat: -37.8, minLng: 144.9, maxLat: -37.8, maxLng: 144.9 });
  assert.equal(boundsAround(null, []), null);
});

test('Navigate offers Apple Maps on iPhone, then Google Maps and Waze, all to the same spot', () => {
  const to = { lat: -37.81234, lng: 144.96321 };
  const ios = navigateOptions(to, 'ios');
  assert.deepEqual(ios.map((o) => o.app), ['apple', 'google', 'waze']);
  assert.equal(ios[0].url, 'https://maps.apple.com/?daddr=-37.81234,144.96321&dirflg=d');
  assert.equal(ios[1].url, 'https://www.google.com/maps/dir/?api=1&destination=-37.81234,144.96321&travelmode=driving');
  assert.equal(ios[2].url, 'https://waze.com/ul?ll=-37.81234,144.96321&navigate=yes');
  assert.deepEqual(navigateOptions(to, 'android').map((o) => o.app), ['google', 'waze']);
  assert.deepEqual(navigateOptions(to, 'web').map((o) => o.app), ['google', 'waze']);
});

test('a meeting place opens in Apple Maps on an iPhone and Google Maps everywhere else', () => {
  const place = 'Caltex Lara, 1 Station Rd & Co';
  assert.equal(placeSearchUrl(place, 'ios'), 'https://maps.apple.com/?q=Caltex%20Lara%2C%201%20Station%20Rd%20%26%20Co');
  assert.equal(placeSearchUrl(place, 'android'), 'https://www.google.com/maps/search/?api=1&query=Caltex%20Lara%2C%201%20Station%20Rd%20%26%20Co');
  assert.equal(placeSearchUrl(place, 'web'), placeSearchUrl(place, 'android'));
  assert.equal(placeSearchUrl('  Bacchus Marsh  ', 'ios'), 'https://maps.apple.com/?q=Bacchus%20Marsh');
});

test('coordinates in Navigate links are cut to 6 decimal places (about 10 cm)', () => {
  const [g] = navigateOptions({ lat: -37.812345678, lng: 144.9 }, 'android');
  assert.match(g.url, /destination=-37\.812346,144\.9&/);
});

test('rider pins: latest fix only, with who needs help, who split off, leaders, you and stale fixes', () => {
  const riders = [
    rider('me'),
    rider('rc', { leader: true }),
    rider('hurt'),
    rider('behind'),
    rider('old', { updatedAt: '2026-11-08T00:40:00.000Z' }),
    rider('nofix', { position: null, updatedAt: null }),
  ];
  const pins = riderPins(riders, NOW, { meId: 'me', help: new Set(['hurt']), splitOff: new Set(['behind']) });
  assert.deepEqual(
    pins.map((p) => [p.memberId, p.tone]),
    [
      ['me', 'me'],
      ['rc', 'leader'],
      ['hurt', 'help'],
      ['behind', 'split'],
      ['old', 'stale'],
    ],
  );
  assert.deepEqual(pins[0].position, { lat: -37.8, lng: 144.9 });
});

test('needing help wins over being a leader, split off or stale', () => {
  const pins = riderPins([rider('x', { leader: true, updatedAt: '2026-11-08T00:10:00.000Z' })], NOW, {
    meId: 'me',
    help: new Set(['x']),
    splitOff: new Set(['x']),
  });
  assert.equal(pins[0].tone, 'help');
});

// A straight route due north, 21 points about 1.1 km apart (0.01° of latitude each).
const north: [number, number][] = Array.from({ length: 21 }, (_, i) => [-38 + i * 0.01, 145]);

test('the route ahead is the whole route, from its start, when we don\'t know where the rider is or they\'re off it', () => {
  assert.deepEqual(routeAhead(north, null), { line: north, fromStart: true });
  assert.deepEqual(routeAhead(north, { lat: -36, lng: 145 }), { line: north, fromStart: true });
  // ~1.8 km off, at a servo or lunch stop: still on the ride, so carry on from there.
  assert.equal(routeAhead(north, { lat: -37.95, lng: 145.02 }).fromStart, false);
  // ~9 km off: on the way to the ride.
  assert.deepEqual(routeAhead(north, { lat: -37.95, lng: 145.1 }), { line: north, fromStart: true });
});

test('the route ahead starts at the next point past the rider, so Navigate never sends them back', () => {
  const ahead = routeAhead(north, { lat: -37.8999, lng: 145.001 });
  assert.equal(ahead.fromStart, false);
  assert.deepEqual(ahead.line[0], [-37.89, 145]);
  assert.equal(ahead.line.length, 10);
  assert.deepEqual(ahead.line[ahead.line.length - 1], north[20]);
  // Partway along a long straight with no points on it still counts as on the route.
  const sparse: [number, number][] = [[-38, 145], [-37.9, 145], [-37.8, 145]];
  assert.deepEqual(routeAhead(sparse, { lat: -37.95, lng: 145.001 }), { line: [[-37.9, 145], [-37.8, 145]], fromStart: false });
  // Past the end, the end is all that's left.
  assert.deepEqual(routeAhead(north, { lat: -37.8, lng: 145 }).line, [north[20]]);
});

test('on a loop, a rider standing at the start gets the whole way round, not the last metre', () => {
  const loop: [number, number][] = [[-38, 145], [-37.99, 145], [-37.99, 145.01], [-38, 145.01], [-38, 145]];
  assert.deepEqual(routeAhead(loop, { lat: -38, lng: 145 }), { line: loop, fromStart: false });
});

test('Follow the route: Google Maps gets the end plus 9 waypoints spread along the route, from where you are', () => {
  const [g] = followRouteOptions({ line: north, fromStart: false }, 'android', 0);
  assert.equal(g.app, 'google');
  const url = new URL(g.url);
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('origin'), null);
  assert.equal(url.searchParams.get('destination'), '-37.8,145');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
  // Starting to drive at once makes the Google Maps app drop the waypoints and head for the end (Jeff, Big 4, 21 Nov).
  assert.equal(url.searchParams.get('dir_action'), null);
  assert.deepEqual(url.searchParams.get('waypoints')!.split('|'), [
    '-37.98,145', '-37.96,145', '-37.94,145', '-37.92,145', '-37.9,145', '-37.88,145', '-37.86,145', '-37.84,145', '-37.82,145',
  ]);
  assert.match(g.url, /waypoints=[^&]*%7C/);
});

test('Follow the route from its start: the start is the first waypoint, then 8 spread along it', () => {
  const [g] = followRouteOptions({ line: north, fromStart: true }, 'android', 0);
  const wps = new URL(g.url).searchParams.get('waypoints')!.split('|');
  assert.equal(wps.length, 9);
  assert.equal(wps[0], '-38,145');
  assert.equal(new URL(g.url).searchParams.get('destination'), '-37.8,145');
});

test('Follow the route: Apple Maps from iOS 18.4 gets the same waypoints; Waze never, since it can\'t follow one', () => {
  const ahead = { line: north, fromStart: false };
  const ios = followRouteOptions(ahead, 'ios', '18.4');
  assert.deepEqual(ios.map((o) => o.app), ['apple', 'google']);
  const url = new URL(ios[0].url);
  assert.equal(url.origin + url.pathname, 'https://maps.apple.com/directions');
  assert.equal(url.searchParams.get('destination'), '-37.8,145');
  assert.equal(url.searchParams.get('mode'), 'driving');
  assert.equal(url.searchParams.getAll('waypoint').length, 9);
  assert.equal(url.searchParams.getAll('waypoint')[0], '-37.98,145');
  assert.deepEqual(followRouteOptions(ahead, 'ios', '18.3.2').map((o) => o.app), ['google']);
  assert.deepEqual(followRouteOptions(ahead, 'ios', '17.5').map((o) => o.app), ['google']);
  assert.deepEqual(followRouteOptions(ahead, 'ios', '26.1').map((o) => o.app), ['apple', 'google']);
  assert.deepEqual(followRouteOptions(ahead, 'web', '').map((o) => o.app), ['google']);
});

test('Follow the route: a short route sends what it has, and an empty one sends nothing', () => {
  const [g] = followRouteOptions({ line: [[-38, 145], [-37.99, 145]], fromStart: true }, 'android', 0);
  const url = new URL(g.url);
  assert.equal(url.searchParams.get('destination'), '-37.99,145');
  assert.deepEqual(url.searchParams.get('waypoints')!.split('|'), ['-38,145']);
  assert.equal(new URL(followRouteOptions({ line: [[-38, 145]], fromStart: false }, 'android', 0)[0].url).searchParams.get('waypoints'), null);
  assert.deepEqual(followRouteOptions({ line: [], fromStart: true }, 'android', 0), []);
});

test('near the start of a loop, the closing stretch never wins, even when it is the nearer one', () => {
  const loop: [number, number][] = [[-38, 145], [-37.9, 145], [-37.9, 145.1], [-38, 145.1], [-38, 145]];
  // About 170 m from the start, at the meeting café, a little nearer the last stretch.
  assert.deepEqual(routeAhead(loop, { lat: -38.0008, lng: 145.0015 }), { line: loop, fromStart: false });
});

test('on an out-and-back, the way the rider is heading picks the leg they are on', () => {
  const outBack: [number, number][] = [[-38, 145], [-37.95, 145], [-37.9, 145], [-37.95, 145.0001], [-38, 145.0001]];
  const at = { lat: -37.96, lng: 145 };
  assert.deepEqual(routeAhead(outBack, { ...at, heading: 0 }).line, outBack.slice(1)); // heading north: outbound
  assert.deepEqual(routeAhead(outBack, { ...at, heading: 180 }).line, outBack.slice(4)); // heading south: on the way back
});

test('Follow the route never sends a waypoint that is the destination or a repeat', () => {
  const [g] = followRouteOptions({ line: [[-38, 145], [-38, 145], [-38, 145]], fromStart: false }, 'android', 0);
  assert.equal(new URL(g.url).searchParams.get('waypoints'), null);
  const [h] = followRouteOptions({ line: [[-38, 145], [-37.99, 145], [-38, 145], [-37.99, 145], [-38, 145]], fromStart: false }, 'android', 0);
  const wps = new URL(h.url).searchParams.get('waypoints')!.split('|');
  assert.equal(new Set(wps).size, wps.length);
  assert.ok(!wps.includes('-38,145'));
});

test('followApps lists the apps that can follow a route without working the route out', () => {
  assert.deepEqual(followApps('ios', '18.4'), ['apple', 'google']);
  assert.deepEqual(followApps('ios', '17.2'), ['google']);
  assert.deepEqual(followApps('android', 35), ['google']);
});

test('Waze can only take one spot, so it gets the point about 30 km further along the route', () => {
  // 41 points ~1.1 km apart: 30 km on is the 27th point after where the rider is.
  const long: [number, number][] = Array.from({ length: 41 }, (_, i) => [-38 + i * 0.01, 145]);
  const url = new URL(wazeAheadUrl({ line: long, fromStart: false })!);
  assert.equal(url.origin + url.pathname, 'https://waze.com/ul');
  assert.equal(url.searchParams.get('ll'), '-37.73,145');
  assert.equal(url.searchParams.get('navigate'), 'yes');
  // Less than 30 km left: the end.
  assert.equal(new URL(wazeAheadUrl({ line: north, fromStart: false })!).searchParams.get('ll'), '-37.8,145');
  // On the way to the ride: the start.
  assert.equal(new URL(wazeAheadUrl({ line: north, fromStart: true })!).searchParams.get('ll'), '-38,145');
  assert.equal(wazeAheadUrl({ line: [], fromStart: true }), null);
});
