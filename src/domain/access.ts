// Who can see and do what. The same rules are enforced by the database
// (row-level security in supabase/migrations), so the app can never show
// more than the server would hand over.

import { clubwidePositions, coverOf, dutyPositions, heldPositions, heldRows, isActing, isEnded, settleActing } from './acting';
import { BOARD_ROLES, NATIONAL_ROLES, TITLE_ROLES } from './labels';
import { addMonths, displayName } from './profile';
import { melbourneDate } from './rides';
import { addDays, formatAuDate } from './dates';
import { termState } from './terms';
import type { ActingRequest, ClubData, Electorate, Member, MemberStatus, NecSeatRole, Position, PositionRole, StatusNotice, Threshold, Vote } from './types';

export type AccessLevel = 'public' | 'pending' | 'family' | 'member' | 'board' | 'national';

export const LEVEL_RANK: Record<AccessLevel, number> = {
  public: 0,
  pending: 1,
  family: 2,
  member: 3,
  board: 4,
  national: 5,
};

/** An approved Family person: the rides, Home and their own record, nothing members-only. Mirrors private.is_family. */
export function isFamily(viewer: Member | null): boolean {
  return !!viewer && viewer.approval === 'approved' && viewer.status === 'family';
}

/** The rows whose duties this member does now (the duties reading, src/domain/acting.ts). The name is kept. */
export const activePositions = dutyPositions;

/**
 * Holds an executive board seat in this chapter: the board-member reading, so a covered holder
 * still does and a lapsed stint doesn't. Mirrors private.holds_board_seat.
 */
export function holdsBoardSeat(memberId: string, chapterId: string, positions: Position[]): boolean {
  return heldPositions(memberId, positions).some(
    (p) => p.chapterId === chapterId && BOARD_ROLES.includes(p.role),
  );
}

/**
 * The national officers with NEC powers. The National Auditor holds a national seat but reviews
 * and never runs anything (11.8), so they aren't one.
 */
export const NEC_OFFICER_ROLES: PositionRole[] = ['nec_chair', 'nec_secretary'];
/** The seats the NEC votes people into by two-thirds, and the Chairman then fills (11.6, 11.8). */
export const NEC_SEATS: NecSeatRole[] = ['nec_auditor', 'nec_secretary'];

/**
 * Sits on the National Executive Committee: the Chairman, the Secretary, or a chapter President with
 * the seat's duties (an Acting President takes part; a covered one is off it until the cover ends).
 * Mirrors private.is_national.
 */
export function isNational(memberId: string, positions: Position[]): boolean {
  return activePositions(memberId, positions).some(
    (p) => NEC_OFFICER_ROLES.includes(p.role) || p.role === 'president',
  );
}

/** The sitting National Auditor (11.8). Mirrors private.is_auditor. */
export function isAuditor(me: Member | null, positions: Position[]): boolean {
  return !!me && me.approval === 'approved' && activePositions(me.id, positions).some((p) => p.role === 'nec_auditor');
}

/** Reads a chapter's membership and attendance records: its board, the national roles, or the Auditor (11.8). */
export function reviewsChapter(viewer: Member | null, chapterId: string, positions: Position[]): boolean {
  return seesBoardOf(viewer, chapterId, positions) || isAuditor(viewer, positions);
}

/**
 * Who runs a chapter's rides (crew and routes): an approved member on the National Executive
 * Committee, or with a board seat or a sitting Ride Committee place in that chapter. With no
 * chapter (a whole-club thing), any chapter's board seat or any Ride Committee place will do.
 * Mirrors private.manages_chapter_rides.
 */
export function managesChapterRides(me: Member | null, chapterId: string | null, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (isNational(me.id, data.positions)) return true;
  if (chapterId === null) {
    return (
      data.chapters.some((c) => holdsBoardSeat(me.id, c.id, data.positions)) ||
      activePositions(me.id, data.positions).some((p) => p.role === 'ride_committee')
    );
  }
  return (
    holdsBoardSeat(me.id, chapterId, data.positions) ||
    activePositions(me.id, data.positions).some((p) => p.role === 'ride_committee' && p.chapterId === chapterId)
  );
}

export function accessLevel(viewer: Member | null, positions: Position[]): AccessLevel {
  if (!viewer) return 'public';
  if (viewer.approval !== 'approved') return 'pending';
  if (viewer.status === 'family') return 'family';
  if (isNational(viewer.id, positions)) return 'national';
  // A board member: a held board row, covered or not.
  const board = heldPositions(viewer.id, positions).some((p) => BOARD_ROLES.includes(p.role));
  return board ? 'board' : 'member';
}

/**
 * Sees every chapter's private details (emails, licences, emergency contacts, other chapters' chats):
 * the National Chairman or Secretary, or a sitting President, none of them acting or covered. An
 * Acting President takes part in NEC business but reads member data of their own chapter only.
 * Mirrors private.sees_every_chapter.
 */
export function seesEveryChapter(viewer: Member | null, positions: Position[]): boolean {
  if (!isApprovedMember(viewer)) return false;
  return clubwidePositions(viewer.id, positions).some((p) => p.role === 'president' || NEC_OFFICER_ROLES.includes(p.role));
}

/**
 * Sees a chapter's board records (private details, conduct, notices, attendance): a board member
 * of that chapter (a covered holder included), or whoever sees every chapter. Mirrors private.sees_board_of.
 */
export function seesBoardOf(viewer: Member | null, chapterId: string, positions: Position[]): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  return holdsBoardSeat(viewer.id, chapterId, positions) || seesEveryChapter(viewer, positions);
}

/**
 * Acts as a chapter's board (approving, status, notices, conduct, attendance, terms): a seated
 * board member of that chapter only (8.2, 12.3). Mirrors private.is_board_of.
 */
export function isBoardOf(viewer: Member | null, chapterId: string, positions: Position[]): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  return holdsBoardSeat(viewer.id, chapterId, positions);
}

/** An approved member who isn't Family. Mirrors private.is_approved_member. */
export function isApprovedMember(viewer: Member | null): viewer is Member {
  return !!viewer && viewer.approval === 'approved' && viewer.status !== 'family';
}

export function canSeeDirectory(viewer: Member | null): boolean {
  return isApprovedMember(viewer);
}

/** Pending applicants are visible to their own chapter board only. */
export function canSeeMember(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer) return false;
  if (viewer.id === target.id) return true;
  if (target.approval === 'approved') return isApprovedMember(viewer);
  return reviewsChapter(viewer, target.chapterId, positions);
}

/** Phone number: self, chapter board and the national roles, or any member when the target chose to share it. */
export function canSeePhone(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer) return false;
  if (viewer.id === target.id || seesBoardOf(viewer, target.chapterId, positions)) return true;
  return isApprovedMember(viewer) && target.approval === 'approved' && target.sharePhone;
}

/** Email, licence, first aid, regos, emergency contacts: self, chapter board and the national roles only. */
export function canSeePrivate(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer) return false;
  return viewer.id === target.id || seesBoardOf(viewer, target.chapterId, positions);
}

export function canApprove(viewer: Member | null, applicant: Member, positions: Position[]): boolean {
  return applicant.approval === 'pending' && isBoardOf(viewer, applicant.chapterId, positions);
}

/**
 * Opens the Manage member screen: the member's chapter board, and the national roles, whose own acts
 * live there too (the 5.6 reinstatement vote and record, the Auditor's and Secretary's NEC votes,
 * national seats). Each act on the screen has its own gate; a national role outside the member's
 * chapter is refused the chapter's acts with the chapter board's words. Nobody manages themselves.
 */
export function canManageMember(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer || viewer.id === target.id || target.approval !== 'approved') return false;
  return seesBoardOf(viewer, target.chapterId, positions);
}

