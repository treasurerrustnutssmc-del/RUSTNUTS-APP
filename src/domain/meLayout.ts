// The Me tab used to be one scroll of about 30 sections. It now keeps the profile card on top and
// folds the rest into six groups, each with a one-line summary you can read without opening it. A
// group starts open only when something in it needs the member. The wording and the open/closed
// rule live here so they can be tested without drawing a screen.
//
// Acting roles (Task 20): what Me and Home show a board holder about covering their seat while
// they're away (spec: Screens, "Me, for a board holder" and "The covered holder, on Me and Home").
import {
  actingCap, actingDefaultUntil, actingWarnings, ASKED_RECENTLY, AUDITOR_STAYS_OUT, CONFIRM_NOT_HOLDER, holdsBoardSeat,
  PRESIDENT_NEEDS_BOARD_VOTE, requestCoverProblem, SMALL_BOARD,
} from './access';
import { coverOf, heldPositions, isActing, settleActing } from './acting';
import { formatAuDate } from './dates';
import { formatCents } from './fees';
import { coveredNotice, coverNote, seatTitle } from './home';
import { BOARD_ROLES, ROLE_LABEL, ROLE_SHORT } from './labels';
import { displayName } from './profile';
import type { ActingRequest, ClubData, Member, Position } from './types';

export type MeGroupId = 'year' | 'details' | 'rules' | 'fees' | 'settings' | 'help';

export type MeInput = {
  contacts: number;
  bikes: number;
  owingCents: number;
  onHiatus: boolean;
  /** Where the member stands with the Road Rules, or null when they are not asked to sign. */
  roadRules: { text: string; urgent: boolean } | null;
};

