// Ride briefings: the Road Captain's hazards, one-off changes and notes for a ride, and who has
// read them. These are the rules the database's save_briefing and read_briefing actions apply, in
// the same order with the same words, so the app never offers what the server would refuse.

import { byName, crewFor, managesRide, spotOf } from './crew';
import { formatAuDate } from './dates';
import { displayName, memberName } from './profile';
import { endOfFirstDay, melbourneDate, melbourneTime } from './rides';
import { signedInProblem } from './routes';
import type { Briefing, ClubData, CrewRole, Member, Ride } from './types';

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
export const READ_OUTDATED = 'The briefing changed while you had it open. Read the new version, then tap Got it.';
export const SAVE_CONFLICT =
  'Someone else saved this briefing while you were editing. Your changes aren’t saved: copy them, then open the briefing again.';

/** The card's notice when a newer briefing arrives while it's open. */
export const BRIEFING_UPDATED = 'The RC updated this briefing while you had it open.';

/** Who to call when something goes wrong, first to last (constitution 7.6). Printed on every card. */
export const SAFETY_ORDER = ['Road Captain', 'Sergeant-at-Arms', 'Vice President', 'President', 'NEC'] as const;

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

/**
 * Whether the stored briefing is newer than the version someone had on screen (`seen`, its
 * `updatedAt` then, or null for none). The app holds milliseconds and the database microseconds,
 * so up to 1 ms newer still counts as the same version.
 */
function newerThan(briefing: Briefing, seen: string | null): boolean {
  return seen === null || Date.parse(briefing.updatedAt) > Date.parse(seen) + 1;
}

/**
 * Why `me` can't save this briefing, or null when they can. Mirrors public.save_briefing. `seen`
 * is the version the editor opened on (null when there was no briefing yet): a save on top of
 * someone else's newer one is refused, so it never quietly replaces it.
 */
export function saveBriefingProblem(
  me: Member | null,
  ride: Ride | undefined,
  input: BriefingInput,
  data: ClubData,
  now: string,
  seen: string | null,
): string | null {
  const editing = editBriefingProblem(me, ride, data, now);
  if (editing) return editing;
  const stored = ride ? briefingOf(ride.id, data) : undefined;
  if (stored && newerThan(stored, seen)) return SAVE_CONFLICT;
  const { hazards, changes, notes } = cleanBriefing(input);
  if (hazards.length > MAX_HAZARDS) return TOO_MANY_HAZARDS;
  if (hazards.some((h) => length(h) > MAX_HAZARD)) return HAZARD_TOO_LONG;
  if (length(changes) > MAX_TEXT || length(notes) > MAX_TEXT) return TEXT_TOO_LONG;
  if (hazards.length === 0 && changes === '' && notes === '') return BRIEFING_EMPTY;
  return null;
}

/**
 * Why `me` can't write or edit this ride's briefing right now, whatever they type: the first six
 * of the save checks (sign in, approved, the ride, cancelled, the ride day, a writer). The screens
 * use it to decide whether to offer Write briefing and Edit.
 */
export function editBriefingProblem(me: Member | null, ride: Ride | undefined, data: ClubData, now: string): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return NO_RIDE;
  if (ride.cancelledAt) return RIDE_CANCELLED;
  if (new Date(now).getTime() >= endOfFirstDay(ride)) return BRIEFING_LOCKED;
  if (!writesBriefing(me, ride, data)) return NOT_WRITER;
  return null;
}

/**
 * Why `me` can't tap Got it on this ride, or null when they can. Mirrors public.read_briefing.
 * It works at any time, on a cancelled or past ride too, so it takes no clock. `seen` is the
 * version on screen: Got it on an older one is refused, so a read always means this version.
 */
export function readBriefingProblem(me: Member | null, ride: Ride | undefined, data: ClubData, seen: string | null): string | null {
  const opening = signedInProblem(me);
  if (opening) return opening;
  if (!ride) return NO_RIDE;
  const stored = briefingOf(ride.id, data);
  if (!stored) return NO_BRIEFING;
  if (newerThan(stored, seen)) return READ_OUTDATED;
  return null;
}

/** Whether an error is one of the two refusals that mean a newer briefing is waiting to be loaded. */
export function isVersionRefusal(e: unknown): boolean {
  return e instanceof Error && (e.message === READ_OUTDATED || e.message === SAVE_CONFLICT);
}

