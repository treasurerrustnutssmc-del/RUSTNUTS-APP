// Crew swaps: a crew member asks someone to take their spot, or trade when the other already holds
// a spot on the ride, and the other accepts. These are the rules the database's ask_swap,
// answer_swap and withdraw_swap apply, in the same order with the same words.

import { eligibilityProblem } from './crew';
import { endOfFirstDay, melbourneDate } from './rides';
import { CREW_NOT_SIGNED, mustSignFirst } from './roadRules';
import { signedInProblem } from './routes';
import type { ClubData, CrewRole, CrewSwap, Member, Ride } from './types';

export const MAX_NOTE = 200;
export const NOT_ON_CREW = 'You’re not on this ride’s crew.';
export const PICK_SOMEONE_ELSE = 'Pick someone else.';
export const ALREADY_THAT_SPOT = 'They already have that spot.';
export const ALREADY_ASKED = 'You’ve already asked someone. Withdraw that first.';
export const NOTE_TOO_LONG = 'Keep the note to 200 characters at most.';
export const NO_SWAP = 'No such swap.';
export const NOT_FOR_YOU = 'That ask isn’t for you.';
export const ALREADY_ANSWERED = 'That ask has already been answered.';
export const CREW_CHANGED = 'The crew has changed since. Ask again.';
export const NOT_ASKER = 'Only whoever asked can withdraw it.';

const spot = (rideId: string, memberId: string, data: ClubData): CrewRole | null =>
  (data.crew ?? []).find((s) => s.rideId === rideId && s.memberId === memberId)?.role ?? null;

/** The ride checks every swap action starts with. */
function rideProblem(ride: Ride | undefined, now: string): string | null {
  if (!ride) return 'No such ride.';
  if (ride.cancelledAt) return 'That ride was cancelled.';
  if (Date.parse(now) >= endOfFirstDay(ride)) return 'The crew can’t change after the ride day.';
  return null;
}

/** Why `member` can't hold `role` on this ride: the crew checks, then the Road Rules as of now. */
function holdProblem(member: Member, role: CrewRole, ride: Ride, data: ClubData, now: string): string | null {
  return eligibilityProblem(member, role, ride, data) ?? (mustSignFirst(member, data, melbourneDate(now)) ? CREW_NOT_SIGNED : null);
}

/** Why `me` can't ask `targetId` to swap, or null when they can. Mirrors public.ask_swap. */
export function askSwapProblem(me: Member | null, ride: Ride | undefined, targetId: string, note: string, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me) ?? rideProblem(ride, now);
  if (opening) return opening;
  const mine = spot(ride!.id, me!.id, data);
  if (!mine) return NOT_ON_CREW;
  if (targetId === me!.id) return PICK_SOMEONE_ELSE;
  const target = data.members.find((m) => m.id === targetId);
  if (!target) return 'That member no longer exists.';
  const theirs = holdProblem(target, mine, ride!, data, now);
  if (theirs) return theirs;
  if (data.rsvps.some((r) => r.rideId === ride!.id && r.memberId === targetId && r.answer === 'no')) return 'They said they can’t make it.';
  const their = spot(ride!.id, targetId, data);
  if (their === mine) return ALREADY_THAT_SPOT;
  if (their) {
    const myOwn = holdProblem(me!, their, ride!, data, now);
    if (myOwn) return myOwn;
  }
  if ((data.crewSwaps ?? []).some((s) => s.rideId === ride!.id && s.askedBy === me!.id && s.state === 'asked')) return ALREADY_ASKED;
  if ([...note.trim()].length > MAX_NOTE) return NOTE_TOO_LONG;
  return null;
}

/** Whether the crew still matches the ask: the asker holds the spot, and the other holds what they held. */
export function swapIsCurrent(swap: CrewSwap, data: ClubData): boolean {
  return spot(swap.rideId, swap.askedBy, data) === swap.role && spot(swap.rideId, swap.askedTo, data) === swap.theirRole;
}

/** Why `me` can't answer this ask, or null. A no always closes an open ask. Mirrors public.answer_swap. */
export function answerSwapProblem(me: Member | null, swap: CrewSwap | undefined, yes: boolean, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!swap) return NO_SWAP;
  if (swap.askedTo !== me!.id) return NOT_FOR_YOU;
  if (swap.state !== 'asked') return ALREADY_ANSWERED;
  if (!yes) return null;
  const ride = data.rides.find((r) => r.id === swap.rideId);
  const riding = rideProblem(ride, now);
  if (riding) return riding;
  if (!swapIsCurrent(swap, data)) return CREW_CHANGED;
  const mine = holdProblem(me!, swap.role, ride!, data, now);
  if (mine) return mine;
  const asker = data.members.find((m) => m.id === swap.askedBy);
  if (swap.theirRole && asker) return holdProblem(asker, swap.theirRole, ride!, data, now);
  return null;
}

/** Why `me` can't withdraw this ask, or null. Mirrors public.withdraw_swap. */
export function withdrawSwapProblem(me: Member | null, swap: CrewSwap | undefined): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!swap) return NO_SWAP;
  if (swap.askedBy !== me!.id) return NOT_ASKER;
  if (swap.state !== 'asked') return ALREADY_ANSWERED;
  return null;
}

/** Open asks to `memberId` on rides whose day hasn't ended and whose crew still matches, oldest first. */
export function openAsksFor(memberId: string, data: ClubData, now: string): CrewSwap[] {
  return (data.crewSwaps ?? [])
    .filter((s) => s.askedTo === memberId && s.state === 'asked' && swapIsCurrent(s, data))
    .filter((s) => {
      const ride = data.rides.find((r) => r.id === s.rideId);
      return !!ride && !ride.cancelledAt && Date.parse(now) < endOfFirstDay(ride);
    })
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt));
}

/** `memberId`'s own open ask on this ride, if any. */
export function myOpenAsk(rideId: string, memberId: string, data: ClubData): CrewSwap | undefined {
  return (data.crewSwaps ?? []).find((s) => s.rideId === rideId && s.askedBy === memberId && s.state === 'asked');
}
