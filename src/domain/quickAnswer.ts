// One-tap answers on the Home "Next ride" card. They are offered only when every check the ride
// screen makes for Going passes (the ride takes answers, the Road Rules are signed, the Big 4 rules
// allow it). Otherwise the card just opens the ride, where the reason is shown.
import { big4GoingProblem } from './big4';
import { goingProblem } from './roadRules';
import { rsvpProblem } from './rides';
import type { ClubData, Member, Ride } from './types';

export function canQuickAnswer(me: Member | null, ride: Ride, data: ClubData, today: string, nowIso: string): boolean {
  return (
    rsvpProblem(me, ride, nowIso) === null &&
    goingProblem(me, 'going', data, today) === null &&
    big4GoingProblem(me, ride.id, 'going', data, today) === null
  );
}
