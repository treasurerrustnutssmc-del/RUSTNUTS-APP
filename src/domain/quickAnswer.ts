// One-tap answers on the Home "Next ride" card. They are offered only when every check the ride
// screen makes for Going passes (the ride takes answers, the Road Rules are signed, the Big 4 rules
// allow it). Otherwise the card just opens the ride, where the reason is shown.
import { big4GoingProblem } from './big4';
import { goingProblem } from './roadRules';
import { rsvpProblem } from './rides';
import type { ClubData, Member, Ride } from './types';

/**
 * Why the one-tap answers are not offered on this ride, in the same words the ride screen uses, or
 * null when they are. Order matches the ride screen: the ride first, then the Road Rules, then Big 4.
 */
export function quickAnswerReason(me: Member | null, ride: Ride, data: ClubData, today: string, nowIso: string): string | null {
  return (
    rsvpProblem(me, ride, nowIso) ??
    goingProblem(me, 'going', data, today) ??
    big4GoingProblem(me, ride.id, 'going', data, today)
  );
}

export function canQuickAnswer(me: Member | null, ride: Ride, data: ClubData, today: string, nowIso: string): boolean {
  return quickAnswerReason(me, ride, data, today, nowIso) === null;
}