export type MeGroup = { id: MeGroupId; title: string; summary: string; startsOpen: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function meGroups(m: MeInput): MeGroup[] {
  const rules = m.roadRules ? `Road Rules: ${m.roadRules.text[0].toLowerCase()}${m.roadRules.text.slice(1)}` : 'Club documents and policies';
  const details =
    m.contacts === 0
      ? 'No emergency contact yet'
      : `${plural(m.contacts, 'emergency contact', 'emergency contacts')}, ${m.bikes === 0 ? 'no bikes' : plural(m.bikes, 'bike', 'bikes')}`;
  const fees = m.owingCents > 0 ? `${formatCents(m.owingCents)} owing` : m.onHiatus ? 'On hiatus: no new fees' : 'All paid up';
  return [
    { id: 'year', title: 'My club year', summary: 'Attendance and badges', startsOpen: false },
    { id: 'details', title: 'My details', summary: details, startsOpen: m.contacts === 0 },
    { id: 'rules', title: 'Rules and papers', summary: rules, startsOpen: m.roadRules?.urgent === true },
    { id: 'fees', title: 'Fees', summary: fees, startsOpen: m.owingCents > 0 },
    { id: 'settings', title: 'Notifications and privacy', summary: 'Alerts and sharing your mobile', startsOpen: false },
    { id: 'help', title: 'Help and the club online', summary: 'Feedback, support, links and sponsors', startsOpen: false },
  ];
}

// ---------------------------------------------------------------------------
// Cover while I'm away (acting roles, Task 20)
// ---------------------------------------------------------------------------

export const ARRANGE_COVER = 'Arrange cover while I’m away';
export const WHY_HINT = 'Every member can read this. Keep health details out.';
export const coverUntilHint = (cap: string): string => `Last acting day. Up to ${formatAuDate(cap)}.`;

/** The labels for a ConfirmButton: the first press, the second, and the line shown with the second. */
export type CoverButton = { label: string; confirmLabel: string; confirmNote?: string };
export type StandInChoice = { value: string; label: string };

/**
 * One full board seat of the viewer's, and what Me shows for it: the notice while it's covered,
 * the request while one waits, else the stand-ins to pick from, or why there are none.
 */
export type CoverPanel =
  | { kind: 'covered'; seat: Position; title: string; cover: Position; notice: string; button: CoverButton }
  | { kind: 'asked'; seat: Position; title: string; request: ActingRequest; line: string; button: CoverButton }
  | {
    kind: 'arrange'; seat: Position; title: string; summary: string; choices: StandInChoice[];
    until: string; cap: string; untilHint: string; whyHint: string;
  }
  | { kind: 'blocked'; seat: Position; title: string; summary: string; line: string };

/** A why that passes, for asking the rule which stand-ins a seat allows before one is typed. */
const PROBE_WHY = 'Away';
/** Refusals about the seat or the holder, not the stand-in: they come first, so every stand-in gets the same one. */
const SEAT_REFUSALS = [ASKED_RECENTLY, AUDITOR_STAYS_OUT, SMALL_BOARD];

const nameOf = (memberId: string, data: ClubData) => {
  const m = data.members.find((x) => x.id === memberId);
  return m ? displayName(m) : 'Someone';
};

/** The board seat a stand-in is known by in this chapter ("VP"), the VP first, then by seat. */
function boardRole(memberId: string, chapterId: string, data: ClubData) {
  const seats = heldPositions(memberId, data.positions).filter((p) => p.chapterId === chapterId && BOARD_ROLES.includes(p.role));
  const full = seats.filter((p) => !isActing(p));
  return (full.length ? full : seats).map((p) => p.role).sort((a, b) => BOARD_ROLES.indexOf(a) - BOARD_ROLES.indexOf(b))[0];
}
const rank = (role: Position['role']) => (role === 'vice_president' ? -1 : BOARD_ROLES.indexOf(role));

/**
 * Who may stand in for `seat` while its holder is away: the chapter's other board members the
 * rule allows for a cover from today (for a President, only the sitting VP), labelled with their
 * seat, "Jet (VP)", the VP first. Empty when the seat itself can't be covered (a small board, say).
 */
export function standInChoices(me: Member, seat: Position, raw: ClubData, today: string): StandInChoice[] {
  const data = settleActing(raw, today);
  if (seat.chapterId === null) return [];
  const chapterId = seat.chapterId;
  const until = actingDefaultUntil(chapterId, seat.role, true, today, data);
  return data.members
    .filter((m) => m.id !== me.id && holdsBoardSeat(m.id, chapterId, data.positions))
    .filter((m) => requestCoverProblem(me, seat, m, until, PROBE_WHY, data, today) === null)
    .map((m) => ({ m, role: boardRole(m.id, chapterId, data) }))
    .sort((a, b) => rank(a.role) - rank(b.role) || displayName(a.m).localeCompare(displayName(b.m)))
    .map(({ m, role }) => ({ value: m.id, label: `${displayName(m)} (${ROLE_SHORT[role]})` }));
}

/** What asking for this cover moves and keeps (coverNote), then the warnings, each its own paragraph. */
export function coverConfirmNote(seat: Position, standIn: Member, until: string, data: ClubData, today: string): string {
  const warnings = seat.chapterId === null ? [] : actingWarnings(standIn, seat.chapterId, seat.role, seat, until, data, today, false);
  return [coverNote(seat, standIn, until, data), ...warnings].join('\n\n');
}

function askedLine(me: Member, seat: Position, request: ActingRequest, data: ClubData): string {
  const title = seatTitle(seat, data.chapters, ROLE_LABEL);
  const standIn = nameOf(request.memberId, data);
  const until = formatAuDate(request.until);
  return request.requestedBy === me.id
    ? `You asked for ${standIn} to cover as ${title} until ${until}: ${request.why}. ${CONFIRM_NOT_HOLDER}`
    : `${nameOf(request.requestedBy, data)} asked for ${standIn} to act as ${title} for you until ${until}: ${request.why}. If you’re available, withdraw it.`;
}

function panelFor(me: Member, seat: Position, data: ClubData, today: string): CoverPanel {
  const cover = coverOf(seat, data.positions);
  if (cover) {
    return {
      kind: 'covered', seat, title: 'Your seat is covered', cover, notice: coveredNotice(seat, cover, data),
      button: { label: 'I’m back', confirmLabel: 'Yes, I’m back', confirmNote: `This ends ${nameOf(cover.memberId, data)}’s acting today.` },
    };
  }
  const request = (data.actingRequests ?? []).find((r) => r.closedAt === null && r.covers === seat.id);
  if (request) {
    return {
      kind: 'asked', seat, title: 'Cover asked for your seat', request, line: askedLine(me, seat, request, data),
      button: { label: 'Withdraw request', confirmLabel: 'Yes, withdraw it' },
    };
  }
  const chapterId = seat.chapterId!;
  const title = seatTitle(seat, data.chapters, ROLE_LABEL);
  const choices = standInChoices(me, seat, data, today);
  if (choices.length > 0) {
    const cap = actingCap(chapterId, seat.role, true, today, data);
    return {
      kind: 'arrange', seat, title: ARRANGE_COVER, choices,
      summary: `${title} · ${choices.length === 1 ? choices[0].label : choices.length} can stand in`,
      until: actingDefaultUntil(chapterId, seat.role, true, today, data), cap, untilHint: coverUntilHint(cap), whyHint: WHY_HINT,
    };
  }
  // Nobody to pick: the seat's own refusal when it has one (a board too small to decide it, say),
  // else nobody on the board can stand in now.
  const others = data.members.filter((m) => m.id !== me.id && holdsBoardSeat(m.id, chapterId, data.positions));
  const refusal = others.length === 0
    ? SMALL_BOARD
    : SEAT_REFUSALS.find((r) => r === requestCoverProblem(me, seat, others[0], actingDefaultUntil(chapterId, seat.role, true, today, data), PROBE_WHY, data, today));
  if (refusal) {
    return { kind: 'blocked', seat, title: ARRANGE_COVER, summary: `${title} · ${refusal === SMALL_BOARD ? 'Refer it to the NEC (8.6)' : 'Not now'}`, line: refusal };
  }
  const chapter = data.chapters.find((c) => c.id === chapterId)?.name ?? 'the chapter';
  const nobody = `Nobody on ${chapter}’s board can stand in now.`;
  return {
    kind: 'blocked', seat, title: ARRANGE_COVER, summary: `${title} · Nobody can stand in now`,
    line: seat.role === 'president' ? `${nobody} ${PRESIDENT_NEEDS_BOARD_VOTE} Your board can arrange it by a vote.` : nobody,
  };
}

/**
 * Me: one panel for each of the viewer's full board seats (a stint, or a seat off the board, is
 * never covered), on data settled to `today`, so a lapsed cover gives the seat back.
 */
export function coverPanels(me: Member, raw: ClubData, today: string): CoverPanel[] {
  if (me.approval !== 'approved') return [];
  const data = settleActing(raw, today);
  return heldPositions(me.id, data.positions)
    .filter((p) => p.chapterId !== null && BOARD_ROLES.includes(p.role) && !isActing(p))
    .sort((a, b) => BOARD_ROLES.indexOf(a.role) - BOARD_ROLES.indexOf(b.role))
    .map((seat) => panelFor(me, seat, data, today));
}

/** Home: only the covered holder's notice, with I'm back. */
export function homeCoverPanels(me: Member, data: ClubData, today: string): CoverPanel[] {
  return coverPanels(me, data, today).filter((p) => p.kind === 'covered');
}
