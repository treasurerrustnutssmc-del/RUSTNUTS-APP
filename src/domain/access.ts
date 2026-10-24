// Who can see and do what. The same rules are enforced by the database
// (row-level security in supabase/migrations), so the app can never show
// more than the server would hand over.

import { BOARD_ROLES, NATIONAL_ROLES, TITLE_ROLES } from './labels';
import type { ClubData, Member, Position, PositionRole } from './types';

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
  const open = data.positions.filter((p) => p.endedOn === null && p.role === role && p.chapterId === seatChapter);
  if (open.some((p) => p.memberId === target.id)) return 'They already hold that role.';
  if ((BOARD_ROLES.includes(role) || national) && open.length > 0) return 'That seat is taken. End the current term first.';
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
