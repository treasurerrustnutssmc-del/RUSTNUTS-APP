// Manage member › Positions, for acting (docs/superpowers/specs/2026-11-15-acting-roles-design.md,
// "Screens"): the Acting / Full term pair on Appoint, the seats each offers, the Until and Why
// fields, what an acting seat lets the viewer do, the confirm text that repeats the warnings, and
// the route-3 steps on an away holder's page (Arrange cover (board vote), then the board vote). The
// rules themselves live in access.ts and votes.ts; this file only asks them and words the answers.

import { heldPositions, heldRows, isActing, isEnded, coverOf, settleActing } from './acting';
import {
  actingCap, actingElectors, actingWarnings, appointActingProblem, auditorStaysOut, carriedActingVote, endTermProblem, holdsBoardSeat,
  isBoardOf, requestActingProblem, setActingUntilProblem, SMALL_BOARD,
} from './access';
import { melbourneInstant } from './business';
import { addDays, formatAuDate } from './dates';
import { BOARD_ROLES, CLUB_ROLES, RESULT_LABEL, ROLE_LABEL, ROLE_SHORT } from './labels';
import { displayName } from './profile';
import { melbourneDate } from './rides';
import { termEndsOn, termState } from './terms';
import type { ActingRequest, ClubData, Member, Position, PositionRole } from './types';
import { BOARD_QUORUM_FLOOR, defaultQuorum, openActingVoteProblem, removalVoteFor } from './votes';

const isBoardRole = (role: PositionRole) => BOARD_ROLES.includes(role);
const nameOf = (id: string | null | undefined, data: Pick<ClubData, 'members'>) => {
  const m = id ? data.members.find((x) => x.id === id) : undefined;
  return m ? displayName(m) : 'Someone';
};
const chapterName = (id: string | null, data: Pick<ClubData, 'chapters'>) => data.chapters.find((c) => c.id === id)?.name ?? 'the chapter';
/** A stand-in for the until and why while asking which seats someone could act in at all: today, and any reason. */
const ANY_WHY = 'x';

// ---------------------------------------------------------------------------
// Appoint: Acting or Full term, the seats, Until and Why
// ---------------------------------------------------------------------------

export type AppointKind = 'acting' | 'full';
export const APPOINT_KIND_LABEL: Record<AppointKind, string> = { acting: 'Acting', full: 'Full term (elected at a meeting)' };

/**
 * The pair on Appoint, offering only a kind that has a seat. Acting starts chosen when a board seat
 * can be filled that way, since a board seat is elected at the ACM and filled by acting until then
 * (9.8); a non-board role is the board's own appointment (9.2), so Full term starts chosen.
 */
export function appointChoices(seats: { acting: PositionRole[]; full: PositionRole[] }): {
  options: { value: AppointKind; label: string }[];
  initial: AppointKind;
} {
  const kinds = (['acting', 'full'] as const).filter((k) => seats[k].length > 0);
  const initial: AppointKind = seats.acting.some(isBoardRole) || seats.full.length === 0 ? 'acting' : 'full';
  return { options: kinds.map((value) => ({ value, label: APPOINT_KIND_LABEL[value] })), initial };
}

/** A seat in the Acting list: "Treasurer", or "President (needs a board vote)" when it goes to the board (route 3). */
export function actingSeatLabel(role: PositionRole, needsVote: boolean): string {
  return needsVote ? `${ROLE_LABEL[role]} (needs a board vote)` : ROLE_LABEL[role];
}

export type ActingSeat = { role: PositionRole; needsVote: boolean; label: string };

/**
 * The empty seats `target` could act in, as `me` sees it: those `me` can record now (route 1), and
 * those that need a board vote first (route 3, a President who isn't the sitting VP). Asked for a
 * stint from today, so the date and the reason picked later can still refuse; they're checked again
 * under the fields.
 */
export function actingSeatOptions(me: Member, target: Member, raw: ClubData, today: string): ActingSeat[] {
  const data = settleActing(raw, today);
  const chapterId = target.chapterId;
  return [...BOARD_ROLES, ...CLUB_ROLES].flatMap((role): ActingSeat[] => {
    if (appointActingProblem(me, target, chapterId, role, today, ANY_WHY, data, today) === null) {
      return [{ role, needsVote: false, label: actingSeatLabel(role, false) }];
    }
    if (requestActingProblem(me, target, chapterId, role, null, today, ANY_WHY, data, today) === null) {
      return [{ role, needsVote: true, label: actingSeatLabel(role, true) }];
    }
    return [];
  });
}

