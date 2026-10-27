import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMENT_TOO_LONG, PICK_STARS, rateProblem, ratingsFor, ROUTE_ARCHIVED, routeScore, starsLine } from './ratings';
import { planningClub, ROUTE, who } from './planning.testkit';
import type { RouteRating } from './types';

const rating = (memberId: string, stars: number, ratedAt: string, comment = ''): RouteRating => ({ routeId: 'route-1', memberId, stars, comment, ratedAt });

test('rating a route: in the database’s order', () => {
  const data = planningClub();
  const rider = who(data, 'rider');
  assert.equal(rateProblem(null, ROUTE, 5, ''), 'Sign in first.');
  assert.equal(rateProblem(who(data, 'applicant'), ROUTE, 5, ''), 'Only approved members can do that.');
  assert.equal(rateProblem(rider, undefined, 5, ''), 'That route no longer exists.');
  assert.equal(rateProblem(rider, { ...ROUTE, archivedAt: '2026-10-01T00:00:00.000Z' }, 5, ''), ROUTE_ARCHIVED);
  assert.equal(rateProblem(rider, ROUTE, 0, ''), PICK_STARS);
  assert.equal(rateProblem(rider, ROUTE, 6, ''), PICK_STARS);
  assert.equal(rateProblem(rider, ROUTE, 2.5, ''), PICK_STARS);
  assert.equal(rateProblem(rider, ROUTE, 4, 'é'.repeat(281)), COMMENT_TOO_LONG);
  assert.equal(rateProblem(rider, ROUTE, 4, ` ${'é'.repeat(280)} `), null);
});

test('the score: average to one decimal and the count; the list newest first', () => {
  const ratings = [rating('rc', 5, '2026-10-01T00:00:00.000Z'), rating('tg', 4, '2026-10-03T00:00:00.000Z', 'Tight'), rating('off', 4, '2026-10-02T00:00:00.000Z')];
  assert.deepEqual(routeScore('route-1', ratings), { average: 4.3, count: 3 });
  assert.deepEqual(routeScore('other', ratings), { average: null, count: 0 });
  assert.deepEqual(ratingsFor('route-1', planningClub({ routeRatings: ratings })).map((r) => r.memberId), ['tg', 'off', 'rc']);
  assert.equal(starsLine({ average: 4.3, count: 3 }), '4.3 ★ · 3 ratings');
  assert.equal(starsLine({ average: 5, count: 1 }), '5.0 ★ · 1 rating');
  assert.equal(starsLine({ average: null, count: 0 }), 'No ratings yet');
});