/**
 * National Chairman or Secretary. Sitting Presidents are on the NEC but are not officers, and the
 * Auditor doesn't seat the people they review (11.8).
 */
export function isNecOfficer(memberId: string, positions: Position[]): boolean {
  return activePositions(memberId, positions).some((p) => NEC_OFFICER_ROLES.includes(p.role));
}

/** The sitting National Chairman. */
export function isChairman(memberId: string, positions: Position[]): boolean {
  return activePositions(memberId, positions).some((p) => p.role === 'nec_chair');
}

const CHAIR_BY_VOTE = 'The National Chairman changes after the vote, and the club’s admin records it.';
const HONOUR_BY_ADMIN = 'Founder is an honour the club’s admin records.';

const NOT_CHAPTER_MEMBER = 'They’re not a member of that chapter.';
const ALREADY_HOLDS = 'They already hold that role.';
const TERM_ENDED = 'That term has already ended.';
const BOARD_ENDS_THIS = 'Only that chapter’s board can end this term.';

/**
 * Why `me` can't appoint `target` to `role`, or null when they can. The database's
 * appoint_position action applies exactly the same rules, after its lazy close: so a stint past
 * its date leaves the seat free. Over acting: electing the acting person ends their empty-seat
 * acting there (`replaced`), and anyone else waits for it to end (9.8); a cover is no holder, but
 * the seat it covers is; chair and books stay apart only against an acting row, so no sitting
 * holder changes (17.6). `today` is the Melbourne date.
 */
export function appointProblem(
  me: Member | null,
  target: Member,
  chapterId: string | null,
  role: PositionRole,
  raw: ClubData,
  today: string,
): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  if (TITLE_ROLES.includes(role)) return HONOUR_BY_ADMIN;
  if (me.id === target.id) return 'You can’t appoint yourself.';
  if (target.approval !== 'approved') return 'Approve them first.';
  if (target.status === 'legacy') return 'Legacy members don’t hold positions.';
  const data = settleActing(raw, today);
  const national = NATIONAL_ROLES.includes(role);
  const seatChapter = national ? null : chapterId;
  if (national) {
    if (role === 'nec_chair') return CHAIR_BY_VOTE;
    if (!isChairman(me.id, data.positions)) return 'Only the National Chairman hands out national roles.';
  } else {
    if (!seatChapter || seatChapter !== target.chapterId) return NOT_CHAPTER_MEMBER;
    if (role === 'president') {
      if (!isNecOfficer(me.id, data.positions)) return 'Only the National Chairman or Secretary can seat a President.';
    } else if (!isBoardOf(me, seatChapter, data.positions)) {
      return 'Only that chapter’s board can appoint here.';
    }
    if (auditorStaysOut(me, role, data.positions)) return AUDITOR_STAYS_OUT;
  }
  const unfit = holdProblem(target, role, data.positions);
  if (unfit) return unfit;
  const open = heldRows(data.positions).filter((p) => p.role === role && p.chapterId === seatChapter);
  const emptySeatActing = (p: Position) => isActing(p) && p.covers == null;
  if (open.some((p) => p.memberId === target.id && !emptySeatActing(p))) return ALREADY_HOLDS;
  if ((BOARD_ROLES.includes(role) || national) && open.some((p) => !isActing(p))) return 'That seat is taken. End the current term first.';
  if (seatChapter !== null) {
    const actingHere = heldPositions(target.id, data.positions).filter((p) => p.chapterId === seatChapter && isActing(p));
    if (role === 'treasurer' && actingHere.some((p) => p.role === 'president')) return CHAIR_NOT_BOOKS;
    if (role === 'president' && actingHere.some((p) => p.role === 'treasurer')) return BOOKS_NOT_CHAIR;
  }
  if (BOARD_ROLES.includes(role) && seatChapter !== null) {
    if (open.some((p) => emptySeatActing(p) && p.memberId !== target.id)) return REPLACE_NEEDS_END;
    // On a board seat only acting has the board-majority shape, so this is a vote that ended their acting.
    if (carriedVoteOn(target.id, seatChapter, role, [END_ACTING_SHAPE], data, today)) return ENDED_BY_VOTE;
  }
  // The Auditor (11.8) and the Secretary (11.6) are seated after a carried two-thirds NEC vote about them.
  if (isNecSeat(role) && !hasCarriedSeatVote(target.id, role, data, today)) return seatNeedsVote(role);
  return null;
}

export const isNecSeat = (role: PositionRole): role is NecSeatRole => NEC_SEATS.includes(role as NecSeatRole);

/** How long a carried vote to fill a national seat stays good for (inferred, as for reinstatement). */
export const AUDITOR_VOTE_DAYS = 90;
export const AUDITOR_NOT_NEC = 'The National Auditor isn’t on the NEC, so can’t also be National Chairman or Secretary (11.8).';
export const AUDITOR_NEEDS_VOTE = 'Appointing the National Auditor needs a carried two-thirds NEC vote about them in the last 90 days (11.8).';
export const SECRETARY_NEEDS_VOTE = 'Appointing the National Secretary needs a carried two-thirds NEC vote about them in the last 90 days (11.6).';
export const seatNeedsVote = (seat: NecSeatRole) => (seat === 'nec_auditor' ? AUDITOR_NEEDS_VOTE : SECRETARY_NEEDS_VOTE);

/**
 * The NEC voted by two-thirds, in the last 90 days, to seat this member as National Auditor (11.8) or
 * Secretary (11.6). The vote names its seat, and has to close after their last term in that seat
 * began, so one vote seats them once. Mirrors private.has_carried_nec_vote.
 */
export function hasCarriedSeatVote(memberId: string, seat: NecSeatRole, data: ClubData, today: string): boolean {
  const since = addDays(today, -AUDITOR_VOTE_DAYS);
  const lastStart = data.positions
    .filter((p) => p.memberId === memberId && p.role === seat)
    .reduce((max, p) => (p.startedOn > max ? p.startedOn : max), '');
  return (data.votes ?? []).some(
    (v) => v.subjectMemberId === memberId && v.subjectRole === seat && v.chapterId === null && v.electorate === 'nec'
      && v.threshold === 'two_thirds' && v.closedAt !== null && v.result === 'carried'
      && melbourneDate(v.closedAt) >= since && melbourneDate(v.closedAt) > lastStart,
  );
}

export const hasCarriedAuditorVote = (memberId: string, data: ClubData, today: string) => hasCarriedSeatVote(memberId, 'nec_auditor', data, today);

/** The sitting Auditor's seat, if there is one. */
export function auditorSeat(data: ClubData): Position | null {
  return data.positions.find((p) => p.role === 'nec_auditor' && p.endedOn === null) ?? null;
}

/**
 * Why `me` can't renew the sitting Auditor for another twelve months, or null (11.8). The term has to
 * be ending (60 days) or over, and the NEC has to have voted again. Mirrors the database's renew_auditor.
 */
export function renewAuditorProblem(me: Member | null, data: ClubData, today: string): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  if (!isChairman(me.id, data.positions)) return 'Only the National Chairman renews the National Auditor.';
  const seat = auditorSeat(data);
  if (!seat) return 'There’s no sitting National Auditor to renew.';
  if (seat.memberId === me.id) return 'You can’t renew yourself.';
  if (termState(seat, today) === 'running') return 'The Auditor’s term isn’t ending yet. Renew in its last 60 days.';
  const target = data.members.find((m) => m.id === seat.memberId);
  if (!target) return 'There’s no sitting National Auditor to renew.';
  const unfit = holdProblem(target, 'nec_auditor', data.positions);
  if (unfit) return unfit;
  return hasCarriedAuditorVote(target.id, data, today) ? null : AUDITOR_NEEDS_VOTE;
}

