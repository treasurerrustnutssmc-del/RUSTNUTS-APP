import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineM, MAX_BYTES, NO_TRACK, NOT_GPX, readGpx, simplify, TOO_BIG, UNREADABLE } from './gpx';
import type { GpxSummary } from './gpx';

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

test('readGpx: a 100k-point file reads quickly', () => {
  // Five decimal places, and a height on every fourth point, so 100k points fit under 5 MB.
  const pts: string[] = [];
  for (let i = 0; i < 100000; i++) {
    const lat = (-37 - i * 0.00001).toFixed(5);
    const lon = (144 + Math.sin(i / 500) * 0.01).toFixed(5);
    pts.push(i % 4 === 0 ? `<trkpt lat="${lat}" lon="${lon}"><ele>${50 + (i % 40)}</ele></trkpt>` : `<trkpt lat="${lat}" lon="${lon}"/>`);
  }
  const text = gpx(`<trk><trkseg>${pts.join('')}</trkseg></trk>`);
  assert.ok(text.length <= MAX_BYTES, `the test file is ${text.length} bytes`);
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

test('readGpx: the well-formedness checks stay linear too (huge tags, references, dashes)', () => {
  const t0 = Date.now();
  let attrs = '';
  for (let k = 0; k < 200000; k++) attrs += ` a${k}="&amp;"`;
  assert.equal(typeof readGpx(`<gpx${attrs}>${track([[-37, 144], [-37.1, 144]])}</gpx>`), 'object', '200k different attributes');
  assert.equal(readGpx(`<gpx${attrs} a5="x"></gpx>`), NOT_GPX, 'the repeat comes last');
  assert.equal(readGpx(`<gpx><desc>${'&#x41;'.repeat(400000)}</desc></gpx>`), NO_TRACK, '400k references');
  assert.equal(readGpx(`<gpx><desc>${'&#x00000000000041'.repeat(200000)}</desc></gpx>`), NOT_GPX, 'unterminated references');
  assert.equal(readGpx(`<gpx><!-- ${'-'.repeat(1000000)}`), NOT_GPX, 'a comment of dashes');
  assert.equal(readGpx(`<gpx><desc>${']]'.repeat(1000000)}</desc></gpx>`), NO_TRACK, 'runs of ]');
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
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

test('the three GPX messages are exported with the spec’s words', () => {
  assert.equal(NOT_GPX, 'That isn’t a GPX file.');
  assert.equal(NO_TRACK, 'That route has no track in it.');
  assert.equal(TOO_BIG, 'That file is too big (5 MB at most).');
});

test('readGpx: at most 100 stops, the first ones in the file, numbered by their place', () => {
  let wpts = '';
  for (let k = 0; k < 150; k++) wpts += k % 2 ? `<wpt lat="-37.${k}" lon="144.5"/>` : `<wpt lat="-37.${k}" lon="144.5"><name>W${k}</name></wpt>`;
  const s = summary(readGpx(gpx(wpts + track([[-37.8, 144.9], [-37.9, 145.0]]))));
  assert.equal(s.stops.length, 100);
  assert.equal(s.stops[0].name, 'W0');
  assert.equal(s.stops[1].name, 'Stop 2');
  assert.equal(s.stops[99].name, 'Stop 100');
  const hundred = summary(readGpx(gpx(wpts.split('<wpt').slice(0, 101).join('<wpt') + track([[-37.8, 144.9], [-37.9, 145.0]]))));
  assert.equal(hundred.stops.length, 100, 'exactly 100 are all kept');
});

test('readGpx: the gap between two track segments counts towards the distance', () => {
  // Segment one ends at -37.1, segment two starts at -37.2: the 0.1 degree hop between them is ridden too.
  const text = gpx(track([[-37.0, 144.0], [-37.1, 144.0]], [[-37.2, 144.0], [-37.3, 144.0]]));
  const s = summary(readGpx(text));
  const expected = 0.3 * DEGREE_M;
  assert.ok(Math.abs(s.distanceM - expected) / expected < 0.005, `${s.distanceM} vs ${expected}`);
});

test('readGpx: a gpx:-prefixed, route-only file with heights in CDATA', () => {
  const text =
    `<?xml version="1.0"?><gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1" version="1.1">` +
    `<gpx:rte><gpx:name>Odd one</gpx:name>` +
    `<gpx:rtept lat="-37.0" lon="144.0"><gpx:ele><![CDATA[100]]></gpx:ele></gpx:rtept>` +
    `<gpx:rtept lat="-37.1" lon="144.0"><gpx:ele><![CDATA[ 140 ]]></gpx:ele></gpx:rtept>` +
    `<gpx:rtept lat="-37.2" lon="144.0"><gpx:ele><![CDATA[120]]></gpx:ele></gpx:rtept>` +
    `</gpx:rte></gpx:gpx>`;
  const s = summary(readGpx(text));
  assert.deepEqual(s.line, [[-37.0, 144.0], [-37.1, 144.0], [-37.2, 144.0]]);
  assert.equal(s.climbM, 40);
});

test('readGpx: coordinates must be plain decimals', () => {
  const two = (a: string, b = 'lon="144"') => gpx(`<trk><trkseg><trkpt lat="${a}" ${b}/><trkpt lat="-37.1" lon="144"/></trkseg></trk>`);
  for (const bad of ['0x10', '1e0', '-3.7e1', 'Infinity', '+', '.', '1.2.3', '--1', '']) {
    assert.equal(readGpx(two(bad)), NOT_GPX, `lat="${bad}"`);
  }
  assert.equal(readGpx(two('-37', 'lon="0x90"')), NOT_GPX, 'hex longitude');
  assert.equal(readGpx(two('-37', 'lon="1.44e2"')), NOT_GPX, 'exponent longitude');
  for (const good of ['-37', '-37.', '-37.0', '+37.5', '.5', '-.5', ' -37.0 ']) {
    assert.equal(typeof readGpx(two(good)), 'object', `lat="${good}"`);
  }
});

test('readGpx: a height that isn’t a plain decimal is left out, like a missing one', () => {
  const pts = (eles: string[]) =>
    gpx(`<trk><trkseg>${eles.map((e, i) => `<trkpt lat="${-37 - i * 0.01}" lon="144"><ele>${e}</ele></trkpt>`).join('')}</trkseg></trk>`);
  assert.equal(summary(readGpx(pts(['10', '1e3', '30']))).climbM, 20, 'the 1e3 is skipped');
  assert.equal(summary(readGpx(pts(['10', '0x20', '15.5']))).climbM, 6, 'the 0x20 is skipped');
  assert.equal(summary(readGpx(pts(['1e1', '0x20', 'high']))).climbM, null, 'no usable heights');
});

test('the file limits and messages shared with the pickers', () => {
  assert.equal(MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(TOO_BIG, 'That file is too big (5 MB at most).');
  assert.equal(UNREADABLE, 'That file couldn’t be read. Try picking it again.');
});

// ---- What Postgres (libxml2) refuses, the reader refuses too ----
// Every case below was checked with xml_is_well_formed_document on the test database.

const goodTrack = track([[-37.0, 144.0], [-37.1, 144.0]]);

test('readGpx: nothing may come before the XML declaration but one byte order mark', () => {
  const doc = gpx(goodTrack);
  assert.equal(typeof readGpx('﻿' + doc), 'object', 'one BOM is fine');
  assert.equal(readGpx(' ' + doc), NOT_GPX, 'a space');
  assert.equal(readGpx('\n' + doc), NOT_GPX, 'a newline');
  assert.equal(readGpx('\r\n' + doc), NOT_GPX, 'a Windows newline');
  assert.equal(readGpx('x' + doc), NOT_GPX, 'a letter');
  assert.equal(readGpx('﻿﻿' + doc), NOT_GPX, 'two BOMs');
  assert.equal(readGpx('﻿ ' + doc), NOT_GPX, 'a BOM then a space');
  assert.equal(readGpx('<!-- hi -->' + doc), NOT_GPX, 'a comment');
  assert.equal(readGpx(doc.replace('<gpx ', '<?xml version="1.0"?><gpx ')), NOT_GPX, 'a second declaration');
  assert.equal(readGpx(doc.replace('<gpx ', '<?XML x?><gpx ')), NOT_GPX, 'xml is a reserved PI name in any case');
  assert.equal(readGpx(gpx(`<?xml x?>${goodTrack}`)), NOT_GPX, 'a declaration inside the root');
  // Without a declaration, white space before the root is allowed.
  assert.equal(typeof readGpx(`  \n<gpx>${goodTrack}</gpx>`), 'object', 'white space, no declaration');
  assert.equal(typeof readGpx(doc.replace('<gpx ', '<?xml-stylesheet href="a.xsl"?>\n<gpx ')), 'object', 'other PIs are fine');
});

test('readGpx: an & must start one of the five entities or a character reference, in text and attributes', () => {
  const wpt = (name: string) => gpx(`<wpt lat="-37.81" lon="144.96"><name>${name}</name></wpt>${goodTrack}`);
  for (const bad of ['Fish & chips', 'Fish &chips', 'A&nbsp;B', '&amp', '&AMP;', '&#;', '&#x;', '&#X41;', '&#0;', '&#x1F;', '&#xD800;', '&#xFFFE;', '&#x110000;', '&#99999999999;']) {
    assert.equal(readGpx(wpt(bad)), NOT_GPX, `text ${bad}`);
  }
  assert.equal(readGpx(gpx(`<metadata><desc>Fish & chips</desc></metadata>${goodTrack}`)), NOT_GPX, 'in text the reader does not keep');
  assert.equal(readGpx(gpx(goodTrack, ' creator2="Fish & chips"')), NOT_GPX, 'in an attribute');
  assert.equal(readGpx(gpx(goodTrack, ' creator2="A&nbsp;B"')), NOT_GPX, '&nbsp; in an attribute');
  const s = summary(readGpx(wpt('&amp;&lt;&gt;&quot;&apos; &#65;&#x41;&#x1F600;&#x0000042;&#9;!')));
  assert.equal(s.stops[0].name, '&<>"\' AA😀B\t!');
  assert.equal(typeof readGpx(gpx(goodTrack, ' creator2="&amp;&lt;&#65;&#x41;"')), 'object', 'good references in an attribute');
  assert.equal(typeof readGpx(gpx(`<!-- Fish & chips < -->${goodTrack}<![CDATA[]]>`)), 'object', 'comments and CDATA are not text');
});

test('readGpx: a raw < inside an attribute value is not XML', () => {
  assert.equal(readGpx(gpx(goodTrack, ' creator2="a < b"')), NOT_GPX);
  assert.equal(readGpx(gpx(`<trk><extensions x='a<b'/><trkseg>${trkpt([-37, 144])}${trkpt([-37.1, 144])}</trkseg></trk>`)), NOT_GPX);
  assert.equal(typeof readGpx(gpx(goodTrack, ' creator2="a > b"')), 'object', 'a > is fine');
});

test('readGpx: an element may not have the same attribute twice', () => {
  assert.equal(readGpx(gpx(goodTrack, ' version="1.1"')), NOT_GPX, 'on the root');
  assert.equal(readGpx(gpx(`<trk><trkseg><trkpt lat="-37" lat="-37" lon="144"/>${trkpt([-37.1, 144])}</trkseg></trk>`)), NOT_GPX, 'on a point');
  assert.equal(readGpx(gpx(`<extensions><x:a b="1" c="2" b="3"/></extensions>${goodTrack}`)), NOT_GPX, 'on any element');
  // Many attributes, the repeat far down the list.
  let many = '';
  for (let k = 0; k < 40; k++) many += ` a${k}="${k}"`;
  assert.equal(typeof readGpx(gpx(`<extensions><x${many}/></extensions>${goodTrack}`)), 'object', '40 different names');
  assert.equal(readGpx(gpx(`<extensions><x${many} a33="again"/></extensions>${goodTrack}`)), NOT_GPX, 'the 41st repeats the 34th');
});

test('readGpx: after the root closes, only white space, comments and PIs', () => {
  const doc = gpx(goodTrack);
  assert.equal(typeof readGpx(doc + '\n  \r\n\t'), 'object', 'white space');
  assert.equal(typeof readGpx(doc + '<!-- end -->\n<?app done?>\n'), 'object', 'a comment and a PI');
  assert.equal(readGpx(doc + 'junk'), NOT_GPX, 'text');
  assert.equal(readGpx(doc + '\n.'), NOT_GPX, 'a full stop');
  assert.equal(readGpx(doc + '&amp;'), NOT_GPX, 'an entity');
  assert.equal(readGpx(doc + '<b/>'), NOT_GPX, 'another element');
  assert.equal(readGpx(doc + '<![CDATA[x]]>'), NOT_GPX, 'CDATA');
  assert.equal(readGpx(doc + '<!DOCTYPE gpx>'), NOT_GPX, 'a doctype');
  assert.equal(readGpx(doc + '﻿'), NOT_GPX, 'a stray BOM');
});

test('readGpx: other things libxml2 refuses are refused too', () => {
  assert.equal(readGpx(`<?xml version="1.0"?>hello<gpx>${goodTrack}</gpx>`), NOT_GPX, 'text before the root');
  assert.equal(readGpx(`<?xml version="1.0"?><![CDATA[x]]><gpx>${goodTrack}</gpx>`), NOT_GPX, 'CDATA before the root');
  assert.equal(readGpx(gpx(`<!-- a -- b -->${goodTrack}`)), NOT_GPX, '-- inside a comment');
  assert.equal(readGpx(gpx(`<!-- a --->${goodTrack}`)), NOT_GPX, 'a comment ending --->');
  assert.equal(readGpx(gpx(`<? x?>${goodTrack}`)), NOT_GPX, 'a PI with no name');
  assert.equal(readGpx(gpx(`<desc>a ]]> b</desc>${goodTrack}`)), NOT_GPX, ']]> in text');
  assert.equal(readGpx(gpx(`<desc>a \u0001 b</desc>${goodTrack}`)), NOT_GPX, 'a control character');
  assert.equal(readGpx(gpx(`<!-- \u0000 -->${goodTrack}`)), NOT_GPX, 'a NUL even in a comment');
  assert.equal(readGpx(gpx(`<desc>\uD800</desc>${goodTrack}`)), NOT_GPX, 'a lone surrogate');
  assert.equal(readGpx(gpx(`<desc>￿</desc>${goodTrack}`)), NOT_GPX, 'U+FFFF');
  assert.equal(readGpx(gpx(goodTrack, ' a="1"b="2"')), NOT_GPX, 'attributes with no space between');
  assert.equal(readGpx(gpx(goodTrack, ' a')), NOT_GPX, 'an attribute with no value');
  assert.equal(readGpx(gpx(goodTrack, ' a=1')), NOT_GPX, 'an unquoted value');
  assert.equal(readGpx(gpx(goodTrack).replace('</gpx>', '</gpx a="1">')), NOT_GPX, 'an attribute on an end tag');
  assert.equal(readGpx(gpx(`<extensions><1a/></extensions>${goodTrack}`)), NOT_GPX, 'a name starting with a digit');
  assert.equal(readGpx(gpx(`<extensions><a"b"/></extensions>${goodTrack}`)), NOT_GPX, 'a quote in a name');
  assert.equal(readGpx(gpx(`<desc><!ENTITY x "y"></desc>${goodTrack}`)), NOT_GPX, 'a declaration inside the root');
  assert.equal(readGpx(gpx(`<desc><!DOCTYPE gpx></desc>${goodTrack}`)), NOT_GPX, 'a doctype inside the root');
  // Still fine:
  assert.equal(typeof readGpx(gpx(goodTrack).replace('</gpx>', '</gpx >')), 'object', 'space before > in an end tag');
  assert.equal(typeof readGpx(gpx(goodTrack, ' a = "1"\n\tb=\'2\' ')), 'object', 'space around = and before >');
  assert.equal(typeof readGpx(`<!DOCTYPE gpx>\n<gpx>${goodTrack}</gpx>`), 'object', 'a doctype before the root');
  assert.equal(typeof readGpx(gpx(`<!---->${goodTrack}`)), 'object', 'an empty comment');
  assert.equal(typeof readGpx(gpx(`<desc>a ] ]] > b � 😀</desc>${goodTrack}`)), 'object', 'near misses');
});

test('readGpx: the GPX’s own name, from its first track, then its route, then its metadata', () => {
  const meta = '<metadata><name>Meta name</name><author><name>Not this</name></author></metadata>';
  const rte = `<rte><name>Route name</name>${trkpt([-36, 145], 'rtept')}${trkpt([-36.1, 145], 'rtept')}</rte>`;
  const trk = (name: string) => `<trk><name>${name}</name><trkseg>${trkpt([-37, 144])}${trkpt([-37.1, 144])}</trkseg></trk>`;
  const wpt = '<wpt lat="-37.5" lon="144.5"><name>A stop</name></wpt>';
  assert.equal(summary(readGpx(gpx(meta + wpt + rte + trk(' Track &amp; one ') + trk('Track two')))).name, 'Track & one');
  assert.equal(summary(readGpx(gpx(meta + wpt + rte + `<trk><trkseg>${trkpt([-37, 144])}${trkpt([-37.1, 144])}</trkseg></trk>`))).name, 'Route name');
  assert.equal(summary(readGpx(gpx(wpt + meta + rte.replace('<name>Route name</name>', '')))).name, 'Meta name');
  assert.equal(summary(readGpx(gpx(wpt + trk('')))).name, undefined, 'a waypoint’s name is never the route’s, nor an empty one');
  assert.equal(summary(readGpx(gpx(`<metadata><author><name>Jo</name></author></metadata>${trk('<![CDATA[]]>')}`))).name, undefined, 'only a direct child');
  assert.equal(summary(readGpx(gpx(trk('<![CDATA[Fish & chips]]>') + trk('Second')))).name, 'Fish & chips', 'CDATA');
  assert.equal(summary(readGpx(gpx(trk('') + trk('Second')))).name, 'Second', 'the first track with a name');
  assert.ok(!('name' in summary(readGpx(gpx(goodTrack.replace('<name>Test</name>', ''))))), 'no name key when there is none');
});
