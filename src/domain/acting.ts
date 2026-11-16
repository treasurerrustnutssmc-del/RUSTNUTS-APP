// Acting in a role, until a date: the four readings of a seat, settling lapsed stints at Melbourne
// midnight, and what ending a row takes with it. Each mirrors the database
// (supabase/migrations/20270870000000_acting_roles.sql §1): private.held_positions,
// private.duty_positions and private.clubwide_positions, private.close_lapsed_acting and the
// private.on_position_end trigger. See docs/superpowers/specs/2026-11-15-acting-roles-design.md.
//
// The readings expect settled rows (settleActing first): a stint past its until date is then ended.
//   Held: open rows. Titles, eligibility, "end their positions first", board membership.
//   Duties: held rows, minus any row a held cover points at. Chairing, the NEC, the books, one-role checks.
//   Club-wide: duty rows that aren't acting. Every chapter's private details, the Club fund, the shop.

import { addDays } from './dates';
import { BOARD_ROLES } from './labels';
import { melbourneDate } from './rides';
import type { ActingChange, ActingRequest, ClubData, Electorate, EndedReason, Position, PositionRole, Threshold, Vote } from './types';

/** A stint: a row with an until date. */
export const isActing = (p: Position): boolean => p.actingUntil != null;

export const isEnded = (p: Position): boolean => p.endedOn != null;

/** Open rows, settled or not: what a writer checks before it changes a seat. */
export function openRows(positions: Position[]): Position[] {
  return positions.filter((p) => !isEnded(p));
}

export function heldRows(positions: Position[]): Position[] {
  return openRows(positions);
}

/** The rows a held cover stands in for. */
function coveredIds(positions: Position[]): Set<string> {
  const out = new Set<string>();
  for (const c of positions) if (c.covers != null && !isEnded(c)) out.add(c.covers);
  return out;
}

export function dutyRows(positions: Position[]): Position[] {
  const covered = coveredIds(positions);
  return heldRows(positions).filter((p) => !covered.has(p.id));
}

export function heldPositions(memberId: string, positions: Position[]): Position[] {
  return positions.filter((p) => p.memberId === memberId && !isEnded(p));
}

export function dutyPositions(memberId: string, positions: Position[]): Position[] {
  const mine = heldPositions(memberId, positions);
  if (mine.length === 0) return mine;
  const covered = coveredIds(positions);
  return covered.size === 0 ? mine : mine.filter((p) => !covered.has(p.id));
}

export function clubwidePositions(memberId: string, positions: Position[]): Position[] {
  return dutyPositions(memberId, positions).filter((p) => !isActing(p));
}

/** The held cover standing in for this row, if any. */
export function coverOf(position: Position, positions: Position[]): Position | null {
  return positions.find((c) => c.covers === position.id && !isEnded(c)) ?? null;
}

// How a row stood on a past day, read from the rows as they are (settled or not), for the 13.3
// approver check (private.approval_conflict). An early end records the day it happened, so a row
// counts as held sometime on its endedOn day but not all of it; a stint runs to the end of its
// until day.

/** Held at any time on `day`: started by then, not ended before it, and a stint's until on or after it. */
export function heldSometimeOn(p: Position, day: string): boolean {
  return p.startedOn <= day && (!isEnded(p) || p.endedOn! >= day) && (!isActing(p) || p.actingUntil! >= day);
}

/** Held all of `day`: started before it, not ended on or before it, and a stint's until on or after it. */
export function heldAllOf(p: Position, day: string): boolean {
  return p.startedOn < day && (!isEnded(p) || p.endedOn! > day) && (!isActing(p) || p.actingUntil! >= day);
}

// ---------------------------------------------------------------------------
// Melbourne midnight
// ---------------------------------------------------------------------------

/** The instant a Melbourne date begins (its midnight, in summer time or not). */
function clubDayStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  // Melbourne is ten or eleven hours ahead of UTC; midnight itself is never skipped or repeated.
  for (const hours of [11, 10]) {
    const at = wall - hours * 3_600_000;
    if (melbourneDate(new Date(at).toISOString()) === day && melbourneDate(new Date(at - 1).toISOString()) !== day) {
      return new Date(at).toISOString();
    }
  }
  throw new Error(`No Melbourne midnight for ${day}`);
}

