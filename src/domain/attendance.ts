// Check-ins at rides and meetings: who runs them, who can check in, and what's been attended.
// The database's open_checkin, check_in, mark_attendance and close_checkin actions apply the same
// rules with the same words.

import { isBoardOf, isNational, reviewsChapter } from './access';
import { heldPositions } from './acting';
import { BOARD_ROLES } from './labels';
import { melbourneDate } from './rides';
import type { Chapter, CheckinKind, CheckinSession, ClubData, MeetingType, Member, Position, Ride } from './types';

/** No 0/O, 1/I/L: easy to read off a phone held up at a servo. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
const QR_PREFIX = 'RUSTNUTS:';

/** What the QR code holds. */
export function qrPayload(code: string): string {
  return QR_PREFIX + code;
}

/** A code however it arrived: typed in lower case with spaces, or scanned with the prefix. */
export function normalizeCode(raw: string): string {
  const up = raw.toUpperCase().replace(/\s+/g, '');
  return up.startsWith(QR_PREFIX) ? up.slice(QR_PREFIX.length) : up;
}

export function newCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** A North or West ride belongs to that chapter; the rest are the whole club's. */
export function rideChapterId(ride: Ride, chapters: Chapter[]): string | null {
  if (ride.category !== 'north' && ride.category !== 'west') return null;
  return chapters.find((c) => c.slug === ride.category)?.id ?? null;
}

/** That chapter's board or the NEC; for a whole-club ride, any chapter's board (covered holders included). Mirrors private.can_run_checkin. */
export function canRunCheckin(viewer: Member | null, chapterId: string | null, positions: Position[]): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  if (chapterId !== null) return isBoardOf(viewer, chapterId, positions);
  return isNational(viewer.id, positions) || heldPositions(viewer.id, positions).some((p) => BOARD_ROLES.includes(p.role));
}

/** Approved members, and applicants still in their introduction phase (it's their meetings that count). */
export function canCheckIn(viewer: Member | null): boolean {
  if (!viewer) return false;
  if (viewer.approval === 'approved') return viewer.status !== 'family'; // Family view: no attendance
  return viewer.approval === 'pending' && viewer.status === 'introduced';
}

export interface OpenCheckinInput {
  kind: CheckinKind;
  rideId: string | null;
  chapterId: string | null;
  title: string;
  heldOn: string;
  /** A meeting's category; left out means ordinary. */
  meetingType?: MeetingType;
}

/** Ordinary monthly meetings, special or annual meetings, and other events (5.2, 5.4). */
export const MEETING_TYPES: MeetingType[] = ['ordinary', 'special', 'event'];

const RUN_ONLY = 'Only that chapter’s board can run this check-in.';

export function openCheckinProblem(me: Member | null, input: OpenCheckinInput, data: ClubData, today: string): string | null {
  if (!me) return 'Sign in first.';
  if (me.approval !== 'approved') return 'Only approved members can do that.';
  let chapterId = input.chapterId;
  if (input.kind === 'ride') {
    const ride = data.rides.find((r) => r.id === input.rideId);
    if (!ride) return 'No such ride.';
    if (ride.cancelledAt) return 'That ride was cancelled.';
    if ((data.checkinSessions ?? []).some((s) => s.rideId === ride.id)) return 'Check-in for this ride is already open.';
    chapterId = rideChapterId(ride, data.chapters);
  } else {
    if (!chapterId) return 'Pick a chapter.';
    if (!input.title.trim()) return 'Add a title.';
    if (input.heldOn < today) return 'Pick today or a later date.';
    if (input.meetingType !== undefined && !MEETING_TYPES.includes(input.meetingType)) return 'Pick what kind of meeting it is.';
  }
  if (!canRunCheckin(me, chapterId, data.positions)) return 'Only that chapter’s board can open a check-in.';
  return null;
}

/** Why `me` can't check in to this session today, or null. Checking in twice is fine (nothing happens). */
export function checkInProblem(me: Member | null, session: CheckinSession | undefined, today: string): string | null {
  if (!me) return 'Sign in first.';
  if (!canCheckIn(me)) return 'Only members and applicants can check in.';
  if (!session) return 'That code doesn’t match a check-in.';
  if (session.closedAt) return 'That check-in has closed.';
  if (session.heldOn !== today) return 'That check-in isn’t for today.';
  return null;
}

// ---------------------------------------------------------------------------
// "I'm here": the rider taps it, a ride leader or the board confirms it. Mirrors ask_check_in and
// answer_check_in. The code and QR stay as a backup.
// ---------------------------------------------------------------------------

