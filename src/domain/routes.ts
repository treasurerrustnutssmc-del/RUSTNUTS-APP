// The club's locked ride routes: who can change the library, who can pick a ride's route, and
// the order of the checks. These are the rules the database's save_route, archive_route and
// set_ride_route actions apply, in the same order with the same words, so the app never offers
// what the server would refuse. Reading the GPX file itself is gpx.ts.

import { managesChapterRides } from './access';
import { managesRide } from './crew';
import { endOfFirstDay } from './rides';
import type { ClubData, Member, Ride, Route } from './types';

const NAME_MAX = 80;
const NO_ROUTE = 'That route no longer exists.';
const NOT_MANAGER = 'Only the board or ride committee can change routes.';

/**
 * Who can add, change or archive a route in this chapter (null: a whole-club route): that
 * chapter's board or Ride Committee, anyone on the NEC, and for a whole-club route any chapter's
 * board or Ride Committee. The same people as `managesRide`, applied to a chapter.
 */
export function managesChapterRoutes(me: Member | null, chapterId: string | null, data: ClubData): boolean {
  return managesChapterRides(me, chapterId, data);
}

/** The first two checks every action starts with. */
function signedInProblem(me: Member | null): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  return null;
}

/**
 * Why `me` can't add this route, or save changes to it, or null when they can. Mirrors
 * public.save_route. `existing` is the route being edited. An edit is told apart from an add by
 * `input.id` (or by `existing` being there), so an id with no route behind it is “gone”. The
 * file is checked separately, by `readGpx`.
 */
export function saveRouteProblem(
  me: Member | null,
  existing: Route | undefined,
  input: { id?: string | null; name: string; chapterId: string | null },
  data: ClubData,
): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  const editing = existing !== undefined || (input.id !== undefined && input.id !== null);
  if (editing && !existing) return NO_ROUTE;
  // The target chapter, and when editing also the one it is leaving.
  if (!managesChapterRoutes(me, input.chapterId, data)) return NOT_MANAGER;
  if (existing && !managesChapterRoutes(me, existing.chapterId, data)) return NOT_MANAGER;
  // Counted in characters (code points), as the database's char_length does, so an emoji is one.
  const length = [...input.name.trim()].length;
  if (length === 0 || length > NAME_MAX) return 'Give the route a name.';
  return null;
}

/** Why `me` can't archive this route, or null when they can. Mirrors public.archive_route. */
export function archiveRouteProblem(me: Member | null, route: Route | undefined, data: ClubData): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!route) return NO_ROUTE;
  if (!managesChapterRoutes(me, route.chapterId, data)) return NOT_MANAGER;
  return null;
}

/**
 * Why `me` can't give this ride this route, or null when they can. `route` null clears the
 * ride's route, so it skips the two route checks. Mirrors public.set_ride_route.
 */
export function rideRouteProblem(
  me: Member | null,
  ride: Ride | undefined,
  route: Route | undefined | null,
  data: ClubData,
  now: string,
): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (new Date(now).getTime() >= endOfFirstDay(ride)) return 'The route can’t change after the ride day.';
  if (!managesRide(me, ride, data)) return 'Only the board or ride committee can choose this ride’s route.';
  if (route === null) return null;
  if (!route) return NO_ROUTE;
  if (route.archivedAt) return 'That route has been archived.';
  return null;
}

/** The route a ride uses, if it has one. An archived route stays on the rides that use it. */
export function routeOf(rideId: string, data: ClubData): Route | undefined {
  const link = (data.rideRoutes ?? []).find((r) => r.rideId === rideId);
  return link ? (data.routes ?? []).find((r) => r.id === link.routeId) : undefined;
}

/**
 * The library as it is shown or chosen from: routes that aren't archived, newest first. Pass the
 * chapters to show (null is the whole club), or 'all'.
 */
export function libraryFor(data: ClubData, chapterIds: (string | null)[] | 'all'): Route[] {
  return (data.routes ?? [])
    .filter((r) => r.archivedAt === null && (chapterIds === 'all' || chapterIds.includes(r.chapterId)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