/** How long until the next Melbourne midnight, when the club's date (and so every stint) moves on. */
export function msUntilNextClubDay(nowIso: string): number {
  return Date.parse(clubDayStart(addDays(melbourneDate(nowIso), 1))) - Date.parse(nowIso);
}

/**
 * Hands `onDay` the club's date at each Melbourne midnight until the returned stop is called (the
 * clock under useClubToday). Each timer is set afresh from the clock, so summer time comes right, and
 * a timer that fires a moment early just hands back the same date and waits the moment out.
 */
export function everyClubDay(onDay: (today: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    timer = setTimeout(() => {
      onDay(melbourneDate(new Date().toISOString()));
      arm();
    }, msUntilNextClubDay(new Date().toISOString()));
  };
  arm();
  return () => clearTimeout(timer);
}

// ---------------------------------------------------------------------------
// Settling: the app's lazy close
// ---------------------------------------------------------------------------

const lapses = (p: Position, today: string): boolean => !isEnded(p) && p.actingUntil != null && p.actingUntil < today;

/** A stint past its until date ends the day after it, by nobody. */
const lapsed = (p: Position): Position => ({ ...p, endedOn: addDays(p.actingUntil!, 1), endedReason: 'lapsed' });

/**
 * How an open request closes today, if it does: rejected once any acting vote on it is lost (a vote
 * without quorum leaves it open), else lapsed once the row it would cover has ended (on that row's
 * end day; a row nobody can find, today), or after its until date or 28 days after it was made.
 */
function requestCloses(
  r: ActingRequest, votes: Vote[], positions: Position[], today: string,
): Pick<ActingRequest, 'closedAt' | 'outcome'> | null {
  if (r.closedAt !== null) return null;
  const lost = votes.find((v) => v.actingRequestId === r.id && v.result === 'lost');
  if (lost) return { outcome: 'rejected', closedAt: lost.closedAt ?? clubDayStart(today) };
  if (r.covers != null) {
    const covered = positions.find((p) => p.id === r.covers);
    if (!covered || covered.endedOn !== null) return { outcome: 'lapsed', closedAt: clubDayStart(covered?.endedOn ?? today) };
  }
  const pastUntil = addDays(r.until, 1);
  const tooOld = addDays(melbourneDate(r.createdAt), 28);
  const on = pastUntil < tooOld ? pastUntil : tooOld;
  return on <= today ? { outcome: 'lapsed', closedAt: clubDayStart(on) } : null;
}

/**
 * The club data as it stands on `today`: stints past their until date ended (`lapsed`), and
 * requests closed as the database's lazy close would. Nothing lapsing gives back the same object,
 * and untouched rows keep theirs, so memos keyed on them don't rerun.
 */
export function settleActing(data: ClubData, today: string): ClubData {
  const positions = data.positions.some((p) => lapses(p, today))
    ? data.positions.map((p) => (lapses(p, today) ? lapsed(p) : p))
    : data.positions;
  const votes = data.votes ?? [];
  const requests = data.actingRequests;
  const closing = requests?.some((r) => requestCloses(r, votes, positions, today) !== null) ?? false;
  if (positions === data.positions && !closing) return data;
  return {
    ...data,
    positions,
    ...(closing && requests
      ? {
          actingRequests: requests.map((r) => {
            const closes = requestCloses(r, votes, positions, today);
            return closes ? { ...r, ...closes } : r;
          }),
        }
      : {}),
  };
}

/** Whether settling on `today` ends one of this member's own rows (so their powers have changed). */
export function lapsedOwnRows(raw: ClubData, today: string, memberId: string | null): boolean {
  return memberId !== null && raw.positions.some((p) => p.memberId === memberId && lapses(p, today));
}

/**
 * Whether the live app should load again: settling on `today` ends one of this member's own rows
 * that was still open on the day the rows on screen were loaded (`loadedOn`). A row that had already
 * lapsed by then, which the database hasn't closed yet, doesn't count, so a fresh load that brings
 * it back never loads again and again.
 */
