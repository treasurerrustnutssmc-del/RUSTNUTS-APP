import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineM, readGpx, simplify } from './gpx';
import type { GpxSummary } from './gpx';

const NOT_GPX = 'That isn’t a GPX file.';
const NO_TRACK = 'That route has no track in it.';
const TOO_BIG = 'That file is too big (5 MB at most).';

type Pt = [number, number, number?];

const trkpt = ([lat, lon, ele]: Pt, tag = 'trkpt') =>
  `<${tag} lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</${tag}>`;

function gpx(body: string, attrs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test"${attrs}>${body}</gpx>`;
}

function track(...segments: Pt[][]): string {
  return `<trk><name>Test</name>${segments.map((s) => `<trkseg>${s.map((p) => trkpt(p)).join('')}</trkseg>`).join('')}</trk>`;
}

function summary(result: GpxSummary | string): GpxSummary {
  assert.equal(typeof result, 'object', `expected a summary, got: ${String(result)}`);
  return result as GpxSummary;
}

// One degree of latitude (or of longitude on the equator) at the module's Earth radius.
const DEGREE_M = (6371008.8 * Math.PI) / 180;

test('haversineM: a degree of latitude, a degree on the equator, and no distance', () => {
  assert.ok(Math.abs(haversineM([0, 0], [1, 0]) - DEGREE_M) < 0.01);
  assert.ok(Math.abs(haversineM([0, 10], [0, 11]) - DEGREE_M) < 0.01);
  assert.equal(haversineM([-37.8, 144.9], [-37.8, 144.9]), 0);
});

test('readGpx: a 3-segment track sums distance across segments, within 0.5% of the hand-computed course', () => {
  // Three legs due north: 0.1, 0.1 and 0.2 degrees of latitude, one per segment (0.4 degrees in all).
  const text = gpx(
    track(
      [[-37.0, 144.0], [-37.1, 144.0]],
      [[-37.1, 144.0], [-37.2, 144.0]],
      [[-37.2, 144.0], [-37.4, 144.0]],
    ),
  );
  const s = summary(readGpx(text));
  const expected = 0.4 * DEGREE_M;
  assert.ok(Math.abs(s.distanceM - expected) / expected < 0.005, `${s.distanceM} vs ${expected}`);
  assert.equal(s.distanceM, Math.round(s.distanceM));
  assert.deepEqual(s.line, [[-37.0, 144.0], [-37.1, 144.0], [-37.1, 144.0], [-37.2, 144.0], [-37.2, 144.0], [-37.4, 144.0]]);
  assert.deepEqual(s.bounds, { minLat: -37.4, minLng: 144.0, maxLat: -37.0, maxLng: 144.0 });
  assert.deepEqual(s.stops, []);
});

test('readGpx: a route-only file reads its route points', () => {
  const text = gpx(`<rte><name>R</name>${trkpt([-37.8, 144.9], 'rtept')}${trkpt([-37.7, 145.0], 'rtept')}</rte>`);
  const s = summary(readGpx(text));
  assert.deepEqual(s.line, [[-37.8, 144.9], [-37.7, 145.0]]);
  assert.ok(s.distanceM > 10000 && s.distanceM < 20000);
});

test('readGpx: track points win over route points when a file has both', () => {
  const text = gpx(
    `<rte>${trkpt([10, 10], 'rtept')}${trkpt([11, 11], 'rtept')}${trkpt([12, 12], 'rtept')}</rte>` +
      track([[-37.0, 144.0], [-37.1, 144.0]]),
  );
  const s = summary(readGpx(text));
  assert.deepEqual(s.line, [[-37.0, 144.0], [-37.1, 144.0]]);
});

test('readGpx: waypoints become stops; unnamed ones are numbered by their position among all waypoints', () => {
  const text = gpx(
    `<wpt lat="-37.81" lon="144.96"><name>Fuel &amp; coffee</name></wpt>` +
      `<wpt lat="-37.82" lon="144.97"></wpt>` +
      `<wpt lat="-37.83" lon="144.98"/>` +
      `<wpt lat="-37.84" lon="144.99"><name><![CDATA[Pie <stop>]]></name></wpt>` +
      track([[-37.0, 144.0], [-37.1, 144.0]]),
  );
  const s = summary(readGpx(text));
  assert.deepEqual(s.stops, [
    { name: 'Fuel & coffee', lat: -37.81, lng: 144.96 },
    { name: 'Stop 2', lat: -37.82, lng: 144.97 },
    { name: 'Stop 3', lat: -37.83, lng: 144.98 },
    { name: 'Pie <stop>', lat: -37.84, lng: 144.99 },
  ]);
});

