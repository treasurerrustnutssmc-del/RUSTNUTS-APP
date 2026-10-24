// Ride briefings: the Road Captain's hazards, one-off changes and notes for a ride, and who has
// read them. These are the rules the database's save_briefing and read_briefing actions apply, in
// the same order with the same words, so the app never offers what the server would refuse.

import { byName, managesRide, spotOf } from './crew';
import { endOfFirstDay } from './rides';
import { signedInProblem } from './routes';
import type { Briefing, ClubData, Member, Ride } from './types';

/** The most hazard lines a briefing holds, after blank ones are dropped. */
export const MAX_HAZARDS = 12;
/** The longest a hazard line can be, in characters (code points). */
export const MAX_HAZARD = 120;
/** The longest the changes, or the notes, can be, in characters (code points). */
export const MAX_TEXT = 2000;

/** Refusals the screens and demo also show, in the database's words. */
export const NO_RIDE = 'No such ride.';
export const RIDE_CANCELLED = 'That ride was cancelled.';
export const BRIEFING_LOCKED = 'The briefing can’t change after the ride day.';
export const NOT_WRITER = 'Only the board, ride committee or this ride’s Road Captain can write the briefing.';
export const TOO_MANY_HAZARDS = 'That’s too many hazards (12 at most).';
export const HAZARD_TOO_LONG = 'Keep each hazard to one short line (120 characters at most).';
export const TEXT_TOO_LONG = 'That’s too long (2000 characters at most).';
export const BRIEFING_EMPTY = 'Write at least one hazard, change or note.';
export const NO_BRIEFING = 'There’s no briefing for this ride yet.';

/** Who to call when something goes wrong, first to last (constitution 7.6). Printed on every card. */
export const SAFETY_ORDER = ['Road Captain', 'Sergeant-at-Arms', 'Vice President', 'President', 'NEC'] as const;
/** The spec's name for the same list. */
export const safetyOrder = SAFETY_ORDER;

/** What a writer types: hazard lines, the changes for this ride, and notes. */
export interface BriefingInput {
  hazards: string[];
  changes: string;
  notes: string;
}

/** Counted in characters (code points), as the database's char_length does, so an emoji is one. */
const length = (s: string): number => [...s].length;

/** The briefing as it is saved: every text trimmed, and blank hazard lines dropped. */
export function cleanBriefing(input: BriefingInput): BriefingInput {
  return {
    hazards: input.hazards.map((h) => h.trim()).filter((h) => h !== ''),
    changes: input.changes.trim(),
    notes: input.notes.trim(),
  };
}

/**
 * Who can write this ride's briefing: the people who run its crew (`managesRide`), plus whoever
 * holds this ride's Road Captain crew spot, board seat or not.
 */
export function writesBriefing(me: Member | null, ride: Ride, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  return managesRide(me, ride, data) || spotOf(ride.id, me.id, data.crew) === 'road_captain';
}

/** Why `me` can't save this briefing, or null when they can. Mirrors public.save_briefing. */
export function saveBriefingProblem(
  me: Member | null,
  ride: Ride | undefined,
  input: BriefingInput,
  data: ClubData,
  now: string,
): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return NO_RIDE;
  if (ride.cancelledAt) return RIDE_CANCELLED;
  if (new Date(now).getTime() >= endOfFirstDay(ride)) return BRIEFING_LOCKED;
  if (!writesBriefing(me, ride, data)) return NOT_WRITER;
  const { hazards, changes, notes } = cleanBriefing(input);
  if (hazards.length > MAX_HAZARDS) return TOO_MANY_HAZARDS;
  if (hazards.some((h) => length(h) > MAX_HAZARD)) return HAZARD_TOO_LONG;
  if (length(changes) > MAX_TEXT || length(notes) > MAX_TEXT) return TEXT_TOO_LONG;
  if (hazards.length === 0 && changes === '' && notes === '') return BRIEFING_EMPTY;
  return null;
}

/**
 * Why `me` can't tap Got it on this ride, or null when they can. Mirrors public.read_briefing.
 * It works at any time, on a cancelled or past ride too, so it takes no clock.
 */
export function readBriefingProblem(me: Member | null, ride: Ride | undefined, data: ClubData): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return NO_RIDE;
  if (!briefingOf(ride.id, data)) return NO_BRIEFING;
  return null;
}

/** The briefing a ride has, if any. */
export function briefingOf(rideId: string, data: ClubData): Briefing | undefined {
  return (data.briefings ?? []).find((b) => b.rideId === rideId);
}

/** Whether a read was made at or after the briefing's last change. Equal counts as current. */
function isCurrent(readAt: string, briefing: Briefing): boolean {
  return Date.parse(readAt) >= Date.parse(briefing.updatedAt);
}

/**
 * Where `me` stands with a ride's briefing: 'none' (no briefing, or not read), 'current', or
 * 'stale' (read, but the briefing changed since).
 */
export function readState(me: Member | null, rideId: string, data: ClubData): 'none' | 'current' | 'stale' {
  const briefing = briefingOf(rideId, data);
  if (!me || !briefing) return 'none';
  const mine = (data.briefingReads ?? []).find((r) => r.rideId === rideId && r.memberId === me.id);
  if (!mine) return 'none';
  return isCurrent(mine.readAt, briefing) ? 'current' : 'stale';
}

/** The members whose answer to this ride is Going. */
function goingMembers(ride: Ride, data: ClubData): Member[] {
  const going = new Set(data.rsvps.filter((r) => r.rideId === ride.id && r.answer === 'going').map((r) => r.memberId));
  return data.members.filter((m) => going.has(m.id));
}

/** “6 of 9 going have read it”: the Going riders, and how many of them have a current read. */
export function readCount(ride: Ride, data: ClubData): { read: number; going: number } {
  const going = goingMembers(ride, data);
  return { read: going.filter((m) => readState(m, ride.id, data) === 'current').length, going: going.length };
}

/** The Going riders who haven't read the briefing, or whose read is out of date, by name. */
export function unreadGoing(ride: Ride, data: ClubData): Member[] {
  if (!briefingOf(ride.id, data)) return [];
  return goingMembers(ride, data)
    .filter((m) => readState(m, ride.id, data) !== 'current')
    .sort(byName);
}