const patched = (status: MemberStatus) => status === 'full' || status === 'nomad';
const SEAT_ROLES: PositionRole[] = [...BOARD_ROLES, ...NATIONAL_ROLES];

/**
 * Whether `target` may hold `role` (constitution v4): only Full and Nomad members hold Club
 * positions (4.6, 5.8); Nomads hold Non-Board roles only (9.1); the National Auditor can't also
 * be a President or Treasurer (11.8), nor National Chairman or Secretary, since they aren't on the
 * NEC (11.2, 11.8). Reads held rows: a covered holder still holds their seat. Mirrors private.hold_problem.
 */
function holdProblem(target: Member, role: PositionRole, positions: Position[]): string | null {
  if (!patched(target.status)) return 'Only Full and Nomad members hold Club positions (4.6, 5.8).';
  if (target.status === 'nomad' && SEAT_ROLES.includes(role)) return 'Nomads can’t hold a board or national seat (9.1).';
  const holds = (roles: PositionRole[]) => heldPositions(target.id, positions).some((p) => roles.includes(p.role));
  if ((role === 'nec_auditor' && holds(['president', 'treasurer'])) || ((role === 'president' || role === 'treasurer') && holds(['nec_auditor']))) {
    return 'The National Auditor can’t also be a President or Treasurer (11.8).';
  }
  if ((role === 'nec_auditor' && holds(NEC_OFFICER_ROLES)) || (NEC_OFFICER_ROLES.includes(role) && holds(['nec_auditor']))) {
    return AUDITOR_NOT_NEC;
  }
  return null;
}

/**
 * Rules with exemptions the app can't see (founding officers, an NEC waiver), so they're shown on
 * the Appoint screen rather than refused: two years as a Full Member for a board seat (9.1), and a
 * full term in another board seat before President or Vice President (9.4). A stint isn't a term.
 */
export function appointWarnings(target: Member, role: PositionRole, data: ClubData, today: string): string[] {
  if (!BOARD_ROLES.includes(role)) return [];
  const warnings: string[] = [];
  if (twoYearsShort(target, today)) warnings.push(BOARD_TWO_YEARS);
  if ((role === 'president' || role === 'vice_president') && !servedTerm(target.id, role, data, today)) warnings.push(SERVED_TERM_FIRST);
  return warnings;
}

export const BOARD_TWO_YEARS = 'Board nominees need two years as a Full Member, unless the NEC waived it or they’re a founding officer (9.1).';
export const SERVED_TERM_FIRST = 'A President or Vice President should have served a full term in another board seat, unless they’re a founding officer or the NEC gave an exemption (9.4).';

/** Under two years as a Full Member (9.1). */
const twoYearsShort = (target: Member, today: string): boolean => target.patchedOn !== null && addMonths(target.patchedOn, 24) > today;

/** A full term (two years) in another board seat (9.4). A stint isn't a term. */
function servedTerm(memberId: string, role: PositionRole, data: ClubData, today: string): boolean {
  return data.positions.some(
    (p) => p.memberId === memberId && p.role !== role && BOARD_ROLES.includes(p.role) && !isActing(p)
      && addMonths(p.startedOn, 24) <= (p.endedOn ?? today),
  );
}

/**
 * A patch vote on this member, opened during their current FNG trial, has closed Carried (4.9).
 * A vote from an earlier trial doesn't count: coming back after leaving is the NEC's call (5.6).
 */
export function hasCarriedPatchVote(memberId: string, data: ClubData): boolean {
  const since = data.members.find((m) => m.id === memberId)?.fngStartedOn ?? null;
  return (data.votes ?? []).some(
    (v) => v.subjectMemberId === memberId && (v.subjectRole ?? null) === null && v.electorate === 'chapter_patched' && v.closedAt !== null && v.result === 'carried'
      && (since === null || melbourneDate(v.openedAt) >= since),
  );
}

/** Their licence on file is a learner permit, so they can't be an FNG yet (3.2). */
export function isLearner(memberId: string, data: ClubData): boolean {
  return data.privates.find((p) => p.memberId === memberId)?.licenceClass === 'learner';
}

export const LEARNER_FNG = 'A learner permit rider can’t become an FNG yet (3.2).';
/** How long a carried NEC reinstatement vote stays good for (inferred). */
export const REINSTATE_VOTE_DAYS = 90;

/** The NEC voted, in the last 90 days, to bring this member back to Full or Nomad (5.6). */
export function hasCarriedReinstateVote(memberId: string, data: ClubData, today: string): boolean {
  const since = addDays(today, -REINSTATE_VOTE_DAYS);
  return (data.votes ?? []).some(
    (v) => v.subjectMemberId === memberId && (v.subjectRole ?? null) === null && v.electorate === 'nec' && v.threshold === 'majority' && v.closedAt !== null && v.result === 'carried'
      && melbourneDate(v.closedAt) >= since,
  );
}

export const NEEDS_NEC_VOTE = 'Coming back to Full or Nomad needs a carried NEC vote (5.6).';
export const NEEDS_PATCH_VOTE = 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';
export const DOWNWARD_NEEDS_NOTICE = 'Moving them down to Supporter, Legacy or FNG follows a 5.5 notice the board has decided in the last 90 days, unless it’s at their request.';
/** How long a decided 5.5 notice stays good for a step down (inferred, as for the votes). */
export const NOTICE_DAYS = 90;
/** The statuses a step down is gated from: the people who'd lose something (5.5). */
export const GATED_FROM: MemberStatus[] = ['fng', 'full', 'nomad'];
/** The statuses that count as a step down. Nomad is sideways (5.3), so it isn't here. */
export const GATED_TO: MemberStatus[] = ['supporter', 'legacy', 'fng'];
/** A move the board makes only after a decided 5.5 notice, unless the member asked for it. Mirrors set_member_status. */
export function isStepDown(from: MemberStatus, to: MemberStatus): boolean {
  return GATED_TO.includes(to) && GATED_FROM.includes(from) && from !== to;
}

/** The newest 5.5 notice about this member the board decided in the last 90 days, or null. */
export function decidedNoticeFor(memberId: string, data: ClubData, today: string): StatusNotice | null {
  const since = addDays(today, -NOTICE_DAYS);
  return (
    (data.statusNotices ?? [])
      .filter((n) => n.memberId === memberId && n.outcome === 'decided' && n.closedOn !== null && n.closedOn >= since)
      .sort((a, b) => b.closedOn!.localeCompare(a.closedOn!) || b.givenOn.localeCompare(a.givenOn))[0] ?? null
  );
}

/**
 * Why `me` can't move `target` to `status`, or null. Mirrors the database's set_member_status.
 * An FNG reaches Full or Nomad only through a carried patch vote (4.9); anyone else coming back
 * to Full or Nomad needs a carried NEC vote (5.6), and then the NEC makes the change. Positions
 * end first when the new status can't hold them. Moving an FNG, Full Member or Nomad down to Supporter,
 * Legacy or FNG follows a decided 5.5 notice unless `byRequest` records that the member asked for it. `today` is
 * the Melbourne date.
 */