/**
 * What the card shows: the version it pinned when it opened (`pinned`), not whatever is stored now,
 * so the text never changes under a reader and Got it always means the version read. A different
 * stored version (more than the database's 1 ms apart) comes back as `update`, for the card to offer.
 * - Nothing pinned yet (the card opened before there was a briefing): the stored one is shown.
 * - Gone from the data: the pinned one stays.
 * - Saved by `meId` (a writer back from Edit): taken without asking, since they wrote it.
 * The screen pins `shown` each time.
 */
export function pinnedBriefing(
  pinned: Briefing | undefined,
  stored: Briefing | undefined,
  meId: string | null,
): { shown: Briefing | undefined; update: Briefing | null } {
  if (!pinned) return { shown: stored, update: null };
  if (!stored || Math.abs(Date.parse(stored.updatedAt) - Date.parse(pinned.updatedAt)) <= 1) return { shown: pinned, update: null };
  if (meId !== null && stored.updatedBy === meId) return { shown: stored, update: null };
  return { shown: pinned, update: stored };
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

// ---------------------------------------------------------------------------
// What the screens show
// ---------------------------------------------------------------------------

/** The card's "If something goes wrong" lines (constitution 7.6). */
export const SAFETY_LINE = `Safety calls, in order: ${SAFETY_ORDER.join(' → ')} (constitution 7.6).`;
export const STOPPED_RIDER = 'Stopped rider? The TG stops with them. An Officer takes the rear.';

/** A hazard line or text field that's over its limit once trimmed, so the form can mark it as you type. */
export const hazardTooLong = (line: string): boolean => length(line.trim()) > MAX_HAZARD;
export const textTooLong = (text: string): boolean => length(text.trim()) > MAX_TEXT;

/** A hazard as typed, kept to one line: any line breaks that get in (a paste, say) become one space. */
export const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ');

/** The ride screen's summary: the first hazard, and how many more there are. Null with no hazards. */
export function hazardSummary(hazards: string[]): { first: string; more: number } | null {
  return hazards.length === 0 ? null : { first: hazards[0], more: hazards.length - 1 };
}

/** "+2 more", or null when there are no more. */
export function moreLabel(more: number): string | null {
  return more > 0 ? `+${more} more` : null;
}

/** "6 of 9 going have read it". */
export function readCountLine({ read, going }: { read: number; going: number }): string {
  return going === 0 ? 'Nobody’s said Going yet' : `${read} of ${going} going have read it`;
}

/** "at 7:42 am" on the same Melbourne day as `now`, otherwise "on 24/10/2026 at 7:42 am". */
export function stampLine(iso: string, now: string): string {
  const day = melbourneDate(iso);
  const time = melbourneTime(iso);
  return day === melbourneDate(now) ? `at ${time}` : `on ${formatAuDate(day)} at ${time}`;
}

/** "You read this at 7:42 am". */
export function readLine(readAt: string, now: string): string {
  return `You read this ${stampLine(readAt, now)}`;
}

/** "Updated at 8:15 pm by Torque", leaving out who when they aren't known. */
export function updatedLine(briefing: Briefing, data: ClubData, now: string): string {
  const by = briefing.updatedBy ? data.members.find((m) => m.id === briefing.updatedBy) : undefined;
  return `Updated ${stampLine(briefing.updatedAt, now)}${by ? ` by ${displayName(by)}` : ''}`;
}

/**
 * The card's crew: each spot held, in the listed order (RC, TG, ATG, then Officers), with the
 * holder's name, and who carries first aid (the Tail Gunner), or null when there's no TG.
 */
export function briefingCrew(rideId: string, data: ClubData): { rows: { role: CrewRole; name: string }[]; firstAid: string | null } {
  const rows = crewFor(rideId, data.crew ?? []).map((s) => ({ role: s.role, name: memberName(s.memberId, data.members) }));
  return { rows, firstAid: rows.find((r) => r.role === 'tail_gunner')?.name ?? null };
}

/** What the edit form starts with: the briefing as it is, with at least one (empty) hazard line. */
export function editStart(briefing: Briefing | undefined): BriefingInput {
  const hazards = briefing?.hazards ?? [];
  return { hazards: hazards.length > 0 ? [...hazards] : [''], changes: briefing?.changes ?? '', notes: briefing?.notes ?? '' };
}