test('readGpx: waypoints alone do not make a route', () => {
  const text = gpx(`<wpt lat="-37.81" lon="144.96"><name>A</name></wpt><wpt lat="-37.82" lon="144.97"><name>B</name></wpt>`);
  assert.equal(readGpx(text), NO_TRACK);
});

test('readGpx: no elevation means climb is null', () => {
  const s = summary(readGpx(gpx(track([[-37.0, 144.0], [-37.1, 144.0]]))));
  assert.equal(s.climbM, null);
});

test('readGpx: climb sums only the rises, rounded', () => {
  // 100 -> 130 (+30), -> 110 (down), -> 125.4 (+15.4), -> 90 (down): 45.4 up.
  const pts: Pt[] = [[-37.0, 144.0, 100], [-37.01, 144.0, 130], [-37.02, 144.0, 110], [-37.03, 144.0, 125.4], [-37.04, 144.0, 90]];
  const s = summary(readGpx(gpx(`<trk><trkseg>${pts.map((p) => trkpt(p)).join('')}</trkseg></trk>`)));
  assert.equal(s.climbM, 45);
});

test('readGpx: points without elevation are skipped when at least two have it; fewer than two gives null', () => {
  const some = `<trk><trkseg>${trkpt([-37.0, 144.0, 10])}${trkpt([-37.01, 144.0])}${trkpt([-37.02, 144.0, 30])}</trkseg></trk>`;
  assert.equal(summary(readGpx(gpx(some))).climbM, 20);
  const one = `<trk><trkseg>${trkpt([-37.0, 144.0, 10])}${trkpt([-37.01, 144.0])}${trkpt([-37.02, 144.0])}</trkseg></trk>`;
  assert.equal(summary(readGpx(gpx(one))).climbM, null);
});

test('readGpx: a gpx:-prefixed file and single-quoted attributes', () => {
  const text =
    `<?xml version='1.0'?><gpx:gpx xmlns:gpx='http://www.topografix.com/GPX/1/1' version='1.1' creator='x'>` +
    `<gpx:wpt lat='-37.5' lon='144.5'><gpx:name>Lookout</gpx:name></gpx:wpt>` +
    `<gpx:trk><gpx:trkseg>` +
    `<gpx:trkpt lat='-37.0' lon='144.0'><gpx:ele>5</gpx:ele></gpx:trkpt>` +
    `<gpx:trkpt lon='144.0' lat='-37.1'><gpx:ele>25</gpx:ele></gpx:trkpt>` +
    `</gpx:trkseg></gpx:trk></gpx:gpx>`;
  const s = summary(readGpx(text));
  assert.deepEqual(s.line, [[-37.0, 144.0], [-37.1, 144.0]]);
  assert.equal(s.climbM, 20);
  assert.deepEqual(s.stops, [{ name: 'Lookout', lat: -37.5, lng: 144.5 }]);
});

test('readGpx: comments, a BOM, extensions and a ">" inside an attribute do not confuse the scanner', () => {
  const text =
    '﻿' +
    gpx(
      `<!-- <trkpt lat="1" lon="1"> -->` +
        `<metadata><desc>Hello > there</desc></metadata>` +
        `<trk><extensions x="a>b"><foo/></extensions><trkseg>` +
        `<trkpt lat="-37.0" lon="144.0"><time>2026-10-24T00:00:00Z</time></trkpt>` +
        `<trkpt lat="-37.1" lon="144.0"/>` +
        `</trkseg></trk>`,
    );
  const s = summary(readGpx(text));
  assert.deepEqual(s.line, [[-37.0, 144.0], [-37.1, 144.0]]);
});

