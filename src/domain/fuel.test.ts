import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bikeRange, fuelCheck, kmAlong, packLimit, rangeProblem, RANGE_LIMITS, NOT_YOUR_BIKE, safeLeg } from './fuel';
import { bike, planningClub, ROUTE, who } from './planning.testkit';
import type { PlanStop } from './types';

const fuel = (name: string, km: number | null): PlanStop => ({ kind: 'fuel', name, km, time: null });

test('range: your own bike, whole km from 30 to 1000, or blank', () => {
  const data = planningClub({ bikes: [bike('b1', 'rc', null)] });
  const rc = who(data, 'rc');
  assert.equal(rangeProblem(null, data.bikes[0], 200), 'Sign in first.');
  assert.equal(rangeProblem(who(data, 'applicant'), data.bikes[0], 200), 'Only approved members can do that.');
  assert.equal(rangeProblem(who(data, 'tg'), data.bikes[0], 200), NOT_YOUR_BIKE);
  assert.equal(rangeProblem(rc, undefined, 200), NOT_YOUR_BIKE);
  assert.equal(rangeProblem(rc, data.bikes[0], 29), RANGE_LIMITS);
  assert.equal(rangeProblem(rc, data.bikes[0], 1001), RANGE_LIMITS);
  assert.equal(rangeProblem(rc, data.bikes[0], 180.5), RANGE_LIMITS);
  assert.equal(rangeProblem(rc, data.bikes[0], 180), null);
  assert.equal(rangeProblem(rc, data.bikes[0], null), null);
});

test('a member counts their shortest-range bike that isn’t a project', () => {
  const data = planningClub({
    bikes: [bike('tourer', 'rc', 400), bike('sporty', 'rc', 220), bike('shed', 'rc', 90, { isProject: true }), bike('blank', 'rc', null)],
  });
  assert.equal(bikeRange('rc', data)?.bike.id, 'sporty');
  assert.equal(bikeRange('tg', data), null);
});

test('the pack is everyone Going plus the crew; its limit is the shortest range, and who has none is listed', () => {
  const data = planningClub({ bikes: [bike('a', 'rc', 300), bike('b', 'tg', 180), bike('c', 'off', null)] });
  const pack = packLimit('r-west', data);
  assert.deepEqual(pack.limit, { memberId: 'tg', bikeId: 'b', rangeKm: 180 });
  assert.deepEqual(pack.unknown.sort(), ['off', 'rider']);
  assert.equal(pack.riders, 4);
  assert.equal(safeLeg(180), 162);
  assert.equal(packLimit('r-club', data).limit, null);
});

test('km along the route: waypoints project onto the line, scaled to the route’s distance', () => {
  assert.equal(Math.round(kmAlong(ROUTE, [0, 0.45])), 50);
  assert.equal(Math.round(kmAlong(ROUTE, [0.01, 1.35])), 150);
  assert.equal(kmAlong(ROUTE, [0, 0]), 0);
});

test('fuel check: legs from the start through each fuel stop to the finish, long ones flagged with a suggestion', () => {
  // Limit 180, safe leg 162. Route 200 km, no fuel stops: one leg of 200, too long.
  const data = planningClub({ bikes: [bike('a', 'rc', 300), bike('b', 'tg', 180)] });
  let check = fuelCheck('r-west', data);
  assert.equal(check.safeKm, 162);
  assert.equal(check.legs?.length, 1);
  assert.deepEqual(
    { ...check.legs![0], km: Math.round(check.legs![0].km) },
    { from: 'Start', to: 'Finish', fromKm: 0, toKm: 200, km: 200, tooLong: true, fuelByKm: 162, suggest: 'Marysville' },
  );
  assert.equal(check.ok, false);

  // A fuel stop at km 90 makes it two legs, both fine. Coffee stops don't count as fuel.
  check = fuelCheck('r-west', planningClub({
    bikes: [bike('b', 'tg', 180)],
    ridePlans: [{ rideId: 'r-west', stops: [{ kind: 'coffee', name: 'Cafe', km: 20, time: null }, fuel('Healesville', 90)], updatedAt: '', updatedBy: null }],
  }));
  assert.deepEqual(check.legs?.map((l) => [l.from, l.to, Math.round(l.km), l.tooLong]), [
    ['Start', 'Healesville', 90, false],
    ['Healesville', 'Finish', 110, false],
  ]);
  assert.equal(check.ok, true);

  // A short tank: two long legs; the suggestion is the furthest stop or waypoint before the fuel-by point.
  check = fuelCheck('r-west', planningClub({
    bikes: [bike('b', 'tg', 100)],
    ridePlans: [{ rideId: 'r-west', stops: [{ kind: 'coffee', name: 'Cafe', km: 20, time: null }], updatedAt: '', updatedBy: null }],
  }));
  assert.equal(check.safeKm, 90);
  assert.equal(check.legs![0].fuelByKm, 90);
  assert.equal(check.legs![0].suggest, 'Healesville');
});

test('fuel check without a route or without ranges', () => {
  const noRoute = fuelCheck('r-west', planningClub({ rideRoutes: [], bikes: [bike('b', 'tg', 180)] }));
  assert.equal(noRoute.legs, null);
  assert.equal(noRoute.limit?.rangeKm, 180);
  const noRanges = fuelCheck('r-west', planningClub());
  assert.equal(noRanges.limit, null);
  assert.equal(noRanges.legs, null);
  assert.equal(noRanges.ok, true);
});
