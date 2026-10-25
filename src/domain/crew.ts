// A ride's crew: Road Captain, Tail Gunner, Assistant Tail Gunner and Officers. These are the
// rules the database's set_crew and leave_crew actions apply, in the same order with the same
// words, so the app never offers what the server would refuse.

import { activePositions, isNational, managesChapterRides } from './access';
import { daysBetween } from './dates';
import { CREW_ROLES } from './labels';
import { endOfFirstDay, melbourneDate } from './rides';
import type { ClubData, CrewRole, CrewSpot, Member, Ride } from './types';

/** The chapter whose slug is the ride's category (North and West rides), if any. */
function rideChapterId(ride: Ride, data: ClubData): string | null {
  if (ride.category !== 'north' && ride.category !== 'west') return null;
  return data.chapters.find((c) => c.slug === ride.category)?.id ?? null;
}

/** The board, ride committee and National Executive Committee run the crew. */
export function managesRide(me: Member | null, ride: Ride, data: ClubData): boolean {
  if (ride.category === 'north' || ride.category === 'west') {
    const chapterId = rideChapterId(ride, data);
    if (chapterId !== null) return managesChapterRides(me, chapterId, data);
    // A North or West ride whose chapter isn't in the data: only the NEC.
    return me?.approval === 'approved' && isNational(me.id, data.positions);
  }
  return managesChapterRides(me, null, data);
}

/** Why `target` can't crew this ride in this role, or null when they can. */
export function eligibilityProblem(target: Member, role: CrewRole, ride: Ride, data: ClubData): string | null {
  if (target.approval !== 'approved' || (target.status !== 'full' && target.status !== 'nomad')) {
    return 'Only Full and Nomad members can crew a ride.';
  }
  if (target.onHiatus) return 'Members on hiatus can’t crew a ride.';
  if (role === 'tail_gunner' || role === 'assistant_tail_gunner') {
    // The first aid date is private, so a viewer who can't see it has no row: that passes here
    // and the database makes the final call.
    const row = data.privates.find((p) => p.memberId === target.id);
    if (row && (row.firstAidExpiry === null || row.firstAidExpiry < melbourneDate(ride.startsAt))) {
      return 'Tail Gunners need a current first aid certificate on file.';
    }
  }
  return null;
}

/** The checks both ways of changing the crew start with, up to and including the ride day. */
export function crewChangeProblem(me: Member | null, ride: Ride | undefined, now: string): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (new Date(now).getTime() >= endOfFirstDay(ride)) return 'The crew can’t change after the ride day.';
  return null;
}

/** Why `me` can't put `target` in this spot, or null when they can. Mirrors public.set_crew. */
export function crewProblem(
  me: Member | null,
  ride: Ride | undefined,
  target: Member | undefined,
  role: CrewRole,
  data: ClubData,
  now: string,
): string | null {
  const opening = crewChangeProblem(me, ride, now);
  if (opening) return opening;
  if (!me || !ride) return null; // narrowed by crewChangeProblem
  if (!target) return 'That member no longer exists.';
  const manages = managesRide(me, ride, data);
  if (target.id !== me.id && !manages) return 'Only the board or ride committee can put someone else on the crew.';
  const eligibility = eligibilityProblem(target, role, ride, data);
  if (eligibility) return eligibility;
  if (target.id !== me.id && data.rsvps.some((r) => r.rideId === ride.id && r.memberId === target.id && r.answer === 'no')) {
    return 'They said they can’t make it.';
  }
  if (role !== 'officer' && !manages) {
    const holder = (data.crew ?? []).find((s) => s.rideId === ride.id && s.role === role);
    if (holder && holder.memberId !== target.id) return 'That spot’s taken.';
  }
  return null;
}

/** Why `me` can't take `targetId` off this ride's crew, or null when they can. Mirrors public.leave_crew. */
export function leaveProblem(
  me: Member | null,
  ride: Ride | undefined,
  targetId: string,
  data: ClubData,
  now: string,
): string | null {
  const opening = crewChangeProblem(me, ride, now);
  if (opening) return opening;
  if (!me || !ride) return null; // narrowed by crewChangeProblem
  if (targetId !== me.id && !managesRide(me, ride, data)) {
    return 'Only the board or ride committee can take someone else off the crew.';
  }
  if (!(data.crew ?? []).some((s) => s.rideId === ride.id && s.memberId === targetId)) return 'They’re not on the crew.';
  return null;
}

/**
 * Whether `me` gets “I’ll do it” on a spot: they could take it, and they don't already hold a spot
 * on this ride. Moving between spots is for the board or ride committee, with Pick or Change.
 */
export function canVolunteer(me: Member | null, ride: Ride, role: CrewRole, data: ClubData, now: string): boolean {
  if (!me || spotOf(ride.id, me.id, data.crew) !== null) return false;
  return crewProblem(me, ride, me, role, data, now) === null;
}

