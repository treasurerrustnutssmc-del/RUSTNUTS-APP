// Big 4 rides: the principal annual Club-only rides the NEC designates ahead of time, for the whole
// club or one chapter (constitution v4 5.11, 12.7), and who's eligible to ride one (5.4, 5.8). The
// database's designate_big4 and undesignate_big4 apply the same rules with the same words.

import { activePositions, isBoardOf } from './access';
import { attended, excusedAway, meetingTypeOf } from './attendance';
import { answersClose, melbourneDate } from './rides';
import type { Big4Ground, Big4Ride, Big4Waiver, ClubData, Member, Position, PositionRole, RsvpAnswer } from './types';

export const BIG4_NEC_ONLY = 'Only the NEC designates Big 4 rides (5.11).';
export const BIG4_CLUB_ONLY = 'Big 4 rides are Club-only: pick a club, North or West ride.';
export const BIG4_AHEAD = 'A Big 4 is designated before the ride, not after (5.11).';
export const SUPPORTERS_NO_BIG4 = 'Supporters can’t join Big 4 Club-only rides (5.8).';
export const BIG4_CLUB_STATUS = 'Big 4 rides are for FNGs, Full Members and Nomads (5.4).';
export const BIG4_GROUND = 'Pick work, family, health, injury or distance (5.4).';

/** The grounds 5.4 names, in its order. */
export const BIG4_GROUNDS: Big4Ground[] = ['work', 'family', 'health', 'injury', 'distance'];
export const GROUND_LABEL: Record<Big4Ground, string> = { work: 'Work', family: 'Family', health: 'Health', injury: 'Injury', distance: 'Distance' };

/** Who rides a Big 4 at all: the Club statuses 5.4 names. */
const RIDES_BIG4 = ['fng', 'full', 'nomad'];

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
    // Newest first; on the same day, the ones they came to first, so the pick doesn't hang on ids.
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn) || Number(attended(b.id, member.id, data)) - Number(attended(a.id, member.id, data)))
    .slice(0, 3);
  const came = recent.filter((s) => attended(s.id, member.id, data)).length;
  const needed = Math.min(2, recent.length);
  return { attended: came, of: recent.length, needed, ok: came >= needed };
}

// ---------------------------------------------------------------------------
// Who can say Going on a Big 4 (5.4, 5.8). The database's set_rsvp and set_crew check the same.
// ---------------------------------------------------------------------------

/** "2 of the last 3 meetings", or "the last meeting" when only one was held. */
export function needsMeetingsText(e: { needed: number; of: number }): string {
  return e.of === 1 ? 'the last meeting' : `${e.needed} of the last ${e.of} meetings`;
}

export function isBig4Waived(rideId: string, memberId: string, data: ClubData): boolean {
  return (data.big4Waivers ?? []).some((w) => w.rideId === rideId && w.memberId === memberId);
}

/** Eligible under 5.4 for this Big 4: made enough meetings, or excused by their board. */
function meetsBig4(member: Member, rideId: string, data: ClubData, today: string): { ok: true } | { ok: false; needed: number; of: number } {
  if (isBig4Waived(rideId, member.id, data)) return { ok: true };
  const ride = data.rides.find((r) => r.id === rideId);
  if (!ride) return { ok: true };
  const e = big4Eligibility(member, melbourneDate(ride.startsAt), data, today);
  return e.ok ? { ok: true } : { ok: false, needed: e.needed, of: e.of };
}

/**
 * Why `me` can't give this answer on a Big 4, or null. Only Going is checked: Maybe and Can't
 * make it always work. set_rsvp checks it after its other checks and the Road Rules.
 */
export function big4GoingProblem(me: Member | null, rideId: string, answer: RsvpAnswer, data: ClubData, today: string): string | null {
  if (!me || answer !== 'going' || !isBig4(rideId, data)) return null;
  if (me.status === 'supporter') return SUPPORTERS_NO_BIG4;
  if (!RIDES_BIG4.includes(me.status)) return BIG4_CLUB_STATUS;
  const m = meetsBig4(me, rideId, data, today);
  return m.ok ? null : `You need ${needsMeetingsText(m)} to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance.`;
}

/** Why `target` can't be put on this Big 4's crew under 5.4, or null. (Crew is Full and Nomad only already.) */
export function big4CrewProblem(target: Member, rideId: string, data: ClubData, today: string): string | null {
  if (!isBig4(rideId, data)) return null;
  const m = meetsBig4(target, rideId, data, today);
  return m.ok ? null : `They need ${needsMeetingsText(m)} to ride this Big 4 (5.4).`;
}

/**
 * Why `me` can't excuse (a ground) or un-excuse (null) a member from 5.4 for one Big 4, or null.
 * Their chapter's board does it, never for themselves, before the ride starts. Mirrors set_big4_waiver.
 */
export function big4WaiverProblem(
  me: Member | null, rideId: string, memberId: string, ground: Big4Ground | null, data: ClubData, now: string,
): string | null {
  const ride = data.rides.find((r) => r.id === rideId);
  if (!ride) return 'No such ride.';
  if (!isBig4(rideId, data)) return 'That ride isn’t a Big 4.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (new Date(now).getTime() >= answersClose(ride)) return 'That ride has already started.';
  const target = data.members.find((m) => m.id === memberId);
  if (!target) return 'That member no longer exists.';
  if (!isBoardOf(me, target.chapterId, data.positions)) return 'Only their chapter’s board can excuse them.';
  if (me!.id === target.id) return 'Someone else on the board has to excuse you.';
  if (ground !== null && !BIG4_GROUNDS.includes(ground)) return BIG4_GROUND;
  return null;
}

/** For a chapter's board on a Big 4: its FNG, Full and Nomad members who aren't eligible yet, and the excuses it's given. */
export function big4Board(rideId: string, chapterId: string, data: ClubData, today: string): { notYet: Member[]; excused: Big4Waiver[] } {
  const ours = data.members.filter((m) => m.chapterId === chapterId && m.approval === 'approved' && RIDES_BIG4.includes(m.status));
  const excused = (data.big4Waivers ?? []).filter((w) => w.rideId === rideId && ours.some((m) => m.id === w.memberId));
  const notYet = ours.filter((m) => !meetsBig4(m, rideId, data, today).ok);
  return { notYet, excused };
}