export function statusChangeProblem(
  me: Member | null, target: Member, status: MemberStatus, data: ClubData, today: string, byRequest = false,
): string | null {
  if (me?.id === target.id) return 'You can’t change your own status.';
  // Bringing an approved Supporter, Family or Legacy member back to Full or Nomad is the NEC's (5.6);
  // every other change, an applicant's approval first of all, is their chapter board's (8.2).
  // Mirrors set_member_status.
  if (patched(status) && !patched(target.status) && target.status !== 'fng' && target.approval === 'approved') {
    if (!me || !isNational(me.id, data.positions)) return 'Only the NEC can bring someone back to Full or Nomad (5.6).';
    if (target.approval !== 'approved') return 'Approve them first.';
    if (!hasCarriedReinstateVote(target.id, data, today)) return NEEDS_NEC_VOTE;
  } else {
    if (!isBoardOf(me, target.chapterId, data.positions)) return 'Only that chapter’s board can change this member’s status.';
    if (target.approval !== 'approved') return 'Approve them first.';
    if (patched(status) && target.status === 'fng' && !hasCarriedPatchVote(target.id, data)) return NEEDS_PATCH_VOTE;
  }
  if (status === 'fng' && isLearner(target.id, data)) return LEARNER_FNG;
  const held = heldPositions(target.id, data.positions).filter((p) => !TITLE_ROLES.includes(p.role));
  if (!patched(status) && held.length > 0) return 'End their positions first.';
  if (status === 'nomad' && held.some((p) => SEAT_ROLES.includes(p.role))) return 'End their board and national seats first (9.1).';
  if (isStepDown(target.status, status) && !byRequest && !decidedNoticeFor(target.id, data, today)) return DOWNWARD_NEEDS_NOTICE;
  return null;
}

/** How long a carried removal vote stays good for (inferred, as for the other votes about members). */
export const REMOVAL_VOTE_DAYS = 90;
export const ROLE_NEEDS_VOTE = 'Ending someone’s chapter role needs a carried majority vote of the chapter board in the last 90 days (9.3).';
export const BOARD_SEAT_NEEDS_VOTE = 'Removing a board member needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
export const PRESIDENT_NEEDS_VOTE = 'Removing a President needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
export const PRESIDENT_ENDED_BY = 'Only that chapter’s board or the National Chairman or Secretary can end a President’s term.';

type VoteShape = { electorate: Electorate; threshold: Threshold };
/** The shape 9.3 gives a removal from this role: two-thirds of the Full Members for a board seat, a board majority otherwise. */
const removalShapeOf = (role: PositionRole): VoteShape =>
  BOARD_ROLES.includes(role) ? { electorate: 'chapter_patched', threshold: 'two_thirds' } : { electorate: 'chapter_board', threshold: 'majority' };
/** Ending someone's acting: a majority of the chapter board, the shape 9.3 gives a Non-Board removal. */
const END_ACTING_SHAPE: VoteShape = { electorate: 'chapter_board', threshold: 'majority' };

/**
 * A carried chapter vote in the last 90 days naming this member and role there, in one of these
 * shapes, that isn't an acting vote (one that seats acting never ends it).
 */
function carriedVoteOn(
  memberId: string, chapterId: string, role: PositionRole, shapes: VoteShape[], data: ClubData, today: string, since = '',
): Vote | undefined {
  const from = addDays(today, -REMOVAL_VOTE_DAYS);
  return (data.votes ?? []).find(
    (v) => v.subjectMemberId === memberId && v.subjectRole === role && v.chapterId === chapterId && (v.actingRequestId ?? null) === null
      && shapes.some((s) => s.electorate === v.electorate && s.threshold === v.threshold)
      && v.closedAt !== null && v.result === 'carried' && melbourneDate(v.closedAt) >= from && melbourneDate(v.closedAt) >= since,
  );
}

/**
 * The chapter voted, in the last 90 days and since this term began, to remove its holder (9.3): the
 * chapter's vote naming the holder and the role, in the shape the role takes (two-thirds of the
 * chapter's Full Members for a board seat, a board majority otherwise), never an acting vote. An
 * acting row also takes a board majority (ending someone's acting); a 9.3 vote counts against it
 * too, so a holder facing one can't step down, be recorded acting and outlast it.
 * Mirrors private.has_carried_removal_vote.
 */
export function hasCarriedRemovalVote(position: Position, data: ClubData, today: string): boolean {
  if (position.chapterId === null) return false;
  const shapes = isActing(position) ? [removalShapeOf(position.role), END_ACTING_SHAPE] : [removalShapeOf(position.role)];
  return carriedVoteOn(position.memberId, position.chapterId, position.role, shapes, data, today, position.startedOn) !== undefined;
}

/**
 * Why `me` can't end this term, or null when they can. Mirrors the database's end_position. Anyone
 * steps down from their own role. Ending someone else's chapter term follows a carried removal vote
 * (9.3), recorded by the chapter board (for a President, an NEC officer can too); national seats
 * stay the Chairman's to end. A stint: the acting person steps down, the covered holder says "I'm
 * back", and anyone else on the chapter's board needs a carried board-majority vote (NEC officers
 * have no part). A stint past its date has already ended. `today` is the Melbourne date.
 */
export function endTermProblem(me: Member | null, raw: Position, rawData: ClubData, today: string): string | null {
  if (!me) return 'Sign in first.';
  // Settled first, as end_position runs the lazy close: a stint that lapsed last night gives no standing.
  const data = settleActing(rawData, today);
  const position = data.positions.find((p) => p.id === raw.id) ?? raw;
  // Your own seat needs no standing to step down from, so a suspended office holder isn't stuck
  // (ChatGPT audit F10); ending anyone else's does.
  if (position.memberId !== me.id && me.approval !== 'approved') return 'Only approved members can do that.';
  if (isEnded(position) || (isActing(position) && position.actingUntil! < today)) return TERM_ENDED;
  if (isActing(position) && position.chapterId !== null) {
    if (position.memberId === me.id) return null;
    const covered = position.covers ? data.positions.find((p) => p.id === position.covers) : undefined;
    if (covered?.memberId === me.id) return null;
    if (!isBoardOf(me, position.chapterId, data.positions)) return BOARD_ENDS_THIS;
    if (auditorStaysOut(me, position.role, data.positions)) return AUDITOR_STAYS_OUT;
    return hasCarriedRemovalVote(position, data, today) ? null : ACTING_END_NEEDS_VOTE;
  }
  if (TITLE_ROLES.includes(position.role)) return HONOUR_BY_ADMIN;
  if (position.role === 'nec_chair') return CHAIR_BY_VOTE;
  if (position.memberId === me.id) return null;
  if (NATIONAL_ROLES.includes(position.role) || position.chapterId === null) {
    return isChairman(me.id, data.positions) ? null : 'Only the National Chairman can end a national role.';
  }
  if (position.role === 'president') {
    if (!isBoardOf(me, position.chapterId, data.positions) && !isNecOfficer(me.id, data.positions)) return PRESIDENT_ENDED_BY;
    return hasCarriedRemovalVote(position, data, today) ? null : PRESIDENT_NEEDS_VOTE;
  }
  if (!isBoardOf(me, position.chapterId, data.positions)) return BOARD_ENDS_THIS;
  if (hasCarriedRemovalVote(position, data, today)) return null;
  return BOARD_ROLES.includes(position.role) ? BOARD_SEAT_NEEDS_VOTE : ROLE_NEEDS_VOTE;
}

export function visibleMembers(viewer: Member | null, data: ClubData): Member[] {
  return data.members.filter((m) => canSeeMember(viewer, m, data.positions));
}

export function pendingFor(viewer: Member | null, data: ClubData): Member[] {
  return data.members.filter((m) => canApprove(viewer, m, data.positions));
}

/** Pairs each position with its holder, leaving out holders this viewer can't see. */
export function withHolders(positions: Position[], members: Member[]): { position: Position; member: Member }[] {
  return positions.flatMap((position) => {
    const member = members.find((m) => m.id === position.memberId);
    return member ? [{ position, member }] : [];
  });
}

// Suspending a member's app access (App Review Guideline 1.2: a way to eject an abusive member in
// one step). approval = 'suspended' already locks them out of everything members-only, because
// every check asks for 'approved'. Mirrors public.suspend_member_access / restore_member_access.
export const NOT_MEMBER_BOARD = 'Only that member’s chapter board can do that.';
export const SUSPEND_SELF = 'You can’t suspend your own access.';
export const RESTORE_SELF = 'You can’t restore your own access.';
export const NOT_APPROVED_TARGET = 'They’re not an approved member.';
export const NOT_SUSPENDED = 'Their access isn’t suspended.';