/** One row of the ride screen's Crew section: a spot and who holds it, or null for an open one. */
export type CrewRowSlot = { key: string; role: CrewRole; memberId: string | null };

const SINGLE_SPOTS: CrewRole[] = ['road_captain', 'tail_gunner', 'assistant_tail_gunner'];

/**
 * The rows of a ride's Crew section. While the crew can change: RC, TG and ATG (taken or open),
 * each Officer, and an open Officer row when there's an offer on it or no Officers yet. On a
 * locked ride (cancelled, or after the ride day) the crew is a record, so only those who crewed.
 */
export function crewRows(rideId: string, crew: CrewSpot[], locked: boolean, offerOfficer: boolean): CrewRowSlot[] {
  const spots = crewFor(rideId, crew);
  const row = (s: CrewSpot): CrewRowSlot => ({
    key: s.role === 'officer' ? `officer:${s.memberId}` : s.role,
    role: s.role,
    memberId: s.memberId,
  });
  if (locked) return spots.map(row);
  const officers = spots.filter((s) => s.role === 'officer');
  return [
    ...SINGLE_SPOTS.map((role) => {
      const holder = spots.find((s) => s.role === role);
      return holder ? row(holder) : { key: role, role, memberId: null };
    }),
    ...officers.map(row),
    ...(offerOfficer || officers.length === 0 ? [{ key: 'officer:new', role: 'officer' as const, memberId: null }] : []),
  ];
}

/** One ride's crew in listed order: RC, TG, ATG, then Officers, each by when they were put on. */
export function crewFor(rideId: string, crew: CrewSpot[]): CrewSpot[] {
  return crew
    .filter((s) => s.rideId === rideId)
    .sort((a, b) => CREW_ROLES.indexOf(a.role) - CREW_ROLES.indexOf(b.role) || a.assignedAt.localeCompare(b.assignedAt));
}

/** A live ride whose Road Captain or Tail Gunner spot is still open. */
export function crewNeeded(ride: Ride, crew: CrewSpot[]): boolean {
  if (ride.cancelledAt) return false;
  const filled = (role: CrewRole) => crew.some((s) => s.rideId === ride.id && s.role === role);
  return !filled('road_captain') || !filled('tail_gunner');
}

export const byName = (a: Member, b: Member) =>
  (a.roadName ?? a.fullName).toLowerCase().localeCompare((b.roadName ?? b.fullName).toLowerCase());

/** Who `me` can pick for a spot, in the three groups `pickList` lists in order. */
export function pickGroups(
  ride: Ride,
  role: CrewRole,
  me: Member,
  data: ClubData,
): { going: Member[]; holders: Member[]; rest: Member[]; chapterId: string } {
  const chapterId = rideChapterId(ride, data) ?? me.chapterId;
  const answer = (m: Member) => data.rsvps.find((r) => r.rideId === ride.id && r.memberId === m.id)?.answer;
  const holds = (m: Member) =>
    activePositions(m.id, data.positions).some((p) => p.role === role && p.chapterId === chapterId);
  const eligible = data.members.filter((m) => answer(m) !== 'no' && eligibilityProblem(m, role, ride, data) === null);
  return {
    going: eligible.filter((m) => answer(m) === 'going').sort(byName),
    holders: eligible.filter((m) => answer(m) !== 'going' && holds(m)).sort(byName),
    rest: eligible.filter((m) => answer(m) !== 'going' && !holds(m)).sort(byName),
    chapterId,
  };
}

/**
 * Who `me` can pick for a spot: eligible members, those going first, then standing holders of the
 * same position (in the ride's chapter for a North or West ride, otherwise in `me`'s), then the
 * rest. Each group is by road name. Members who said they can't make it are left out.
 */
export function pickList(ride: Ride, role: CrewRole, me: Member, data: ClubData): Member[] {
  const { going, holders, rest } = pickGroups(ride, role, me, data);
  return [...going, ...holders, ...rest];
}

/** The spot `memberId` holds on a ride's crew, if any. */
export function spotOf(rideId: string, memberId: string, crew: CrewSpot[] | undefined): CrewRole | null {
  return (crew ?? []).find((s) => s.rideId === rideId && s.memberId === memberId)?.role ?? null;
}

/** The rides list's "Crew needed" tag: for a crew manager, on a ride starting in the next 14 days with no RC or TG. */
export function showsCrewNeeded(me: Member | null, ride: Ride, data: ClubData, today: string): boolean {
  const days = daysBetween(today, melbourneDate(ride.startsAt));
  return days >= 0 && days <= 14 && crewNeeded(ride, data.crew ?? []) && managesRide(me, ride, data);
}