/** A ride (its check-in opens itself if nobody has opened it yet), or an open check-in such as a meeting. */
export type CheckInAt = { rideId: string } | { sessionId: string };

/** The crew spots that lead a ride, and so confirm check-ins on it: one of each per ride. Not
 *  Officer, which anyone can take on the day. */
export const LEADING_CREW: readonly string[] = ['road_captain', 'tail_gunner', 'assistant_tail_gunner'];

function leadsRide(viewer: Member, session: CheckinSession, data: ClubData): boolean {
  if (viewer.approval !== 'approved' || viewer.status === 'family' || session.kind !== 'ride') return false;
  return (data.crew ?? []).some((c) => c.rideId === session.rideId && c.memberId === viewer.id && LEADING_CREW.includes(c.role));
}

/** Whoever runs the check-in, and on a ride its Road Captain, Tail Gunner and ATG. Mirrors private.can_confirm_checkin. */
export function canConfirmCheckin(viewer: Member | null, session: CheckinSession, data: ClubData): boolean {
  if (canRunCheckin(viewer, session.chapterId, data.positions)) return true;
  return !!viewer && leadsRide(viewer, session, data);
}

const ON_THE_DAY = 'You can only check in on the day.';

/** Why `me` can't say they're here, or null. */
export function askCheckInProblem(me: Member | null, at: CheckInAt, data: ClubData, today: string): string | null {
  if (!me) return 'Sign in first.';
  if (!canCheckIn(me)) return 'Only members and applicants can check in.';
  const sessions = data.checkinSessions ?? [];
  let session: CheckinSession | undefined;
  if ('rideId' in at) {
    const ride = data.rides.find((r) => r.id === at.rideId);
    if (!ride) return 'No such ride.';
    if (ride.cancelledAt) return 'That ride was cancelled.';
    session = sessions.find((s) => s.rideId === ride.id);
    if (!session) return melbourneDate(ride.startsAt) === today ? null : ON_THE_DAY;
  } else {
    session = sessions.find((s) => s.id === at.sessionId);
    if (!session) return 'That check-in no longer exists.';
  }
  if (session.closedAt) return 'That check-in has closed.';
  if (session.heldOn !== today) return ON_THE_DAY;
  return null;
}

/** What tapping "I'm here" does for `me`: checks them straight in if they run the check-in (as they
 *  could with the code), otherwise asks (the crew too: someone else confirms them); or nothing,
 *  when they're already in or already waiting. */
export function checkinAsk(me: Member, session: CheckinSession, data: ClubData): 'in' | 'ask' | 'already' | 'waiting' {
  if ((data.attendance ?? []).some((a) => a.sessionId === session.id && a.memberId === me.id)) return 'already';
  if (canRunCheckin(me, session.chapterId, data.positions)) return 'in';
  if ((data.checkinRequests ?? []).some((r) => r.sessionId === session.id && r.memberId === me.id)) return 'waiting';
  return 'ask';
}

/** Who's waiting to be confirmed at a check-in, first to ask first. */
export function waitingFor(sessionId: string, data: ClubData): Member[] {
  return (data.checkinRequests ?? [])
    .filter((r) => r.sessionId === sessionId)
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt))
    .flatMap((r) => data.members.filter((m) => m.id === r.memberId));
}

/** Why `me` can't confirm (or turn down) `memberId`'s "I'm here", or null. */
export function answerCheckinProblem(me: Member | null, session: CheckinSession | undefined, memberId: string, data: ClubData): string | null {
  if (!session) return 'That check-in no longer exists.';
  if (!canConfirmCheckin(me, session, data)) return 'Only the ride crew or the board can confirm check-ins.';
  if (me!.id === memberId) return 'Someone else has to confirm you.';
  if (session.closedAt) return 'That check-in has closed.';
  if (!canCheckIn(data.members.find((m) => m.id === memberId) ?? null)) return 'They can’t be checked in.';
  if (!(data.checkinRequests ?? []).some((r) => r.sessionId === session.id && r.memberId === memberId)) {
    return 'They’re not waiting to be confirmed.';
  }
  return null;
}

/** Ticking someone off (or un-ticking them) by hand, on the day or afterwards. */
export function markProblem(
  me: Member | null,
  session: CheckinSession,
  target: Member | undefined,
  data: ClubData,
  today: string,
): string | null {
  if (!canRunCheckin(me, session.chapterId, data.positions)) return RUN_ONLY;
  if (!target) return 'That member no longer exists.';
  // An applicant is only on their own chapter board's books.
  const tickable = target.approval === 'approved' || (canCheckIn(target) && isBoardOf(me, target.chapterId, data.positions));
  if (!tickable) return 'They can’t be checked in.';
  if (session.heldOn > today) return 'That check-in hasn’t started yet.';
  return null;
}