/** Why `me` can't suspend `target`'s app access, or null. */
export function suspendAccessProblem(me: Member | null, target: Member | undefined, positions: Position[]): string | null {
  if (!me) return 'Sign in first.';
  if (!isApprovedMember(me)) return 'Only approved members can do that.';
  if (!target) return 'That member no longer exists.';
  if (target.id === me.id) return SUSPEND_SELF;
  if (!isBoardOf(me, target.chapterId, positions)) return NOT_MEMBER_BOARD;
  if (target.approval !== 'approved') return NOT_APPROVED_TARGET;
  return null;
}

/** Why `me` can't restore `target`'s app access, or null. */
export function restoreAccessProblem(me: Member | null, target: Member | undefined, positions: Position[]): string | null {
  if (!me) return 'Sign in first.';
  if (!isApprovedMember(me)) return 'Only approved members can do that.';
  if (!target) return 'That member no longer exists.';
  if (target.id === me.id) return RESTORE_SELF;
  if (!isBoardOf(me, target.chapterId, positions)) return NOT_MEMBER_BOARD;
  if (target.approval !== 'suspended') return NOT_SUSPENDED;
  return null;
}

// ---------------------------------------------------------------------------
// Acting in a role, until a date (docs/superpowers/specs/2026-11-15-acting-roles-design.md).
// Each check mirrors the database's acting RPCs (supabase/migrations/20270870000000_acting_roles.sql
// §4) in the same order and words: 1 signed in and approved; 2 the caller's standing; 3 the
// Auditor stays out; 4 a board big enough to decide, then whether it needs a vote at all; 5
// actingProblem; 6 the vote rule; 7 the why; 8 the until date. Each route settles first, as each
// RPC runs the lazy close first.
// ---------------------------------------------------------------------------

export const ACTING_CHAPTER_ONLY = 'Acting is for chapter roles, not national seats or honours.';
export const SEAT_HAS_HOLDER = 'That seat has a holder. Arrange a cover instead.';
export const SEAT_HAS_ACTING = 'Someone is already acting in that seat, or a request is waiting.';
export const ONE_STINT = 'They’re already acting in a role. One stint at a time.';
export const OWN_SEAT_COVERED = 'Their own seat is covered, so they can’t act for anyone.';
export const CHAIR_NOT_BOOKS = 'An Acting President can’t also keep the chapter’s books (9.5).';
export const BOOKS_NOT_CHAIR = 'An Acting Treasurer can’t also be the chapter’s President (9.5).';
export const HIATUS_NO_LEAD = 'Members on hiatus can’t lead rides.';
export const COVER_BOARD_SEATS = 'Only board seats can be covered.';
export const COVER_FROM_BOARD = 'A cover goes to someone already on that chapter’s board.';
export const PRESIDENT_NEEDS_BOARD_VOTE = 'Anyone but the sitting VP needs a carried board vote to act as President (8.2, 9.8).';
export const ENDED_BY_VOTE = 'A carried vote ended their time in this seat in the last 90 days. Acting there again needs a new board vote.';
export const WHY_NEEDED = 'Say why, in 120 characters or fewer.';
export const untilRange = (cap: string): string => `Pick an until date from today to ${formatAuDate(cap)}.`;
export const RUN_OVER = 'Acting in this seat has reached its limit (its ACM, or six or twelve months), so it can’t start or run longer. Seat someone in full (9.2, 9.8).';
export const ASKED_RECENTLY = 'The board voted down your request for this seat in the last 28 days.';
export const SMALL_BOARD = 'Too few board members outside this can decide it in the app. Refer it to the NEC (8.6).';
export const LICENCE_ENDS = 'Their recorded licence ends before the until date (9.7).';
export const RECORD_INSTEAD = 'This doesn’t need a vote. Record it as acting, or ask for cover from your own seat.';
export const REPLACE_NEEDS_END = 'Someone is acting in that seat. They step down first, or a carried board vote ends their acting.';
export const AUDITOR_STAYS_OUT = 'The National Auditor doesn’t seat or unseat a President or Treasurer (11.8).';
export const BOARD_RECORDS_ACTING = 'Only that chapter’s board can record acting here.';
export const NOT_YOURSELF = 'You can’t record yourself as acting.';
export const OWN_SEAT_ONLY = 'You can only ask for cover of your own board seat.';
export const NO_REQUEST = 'That request isn’t open.';
export const CONFIRM_NOT_STANDIN = 'The stand-in can’t confirm their own acting.';
export const CONFIRM_NOT_HOLDER = 'A third board member confirms the cover you asked for (9.5).';
export const NEEDS_ACTING_VOTE = 'This needs a carried board vote on the request in the last 90 days.';
export const SEAT_ENDED = 'The seat they asked to cover has ended.';
export const WITHDRAW_WHO = 'Only the stand-in or the holder can withdraw this, or the person who asked before a vote on it opens.';
export const NOT_ACTING = 'That isn’t an acting seat.';
export const UNTIL_NOT_PAST = 'Pick today or later. To end it now, step down.';
export const EARLIER_WHO = 'Only the acting person or the holder can bring the date forward.';
export const LATER_WHO_EMPTY = 'Only another board member can give this more time.';
export const laterWhoCover = (holder: string): string => `Only ${holder} can keep this cover going longer.`;
export const VOTED_NEEDS_NEW_VOTE = 'The board voted for this stint, so it needs a new vote to run longer.';
export const ACTING_END_NEEDS_VOTE = 'Ending someone’s acting needs a carried majority vote of the chapter board in the last 90 days (9.3).';

// Warnings: rules the app can't see the whole of, shown on the confirm rather than refused.
export const ACTING_FAMILY = 'Immediate family can’t sit on the same board, including the person they cover, without a two-thirds written exemption (9.6).';
export const ACTING_LICENCE_VACANCY = 'If their licence is suspended or cancelled, their seat is vacant (9.7). The app can’t record that yet: they step down, then the board fills the seat.';
export const ACTING_COMBINED = 'A small chapter may combine duties for a while where it’s necessary, with the reason recorded (9.5).';
const shortDate = (iso: string) => formatAuDate(iso).slice(0, 5);
/** The stand-in leads a ride the stint ends during: `day` is the ride's, `pick` the first until that covers it. */
export const actingRideWarning = (name: string, day: string, pick: string): string =>
  `${name} leads the ${shortDate(day)} run. Acting ends that night. Pick ${shortDate(pick)} or later.`;
/** A voted President cover leaves the chapter's uncast NEC ballots without a voter while it runs (11.2, 11.5). */
export const necBallotsWait = (chapter: string, n: number): string =>
  `${chapter} can’t cast its ballot on ${n} open NEC vote${n === 1 ? '' : 's'} while this runs, so they may close without quorum (11.2, 11.5).`;

/** How long a carried acting vote stays good for confirming, as for the other votes about members. */
export const ACTING_VOTE_DAYS = 90;
/** How long a requester waits after the board voted their request for a seat down. */
export const ASKED_AGAIN_DAYS = 28;
/** Stints this close together share one run (and one cap). */
export const RUN_GAP_DAYS = 28;
export const WHY_MAX = 120;

/** The roles a member on hiatus can't act in: every chapter role private.is_ride_leader counts. */
const LEADING_ROLES: PositionRole[] = [...BOARD_ROLES, 'tail_gunner', 'assistant_tail_gunner'];
const isBoardRole = (role: PositionRole) => BOARD_ROLES.includes(role);
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** A chapter's board members: distinct approved people with a held board row there, covered or not (electors_for). */
function boardMembers(chapterId: string, data: ClubData): string[] {
  return data.members
    .filter((m) => m.approval === 'approved' && m.status !== 'legacy' && holdsBoardSeat(m.id, chapterId, data.positions))
    .map((m) => m.id)
    .sort();
}

