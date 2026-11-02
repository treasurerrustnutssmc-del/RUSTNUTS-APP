// Delete my account (both app stores require it). The database's delete_my_account() refuses with
// the same words.

import { activePositions, endTermProblem } from './access';
import { BOARD_ROLES, NATIONAL_ROLES } from './labels';
import type { ClubData, Member, Position } from './types';

/** The name a deleted account leaves on the club's records (books, minutes, votes, attendance). */
export const FORMER_MEMBER = 'Former member';

export const STEP_DOWN_FIRST = 'Step down from your seat first, so the club can fill it. Then you can delete your account.';

/** Why `me` can't delete their account now, or null when they can. A board or national seat comes first. */
export function deleteAccountProblem(me: Member | null, positions: Position[]): string | null {
  if (!me) return 'Sign in first.';
  const seats = [...BOARD_ROLES, ...NATIONAL_ROLES];
  if (activePositions(me.id, positions).some((p) => seats.includes(p.role))) return STEP_DOWN_FIRST;
  return null;
}

export interface SeatToStepDown {
  position: Position;
  /** They can end it themselves, with the same step-down as on their member page. */
  selfEnd: boolean;
  /** When they can't: who has to record the change. */
  note: string | null;
}

/** The seats that stop `me` deleting their account, each with whether they can step down from it
 *  here (the term rules in access.ts decide) or who has to record the change instead. */
export function stepDownSeats(me: Member | null, data: ClubData, today: string): SeatToStepDown[] {
  if (!me) return [];
  const seats = [...BOARD_ROLES, ...NATIONAL_ROLES];
  return activePositions(me.id, data.positions)
    .filter((p) => seats.includes(p.role))
    .map((position) => {
      const note = endTermProblem(me, position, data, today);
      return { position, selfEnd: note === null, note };
    });
}