/** The chapter's sitting VP (a held VP row that isn't acting), for the President's Why. */
function sittingVp(chapterId: string, data: ClubData): Member | null {
  const vp = heldRows(data.positions).find((p) => p.chapterId === chapterId && p.role === 'vice_president' && !isActing(p));
  return vp ? data.members.find((m) => m.id === vp.memberId) ?? null : null;
}

/** The Why field's label: "Why not Jet (VP)?" when someone other than the sitting VP would act as President (8.2). */
export function whyLabel(target: Member, chapterId: string, role: PositionRole, data: ClubData): string {
  const vp = role === 'president' ? sittingVp(chapterId, data) : null;
  return vp && vp.id !== target.id ? `Why not ${displayName(vp)} (VP)?` : 'Why';
}

/**
 * Under the Why: it's needed (the button stays off without one, and the red line waits for typing),
 * and every approved member can read a position row, reason included.
 */
export const WHY_HINT = 'Required. Every member can read this. Keep health details out.';

/** Under the Until: "Last acting day. Up to 13/12/2026." */
export function untilHint(latest: string): string {
  return `Last acting day. Up to ${formatAuDate(latest)}.`;
}

/** Seating someone in full where they act in the empty seat ends their acting (`replaced`): "This ends Crank’s acting." */
export function replaceNote(target: Member, chapterId: string, role: PositionRole, data: ClubData): string | null {
  const acting = heldPositions(target.id, data.positions).some(
    (p) => p.chapterId === chapterId && p.role === role && isActing(p) && p.covers == null,
  );
  return acting ? `This ends ${displayName(target)}’s acting.` : null;
}

/** After recording a stint: "Crank is Acting Treasurer until 13/12/2026." */
export function doneMessage(target: Member, role: PositionRole, until: string): string {
  return `${displayName(target)} is Acting ${ROLE_LABEL[role]} until ${formatAuDate(until)}.`;
}

/** After proposing a stint that needs a board vote. */
export const PROPOSED_MESSAGE = 'Proposed. Next, start the board vote.';

/** A stint recorded now (route 1), or one proposed to the board (route 3), as the confirm step describes it. */
export type ActingStep =
  | { route: 'record'; target: Member; chapterId: string; role: PositionRole; until: string }
  | { route: 'propose'; target: Member; chapterId: string; role: PositionRole; covers: Position | null; until: string };

/**
 * The note above the confirm step: what happens, then every warning the rules give (9.6, 9.1, 9.4,
 * 9.7, 9.5, a ride they lead, NEC ballots that wait), each in its own paragraph. A proposal is a
 * voted stint, so its warnings are a voted cover's.
 */
export function confirmText(step: ActingStep, data: ClubData, today: string): string {
  const chapter = chapterName(step.chapterId, data);
  const lead = step.route === 'record'
    ? `${displayName(step.target)} acts as ${ROLE_LABEL[step.role]} (${chapter}) from today until ${formatAuDate(step.until)}.`
    : `Nothing changes until ${chapter}’s board votes yes and a board member confirms it.`;
  const warnings = step.route === 'record'
    ? actingWarnings(step.target, step.chapterId, step.role, null, step.until, data, today)
    : actingWarnings(step.target, step.chapterId, step.role, step.covers, step.until, data, today, true);
  return [lead, ...warnings].join('\n\n');
}

// ---------------------------------------------------------------------------
// An acting seat on the Positions card
// ---------------------------------------------------------------------------

/** The line under a seat's title: "Acting until 22/11/2026" for a stint, else when the term ends (warning colour near the end). */
export function termLine(p: Position, today: string): { label: string; value: string; tone?: 'warn' } | null {
  if (isActing(p)) return { label: 'Acting until', value: formatAuDate(p.actingUntil) };
  const ends = termEndsOn(p);
  const state = termState(p, today);
  if (!ends || state === null) return null;
  return state === 'running'
    ? { label: 'Term', value: `Ends ${formatAuDate(ends)}` }
    : { label: 'Term', value: `${state === 'ended' ? 'Ended' : 'Ends'} ${formatAuDate(ends)}`, tone: 'warn' };
}

/** A stint's reason, as 9.5 records it: "Why: No Treasurer since the ACM", or "For Smokey: Smokey overseas" on a cover. */
export function stintNote(p: Position, data: ClubData): string | null {
  if (!isActing(p) || !p.actingWhy) return null;
  const holder = p.covers ? data.positions.find((x) => x.id === p.covers)?.memberId : null;
  return holder ? `For ${nameOf(holder, data)}: ${p.actingWhy}` : `Why: ${p.actingWhy}`;
}

