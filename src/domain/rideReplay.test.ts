import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canReplay,
  FPS,
  frameAt,
  partialLine,
  pointAt,
  replayCaption,
  replayFileName,
  replayPlan,
  replayStats,
  wrapLines,
} from './rideReplay';
import type { Ride, Route } from './types';

// A straight run due east along the equator-ish latitude of Melbourne, 0.1° steps.
const route = (over: Partial<Route> = {}): Route => ({
  id: 'rt-1',
  name: 'Black Spur loop',
  chapterId: null,
  notes: '',
  distanceM: 26_400,
  climbM: 1240,
  line: [
    [-37.8, 145.0],
    [-37.8, 145.1],
    [-37.8, 145.2],
    [-37.8, 145.3],
  ],
  stops: [],
  bounds: { minLat: -37.8, minLng: 145.0, maxLat: -37.8, maxLng: 145.3 },
  archivedAt: null,
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const ride: Ride = {
  id: 'ride-1',
  title: 'Sunday Spur run',
  startsAt: '2026-11-08T22:30:00.000Z', // 9:30 am on 9 Nov in Melbourne
  endsAt: null,
  allDay: false,
  location: null,
  notes: null,
  category: 'west',
  cancelledAt: null,
};

test('a route needs two points to replay', () => {
  assert.equal(canReplay(route()), true);
  assert.equal(canReplay(route({ line: [[-37.8, 145]] })), false);
  assert.equal(canReplay(route({ line: [] })), false);
  assert.equal(canReplay(null), false);
});

test('the plan measures the line', () => {
  const plan = replayPlan(route());
  assert.equal(plan.cum.length, 4);
  assert.equal(plan.cum[0], 0);
  // Three equal steps.
  assert.ok(Math.abs(plan.cum[1] * 3 - plan.total) < 1);
});

test('the point at a fraction is along the line', () => {
  const plan = replayPlan(route());
  assert.deepEqual(pointAt(plan, 0), [-37.8, 145.0]);
  assert.deepEqual(pointAt(plan, 1), [-37.8, 145.3]);
  const [lat, lng] = pointAt(plan, 0.5);
  assert.equal(lat, -37.8);
  assert.ok(Math.abs(lng - 145.15) < 1e-9);
  // Out of range is held to the ends.
  assert.deepEqual(pointAt(plan, -1), [-37.8, 145.0]);
  assert.deepEqual(pointAt(plan, 2), [-37.8, 145.3]);
});

test('the part-line ends at the marker', () => {
  const plan = replayPlan(route());
  assert.deepEqual(partialLine(plan, 0), [[-37.8, 145.0]]);
  const half = partialLine(plan, 0.5);
  assert.equal(half.length, 3);
  assert.ok(Math.abs(half[2][1] - 145.15) < 1e-9);
  assert.equal(partialLine(plan, 1).length, 4);
});

test('stops fall where they sit along the route, in order', () => {
  const plan = replayPlan(
    route({
      stops: [
        { name: 'Bakery', lat: -37.801, lng: 145.25 },
        { name: 'Fuel', lat: -37.79, lng: 145.05 },
      ],
    }),
  );
  assert.deepEqual(
    plan.stops.map((s) => s.name),
    ['Fuel', 'Bakery'],
  );
  assert.ok(Math.abs(plan.stops[0].at - 1 / 6) < 0.01);
  assert.ok(Math.abs(plan.stops[1].at - 5 / 6) < 0.01);
});

test('the timeline: intro, the ride with a hold at each stop, then the end card', () => {
  const plain = replayPlan(route());
  const stopped = replayPlan(route({ stops: [{ name: 'Bakery', lat: -37.8, lng: 145.15 }] }));
  assert.ok(stopped.durationMs > plain.durationMs);
  assert.equal(frameAt(plain, 0).phase, 'intro');
  assert.equal(frameAt(plain, plain.introMs + 1).phase, 'ride');
  assert.equal(frameAt(plain, plain.durationMs - 1).phase, 'outro');
  assert.equal(frameAt(plain, plain.durationMs + 5000).phase, 'outro');
  assert.equal(frameAt(plain, 0).fraction, 0);
  assert.equal(frameAt(plain, plain.durationMs - 1).fraction, 1);
});

test('the marker stops at a stop and names it', () => {
  const plan = replayPlan(route({ stops: [{ name: 'Bakery', lat: -37.8, lng: 145.15 }] }));
  const travel = plan.durationMs - plan.introMs - plan.outroMs - plan.holdMs;
  // Halfway through the travel time, the marker has just reached the stop and holds there.
  const atStop = plan.introMs + travel / 2 + plan.holdMs / 2;
  const f = frameAt(plan, atStop);
  assert.ok(Math.abs(f.fraction - 0.5) < 0.01);
  assert.equal(f.reached, 1);
  assert.equal(f.atStop?.name, 'Bakery');
  // Before it, nothing is reached.
  const before = frameAt(plan, plan.introMs + travel / 4);
  assert.equal(before.reached, 0);
  assert.equal(before.atStop, null);
  // After the hold the marker moves on, the stop stays reached.
  const after = frameAt(plan, plan.introMs + plan.holdMs + (travel * 3) / 4);
  assert.ok(after.fraction > 0.6);
  assert.equal(after.reached, 1);
  assert.equal(after.atStop, null);
});

test('the distance counter follows the route length on file', () => {
  const plan = replayPlan(route());
  assert.equal(frameAt(plan, 0).distanceM, 0);
  assert.equal(frameAt(plan, plan.durationMs).distanceM, 26_400);
});

test('holds shrink when a route has many stops', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, lat: -37.8, lng: 145 + (i + 1) * 0.014 }));
  const plan = replayPlan(route({ stops: many }));
  assert.ok(plan.holdMs * 20 <= 4000);
});

test('frames at the video rate cover the whole replay', () => {
  const plan = replayPlan(route());
  assert.equal(FPS, 10);
  assert.ok(plan.durationMs >= 10_000 && plan.durationMs <= 14_000);
});

test('captions use the stencil-ready parts', () => {
  assert.deepEqual(replayCaption(ride), { title: 'Sunday Spur run', date: '09/11/2026', category: 'West' });
  assert.deepEqual(replayStats(route({ stops: [{ name: 'A', lat: 0, lng: 0 }] })), ['26.4 km', '1 stop', '1,240 m climb']);
  assert.deepEqual(replayStats(route({ climbM: null })), ['26.4 km']);
});

test('the file name keeps safe characters', () => {
  assert.equal(replayFileName('Toy Run: 2026 / West'), 'Toy Run 2026  West replay.gif');
  assert.equal(replayFileName('!!!'), 'ride replay.gif');
});

test('long titles wrap to two lines and end with an ellipsis', () => {
  assert.deepEqual(wrapLines('Sunday Spur run', 18, 2), ['Sunday Spur run']);
  assert.deepEqual(wrapLines('The Great Ocean Road Toy Run for Kids', 18, 2), ['The Great Ocean', 'Road Toy Run for…']);
  assert.deepEqual(wrapLines('Supercalifragilisticexpialidocious', 10, 2), ['Supercali…']);
  assert.deepEqual(wrapLines('', 10, 2), []);
  assert.deepEqual(wrapLines('Big day out Supercalifragilistic', 11, 1), ['Big day ou…']);
});
