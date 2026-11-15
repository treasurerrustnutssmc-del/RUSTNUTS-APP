// Delete my account (both app stores require it). The database's delete_my_account() refuses with
// the same words.

import { endTermProblem } from './access';
import { heldPositions, isActing } from './acting';
import { BOARD_ROLES, NATIONAL_ROLES } from './labels';
import type { ClubData, Member, Position } from './types';

/** The name a deleted account leaves on the club's records (books, minutes, votes, attendance). */
export const FORMER_MEMBER = 'Former member';

export const STEP_DOWN_FIRST = 'Step down from your seat first, so the club can fill it. Then you can delete your account.';
/** The Chairman can't step down in the app (the seat changes by the club's vote), so email instead. */
export const CHAIR_EMAILS_US = 'The National Chairman’s seat changes by the club’s vote. To delete your account, email apps@rustnutssmc.com.au.';

const SEATS = [...BOARD_ROLES, ...NATIONAL_ROLES];
/** A row that stops a delete: a board or national seat (covered or not), or acting in any role. */
const blocksDelete = (p: Position) => SEATS.includes(p.role) || isActing(p);

/** Why `me` can't delete their account now, or null when they can. A board or national seat, or a stint, comes first. */
export function deleteAccountProblem(me: Member | null, positions: Position[]): string | null {
  if (!me) return 'Sign in first.';
  const mine = heldPositions(me.id, positions);
  if (mine.some((p) => p.role === 'nec_chair')) return CHAIR_EMAILS_US;
  if (mine.some(blocksDelete)) return STEP_DOWN_FIRST;
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
  return heldPositions(me.id, data.positions)
    .filter(blocksDelete)
    .map((position) => {
      const note = endTermProblem(me, position, data, today);
      return { position, selfEnd: note === null, note };
    });
}