/** On a covered holder's own seat: "Jet covers this seat until 13/12/2026." */
export function coverLine(p: Position, data: ClubData): string | null {
  const cover = coverOf(p, data.positions);
  return cover ? `${nameOf(cover.memberId, data)} covers this seat until ${formatAuDate(cover.actingUntil)}.` : null;
}

export const TERM_ACTION = {
  changeDate: 'Change date',
  stepDown: 'Step down from acting',
  startEndVote: 'Start a vote to end acting',
  seeEndVote: 'See the vote to end acting',
  endActing: 'End acting',
  back: 'I’m back',
} as const;
export type TermAction = (typeof TERM_ACTION)[keyof typeof TERM_ACTION];

/**
 * The last until date `me` may give this stint, or null when they can't move it: the acting person,
 * and for a cover the holder, bring it forward (today at the earliest); another board member gives
 * an empty seat more time, and the holder an agreed cover, within the cap (set_acting_until).
 */
export function changeDateLatest(p: Position, me: Member, raw: ClubData, today: string): string | null {
  const data = settleActing(raw, today);
  const stint = data.positions.find((x) => x.id === p.id) ?? p;
  if (!isActing(stint) || isEnded(stint) || stint.chapterId === null) return null;
  const until = stint.actingUntil!;
  if (setActingUntilProblem(me, stint, addDays(until, 1), data, today) === null) {
    return actingCap(stint.chapterId, stint.role, stint.covers != null, stint.startedOn, data);
  }
  return today < until && setActingUntilProblem(me, stint, today, data, today) === null ? until : null;
}

/**
 * What `me` can do about an acting seat, in button order: Change date when they may move it, then
 * Step down from acting (the acting person), I’m back (the covered holder) or, for anyone else on
 * that chapter's board, the vote to end acting (start it, follow it, or end acting once it has
 * carried). Never a removal vote: ending acting is a board majority (9.3). NEC officers have no part,
 * nor does the Auditor in a President or Treasurer seat (11.8). A full term returns nothing here.
 */
export function termActionsFor(p: Position, me: Member, raw: ClubData, today: string): TermAction[] {
  const data = settleActing(raw, today);
  const stint = data.positions.find((x) => x.id === p.id) ?? p;
  if (!isActing(stint) || isEnded(stint) || stint.chapterId === null) return [];
  const out: TermAction[] = [];
  if (changeDateLatest(stint, me, data, today) !== null) out.push(TERM_ACTION.changeDate);
  const holder = stint.covers ? data.positions.find((x) => x.id === stint.covers)?.memberId : undefined;
  if (stint.memberId === me.id) return [...out, TERM_ACTION.stepDown];
  if (holder === me.id) return [...out, TERM_ACTION.back];
  if (!isBoardOf(me, stint.chapterId, data.positions) || auditorStaysOut(me, stint.role, data.positions)) return out;
  if (endTermProblem(me, stint, data, today) === null) return [...out, TERM_ACTION.endActing];
  const vote = removalVoteFor(stint, data.votes ?? []);
  return [...out, vote && vote.closedAt === null ? TERM_ACTION.seeEndVote : TERM_ACTION.startEndVote];
}

/**
 * Why the vote to end this stint can't start in the app, or null: it's decided without the acting
 * person, the holder they cover and, for a President or Treasurer seat, the Auditor, and fewer than
 * three left gives the 8.6 words, as NewVote would. The button stays, off, with this beside it.
 */
export function endVoteBlock(p: Position, raw: ClubData, today: string): string | null {
  if (!isActing(p) || p.chapterId === null) return null;
  const data = settleActing(raw, today);
  return actingElectors(p.chapterId, p.role, p.memberId, p.covers ?? null, data).length < BOARD_QUORUM_FLOOR ? SMALL_BOARD : null;
}

/** Above I’m back's confirm: "Jet’s acting ends today, and the seat’s duties come back to you." */
export function backNote(p: Position, data: Pick<ClubData, 'members'>): string {
  const standIn = data.members.find((m) => m.id === p.memberId);
  return `${standIn ? `${displayName(standIn)}’s` : 'The'} acting ends today, and the seat’s duties come back to you.`;
}

// ---------------------------------------------------------------------------
// The away holder's page: Arrange cover (board vote), then the board vote (route 3)
// ---------------------------------------------------------------------------

/** A board member's own seat there, for their label in a stand-in list: "Jet (VP)". */
function standInLabel(member: Member, chapterId: string, data: ClubData): string {
  const seat = heldPositions(member.id, data.positions)
    .filter((p) => p.chapterId === chapterId && isBoardRole(p.role) && !isActing(p))
    .sort((a, b) => BOARD_ROLES.indexOf(a.role) - BOARD_ROLES.indexOf(b.role))[0];
  return seat ? `${displayName(member)} (${ROLE_SHORT[seat.role]})` : displayName(member);
}

