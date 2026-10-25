// Who can see and do what. The same rules are enforced by the database
// (row-level security in supabase/migrations), so the app can never show
// more than the server would hand over.

import { BOARD_ROLES, NATIONAL_ROLES, TITLE_ROLES } from './labels';
import { addMonths } from './profile';
import { melbourneDate } from './rides';
import { addDays } from './dates';
import type { ClubData, Member, MemberStatus, Position, PositionRole } from './types';

export type AccessLevel = 'public' | 'pending' | 'member' | 'board' | 'national';

export const LEVEL_RANK: Record<AccessLevel, number> = {
  public: 0,
  pending: 1,
  member: 2,
  board: 3,
  national: 4,
};

export function activePositions(memberId: string, positions: Position[]): Position[] {
  return positions.filter((p) => p.memberId === memberId && p.endedOn === null);
}

/** Holds an executive board seat in this chapter. */
export function holdsBoardSeat(memberId: string, chapterId: string, positions: Position[]): boolean {
  return activePositions(memberId, positions).some(
    (p) => p.chapterId === chapterId && BOARD_ROLES.includes(p.role),
  );
}

/** Sits on the National Executive Committee: a national role, or any sitting chapter President. */
export function isNational(memberId: string, positions: Position[]): boolean {
  return activePositions(memberId, positions).some(
    (p) => NATIONAL_ROLES.includes(p.role) || p.role === 'president',
  );
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
  if (isNational(viewer.id, positions)) return 'national';
  const board = activePositions(viewer.id, positions).some((p) => BOARD_ROLES.includes(p.role));
  return board ? 'board' : 'member';
}

/** Board of that chapter, or anyone on the NEC. */
export function isBoardOf(viewer: Member | null, chapterId: string, positions: Position[]): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  return holdsBoardSeat(viewer.id, chapterId, positions) || isNational(viewer.id, positions);
}

function isApprovedMember(viewer: Member | null): viewer is Member {
  return !!viewer && viewer.approval === 'approved';
}

export function canSeeDirectory(viewer: Member | null): boolean {
  return isApprovedMember(viewer);
}

/** Pending applicants are visible to their own chapter board only. */
export function canSeeMember(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer) return false;
  if (viewer.id === target.id) return true;
  if (target.approval === 'approved') return isApprovedMember(viewer);
  return isBoardOf(viewer, target.chapterId, positions);
}

/** Phone number: self, chapter board, or any member when the target chose to share it. */
export function canSeePhone(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer) return false;
  if (viewer.id === target.id || isBoardOf(viewer, target.chapterId, positions)) return true;
  return isApprovedMember(viewer) && target.approval === 'approved' && target.sharePhone;
}

/** Email, licence, first aid, regos, emergency contacts: self and chapter board only. */
export function canSeePrivate(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer) return false;
  return viewer.id === target.id || isBoardOf(viewer, target.chapterId, positions);
}

export function canApprove(viewer: Member | null, applicant: Member, positions: Position[]): boolean {
  return applicant.approval === 'pending' && isBoardOf(viewer, applicant.chapterId, positions);
}

/** Board can change an approved member's status, but nobody can change their own. */
export function canManageMember(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer || viewer.id === target.id || target.approval !== 'approved') return false;
  return isBoardOf(viewer, target.chapterId, positions);
}

/** National Chairman, Secretary or Auditor. Sitting Presidents are on the NEC but are not officers. */
export function isNecOfficer(memberId: string, positions: Position[]): boolean {
  return activePositions(memberId, positions).some((p) => NATIONAL_ROLES.includes(p.role));
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
      if (!isNecOfficer(me.id, data.positions)) return 'Only the National Chairman, Secretary or Auditor can seat a President.';
    } else if (!isBoardOf(me, seatChapter, data.positions)) {
      return 'Only that chapter’s board can appoint here.';
    }
  }
  const unfit = holdProblem(target, role, data.positions);
  if (unfit) return unfit;
  const open = data.positions.filter((p) => p.endedOn === null && p.role === role && p.chapterId === seatChapter);
  if (open.some((p) => p.memberId === target.id)) return 'They already hold that role.';
  if ((BOARD_ROLES.includes(role) || national) && open.length > 0) return 'That seat is taken. End the current term first.';
  return null;
}

