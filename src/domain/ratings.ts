// Route ratings: one per member per route, 1 to 5 stars with a short comment. These are the rules
// the database's rate_route applies, in the same order with the same words.

import { NO_ROUTE, signedInProblem } from './routes';
import type { ClubData, Member, Route, RouteRating } from './types';

export const MAX_COMMENT = 280;
export const ROUTE_ARCHIVED = 'That route is archived.';
export const PICK_STARS = 'Pick 1 to 5 stars.';
export const COMMENT_TOO_LONG = 'Keep the comment to 280 characters at most.';

/** Why `me` can't rate this route, or null when they can. Mirrors public.rate_route. */
export function rateProblem(me: Member | null, route: Route | undefined, stars: number, comment: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!route) return NO_ROUTE;
  if (route.archivedAt) return ROUTE_ARCHIVED;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return PICK_STARS;
  if ([...comment.trim()].length > MAX_COMMENT) return COMMENT_TOO_LONG;
  return null;
}

/** A route's average to one decimal (null with no ratings) and how many there are. */
export function routeScore(routeId: string, ratings: RouteRating[] | undefined): { average: number | null; count: number } {
  const mine = (ratings ?? []).filter((r) => r.routeId === routeId);
  if (mine.length === 0) return { average: null, count: 0 };
  const sum = mine.reduce((total, r) => total + r.stars, 0);
  return { average: Math.round((sum / mine.length) * 10) / 10, count: mine.length };
}

/** "4.3 ★ · 3 ratings", or "No ratings yet". */
export function starsLine(score: { average: number | null; count: number }): string {
  if (score.average === null) return 'No ratings yet';
  return `${score.average.toFixed(1)} ★ · ${score.count} rating${score.count === 1 ? '' : 's'}`;
}

/** Everyone's ratings for a route, newest first. */
export function ratingsFor(routeId: string, data: ClubData): RouteRating[] {
  return (data.routeRatings ?? []).filter((r) => r.routeId === routeId).sort((a, b) => b.ratedAt.localeCompare(a.ratedAt));
}