test('readGpx: malformed files are not GPX files', () => {
  const good = track([[-37.0, 144.0], [-37.1, 144.0]]);
  assert.equal(readGpx(''), NOT_GPX);
  assert.equal(readGpx('hello'), NOT_GPX);
  assert.equal(readGpx('<html><body>hi</body></html>'), NOT_GPX);
  assert.equal(readGpx('<kml><Placemark/></kml>'), NOT_GPX);
  assert.equal(readGpx(gpx(good).replace('</gpx>', '')), NOT_GPX); // root never closed
  assert.equal(readGpx(gpx(good).replace('</trkseg>', '')), NOT_GPX); // unbalanced
  assert.equal(readGpx(gpx(good).replace('</trkseg>', '</trk>')), NOT_GPX); // crossed tags
  assert.equal(readGpx(gpx(good).slice(0, -3)), NOT_GPX); // cut off inside the last tag
  assert.equal(readGpx(gpx(good) + '<gpx></gpx>'), NOT_GPX); // two roots
  assert.equal(readGpx(gpx(`<!-- never closed ${good}`)), NOT_GPX);
  assert.equal(readGpx(gpx(`<trk><trkseg><trkpt lat="x" lon="144"/><trkpt lat="1" lon="2"/></trkseg></trk>`)), NOT_GPX);
  assert.equal(readGpx(gpx(`<trk><trkseg><trkpt lat="95" lon="144"/><trkpt lat="1" lon="2"/></trkseg></trk>`)), NOT_GPX);
  assert.equal(readGpx(gpx(`<trk><trkseg><trkpt lat="1"/><trkpt lat="1" lon="2"/></trkseg></trk>`)), NOT_GPX);
});

test('readGpx: an empty or one-point track has no track in it', () => {
  assert.equal(readGpx(gpx('<trk></trk>')), NO_TRACK);
  assert.equal(readGpx(gpx('<trk><trkseg></trkseg></trk>')), NO_TRACK);
  assert.equal(readGpx(gpx('')), NO_TRACK);
  assert.equal(readGpx('<gpx/>'), NO_TRACK);
  assert.equal(readGpx(gpx(track([[-37.0, 144.0]]))), NO_TRACK);
});

test('readGpx: more than 5 MB is refused first, counted in UTF-8 bytes', () => {
  const limit = 5 * 1024 * 1024;
  assert.equal(readGpx('x'.repeat(limit + 1)), TOO_BIG);
  // 2-byte characters: under the limit in characters, over it in bytes.
  assert.equal(readGpx('é'.repeat(limit / 2 + 1)), TOO_BIG);
  // Exactly at the limit is allowed through to the reader (and fails there for not being GPX).
  assert.equal(readGpx('x'.repeat(limit)), NOT_GPX);
  assert.equal(readGpx('é'.repeat(limit / 2)), NOT_GPX);
});

test('readGpx: a large real-sized file reads quickly', () => {
  const pts: string[] = [];
  for (let i = 0; i < 40000; i++) pts.push(trkpt([-37 - i * 0.00001, 144 + Math.sin(i / 500) * 0.01, 50 + (i % 40)]));
  const text = gpx(`<trk><trkseg>${pts.join('')}</trkseg></trk>`);
  const t0 = Date.now();
  const s = summary(readGpx(text));
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  assert.ok(s.line.length <= 300);
  assert.deepEqual(s.line[0], [-37, 144]);
  assert.ok(s.climbM !== null && s.climbM > 0);
});

test('readGpx: hostile input stays linear (many unclosed tags, long runs of "<")', () => {
  const t0 = Date.now();
  assert.equal(readGpx('<gpx>' + '<a>'.repeat(100000)), NOT_GPX);
  assert.equal(readGpx('<'.repeat(200000)), NOT_GPX);
  assert.equal(readGpx('<gpx ' + 'a="'.repeat(100000)), NOT_GPX);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test('simplify: 100k points come down to at most 300 in under 500 ms, keeping both ends', () => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 100000; i++) pts.push([-37 + Math.sin(i / 1000) * 0.2 + (i % 7) * 1e-5, 144 + i * 1e-5]);
  const t0 = Date.now();
  const out = simplify(pts);
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `took ${ms} ms`);
  assert.ok(out.length <= 300 && out.length > 2);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
});

test('simplify: short lines are returned whole, corners are kept, a smaller max is honoured', () => {
  const few: [number, number][] = [[0, 0], [1, 1], [2, 0]];
  assert.deepEqual(simplify(few), few);
  // An L shape with many collinear points on each arm keeps the corner and both ends.
  const l: [number, number][] = [];
  for (let i = 0; i <= 50; i++) l.push([0, i / 50]);
  for (let i = 1; i <= 50; i++) l.push([i / 50, 1]);
  const out = simplify(l, 5);
  assert.ok(out.length <= 5);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out[out.length - 1], [1, 1]);
  assert.ok(out.some((p) => p[0] === 0 && p[1] === 1), 'the corner survives');
  assert.deepEqual(simplify([], 5), []);
  assert.deepEqual(simplify([[1, 2]], 5), [[1, 2]]);
});