const patched = (status: MemberStatus) => status === 'full' || status === 'nomad';
const SEAT_ROLES: PositionRole[] = [...BOARD_ROLES, ...NATIONAL_ROLES];

/**
 * Whether `target` may hold `role` (constitution v4): only Full and Nomad members hold Club
 * positions (4.6, 5.8); Nomads hold Non-Board roles only (9.1); the National Auditor can't also
 * be a President or Treasurer (11.8). Mirrors private.hold_problem.
 */
function holdProblem(target: Member, role: PositionRole, positions: Position[]): string | null {
  if (!patched(target.status)) return 'Only Full and Nomad members hold Club positions (4.6, 5.8).';
  if (target.status === 'nomad' && SEAT_ROLES.includes(role)) return 'Nomads can’t hold a board or national seat (9.1).';
  const holds = (roles: PositionRole[]) => activePositions(target.id, positions).some((p) => roles.includes(p.role));
  if ((role === 'nec_auditor' && holds(['president', 'treasurer'])) || ((role === 'president' || role === 'treasurer') && holds(['nec_auditor']))) {
    return 'The National Auditor can’t also be a President or Treasurer (11.8).';
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
    (v) => v.subjectMemberId === memberId && v.electorate === 'chapter_patched' && v.closedAt !== null && v.result === 'carried' && (since === null || melbourneDate(v.openedAt) >= since),
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
    (v) => v.subjectMemberId === memberId && v.electorate === 'nec' && v.closedAt !== null && v.result === 'carried' && melbourneDate(v.closedAt) >= since,
  );
}

export const NEEDS_NEC_VOTE = 'Coming back to Full or Nomad needs a carried NEC vote (5.6).';
export const NEEDS_PATCH_VOTE = 'Full membership needs a carried patch vote of the chapter’s Full Members (4.9).';

/**
 * Why `me` can't move `target` to `status`, or null. Mirrors the database's set_member_status.
 * An FNG reaches Full or Nomad only through a carried patch vote (4.9); anyone else coming back
 * to Full or Nomad needs a carried NEC vote (5.6), and then the NEC makes the change. Positions
 * end first when the new status can't hold them. `today` is the Melbourne date.
 */
export function statusChangeProblem(me: Member | null, target: Member, status: MemberStatus, data: ClubData, today: string): string | null {
  if (me?.id === target.id) return 'You can’t change your own status.';
  if (!isBoardOf(me, target.chapterId, data.positions)) return 'Only that chapter’s board can change this member’s status.';
  if (target.approval !== 'approved') return 'Approve them first.';
  if (patched(status) && !patched(target.status)) {
    if (target.status === 'fng') {
      if (!hasCarriedPatchVote(target.id, data)) return NEEDS_PATCH_VOTE;
    } else if (!isNational(me!.id, data.positions)) {
      return 'Only the NEC can bring someone back to Full or Nomad (5.6).';
    } else if (!hasCarriedReinstateVote(target.id, data, today)) {
      return NEEDS_NEC_VOTE;
    }
  }
  if (status === 'fng' && isLearner(target.id, data)) return LEARNER_FNG;
  const held = activePositions(target.id, data.positions).filter((p) => !TITLE_ROLES.includes(p.role));
  if (!patched(status) && held.length > 0) return 'End their positions first.';
  if (status === 'nomad' && held.some((p) => SEAT_ROLES.includes(p.role))) return 'End their board and national seats first (9.1).';
  return null;
}

/** Why `me` can't end this term, or null when they can. Mirrors the database's end_position. */
export function endTermProblem(me: Member | null, position: Position, data: ClubData): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  if (position.endedOn !== null) return 'That term has already ended.';
  if (TITLE_ROLES.includes(position.role)) return HONOUR_BY_ADMIN;
  if (position.memberId === me.id) return 'You can’t end your own term.';
  if (NATIONAL_ROLES.includes(position.role) || position.chapterId === null) {
    if (position.role === 'nec_chair') return CHAIR_BY_VOTE;
    return isChairman(me.id, data.positions) ? null : 'Only the National Chairman can end a national role.';
  }
  if (position.role === 'president') {
    return isNecOfficer(me.id, data.positions)
      ? null
      : 'Only the National Chairman, Secretary or Auditor can end a President’s term.';
  }
  return isBoardOf(me, position.chapterId, data.positions) ? null : 'Only that chapter’s board can end this term.';
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
