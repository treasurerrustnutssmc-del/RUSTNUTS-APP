// Check-ins at rides and meetings: who runs them, who can check in, and what's been attended.
// The database's open_checkin, check_in, mark_attendance and close_checkin actions apply the same
// rules with the same words.

import { activePositions, isBoardOf, isNational } from './access';
import { BOARD_ROLES } from './labels';
import type { Chapter, CheckinKind, CheckinSession, ClubData, Member, Position, Ride } from './types';

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

/** That chapter's board or the NEC; for a whole-club ride, any chapter's board. */
export function canRunCheckin(viewer: Member | null, chapterId: string | null, positions: Position[]): boolean {
  if (!viewer || viewer.approval !== 'approved') return false;
  if (chapterId !== null) return isBoardOf(viewer, chapterId, positions);
  return isNational(viewer.id, positions) || activePositions(viewer.id, positions).some((p) => BOARD_ROLES.includes(p.role));
}

/** Approved members, and applicants still in their introduction phase (it's their meetings that count). */
export function canCheckIn(viewer: Member | null): boolean {
  if (!viewer) return false;
  if (viewer.approval === 'approved') return true;
  return viewer.approval === 'pending' && viewer.status === 'introduced';
}

export interface OpenCheckinInput {
  kind: CheckinKind;
  rideId: string | null;
  chapterId: string | null;
  title: string;
  heldOn: string;
}

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