export function closeProblem(me: Member | null, session: CheckinSession, data: ClubData): string | null {
  if (!canRunCheckin(me, session.chapterId, data.positions)) return RUN_ONLY;
  if (session.closedAt) return 'That check-in is already closed.';
  return null;
}

/**
 * Whose meeting check-ins `viewer` sees: their own, as the member's chapter board (or a national
 * role), or as the Auditor. Ride check-ins are every approved member's (badges and ride walls are
 * built on them). Mirrors the attendance_read policy.
 */
export function canSeeAttendance(viewer: Member | null, target: Member, positions: Position[]): boolean {
  return !!viewer && (viewer.id === target.id || reviewsChapter(viewer, target.chapterId, positions));
}

/** Rides and meetings attended, by the date each was held: from `from`, up to `to` when given. */
export function attendanceCount(memberId: string, data: ClubData, from: string, to?: string): { rides: number; meetings: number } {
  const sessions = new Map((data.checkinSessions ?? []).map((s) => [s.id, s]));
  let rides = 0;
  let meetings = 0;
  for (const a of data.attendance ?? []) {
    if (a.memberId !== memberId) continue;
    const s = sessions.get(a.sessionId);
    if (!s || s.heldOn < from || (to !== undefined && s.heldOn > to)) continue;
    if (s.kind === 'ride') rides++;
    else meetings++;
  }
  return { rides, meetings };
}

/** Who checked in to a session, earliest first. */
export function attendeesOf(sessionId: string, data: ClubData): Member[] {
  return (data.attendance ?? [])
    .filter((a) => a.sessionId === sessionId)
    .sort((a, b) => a.checkedInAt.localeCompare(b.checkedInAt))
    .flatMap((a) => data.members.filter((m) => m.id === a.memberId));
}

/** What a check-in counts towards: a meeting's category (ordinary when it has none), or null for a ride. */
export function meetingTypeOf(session: CheckinSession): MeetingType | null {
  return session.kind === 'ride' ? null : (session.meetingType ?? 'ordinary');
}

export function isExcused(sessionId: string, memberId: string, data: ClubData): boolean {
  return (data.exemptions ?? []).some((e) => e.sessionId === sessionId && e.memberId === memberId);
}

/** Excused and didn't come after all: it drops out of their count. Turning up always counts. */
export function excusedAway(sessionId: string, memberId: string, data: ClubData): boolean {
  return isExcused(sessionId, memberId, data) && !attended(sessionId, memberId, data);
}

export function attended(sessionId: string, memberId: string, data: ClubData): boolean {
  return (data.attendance ?? []).some((a) => a.sessionId === sessionId && a.memberId === memberId);
}

/**
 * Why `me` can't excuse (a reason) or un-excuse (no reason) a member from a check-in, or null.
 * Their chapter's board does it (4.12, 5.3, 5.11), never for themselves.
 */
export function exemptionProblem(me: Member | null, sessionId: string, memberId: string, reason: string | null, data: ClubData): string | null {
  if (!(data.checkinSessions ?? []).some((s) => s.id === sessionId)) return 'That check-in no longer exists.';
  const target = data.members.find((m) => m.id === memberId);
  if (!target) return 'That member no longer exists.';
  if (!isBoardOf(me, target.chapterId, data.positions)) return 'Only their chapter’s board can excuse them.';
  if (me!.id === target.id) return 'Someone else on the board has to excuse you.';
  if (reason?.trim() && attended(sessionId, memberId, data)) return 'They checked in, so there’s nothing to excuse.';
  return null;
}

/** Why `me` can't change a meeting check-in's category, or null. Only before the day it's held (4.6: in advance). */
export function meetingTypeProblem(me: Member | null, sessionId: string, type: MeetingType, data: ClubData, today: string): string | null {
  const session = (data.checkinSessions ?? []).find((s) => s.id === sessionId);
  if (!session) return 'That check-in no longer exists.';
  if (!canRunCheckin(me, session.chapterId, data.positions)) return RUN_ONLY;
  if (session.kind !== 'meeting') return 'Only a meeting check-in has a kind.';
  if (!MEETING_TYPES.includes(type)) return 'Pick what kind of meeting it is.';
  if (session.heldOn <= today) return 'A meeting’s kind is set before the day it’s held (4.6).';
  return null;
}
