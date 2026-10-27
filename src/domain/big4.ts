// Big 4 rides: the principal annual Club-only rides the NEC designates ahead of time, for the whole
// club or one chapter (constitution v4 5.11, 12.7), and who's eligible to ride one (5.4, 5.8). The
// database's designate_big4 and undesignate_big4 apply the same rules with the same words.

import { activePositions } from './access';
import { excusedAway, meetingTypeOf } from './attendance';
import { melbourneDate } from './rides';
import type { Big4Ride, ClubData, Member, Position, PositionRole } from './types';

export const BIG4_NEC_ONLY = 'Only the NEC designates Big 4 rides (5.11).';
export const BIG4_CLUB_ONLY = 'Big 4 rides are Club-only: pick a club, North or West ride.';
export const BIG4_AHEAD = 'A Big 4 is designated before the ride, not after (5.11).';
export const SUPPORTERS_NO_BIG4 = 'Supporters can’t join Big 4 Club-only rides (5.8).';

/** The NEC (11.2: the Chair and the Chapter Presidents), and the National Secretary who keeps Club records (11.7). */
const DESIGNATORS: PositionRole[] = ['nec_chair', 'nec_secretary', 'president'];

export function big4Of(rideId: string, data: ClubData): Big4Ride | undefined {
  return (data.big4Rides ?? []).find((b) => b.rideId === rideId);
}

export function isBig4(rideId: string, data: ClubData): boolean {
  return !!big4Of(rideId, data);
}

/** A Big 4 counts for a member when it's for every chapter or theirs. */
export function appliesTo(big4: Big4Ride, member: Member): boolean {
  return big4.chapterId === null || big4.chapterId === member.chapterId;
}

export function canDesignateBig4(me: Member | null, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  return activePositions(me.id, positions).some((p) => DESIGNATORS.includes(p.role));
}

function rideProblem(rideId: string, data: ClubData, today: string): string | null {
  const ride = data.rides.find((r) => r.id === rideId);
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (!['club', 'north', 'west'].includes(ride.category)) return BIG4_CLUB_ONLY;
  if (melbourneDate(ride.startsAt) <= today) return BIG4_AHEAD;
  return null;
}

export function designateBig4Problem(me: Member | null, rideId: string, chapterId: string | null, data: ClubData, today: string): string | null {
  if (!canDesignateBig4(me, data.positions)) return BIG4_NEC_ONLY;
  const problem = rideProblem(rideId, data, today);
  if (problem) return problem;
  if (chapterId !== null && !data.chapters.some((c) => c.id === chapterId)) return 'No such chapter.';
  return null;
}

export function undesignateBig4Problem(me: Member | null, rideId: string, data: ClubData, today: string): string | null {
  if (!canDesignateBig4(me, data.positions)) return BIG4_NEC_ONLY;
  if (!isBig4(rideId, data)) return 'That ride isn’t a Big 4.';
  const ride = data.rides.find((r) => r.id === rideId);
  if (ride && melbourneDate(ride.startsAt) <= today) return BIG4_AHEAD;
  return null;
}

/**
 * 5.4: before a Big 4, two of the three most recent official meetings (ordinary or special) of the
 * home chapter, held before the ride's date. Meetings they were excused from are skipped. With
 * fewer than two held, all of them are needed. Meetings not yet held don't count either way.
 */
export function big4Eligibility(
  member: Member, rideDate: string, data: ClubData, today: string,
): { attended: number; of: number; needed: number; ok: boolean } {
  const recent = (data.checkinSessions ?? [])
    .filter((s) => s.kind === 'meeting' && s.chapterId === member.chapterId && meetingTypeOf(s) !== 'event')
    // Held already (a meeting still to come can't be missed yet) and before the ride.
    .filter((s) => s.heldOn < rideDate && s.heldOn <= today && !excusedAway(s.id, member.id, data))
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn))
    .slice(0, 3);
  const came = recent.filter((s) => (data.attendance ?? []).some((a) => a.sessionId === s.id && a.memberId === member.id)).length;
  const needed = Math.min(2, recent.length);
  return { attended: came, of: recent.length, needed, ok: came >= needed };
}
