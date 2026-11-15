// The Board tab used to stack 16 sections, empty ones included. It now opens with a short "Needs
// you" list and folds the rest into five groups; only a group with something open starts expanded.
// This file holds the counting and wording so they can be tested without drawing a screen.

import { heldRows, isActing, settleActing } from './acting';
import {
  actingDefaultUntil, actingWarnings, appointActingProblem, confirmActingProblem, holdsBoardSeat, isBoardOf, requestNeedsVote, seesEveryChapter,
  withdrawRequestProblem,
} from './access';
import { boardVoteStep } from './actingCopy';
import { vpFallbackFor } from './audit';
import { addDays, daysBetween, formatAuDate } from './dates';
import { BOARD_ROLES, ROLE_LABEL } from './labels';
import { displayName } from './profile';
import { melbourneDate } from './rides';
import { termEndsOn, termState } from './terms';
import type { ActingRequest, ClubData, Member, Position } from './types';

export type BoardCounts = {
  /** People waiting for approval. */
  pending: number;
  /** Regos, licences and first aid certificates due or expired. */
  alerts: number;
  /** Members with no emergency contact. */
  noContact: number;
  /** FNGs with a review coming. */
  fngs: number;
};

export type BoardGroupId = 'approvals' | 'people' | 'meetings' | 'money' | 'website';