/** Someone with an open National Auditor seat who also sits on a board stays out of President and Treasurer seats (11.8). */
export function auditorStaysOut(me: Member | null, role: PositionRole, positions: Position[]): boolean {
  return !!me && (role === 'president' || role === 'treasurer') && heldPositions(me.id, positions).some((p) => p.role === 'nec_auditor');
}

/**
 * The sitting VP of a chapter: a held VP row that isn't acting (8.2). For an empty President seat
 * it has to have started before the seat's last full President row ended, so nobody is seated VP
 * and then made Acting President without a vote.
 */
function isSittingVp(memberId: string, chapterId: string, positions: Position[]): boolean {
  const vp = heldPositions(memberId, positions).filter((p) => p.chapterId === chapterId && p.role === 'vice_president' && !isActing(p));
  if (vp.length === 0) return false;
  const presidents = positions.filter((p) => p.chapterId === chapterId && p.role === 'president' && !isActing(p));
  if (presidents.some((p) => !isEnded(p))) return true;
  const fellEmpty = presidents.reduce((max, p) => later(max, p.endedOn ?? ''), '');
  return fellEmpty !== '' && vp.some((p) => p.startedOn < fellEmpty);
}

/** A carried vote ended their time in this seat in the last 90 days: a 9.3 removal, or one that ended their acting. */
function endedByVote(memberId: string, chapterId: string, role: PositionRole, data: ClubData, today: string): boolean {
  return carriedVoteOn(memberId, chapterId, role, [removalShapeOf(role), END_ACTING_SHAPE], data, today) !== undefined;
}

/** Step 6: ENDED_BY_VOTE, then anyone but the sitting VP as President. */
function voteRule(memberId: string, chapterId: string, role: PositionRole, data: ClubData, today: string): string | null {
  if (endedByVote(memberId, chapterId, role, data, today)) return ENDED_BY_VOTE;
  if (role === 'president' && !isSittingVp(memberId, chapterId, data.positions)) return PRESIDENT_NEEDS_BOARD_VOTE;
  return null;
}

/**
 * Whether acting here needs a carried board vote: anyone but the sitting VP as President (8.2,
 * 9.8), or someone a carried vote took out of this seat in the last 90 days. Mirrors private.acting_needs_vote.
 */
export function actingNeedsVote(memberId: string, chapterId: string, role: PositionRole, data: ClubData, today: string): boolean {
  return voteRule(memberId, chapterId, role, data, today) !== null;
}

type RequestShape = Pick<ActingRequest, 'chapterId' | 'role' | 'memberId' | 'covers' | 'requestedBy'>;

/** Who holds the covered row now (a held row), or null once it has ended. Expects settled data. */
function holderOf(coversId: string | null, data: ClubData): string | null {
  return coversId === null ? null : heldRows(data.positions).find((p) => p.id === coversId)?.memberId ?? null;
}

/** A request needs a vote when someone other than the holder asked for a cover, or acting there needs one. Mirrors private.request_needs_vote. */
export function requestNeedsVote(request: RequestShape, data: ClubData, today: string): boolean {
  if (request.covers !== null && request.requestedBy !== holderOf(request.covers, data)) return true;
  return actingNeedsVote(request.memberId, request.chapterId, request.role, data, today);
}

/** The carried board vote naming this request, closed in the last 90 days, or null. Mirrors private.has_carried_acting_vote. */
export function carriedActingVote(request: Pick<ActingRequest, 'id'>, data: ClubData, today: string): Vote | null {
  const since = addDays(today, -ACTING_VOTE_DAYS);
  return (data.votes ?? []).find(
    (v) => v.actingRequestId === request.id && v.result === 'carried' && v.closedAt !== null && melbourneDate(v.closedAt) >= since,
  ) ?? null;
}

/**
 * Who votes on acting in this seat: the chapter's board members, less the stand-in, the covered
 * holder and, for a President or Treasurer seat, the National Auditor (8.5, 11.8, 11.10). Mirrors private.acting_electors.
 */
export function actingElectors(chapterId: string, role: PositionRole, memberId: string, coversId: string | null, data: ClubData): string[] {
  const holder = holderOf(coversId, data);
  const auditors = new Set(
    role === 'president' || role === 'treasurer' ? heldRows(data.positions).filter((p) => p.role === 'nec_auditor').map((p) => p.memberId) : [],
  );
  return boardMembers(chapterId, data).filter((id) => id !== memberId && id !== holder && !auditors.has(id));
}

/**
 * Why `target` can't act in this seat until `until`, or null. Mirrors private.acting_problem. A cover
 * (`covers`, the holder's row) needs a board seat and someone already on that chapter's board, and
 * the row has to be a held, full row of this very seat. The seat checks are for the six board seats
 * only: a non-board role takes acting beside its holders. Expects settled data.
 */
export function actingProblem(
  target: Member, chapterId: string | null, role: PositionRole, covers: Pick<Position, 'id'> | null, until: string, data: ClubData,
): string | null {
  if (chapterId === null || NATIONAL_ROLES.includes(role) || TITLE_ROLES.includes(role)) return ACTING_CHAPTER_ONLY;
  if (target.chapterId !== chapterId) return NOT_CHAPTER_MEMBER;
  if (target.approval !== 'approved') return 'Approve them first.';
  const unfit = holdProblem(target, role, data.positions);
  if (unfit) return unfit;
  const mine = heldPositions(target.id, data.positions);
  if (mine.some((p) => p.chapterId === chapterId && p.role === role)) return ALREADY_HOLDS;
  if (isBoardRole(role)) {
    const seat = heldRows(data.positions).filter((p) => p.chapterId === chapterId && p.role === role);
    if (covers === null && seat.some((p) => !isActing(p))) return SEAT_HAS_HOLDER;
    if (covers !== null && !seat.some((p) => p.id === covers.id && !isActing(p))) return SEAT_ENDED;
    const waiting = (data.actingRequests ?? []).some((r) => r.closedAt === null && r.chapterId === chapterId && r.role === role);
    if (waiting || seat.some(isActing)) return SEAT_HAS_ACTING;
  }
  if (mine.some(isActing)) return ONE_STINT;
  if (mine.some((p) => coverOf(p, data.positions) !== null)) return OWN_SEAT_COVERED;
  const here = mine.filter((p) => p.chapterId === chapterId);
  if (role === 'president' && here.some((p) => p.role === 'treasurer')) return CHAIR_NOT_BOOKS;
  if (role === 'treasurer' && here.some((p) => p.role === 'president')) return BOOKS_NOT_CHAIR;
  if (target.onHiatus && LEADING_ROLES.includes(role)) return HIATUS_NO_LEAD;
  const licence = data.privates.find((p) => p.memberId === target.id);
  if (licence && (licence.licenceClass === 'learner' || (licence.licenceExpiry !== null && licence.licenceExpiry < until))) return LICENCE_ENDS;
  if (covers !== null) {
    if (!isBoardRole(role)) return COVER_BOARD_SEATS;
    if (!holdsBoardSeat(target.id, chapterId, data.positions)) return COVER_FROM_BOARD;
  }
  return null;
}

/**
 * Where a run of back-to-back empty-seat stints began: back from `startedOn` through the seat's
 * stints that were open, or ended within 28 days before the next one started, after the seat's last
 * full term ended.
 */
