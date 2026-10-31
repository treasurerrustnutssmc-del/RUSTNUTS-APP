// Who can see and do what. The same rules are enforced by the database
// (row-level security in supabase/migrations), so the app can never show
// more than the server would hand over.

import { BOARD_ROLES, NATIONAL_ROLES, TITLE_ROLES } from './labels';
import { addMonths } from './profile';
import { melbourneDate } from './rides';
import { addDays } from './dates';
import { termState } from './terms';
import type { ClubData, Member, MemberStatus, NecSeatRole, Position, PositionRole, StatusNotice } from './types';

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

export function activePositions(memberId: string, positions: Position[]): Position[] {
  return positions.filter((p) => p.memberId === memberId && p.endedOn === null);
}

/** Holds an executive board seat in this chapter. */
export function holdsBoardSeat(memberId: string, chapterId: string, positions: Position[]): boolean {
  return activePositions(memberId, positions).some(
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

/** Sits on the National Executive Committee: the Chairman, the Secretary, or any sitting chapter President. */
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
  const board = activePositions(viewer.id, positions).some((p) => BOARD_ROLES.includes(p.role));
  return board ? 'board' : 'member';
}

/**
 * Sees a chapter's board records (private details, conduct, notices, attendance): a seated board
 * member of that chapter, or anyone national. Mirrors private.sees_board_of.
 */
export function seesBoardOf(viewer: Member | null, chapterId: string, positions: Position[]): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  return holdsBoardSeat(viewer.id, chapterId, positions) || isNational(viewer.id, positions);
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

/**
 * Why `me` can't appoint `target` to `role`, or null when they can. The database's
 * appoint_position action applies exactly the same rules.
 */
export function appointProblem(
  me: Member | null,
  target: Member,
  chapterId: string | null,
  role: PositionRole,
  data: ClubData,
  today: string = melbourneDate(new Date().toISOString()),
): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  if (TITLE_ROLES.includes(role)) return HONOUR_BY_ADMIN;
  if (me.id === target.id) return 'You can’t appoint yourself.';
  if (target.approval !== 'approved') return 'Approve them first.';
  if (target.status === 'legacy') return 'Legacy members don’t hold positions.';
  const national = NATIONAL_ROLES.includes(role);
  const seatChapter = national ? null : chapterId;
  if (national) {
    if (role === 'nec_chair') return CHAIR_BY_VOTE;
    if (!isChairman(me.id, data.positions)) return 'Only the National Chairman hands out national roles.';
  } else {
    if (!seatChapter || seatChapter !== target.chapterId) return 'They’re not a member of that chapter.';
    if (role === 'president') {
      if (!isNecOfficer(me.id, data.positions)) return 'Only the National Chairman or Secretary can seat a President.';
    } else if (!isBoardOf(me, seatChapter, data.positions)) {
      return 'Only that chapter’s board can appoint here.';
    }
  }
  const unfit = holdProblem(target, role, data.positions);
  if (unfit) return unfit;
  const open = data.positions.filter((p) => p.endedOn === null && p.role === role && p.chapterId === seatChapter);
  if (open.some((p) => p.memberId === target.id)) return 'They already hold that role.';
  if ((BOARD_ROLES.includes(role) || national) && open.length > 0) return 'That seat is taken. End the current term first.';
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
 * NEC (11.2, 11.8). Mirrors private.hold_problem.
 */
function holdProblem(target: Member, role: PositionRole, positions: Position[]): string | null {
  if (!patched(target.status)) return 'Only Full and Nomad members hold Club positions (4.6, 5.8).';
  if (target.status === 'nomad' && SEAT_ROLES.includes(role)) return 'Nomads can’t hold a board or national seat (9.1).';
  const holds = (roles: PositionRole[]) => activePositions(target.id, positions).some((p) => roles.includes(p.role));
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
 * full term in another board seat before President or Vice President (9.4).
 */
export function appointWarnings(target: Member, role: PositionRole, data: ClubData, today: string): string[] {
  if (!BOARD_ROLES.includes(role)) return [];
  const warnings: string[] = [];
  if (target.patchedOn !== null && addMonths(target.patchedOn, 24) > today) {
    warnings.push('Board nominees need two years as a Full Member, unless the NEC waived it or they’re a founding officer (9.1).');
  }
  if (role === 'president' || role === 'vice_president') {
    const servedTerm = data.positions.some(
      (p) => p.memberId === target.id && p.role !== role && BOARD_ROLES.includes(p.role) && addMonths(p.startedOn, 24) <= (p.endedOn ?? today),
    );
    if (!servedTerm) {
      warnings.push('A President or Vice President should have served a full term in another board seat, unless they’re a founding officer or the NEC gave an exemption (9.4).');
    }
  }
  return warnings;
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
export const SUPPORTER_NEEDS_NOTICE = 'Moving them to Supporter follows a 5.5 notice the board has decided in the last 90 days, unless it’s at their request.';
/** How long a decided 5.5 notice stays good for a move to Supporter (inferred, as for the votes). */
export const NOTICE_DAYS = 90;
/** The statuses a move to Supporter is gated for: the people who'd lose something (5.5). */
export const GATED_TO_SUPPORTER: MemberStatus[] = ['fng', 'full', 'nomad'];

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
 * end first when the new status can't hold them. Moving an FNG, Full Member or Nomad to Supporter
 * follows a decided 5.5 notice unless `byRequest` records that the member asked for it. `today` is
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
  const held = activePositions(target.id, data.positions).filter((p) => !TITLE_ROLES.includes(p.role));
  if (!patched(status) && held.length > 0) return 'End their positions first.';
  if (status === 'nomad' && held.some((p) => SEAT_ROLES.includes(p.role))) return 'End their board and national seats first (9.1).';
  if (status === 'supporter' && GATED_TO_SUPPORTER.includes(target.status) && !byRequest && !decidedNoticeFor(target.id, data, today)) {
    return SUPPORTER_NEEDS_NOTICE;
  }
  return null;
}

/** How long a carried removal vote stays good for (inferred, as for the other votes about members). */
export const REMOVAL_VOTE_DAYS = 90;
export const ROLE_NEEDS_VOTE = 'Ending someone’s chapter role needs a carried majority vote of the chapter board in the last 90 days (9.3).';
export const BOARD_SEAT_NEEDS_VOTE = 'Removing a board member needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
export const PRESIDENT_NEEDS_VOTE = 'Removing a President needs a carried two-thirds vote of the chapter’s Full Members in the last 90 days (9.3).';
export const PRESIDENT_ENDED_BY = 'Only that chapter’s board or the National Chairman or Secretary can end a President’s term.';

/**
 * The chapter voted, in the last 90 days and since this term began, to remove its holder (9.3): the
 * chapter's vote naming the holder and the role, in the shape the role takes (two-thirds of the
 * chapter's Full Members for a board seat, a board majority otherwise). Mirrors private.has_carried_removal_vote.
 */
export function hasCarriedRemovalVote(position: Position, data: ClubData, today: string): boolean {
  const since = addDays(today, -REMOVAL_VOTE_DAYS);
  const boardSeat = BOARD_ROLES.includes(position.role);
  return (data.votes ?? []).some(
    (v) => v.subjectMemberId === position.memberId && v.subjectRole === position.role && v.chapterId === position.chapterId
      && v.electorate === (boardSeat ? 'chapter_patched' : 'chapter_board') && v.threshold === (boardSeat ? 'two_thirds' : 'majority')
      && v.closedAt !== null && v.result === 'carried'
      && melbourneDate(v.closedAt) >= since && melbourneDate(v.closedAt) >= position.startedOn,
  );
}

/**
 * Why `me` can't end this term, or null when they can. Mirrors the database's end_position. Anyone
 * steps down from their own role. Ending someone else's chapter term follows a carried removal vote
 * (9.3), recorded by the chapter board (for a President, an NEC officer can too); national seats
 * stay the Chairman's to end. `today` is the Melbourne date.
 */
export function endTermProblem(me: Member | null, position: Position, data: ClubData, today: string): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  if (position.endedOn !== null) return 'That term has already ended.';
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
  if (!isBoardOf(me, position.chapterId, data.positions)) return 'Only that chapter’s board can end this term.';
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
