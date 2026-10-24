import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectLine } from './routeShape';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('the line fits the box inside the padding, centred', () => {
  // A square of degrees at the equator: as wide as it is tall (to a hair: cos 0.5° is 0.99996).
  const line: [number, number][] = [[0, 0], [1, 1]];
  const bounds = { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 };
  const pts = projectLine(line, bounds, 200, 100, 10);
  // Height limits: 80 px for 1 degree, so the line is 80 wide, centred in 200.
  assert.ok(near(pts[0][0], 60, 0.01) && near(pts[0][1], 90), `start ${pts[0]}`);
  assert.ok(near(pts[1][0], 140, 0.01) && near(pts[1][1], 10), `finish ${pts[1]}`);
});

test('north is up and east is right', () => {
  const pts = projectLine([[-37.8, 144.9], [-37.7, 145.0]], { minLat: -37.8, minLng: 144.9, maxLat: -37.7, maxLng: 145.0 }, 100, 100, 0);
  assert.ok(pts[1][0] > pts[0][0], 'east is to the right');
  assert.ok(pts[1][1] < pts[0][1], 'north is higher up the screen');
});

test('longitude is narrowed by the cosine of the middle latitude', () => {
  // At 60 degrees, one degree of longitude is half as wide as one of latitude.
  const bounds = { minLat: 59.5, minLng: 0, maxLat: 60.5, maxLng: 1 };
  const pts = projectLine([[59.5, 0], [60.5, 1]], bounds, 1000, 100, 0);
  const width = pts[1][0] - pts[0][0];
  const height = pts[0][1] - pts[1][1];
  assert.ok(near(height, 100), `height ${height}`);
  assert.ok(Math.abs(width - 100 * Math.cos((60 * Math.PI) / 180)) < 0.01, `width ${width}`);
});

test('a line with no width or height sits in the middle', () => {
  const pts = projectLine([[-37.8, 144.9], [-37.8, 144.9]], { minLat: -37.8, minLng: 144.9, maxLat: -37.8, maxLng: 144.9 }, 100, 60, 8);
  assert.deepEqual(pts.map((p) => p.map((v) => Math.round(v))), [[50, 30], [50, 30]]);
  const flat = projectLine([[-37.8, 144.9], [-37.8, 145.1]], { minLat: -37.8, minLng: 144.9, maxLat: -37.8, maxLng: 145.1 }, 100, 60, 10);
  assert.ok(near(flat[0][0], 10) && near(flat[1][0], 90) && near(flat[0][1], 30), 'an east-west line spans the width, centred top to bottom');
});

test('an empty line gives no points', () => {
  assert.deepEqual(projectLine([], { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 }, 100, 100, 0), []);
});