function runStart(chapterId: string, role: PositionRole, startedOn: string, positions: Position[]): string {
  const seat = positions.filter((p) => p.chapterId === chapterId && p.role === role);
  const lastFull = seat.filter((p) => !isActing(p)).reduce((max, p) => later(max, p.endedOn ?? ''), '');
  const stints = seat.filter((p) => isActing(p) && p.covers == null && p.startedOn >= lastFull);
  let start = startedOn;
  for (;;) {
    const chained = stints.filter((p) => p.startedOn < start && (p.endedOn === null || addDays(p.endedOn, RUN_GAP_DAYS) >= start));
    if (chained.length === 0) return start;
    start = chained.reduce((min, p) => earlier(min, p.startedOn), start);
  }
}

/** The Melbourne date of the chapter's first ACM saved on or after `from`, held or to come, not cancelled. */
function runAcm(chapterId: string, from: string, data: ClubData): string | null {
  const days = (data.meetings ?? [])
    .filter((m) => m.chapterId === chapterId && m.kind === 'agm' && m.cancelledAt === null)
    .map((m) => melbourneDate(m.startsAt))
    .filter((day) => day >= from)
    .sort();
  return days[0] ?? null;
}

/**
 * The last until date a stint starting on `startedOn` may have (inferred; measured from the start,
 * never from today). A cover: three months. A non-board role: six months. An empty board seat: the
 * first ACM in its run (9.8, 9.2), twelve months at most, or six with no ACM saved. Mirrors private.acting_cap.
 */
export function actingCap(chapterId: string, role: PositionRole, cover: boolean, startedOn: string, data: ClubData): string {
  if (cover) return addMonths(startedOn, 3);
  if (!isBoardRole(role)) return addMonths(startedOn, 6);
  const start = runStart(chapterId, role, startedOn, data.positions);
  const acm = runAcm(chapterId, start, data);
  return acm === null ? addMonths(start, 6) : earlier(acm, addMonths(start, 12));
}

/** The until date offered first: four weeks for a cover, the run's ACM or three months otherwise, within the cap. */
export function actingDefaultUntil(chapterId: string, role: PositionRole, cover: boolean, startedOn: string, data: ClubData): string {
  const cap = actingCap(chapterId, role, cover, startedOn, data);
  const pick = cover
    ? addDays(startedOn, 28)
    : (isBoardRole(role) ? runAcm(chapterId, runStart(chapterId, role, startedOn, data.positions), data) : null) ?? addMonths(startedOn, 3);
  return earlier(pick, cap);
}

/** Signed in, approved and not Family, as private.is_approved_member. */
const signInProblem = (me: Member | null): string | null =>
  !me ? 'Sign in first.' : !isApprovedMember(me) ? 'Only approved members can do that.' : null;
/** Step 7: a reason, 1 to 120 characters (counted as the database counts them). */
const whyProblem = (why: string): string | null => {
  const length = [...why.trim()].length;
  return length < 1 || length > WHY_MAX ? WHY_NEEDED : null;
};
/** Step 8: a cap already behind today ends the run; otherwise today to the cap. */
const untilProblem = (cap: string, until: string, today: string): string | null =>
  cap < today ? RUN_OVER : until < today || until > cap ? untilRange(cap) : null;

/** The board voted down a request of theirs for this seat in the last 28 days: on day 28 they may ask again. */
function askedRecently(memberId: string, chapterId: string, role: PositionRole, data: ClubData, today: string): boolean {
  const since = addDays(today, -ASKED_AGAIN_DAYS);
  return (data.actingRequests ?? []).some(
    (r) => r.requestedBy === memberId && r.chapterId === chapterId && r.role === role && r.outcome === 'rejected'
      && r.closedAt !== null && melbourneDate(r.closedAt) > since,
  );
}

/**
 * Route 1: one board member records someone acting in an empty seat, from today. For President,
 * only the sitting VP; anyone else goes to a board vote (route 3). Mirrors public.appoint_acting.
 */
export function appointActingProblem(
  me: Member | null, target: Member, chapterId: string, role: PositionRole, until: string, why: string, raw: ClubData, today: string,
): string | null {
  const signedIn = signInProblem(me);
  if (signedIn || !me) return signedIn;
  const data = settleActing(raw, today);
  if (!isBoardOf(me, chapterId, data.positions)) return BOARD_RECORDS_ACTING;
  if (me.id === target.id) return NOT_YOURSELF;
  if (auditorStaysOut(me, role, data.positions)) return AUDITOR_STAYS_OUT;
  const unfit = actingProblem(target, chapterId, role, null, until, data);
  if (unfit) return unfit;
  const vote = voteRule(target.id, chapterId, role, data, today);
  if (vote) return vote;
  return whyProblem(why) ?? untilProblem(actingCap(chapterId, role, false, today, data), until, today);
}

/**
 * Route 2: the away holder asks for a cover of their own board seat (`seat`). Nothing moves until
 * a third board member confirms it. For President, the sitting VP only. Mirrors public.request_cover.
 */
export function requestCoverProblem(
  me: Member | null, seat: Position | undefined, target: Member, until: string, why: string, raw: ClubData, today: string,
): string | null {
  const signedIn = signInProblem(me);
  if (signedIn || !me) return signedIn;
  if (me.id === target.id) return NOT_YOURSELF;
  const data = settleActing(raw, today);
  const own = seat ? data.positions.find((p) => p.id === seat.id) ?? seat : undefined;
  if (!own || own.memberId !== me.id || isEnded(own) || isActing(own) || own.chapterId === null || !isBoardRole(own.role)) {
    return OWN_SEAT_ONLY;
  }
  if (askedRecently(me.id, own.chapterId, own.role, data, today)) return ASKED_RECENTLY;
  if (auditorStaysOut(me, own.role, data.positions)) return AUDITOR_STAYS_OUT;
  if (boardMembers(own.chapterId, data).length < 3) return SMALL_BOARD;
  const unfit = actingProblem(target, own.chapterId, own.role, own, until, data);
  if (unfit) return unfit;
  const vote = voteRule(target.id, own.chapterId, own.role, data, today);
  if (vote) return vote;
  return whyProblem(why) ?? untilProblem(actingCap(own.chapterId, own.role, true, today, data), until, today);
}

/**
 * Route 3: a board member who isn't the stand-in proposes acting that needs a board vote: a cover
 * someone other than the holder asks for, or an Acting President who isn't the sitting VP.
 * `covers` is the holder's row, or null for an empty seat. Mirrors public.request_acting.
 */
export function requestActingProblem(
  me: Member | null, target: Member, chapterId: string, role: PositionRole, covers: Position | null, until: string, why: string,
  raw: ClubData, today: string,
): string | null {
  const signedIn = signInProblem(me);
  if (signedIn || !me) return signedIn;
  const data = settleActing(raw, today);
  if (!isBoardOf(me, chapterId, data.positions)) return BOARD_RECORDS_ACTING;
  if (me.id === target.id) return NOT_YOURSELF;
  if (askedRecently(me.id, chapterId, role, data, today)) return ASKED_RECENTLY;
  if (auditorStaysOut(me, role, data.positions)) return AUDITOR_STAYS_OUT;
  const seat = covers ? data.positions.find((p) => p.id === covers.id) ?? covers : null;
  if (actingElectors(chapterId, role, target.id, seat?.id ?? null, data).length < 3) return SMALL_BOARD;
  const request = { chapterId, role, memberId: target.id, covers: seat?.id ?? null, requestedBy: me.id };
  if (!requestNeedsVote(request, data, today)) return RECORD_INSTEAD;
  const unfit = actingProblem(target, chapterId, role, seat, until, data);
  if (unfit) return unfit;
  return whyProblem(why) ?? untilProblem(actingCap(chapterId, role, seat !== null, today, data), until, today);
}

/**
 * Who closes an open request: the stand-in (declining) or the holder at any time, and the person
 * who asked only while no vote on it is open or has carried. Settled first when given today (a
 * lost vote has closed it). Mirrors public.withdraw_acting_request.
 */
