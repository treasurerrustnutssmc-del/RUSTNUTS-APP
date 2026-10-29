import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GARMIN_MAX_POINTS, garminFileName, garminGpx } from './garmin';
import { NO_TRACK, NOT_GPX, readGpx } from './gpx';
import type { GpxSummary } from './gpx';

function gpx(body: string, attrs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test"${attrs}>${body}</gpx>`;
}

const pt = (lat: number, lon: number, ele?: number, tag = 'trkpt') =>
  `<${tag} lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</${tag}>`;

function made(result: { gpx: string } | string): string {
  assert.equal(typeof result, 'object', `expected a GPX file, got: ${String(result)}`);
  return (result as { gpx: string }).gpx;
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

test('garminGpx: a plain GPX 1.1 file with the app’s name on the track', () => {
  const out = made(garminGpx(gpx(`<trk><name>Old name</name><trkseg>${pt(-37.1, 144.1, 200)}${pt(-37.2, 144.2, 210)}</trkseg></trk>`), 'Black Spur loop'));
  assert.match(out, /<gpx version="1\.1" creator="Rustnuts SMC" xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1">/);
  assert.match(out, /<metadata><name>Black Spur loop<\/name><\/metadata>/);
  assert.match(out, /<trk><name>Black Spur loop<\/name><trkseg>/);
  assert.ok(!out.includes('Old name'));
  assert.match(out, /<trkpt lat="-37\.100000" lon="144\.100000"><ele>200\.0<\/ele><\/trkpt>/);
});

test('garminGpx: reads back as the same route, stops and all', () => {
  const input = gpx(
    `<wpt lat="-37.3" lon="144.3"><name>Pub</name></wpt><trk><trkseg>${pt(-37.1, 144.1, 200)}${pt(-37.2, 144.25, 260)}${pt(-37.35, 144.3, 240)}</trkseg></trk>`,
  );
  const before = readGpx(input) as GpxSummary;
  const after = readGpx(made(garminGpx(input, 'Loop'))) as GpxSummary;
  assert.equal(typeof after, 'object');
  assert.equal(after.name, 'Loop');
  assert.equal(after.distanceM, before.distanceM);
  assert.equal(after.climbM, before.climbM);
  assert.deepEqual(after.line, before.line);
  assert.deepEqual(after.stops, before.stops);
});

test('garminGpx: leaves out characters XML refuses in the name', () => {
  const out = made(garminGpx(gpx(`<trk><trkseg>${pt(1, 1)}${pt(2, 2)}</trkseg></trk>`), 'a\u0001b\uD800c'));
  assert.ok(out.includes('<name>abc</name>'));
  assert.equal(typeof readGpx(out), 'object');
});

test('garminGpx: a 5 MB track comes down to the Garmin limit quickly', () => {
  const points: string[] = [];
  for (let k = 0; k < 70_000; k++) points.push(pt(-37 + k * 0.00001, 144 + Math.sin(k / 50) * 0.01, k % 500));
  const start = Date.now();
  const out = made(garminGpx(gpx(`<trk><trkseg>${points.join('')}</trkseg></trk>`), 'Big'));
  assert.equal(count(out, '<trkpt '), GARMIN_MAX_POINTS);
  assert.ok(Date.now() - start < 1500, `took ${Date.now() - start} ms`);
});

test('garminGpx: escapes the name', () => {
  const out = made(garminGpx(gpx(`<trk><trkseg>${pt(1, 1)}${pt(2, 2)}</trkseg></trk>`), 'Fish & chips <run> "Q"'));
  assert.ok(out.includes('<name>Fish &amp; chips &lt;run&gt; &quot;Q&quot;</name>'));
});

test('garminGpx: drops other apps’ extensions and route points when there is a track', () => {
  const input = gpx(
    `<rte><rtept lat="5" lon="5"/><rtept lat="6" lon="6"/></rte><trk><extensions><osmand:color>#f00</osmand:color></extensions><trkseg>${pt(1, 1)}${pt(2, 2)}</trkseg></trk>`,
    ' xmlns:osmand="https://osmand.net"',
  );
  const out = made(garminGpx(input, 'R'));
  assert.ok(!out.includes('osmand'));
  assert.ok(!out.includes('<rte'));
  assert.equal(count(out, '<trkpt '), 2);
});

test('garminGpx: uses route points as a track when the file has no track', () => {
  const out = made(garminGpx(gpx(`<rte>${pt(1, 1, undefined, 'rtept')}${pt(2, 2, 5, 'rtept')}${pt(3, 3, undefined, 'rtept')}</rte>`), 'R'));
  assert.equal(count(out, '<trkpt '), 3);
  assert.match(out, /<trkpt lat="1\.000000" lon="1\.000000"\/>/);
  assert.match(out, /<trkpt lat="2\.000000" lon="2\.000000"><ele>5\.0<\/ele><\/trkpt>/);
});

test('garminGpx: joins all track segments into one', () => {
  const out = made(garminGpx(gpx(`<trk><trkseg>${pt(1, 1)}${pt(2, 2)}</trkseg><trkseg>${pt(3, 3)}</trkseg></trk>`), 'R'));
  assert.equal(count(out, '<trkseg>'), 1);
  assert.equal(count(out, '<trkpt '), 3);
});

test('garminGpx: keeps stops as waypoints, named and escaped', () => {
  const out = made(
    garminGpx(gpx(`<wpt lat="-37.5" lon="145.5"><name>Fuel &amp; pies</name></wpt><wpt lat="-37.6" lon="145.6"/><trk><trkseg>${pt(1, 1)}${pt(2, 2)}</trkseg></trk>`), 'R'),
  );
  assert.ok(out.includes('<wpt lat="-37.500000" lon="145.500000"><name>Fuel &amp; pies</name></wpt>'));
  assert.ok(out.includes('<wpt lat="-37.600000" lon="145.600000"><name>Stop 2</name></wpt>'));
  // Waypoints come before the track, as GPX 1.1 orders them.
  assert.ok(out.indexOf('<wpt') < out.indexOf('<trk>'));
});

test('garminGpx: cuts a long track to the Garmin limit, keeping the ends and bends', () => {
  const n = GARMIN_MAX_POINTS * 2 + 7;
  const points: string[] = [];
  for (let k = 0; k < n; k++) points.push(pt(-37 + k * 0.00001, 144 + Math.sin(k / 50) * 0.01, k % 3 === 0 ? 100 + k / 10 : undefined));
  const out = made(garminGpx(gpx(`<trk><trkseg>${points.join('')}</trkseg></trk>`), 'Long'));
  assert.equal(count(out, '<trkpt '), GARMIN_MAX_POINTS);
  assert.ok(out.includes('<trkpt lat="-37.000000" lon="144.000000"><ele>100.0</ele></trkpt>'));
  const lastLat = (-37 + (n - 1) * 0.00001).toFixed(6);
  assert.ok(out.includes(`lat="${lastLat}"`));
});

test('garminGpx: a short track is left as it is', () => {
  const out = made(garminGpx(gpx(`<trk><trkseg>${pt(1, 1)}${pt(1.5, 1.5)}${pt(2, 2)}</trkseg></trk>`), 'R'));
  assert.equal(count(out, '<trkpt '), 3);
});

test('garminGpx: returns readGpx’s message for a file it can’t use', () => {
  assert.equal(garminGpx('not xml', 'R'), NOT_GPX);
  assert.equal(garminGpx(gpx(`<trk><trkseg>${pt(1, 1)}</trkseg></trk>`), 'R'), NO_TRACK);
});

test('garminFileName: ASCII only, accents folded, a fallback and a cap', () => {
  assert.equal(garminFileName('Black Spur loop'), 'Black Spur loop.gpx');
  assert.equal(garminFileName('Café run: Ōmeo/Dargo'), 'Cafe run Omeo Dargo.gpx');
  assert.equal(garminFileName('  🏍️ 🔥 '), 'Rustnuts route.gpx');
  assert.equal(garminFileName('a'.repeat(60)), `${'a'.repeat(40)}.gpx`);
  assert.equal(garminFileName('Two   spaces'), 'Two spaces.gpx');
});
