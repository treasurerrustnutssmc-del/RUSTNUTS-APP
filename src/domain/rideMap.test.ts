import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundsAround, fitCamera, mapsAvailable, navigateOptions, riderPins } from './rideMap';
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