export function withdrawRequestProblem(me: Member | null, request: ActingRequest, raw: ClubData, today?: string): string | null {
  const signedIn = signInProblem(me);
  if (signedIn || !me) return signedIn;
  const data = today === undefined ? raw : settleActing(raw, today);
  const fresh = (data.actingRequests ?? []).find((r) => r.id === request.id) ?? request;
  if (fresh.closedAt !== null) return NO_REQUEST;
  if (me.id === fresh.memberId) return null;
  if (me.id === holderOf(fresh.covers, data)) return null;
  const voted = (data.votes ?? []).some((v) => v.actingRequestId === fresh.id && (v.closedAt === null || v.result === 'carried'));
  return me.id === fresh.requestedBy && !voted ? null : WITHDRAW_WHO;
}

/**
 * Confirming a request seats the stint, so it re-runs every check on the request as it stands now:
 * a board member who is neither the stand-in nor the holder, the covered seat still held, the
 * stand-in still fit, and a carried vote on it when it needs one. Mirrors public.confirm_acting.
 */
export function confirmActingProblem(me: Member | null, request: ActingRequest, raw: ClubData, today: string): string | null {
  const signedIn = signInProblem(me);
  if (signedIn || !me) return signedIn;
  const known = (raw.actingRequests ?? []).some((r) => r.id === request.id);
  const data = settleActing(known ? raw : { ...raw, actingRequests: [...(raw.actingRequests ?? []), request] }, today);
  const fresh = data.actingRequests!.find((r) => r.id === request.id)!;
  if (fresh.closedAt !== null) return NO_REQUEST;
  if (!isBoardOf(me, fresh.chapterId, data.positions)) return BOARD_RECORDS_ACTING;
  if (me.id === fresh.memberId) return CONFIRM_NOT_STANDIN;
  const seat = fresh.covers ? data.positions.find((p) => p.id === fresh.covers) ?? null : null;
  if (seat?.memberId === me.id) return CONFIRM_NOT_HOLDER;
  if (auditorStaysOut(me, fresh.role, data.positions)) return AUDITOR_STAYS_OUT;
  const target = data.members.find((m) => m.id === fresh.memberId);
  if (!target) return NO_REQUEST;
  // The request being confirmed doesn't count as one waiting for the seat.
  const others = { ...data, actingRequests: data.actingRequests!.filter((r) => r.id !== fresh.id) };
  const covers = fresh.covers === null ? null : { id: fresh.covers };
  const unfit = actingProblem(target, fresh.chapterId, fresh.role, covers, fresh.until, others);
  if (unfit) return unfit;
  if (requestNeedsVote(fresh, data, today) && !carriedActingVote(fresh, data, today)) return NEEDS_ACTING_VOTE;
  return whyProblem(fresh.why) ?? untilProblem(actingCap(fresh.chapterId, fresh.role, covers !== null, today, data), fresh.until, today);
}

/**
 * Changing a stint's until date, never to before today. Earlier: the acting person, and for a cover
 * the holder too. Later: in an empty seat, another board member; on a cover, the holder only;
 * either way within the cap. A stint the board voted for needs a new vote to run longer, and a
 * President stint recorded for the sitting VP runs longer only while they still are. Mirrors
 * public.set_acting_until.
 */
export function setActingUntilProblem(me: Member | null, position: Position, until: string, raw: ClubData, today: string): string | null {
  const signedIn = signInProblem(me);
  if (signedIn || !me) return signedIn;
  const data = settleActing(raw, today);
  const row = data.positions.find((p) => p.id === position.id) ?? position;
  if (!isActing(row) || row.chapterId === null) return NOT_ACTING;
  if (isEnded(row) || row.actingUntil! < today) return TERM_ENDED;
  const holderRow = row.covers ? data.positions.find((p) => p.id === row.covers) ?? null : null;
  if (until <= row.actingUntil!) {
    if (me.id !== row.memberId && me.id !== holderRow?.memberId) return EARLIER_WHO;
    if (auditorStaysOut(me, row.role, data.positions)) return AUDITOR_STAYS_OUT;
    return until < today ? UNTIL_NOT_PAST : null;
  }
  if (row.actingVote != null) return VOTED_NEEDS_NEW_VOTE;
  if (row.covers != null) {
    if (me.id !== holderRow?.memberId) {
      const holder = holderRow ? data.members.find((m) => m.id === holderRow.memberId) : undefined;
      return laterWhoCover(holder ? displayName(holder) : 'the holder');
    }
  } else if (me.id === row.memberId || !isBoardOf(me, row.chapterId, data.positions)) {
    return LATER_WHO_EMPTY;
  }
  if (auditorStaysOut(me, row.role, data.positions)) return AUDITOR_STAYS_OUT;
  if (row.role === 'president') {
    const vote = voteRule(row.memberId, row.chapterId, row.role, data, today);
    if (vote) return vote;
  }
  return untilProblem(actingCap(row.chapterId, row.role, row.covers != null, row.startedOn, data), until, today);
}

/** The chapter's NEC ballots on open votes that haven't been cast. */
function uncastNecBallots(chapterId: string, data: ClubData): number {
  return (data.votes ?? []).filter(
    (v) => v.electorate === 'nec' && v.closedAt === null
      && Object.entries(v.electorChapters ?? {}).some(([member, chapter]) => chapter === chapterId && !v.votedIds.includes(member)),
  ).length;
}

/**
 * What a stint's confirm text warns about, in this order: 9.6 on every board seat; 9.1 for an
 * empty-seat stand-in off the board; 9.4 for an empty-seat President or VP who isn't the sitting VP;
 * 9.7 on a cover; 9.5 for a stand-in already on the board (combining duties; a VP acting for the
 * President does what 8.2 gives them); a ride they lead that the stint ends during; and, for a voted
 * President cover, the chapter's uncast NEC ballots that wait while it runs (11.2). `voted` says
 * whether the stint goes through a board vote; left out, a cover is voted when acting there needs a vote.
 */
export function actingWarnings(
  target: Member, chapterId: string, role: PositionRole, covers: Position | null, until: string, raw: ClubData, today: string, voted?: boolean,
): string[] {
  const data = settleActing(raw, today);
  const out: string[] = [];
  const board = isBoardRole(role);
  const onBoard = holdsBoardSeat(target.id, chapterId, data.positions);
  const vpForPresident = role === 'president' && isSittingVp(target.id, chapterId, data.positions);
  if (board) out.push(ACTING_FAMILY);
  if (board && covers === null && !onBoard && twoYearsShort(target, today)) out.push(BOARD_TWO_YEARS);
  if (covers === null && (role === 'vice_president' || (role === 'president' && !vpForPresident)) && !servedTerm(target.id, role, data, today)) {
    out.push(SERVED_TERM_FIRST);
  }
  if (covers !== null) out.push(ACTING_LICENCE_VACANCY);
  if (board && onBoard && !vpForPresident) out.push(ACTING_COMBINED);
  for (const spot of data.crew ?? []) {
    if (spot.memberId !== target.id) continue;
    const ride = data.rides.find((r) => r.id === spot.rideId);
    if (!ride || ride.cancelledAt !== null) continue;
    const starts = melbourneDate(ride.startsAt);
    const ends = melbourneDate(ride.endsAt ?? ride.startsAt);
    if (starts <= until && (starts === until || ends > until)) out.push(actingRideWarning(displayName(target), starts, later(addDays(starts, 1), ends)));
  }
  if (covers !== null && role === 'president' && (voted ?? actingNeedsVote(target.id, chapterId, role, data, today))) {
    const waiting = uncastNecBallots(chapterId, data);
    const chapter = data.chapters.find((c) => c.id === chapterId)?.name ?? chapterId;
    if (waiting > 0) out.push(necBallotsWait(chapter, waiting));
  }
  return out;
}