/**
 * Who `me` could propose to cover `seat` (someone else's full board seat) through a board vote, in
 * seat order, VP first; or, when nobody can, the reason (too few left to vote, say). Null when the
 * page shouldn't offer it at all: not a full board seat, already covered or asked for, me not on that
 * board, or me the holder (who asks from Me). Asked for a cover from today, so the date picked later
 * can still refuse; it's checked again under the fields.
 */
export function arrangeCover(
  me: Member, seat: Position, raw: ClubData, today: string,
): { standIns: { value: string; label: string }[]; blocked: string | null } | null {
  const data = settleActing(raw, today);
  const own = data.positions.find((p) => p.id === seat.id) ?? seat;
  const chapterId = own.chapterId;
  if (chapterId === null || !isBoardRole(own.role) || isActing(own) || isEnded(own) || own.memberId === me.id) return null;
  if (!isBoardOf(me, chapterId, data.positions) || coverOf(own, data.positions) !== null) return null;
  if ((data.actingRequests ?? []).some((r) => r.closedAt === null && r.chapterId === chapterId && r.role === own.role)) return null;
  const board = data.members.filter(
    (m) => m.id !== me.id && m.id !== own.memberId && holdsBoardSeat(m.id, chapterId, data.positions),
  );
  const problems = board.map((m) => ({ m, problem: requestActingProblem(me, m, chapterId, own.role, own, today, ANY_WHY, data, today) }));
  const seatOrder = (m: Member) => {
    const roles = heldPositions(m.id, data.positions).filter((p) => p.chapterId === chapterId && !isActing(p)).map((p) => BOARD_ROLES.indexOf(p.role));
    return Math.min(...roles.filter((i) => i >= 0), BOARD_ROLES.length);
  };
  const standIns = problems
    .filter((x) => x.problem === null)
    .sort((a, b) => seatOrder(a.m) - seatOrder(b.m))
    .map(({ m }) => ({ value: m.id, label: standInLabel(m, chapterId, data) }));
  return { standIns, blocked: standIns.length > 0 ? null : problems[0]?.problem ?? `Nobody else is on ${chapterName(chapterId, data)}’s board.` };
}

/** Open requests about this member: they're the stand-in, or it's their seat to be covered. Expects settled data. */
export function pageRequests(member: Member, data: ClubData): ActingRequest[] {
  const seats = new Set(heldRows(data.positions).filter((p) => p.memberId === member.id).map((p) => p.id));
  return (data.actingRequests ?? []).filter(
    (r) => r.closedAt === null && (r.memberId === member.id || (r.covers !== null && seats.has(r.covers))),
  );
}

const VOTE_DAYS = 7;
const VOTE_CLOSES = '19:00';

/**
 * The next step on a request that needs a board vote: follow an open vote, or a carried one from the
 * last 90 days (its confirm is next); otherwise start one, when `me` may, closing a week away at
 * 7:00 pm with the least quorum (a majority of the board left after the stand-in, the holder and the
 * Auditor, and at least three, 8.5). A vote without quorum leaves the request open for another, so a
 * vote set up to fail can't sink it; `last` then says how the latest one closed. A lost vote closes
 * the request. Null when there's nothing for `me` to do.
 */
export function boardVoteStep(
  me: Member, request: ActingRequest, data: ClubData, now: string,
): { kind: 'start'; quorum: number; closesAt: string; note: string; last: string | null } | { kind: 'see'; voteId: string } | null {
  const today = melbourneDate(now);
  const votes = (data.votes ?? []).filter((v) => v.actingRequestId === request.id);
  const current = votes.find((v) => v.closedAt === null) ?? carriedActingVote(request, data, today);
  if (current) return { kind: 'see', voteId: current.id };
  const latest = [...votes].sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0];
  const last = latest?.result ? `Board vote closed ${formatAuDate(melbourneDate(latest.closedAt!))}: ${RESULT_LABEL[latest.result]}.` : null;
  const closesOn = addDays(today, VOTE_DAYS);
  const closesAt = melbourneInstant(closesOn, VOTE_CLOSES);
  if (!closesAt) return null;
  const electors = actingElectors(request.chapterId, request.role, request.memberId, request.covers, settleActing(data, today)).length;
  const quorum = defaultQuorum('chapter_board', electors);
  if (openActingVoteProblem(me, request, quorum, closesAt, null, data, now) !== null) return null;
  return { kind: 'start', quorum, closesAt, note: `It closes on ${formatAuDate(closesOn)} at 7:00 pm, and needs ${quorum} of its ${electors} voters.`, last };
}