export type NeedsYou = { group: BoardGroupId; text: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The things that need the board right now, most urgent first. Empty when nothing does. */
export function needsYou(c: BoardCounts): NeedsYou[] {
  const items: NeedsYou[] = [];
  if (c.pending > 0) items.push({ group: 'approvals', text: `${plural(c.pending, 'person', 'people')} waiting for approval` });
  if (c.alerts > 0) {
    items.push({
      group: 'people',
      text: c.alerts === 1 ? '1 rego, licence or first aid certificate due' : `${c.alerts} regos, licences or first aid certificates due`,
    });
  }
  if (c.noContact > 0) items.push({ group: 'people', text: `${plural(c.noContact, 'member', 'members')} without an emergency contact` });
  if (c.fngs > 0) items.push({ group: 'people', text: plural(c.fngs, 'FNG review', 'FNG reviews') });
  return items;
}

export type BoardGroup = { id: BoardGroupId; title: string; summary: string; startsOpen: boolean };

/** The five groups, in a fixed order. A group starts open only when it has something waiting. */
export function boardGroups(c: BoardCounts): BoardGroup[] {
  const people = [
    c.alerts > 0 ? `${c.alerts} due` : null,
    c.noContact > 0 ? `${c.noContact} without a contact` : null,
    c.fngs > 0 ? plural(c.fngs, 'FNG review', 'FNG reviews') : null,
  ].filter((s): s is string => s !== null);
  return [
    { id: 'approvals', title: 'Approvals', summary: c.pending > 0 ? `${c.pending} waiting` : 'Nobody waiting', startsOpen: c.pending > 0 },
    { id: 'people', title: 'People', summary: people.length ? people.join(', ') : 'Nothing due', startsOpen: people.length > 0 },
    { id: 'meetings', title: 'Meetings and attendance', summary: 'Attendance and check-ins', startsOpen: false },
    { id: 'money', title: 'Money', summary: 'Chapter fees', startsOpen: false },
    { id: 'website', title: 'Website and app', summary: 'Enquiries, news, visits and app feedback', startsOpen: false },
  ];
}

/**
 * The chapter the Board tab's lists cover for `me`: null (every chapter) only for someone who sees
 * every chapter's details. An Acting President takes part in NEC business, so their level is
 * national, but they see only their own chapter's board (spec, "Nobody acting reaches club-wide").
 */
export function boardScope(me: Member, positions: Position[]): string | null {
  return seesEveryChapter(me, positions) ? null : me.chapterId;
}

/**
 * The terms "Attendance and terms" lists: ended, or ending within 60 days, in `chapterId` (null: every
 * chapter), soonest first. A stint isn't a term: it ends on its until date, and nobody is re-elected to it.
 */
export function termsDue(positions: Position[], chapterId: string | null, today: string): Position[] {
  return positions
    .filter((p) => !isActing(p) && (chapterId === null || p.chapterId === chapterId))
    .filter((p) => termState(p, today) !== null && termState(p, today) !== 'running')
    .sort((a, b) => (termEndsOn(a) ?? '').localeCompare(termEndsOn(b) ?? ''));
}

// ---------------------------------------------------------------------------
// Acting on the Board tab (docs/superpowers/specs/2026-11-15-acting-roles-design.md, "Screens")
// ---------------------------------------------------------------------------

const nameOf = (id: string | null | undefined, data: Pick<ClubData, 'members'>) => {
  const m = id ? data.members.find((x) => x.id === id) : undefined;
  return m ? displayName(m) : 'Someone';
};
const chapterName = (id: string, data: Pick<ClubData, 'chapters'>) => data.chapters.find((c) => c.id === id)?.name ?? 'the chapter';
/** A stand-in for the why while asking whether a stint could be recorded at all. */
const ANY_WHY = 'x';

/**
 * The line under the Board tab's chip. Someone who sees every chapter keeps the first sentence and
 * is told whose board they sit on ("You sit on West’s board."), or that each chapter's board runs its
 * own business; everyone else sees their own chapter's.
 */
export function scopeText(me: Member, data: Pick<ClubData, 'positions' | 'chapters'>): string {
  if (!seesEveryChapter(me, data.positions)) {
    return `You can act for the ${data.chapters.find((c) => c.id === me.chapterId)?.name} chapter.`;
  }
  const seats = data.chapters.filter((c) => holdsBoardSeat(me.id, c.id, data.positions)).map((c) => `${c.name}’s`);
  const second = seats.length === 0
    ? 'Each chapter’s board runs its own business.'
    : `You sit on ${seats.join(' and ')} ${seats.length === 1 ? 'board' : 'boards'}.`;
  return `You sit on the NEC, so you see every chapter’s board records. ${second}`;
}

/** An agreed cover: the holder of the seat asked for it themselves (route 2), so a third board member confirms it. */
function agreedCover(request: ActingRequest, data: Pick<ClubData, 'positions'>): boolean {
  return request.covers !== null && data.positions.find((p) => p.id === request.covers)?.memberId === request.requestedBy;
}

/**
 * An open request, as the Board tab shows it: "Smokey asked for Jet to cover as President until
 * 13/12/2026: Smokey overseas" when the holder asked, else "Crank asked for Jet to act as President
 * until 13/12/2026: Smokey can’t be reached".
 */
export function requestLine(request: ActingRequest, data: Pick<ClubData, 'members' | 'positions'>): string {
  const how = agreedCover(request, data) ? 'cover' : 'act';
  return `${nameOf(request.requestedBy, data)} asked for ${nameOf(request.memberId, data)} to ${how} as ${ROLE_LABEL[request.role]}`
    + ` until ${formatAuDate(request.until)}: ${request.why}`;
}

export type RequestNext =
  | { kind: 'confirm'; label: 'Confirm cover' | 'Confirm acting' }
  | { kind: 'start'; label: 'Start the board vote'; quorum: number; closesAt: string; note: string; last: string | null }
  | { kind: 'see'; label: 'See the board vote'; voteId: string };

/**
 * The one step `me` takes next on a request: confirm it where confirmActingProblem allows (Confirm
 * cover for an agreed one, Confirm acting once a board vote carried); otherwise, for that chapter's
 * board, the board vote's step (boardVoteStep: start it, or follow it). Null when there's none.
 */
export function requestNext(request: ActingRequest, me: Member, raw: ClubData, now: string): RequestNext | null {
  const today = melbourneDate(now);
  const data = settleActing(raw, today);
  const fresh = (data.actingRequests ?? []).find((r) => r.id === request.id) ?? request;
  if (fresh.closedAt !== null) return null;
  if (confirmActingProblem(me, fresh, data, today) === null) {
    return { kind: 'confirm', label: agreedCover(fresh, data) ? 'Confirm cover' : 'Confirm acting' };
  }
  if (!isBoardOf(me, fresh.chapterId, data.positions) || !requestNeedsVote(fresh, data, today)) return null;
  const step = boardVoteStep(me, fresh, data, now);
  if (!step) return null;
  return step.kind === 'start' ? { ...step, label: 'Start the board vote' } : { kind: 'see', label: 'See the board vote', voteId: step.voteId };
}

export type RequestAction = 'Withdraw request' | 'Decline';

/**
 * Closing a request: Decline for the stand-in, Withdraw request for the holder, and for the person
 * who asked while no vote on it is open or has carried (withdrawRequestProblem). Nothing for anyone else.
 */
export function requestActions(request: ActingRequest, me: Member, raw: ClubData, today: string): RequestAction[] {
  if (withdrawRequestProblem(me, request, raw, today) !== null) return [];
  return [me.id === request.memberId ? 'Decline' : 'Withdraw request'];
}

/** The open requests the Board tab shows `me`: those they have a step on, or can withdraw or decline. Oldest first. */
export function boardRequests(me: Member, raw: ClubData, now: string): ActingRequest[] {
  const today = melbourneDate(now);
  const data = settleActing(raw, today);
  return (data.actingRequests ?? [])
    .filter((r) => r.closedAt === null && (requestNext(r, me, data, now) !== null || requestActions(r, me, data, today).length > 0))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Above the confirm step: "Jet acts as President (North) for Smokey from today until 13/12/2026.",
 * then the stint's warnings again (9.6, 9.7, 9.5 and the rest), each in its own paragraph.
 */
export function requestConfirmNote(request: ActingRequest, raw: ClubData, today: string): string {
  const data = settleActing(raw, today);
  const seat = request.covers ? data.positions.find((p) => p.id === request.covers) ?? null : null;
  const target = data.members.find((m) => m.id === request.memberId);
  const lead = `${nameOf(request.memberId, data)} acts as ${ROLE_LABEL[request.role]} (${chapterName(request.chapterId, data)})`
    + `${seat ? ` for ${nameOf(seat.memberId, data)}` : ''} from today until ${formatAuDate(request.until)}.`;
  const warnings = target
    ? actingWarnings(target, request.chapterId, request.role, seat, request.until, data, today, requestNeedsVote(request, data, today))
    : [];
  return [lead, ...warnings].join('\n\n');
}

/**
 * The 11.2 line for a chapter's board while its VP casts the NEC vote with the President seat empty:
 * "Jet casts North’s NEC vote without being formally Acting President (11.2)", with "Make Jet Acting
 * President" only where `me` could record that (appointActingProblem). Null off that board, or with
 * no fallback.
 */
export function vpFallbackLine(
  chapterId: string, me: Member, raw: ClubData, today: string,
): { text: string; button: string | null; memberId: string } | null {
  const data = settleActing(raw, today);
  if (!isBoardOf(me, chapterId, data.positions)) return null;
  const vp = vpFallbackFor(chapterId, data);
  const target = vp ? data.members.find((m) => m.id === vp.memberId) : undefined;
  if (!target) return null;
  const name = displayName(target);
  const until = actingDefaultUntil(chapterId, 'president', false, today, data);
  const can = appointActingProblem(me, target, chapterId, 'president', until, ANY_WHY, data, today) === null;
  return {
    text: `${name} casts ${chapterName(chapterId, data)}’s NEC vote without being formally Acting President (11.2)`,
    button: can ? `Make ${name} Acting President` : null,
    memberId: target.id,
  };
}

// ---------------------------------------------------------------------------
// Stints in "Attendance and terms", listed apart from terms
// ---------------------------------------------------------------------------

/** The open stints in `chapterId` (null: every chapter), soonest until first. Expects settled rows. */
export function stintsDue(positions: Position[], chapterId: string | null): Position[] {
  return heldRows(positions)
    .filter((p) => isActing(p) && (chapterId === null || p.chapterId === chapterId))
    .sort((a, b) => a.actingUntil!.localeCompare(b.actingUntil!));
}

/**
 * A stint's line. An empty board seat: "Acting until 13/12/2026: hold the election at the ACM, change
 * the date or let it end. If Crank stands, the VP or an elected person chairs that vote (9.9, 10.9)."
 * A cover: "Smokey takes back the seat on 14/12/2026." A non-board role, which the board appoints
 * (9.2): "Acting until 13/12/2026: appoint someone, change the date or let it end."
 */
export function stintLine(p: Position, data: Pick<ClubData, 'members' | 'positions'>): string {
  const until = formatAuDate(p.actingUntil);
  if (p.covers != null) {
    const holder = data.positions.find((x) => x.id === p.covers)?.memberId;
    return `${nameOf(holder, data)} takes back the seat on ${formatAuDate(addDays(p.actingUntil!, 1))}.`;
  }
  if (!BOARD_ROLES.includes(p.role)) return `Acting until ${until}: appoint someone, change the date or let it end.`;
  return `Acting until ${until}: hold the election at the ACM, change the date or let it end.`
    + ` If ${nameOf(p.memberId, data)} stands, the VP or an elected person chairs that vote (9.9, 10.9).`;
}

/** Warning colour in a stint's last 7 days, from the day its "Acting ends in a week" reminder comes. */
export function stintTone(p: Position, today: string): 'warning' | null {
  return isActing(p) && daysBetween(today, p.actingUntil!) <= 7 ? 'warning' : null;
}
