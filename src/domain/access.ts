// Who can see and do what. The same rules are enforced by the database
// (row-level security in supabase/migrations), so the app can never show
// more than the server would hand over.

import { BOARD_ROLES, NATIONAL_ROLES } from './labels';
import type { ClubData, Member, Position } from './types';

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

/** Board can change a member's status, but nobody can change their own. */
export function canManageMember(viewer: Member | null, target: Member, positions: Position[]): boolean {
  if (!viewer || viewer.id === target.id) return false;
  return isBoardOf(viewer, target.chapterId, positions);
}

/** Chapter positions are set by that chapter's board; national roles by the NEC. */
export function canAssignRole(
  viewer: Member | null,
  chapterId: string | null,
  positions: Position[],
): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  if (chapterId === null) return isNational(viewer.id, positions);
  return isBoardOf(viewer, chapterId, positions);
}

export function visibleMembers(viewer: Member | null, data: ClubData): Member[] {
  return data.members.filter((m) => canSeeMember(viewer, m, data.positions));
}

export function pendingFor(viewer: Member | null, data: ClubData): Member[] {
  return data.members.filter((m) => canApprove(viewer, m, data.positions));
}