export function needsReloadAfterSettle(raw: ClubData, loadedOn: string, today: string, memberId: string | null): boolean {
  return lapsedOwnRows(settleActing(raw, loadedOn), today, memberId);
}

// ---------------------------------------------------------------------------
// Ending a row, and what it takes with it
// ---------------------------------------------------------------------------

export const HOLDER_SEAT_ENDED = 'Holder’s seat ended';
export const STAND_IN_LEFT = 'Stand-in left the board';

let changeCounter = 0;
const newChangeId = () => `ac-${Date.now().toString(36)}-${(changeCounter++).toString(36)}`;

const later = (a: string, b: string) => (a > b ? a : b);

/** The open stints a row's ending takes with it, each with the note it's logged under. */
function restingOn(ended: Position, rows: Position[]): [Position, string][] {
  const open = openRows(rows);
  const out: [Position, string][] = [];
  const take = (p: Position, note: string) => {
    if (!out.some(([q]) => q.id === p.id)) out.push([p, note]);
  };
  // A cover rests on the seat it covers.
  for (const c of open) if (c.covers === ended.id) take(c, HOLDER_SEAT_ENDED);
  const boardSeat = (p: Position) => p.chapterId === ended.chapterId && !isActing(p) && BOARD_ROLES.includes(p.role);
  if (!isActing(ended) && ended.chapterId !== null && BOARD_ROLES.includes(ended.role)) {
    // A stand-in's cover rests on their own last board seat in the chapter.
    if (!open.some((o) => o.memberId === ended.memberId && boardSeat(o))) {
      for (const c of open) {
        if (c.memberId === ended.memberId && c.chapterId === ended.chapterId && c.covers != null) take(c, STAND_IN_LEFT);
      }
    }
    // A President stint with no vote behind it rests on the person's VP row (8.2).
    if (ended.role === 'vice_president') {
      for (const c of open) {
        if (c.memberId === ended.memberId && c.chapterId === ended.chapterId && c.role === 'president' && isActing(c) && c.actingVote == null) {
          take(c, STAND_IN_LEFT);
        }
      }
    }
  }
  return out;
}

/** The open stints that would end if `row` ended now: a cover of it, and the stand-in's own stints resting on it. */
export function stintsEndingWith(row: Position, rows: Position[]): Position[] {
  const ended = { ...row, endedOn: row.endedOn ?? row.startedOn };
  return restingOn(ended, rows.map((p) => (p.id === row.id ? ended : p))).map(([p]) => p);
}

/**
 * Ends a row as the database's writers do (from `today`, never before it started), and every stint
 * resting on it (`left_board`, logged; one already past its date as `lapsed`, unlogged). A row that
 * has already ended is left as it is.
 */
export function endPositionRows(
  positions: Position[],
  id: string,
  how: { reason: EndedReason; by: string | null; today: string; now?: string },
): { positions: Position[]; changes: ActingChange[] } {
  const target = positions.find((p) => p.id === id);
  if (!target || isEnded(target)) return { positions, changes: [] };
  const now = how.now ?? new Date().toISOString();
  const ended = new Map<string, Position>();
  const current = () => positions.map((p) => ended.get(p.id) ?? p);
  const changes: ActingChange[] = [];
  const first: Position = { ...target, endedOn: later(how.today, target.startedOn), endedReason: how.reason };
  ended.set(id, first);
  const queue = [first];
  while (queue.length > 0) {
    const row = queue.shift()!;
    for (const [stint, note] of restingOn(row, current())) {
      const pastDate = stint.actingUntil! < how.today;
      const closed: Position = pastDate
        ? lapsed(stint)
        : { ...stint, endedOn: later(how.today, stint.startedOn), endedReason: 'left_board' };
      ended.set(stint.id, closed);
      queue.push(closed);
      if (!pastDate) {
        changes.push({
          id: newChangeId(), positionId: stint.id, chapterId: stint.chapterId!, oldUntil: stint.actingUntil ?? null, newUntil: null,
          changedBy: how.by, changedAt: now, note,
        });
      }
    }
  }
  return { positions: current(), changes };
}

// ---------------------------------------------------------------------------
// Who casts a chapter's NEC vote (11.2)
// ---------------------------------------------------------------------------

/**
 * The row that casts a chapter's NEC vote on a vote opened on `day`, counting only rows that started
 * before it (`day` null: now, any start). The President with the seat's duties, unless they chair
 * the NEC (an Acting President counts); then a Vice President row that isn't acting and that no
 * cover points at, since a VP takes part only while formally acting as President. The newest holder
 * acts during a handover (9.8). A cover with no vote behind it counts from the start of the row it
 * covers, because the holder chose the stand-in; while a President row from before the day is under
 * a cover that doesn't count, it's nobody: the covered President is off the NEC, and the board
 * didn't pick who casts. Mirrors private.nec_voter_before.
 */
function necVoterRowBefore(chapterId: string, day: string | null, positions: Position[]): Position | null {
  const held = heldRows(positions);
  const covered = coveredIds(positions);
  const chairs = new Set(dutyRows(positions).filter((p) => p.role === 'nec_chair').map((p) => p.memberId));
  const countsFrom = (x: Position) =>
    (x.covers != null && x.actingVote == null ? held.find((c) => c.id === x.covers)?.startedOn : undefined) ?? x.startedOn;
  const before = (x: Position) => day === null || countsFrom(x) < day;
  const seat = held.filter((x) => x.chapterId === chapterId && (x.role === 'president' || x.role === 'vice_president'));
  if (seat.some((p) => p.role === 'president' && before(p) && seat.some((s) => s.covers === p.id && !before(s)))) return null;
  const candidates = seat.filter(
    (x) =>
      before(x) &&
      !covered.has(x.id) &&
      ((x.role === 'president' && !chairs.has(x.memberId)) || (x.role === 'vice_president' && !isActing(x))),
  );
  candidates.sort(
    (a, b) => Number(a.role === 'vice_president') - Number(b.role === 'vice_president') || countsFrom(b).localeCompare(countsFrom(a)),
  );
  return candidates[0] ?? null;
}

/** The row that casts a chapter's NEC vote now. Mirrors private.nec_voter_for. */
export function necVoterRow(chapterId: string, positions: Position[]): Position | null {
  return necVoterRowBefore(chapterId, null, positions);
}

/** Who casts a chapter's NEC vote now (11.2). */
export function necVoterFor(chapterId: string, positions: Position[]): string | null {
  return necVoterRow(chapterId, positions)?.memberId ?? null;
}

/**
 * Who would cast a chapter's NEC ballot on a vote opened on `day` (a Melbourne date): its voter
 * from rows that started before that day, so a seat that starts on or after it neither takes the
 * ballot nor takes it away. Mirrors private.nec_voter_before.
 */
export function necVoterBefore(chapterId: string, day: string, positions: Position[]): string | null {
  return necVoterRowBefore(chapterId, day, positions)?.memberId ?? null;
}

// ---------------------------------------------------------------------------
// The shape of a vote that ends a term (9.3)
// ---------------------------------------------------------------------------

export type VoteShape = { electorate: Electorate; threshold: Threshold };

/** Ending someone's acting, or a Non-Board role: a majority of the chapter board (9.3). */
export const END_ACTING_SHAPE: VoteShape = { electorate: 'chapter_board', threshold: 'majority' };

/**
 * The shape a vote to end someone's time in a chapter role takes (9.3): two-thirds of the chapter's
 * Full Members for a board seat, a majority of the chapter board for any other chapter role, and
 * for ending someone's acting (`acting`) a majority of the chapter board, the shape 9.3 gives a
 * Non-Board removal. Mirrors private.has_carried_removal_vote and open_vote.
 */
export function removalShape(role: PositionRole, acting = false): VoteShape {
  if (acting || !BOARD_ROLES.includes(role)) return END_ACTING_SHAPE;
  return { electorate: 'chapter_patched', threshold: 'two_thirds' };
}
