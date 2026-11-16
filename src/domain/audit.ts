// The National Auditor's work (constitution v4, 11.8): written requests to a board or the NEC,
// findings reports, and the checks the app runs over the books and records. The Auditor reads
// and asks; they never change the records themselves. The database's actions
// (supabase/migrations/20270535000000_national_auditor.sql) apply the same rules with the same words.

import { actingRunAcm, isAuditor, isNational } from './access';
import { coverOf, heldPositions, heldRows, isActing, isEnded, necVoterRow, settleActing } from './acting';
import { longSeatTitle, seatTitle } from './home';
import { BOARD_ROLES, ROLE_LABEL, ROLE_ORDER } from './labels';
import { BANK_FEES, bankedLate, budgetOf, fundName, monthOf, isDebit } from './ledger';
import { fyOf } from './fees';
import { minutesState, runsScope, signedInProblem } from './meetings';
import { addMonths, displayName } from './profile';
import { melbourneDate } from './rides';
import { standingOf } from './standing';
import { termEndsOn, termState } from './terms';
import type { AuditArea, AuditReport, AuditRequest, AuditRequestKind, ClubData, Member, Position } from './types';

export const AREA_LABEL: Record<AuditArea, string> = {
  policy: 'Policy compliance',
  membership: 'Membership records',
  attendance: 'Attendance records',
  event_funds: 'Event funds',
  bank: 'Bank records',
  transactions: 'Transactions',
  controls: 'Controls',
};
export const AUDIT_AREAS = Object.keys(AREA_LABEL) as AuditArea[];

export const KIND_LABEL: Record<AuditRequestKind, string> = {
  information: 'Information request',
  correction: 'Correction request',
};

export const MAX_TITLE = 120;
export const MAX_TEXT = 4000;
export const MAX_NOTE = 1000;
export const MAX_FINDINGS = 20000;

export const AUDITOR_ONLY = 'Only the National Auditor can do that (11.8).';
export const NO_REQUEST = 'That request isn’t there any more.';
export const REQUEST_CLOSED = 'That request is closed.';
export const NO_REPORT = 'That report isn’t there any more.';
export const REPORT_ISSUED = 'That report has been issued, so it can’t change.';

const isIsoDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function textProblem(text: string | null, what: string, max: number): string | null {
  if (!text || !text.trim()) return what;
  return text.trim().length > max ? `Keep it to ${max} characters at most.` : null;
}

function auditorProblem(me: Member | null, data: ClubData): string | null {
  return signedInProblem(me) ?? (isAuditor(me, data.positions) ? null : AUDITOR_ONLY);
}

// Requests -----------------------------------------------------------------------------------------

export interface RequestInput {
  chapterId: string | null;
  kind: AuditRequestKind;
  area: AuditArea;
  title: string;
  details: string;
  dueOn: string | null;
  ledgerEntryId: string | null;
}

export function raiseRequestProblem(me: Member | null, input: RequestInput, data: ClubData, today: string): string | null {
  const who = auditorProblem(me, data);
  if (who) return who;
  if (input.chapterId !== null && !data.chapters.some((c) => c.id === input.chapterId)) return 'Pick a chapter, or the NEC.';
  if (!(input.kind in KIND_LABEL)) return 'Pick information or correction.';
  if (!(input.area in AREA_LABEL)) return 'Pick what it’s about.';
  const title = textProblem(input.title, 'Give it a title.', MAX_TITLE);
  if (title) return title;
  const details = textProblem(input.details, 'Say what you need.', MAX_TEXT);
  if (details) return details;
  if (input.dueOn !== null && (!isIsoDate(input.dueOn) || input.dueOn < today)) return 'Pick a due date from today on, or none.';
  if (input.ledgerEntryId !== null) {
    const line = (data.ledger ?? []).find((e) => e.id === input.ledgerEntryId);
    if (!line) return 'That line isn’t in the books.';
    if (line.chapterId !== input.chapterId) return 'That line is in another fund.';
  }
  return null;
}

/** That chapter's board answers; for national requests, the NEC. */
export function answersRequest(me: Member | null, request: AuditRequest, positions: Position[]): boolean {
  return runsScope(me, request.chapterId, positions);
}

/** The Auditor, whoever answers for that scope, and the NEC. Never ordinary members. */
export function seesRequest(me: Member | null, request: AuditRequest, data: ClubData): boolean {
  if (!me || me.approval !== 'approved') return false;
  return isAuditor(me, data.positions) || isNational(me.id, data.positions) || answersRequest(me, request, data.positions);
}

export const visibleRequests = (me: Member | null, data: ClubData): AuditRequest[] =>
  (data.auditRequests ?? []).filter((r) => seesRequest(me, r, data));

/** Open requests this person's board (or the NEC) still has to answer. */
export const requestsToAnswer = (me: Member | null, data: ClubData): AuditRequest[] =>
  (data.auditRequests ?? []).filter((r) => r.closedAt === null && r.answer === null && answersRequest(me, r, data.positions));

export function answerRequestProblem(me: Member | null, id: string, answer: string, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const request = (data.auditRequests ?? []).find((r) => r.id === id);
  if (!request) return NO_REQUEST;
  if (!answersRequest(me, request, data.positions)) {
    return request.chapterId === null ? 'Only the NEC answers this request.' : 'Only that chapter’s board answers this request.';
  }
  if (request.closedAt !== null) return REQUEST_CLOSED;
  return textProblem(answer, 'Write the answer first.', MAX_TEXT);
}

export function closeRequestProblem(me: Member | null, id: string, note: string, data: ClubData): string | null {
  const who = auditorProblem(me, data);
  if (who) return who;
  const request = (data.auditRequests ?? []).find((r) => r.id === id);
  if (!request) return NO_REQUEST;
  if (request.closedAt !== null) return REQUEST_CLOSED;
  return textProblem(note, 'Say why you’re closing it.', MAX_NOTE);
}

export type RequestState = 'waiting' | 'overdue' | 'answered' | 'closed';

export function requestState(request: AuditRequest, today: string): RequestState {
  if (request.closedAt !== null) return 'closed';
  if (request.answer !== null) return 'answered';
  return request.dueOn !== null && request.dueOn < today ? 'overdue' : 'waiting';
}

export const scopeName = (chapterId: string | null, data: Pick<ClubData, 'chapters'>): string =>
  chapterId === null ? 'NEC' : `${fundName(chapterId, data)} board`;

// Findings reports ---------------------------------------------------------------------------------

export interface ReportInput {
  id: string | null;
  title: string;
  fromOn: string;
  toOn: string;
  findings: string;
  recommendations: string | null;
}

const reportOf = (id: string, data: ClubData) => (data.auditReports ?? []).find((r) => r.id === id);

function draftProblem(me: Member | null, id: string, data: ClubData): string | null {
  const who = auditorProblem(me, data);
  if (who) return who;
  const report = reportOf(id, data);
  if (!report) return NO_REPORT;
  return report.issuedAt !== null ? REPORT_ISSUED : null;
}

export function saveReportProblem(me: Member | null, input: ReportInput, data: ClubData, today: string): string | null {
  const who = auditorProblem(me, data);
  if (who) return who;
  if (input.id !== null) {
    const draft = draftProblem(me, input.id, data);
    if (draft) return draft;
  }
  const title = textProblem(input.title, 'Give the report a title.', MAX_TITLE);
  if (title) return title;
  if (!isIsoDate(input.fromOn) || !isIsoDate(input.toOn)) return 'Pick the period it covers.';
  if (input.fromOn > input.toOn) return 'The period has to start before it ends.';
  if (input.toOn > today) return 'The period can’t run past today.';
  const findings = textProblem(input.findings, 'Write the findings first.', MAX_FINDINGS);
  if (findings) return findings;
  if (input.recommendations && input.recommendations.trim().length > MAX_FINDINGS) return `Keep it to ${MAX_FINDINGS} characters at most.`;
  return null;
}

export const issueReportProblem = (me: Member | null, id: string, data: ClubData): string | null => draftProblem(me, id, data);
export const deleteReportProblem = (me: Member | null, id: string, data: ClubData): string | null => draftProblem(me, id, data);

/** A board seat in any chapter (held, so a covered holder still counts), or the NEC. */
function onAnyBoard(me: Member, positions: Position[]): boolean {
  return isNational(me.id, positions) || heldPositions(me.id, positions).some((p) => BOARD_ROLES.includes(p.role));
}

/** Drafts stay with the Auditor; an issued report goes to the NEC and every chapter board. */
export function seesReport(me: Member | null, report: AuditReport, positions: Position[]): boolean {
  if (!me || me.approval !== 'approved') return false;
  if (isAuditor(me, positions)) return true;
  return report.issuedAt !== null && onAnyBoard(me, positions);
}

export const visibleReports = (me: Member | null, data: ClubData): AuditReport[] =>
  (data.auditReports ?? []).filter((r) => seesReport(me, r, data.positions));

// Checks -------------------------------------------------------------------------------------------

export interface AuditCheck {
  /** Stable: the kind of check and what it's about. */
  key: string;
  area: AuditArea;
  /** The fund or chapter it's about; null for the Club fund or national. */
  chapterId: string | null;
  title: string;
  detail: string;
  ledgerEntryId: string | null;
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const COVER_REVIEW_MONTHS = 3;

const personOf = (id: string, data: ClubData) => {
  const m = data.members.find((x) => x.id === id);
  return m ? displayName(m) : 'A member';
};
const chapterName = (id: string | null, data: ClubData) => data.chapters.find((c) => c.id === id)?.name ?? 'the chapter';

/** One seat on Membership records › Positions: the role, who and since when, and a chip for a stint or a term near its end. */
export type AuditSeatRow = { id: string; title: string; line: string; chip: { label: string; tone: 'bone' | 'warn' | 'danger' } | null };

/**
 * Membership records › Positions for a chapter: its held rows, and national seats of its members,
 * on data settled to `today` (a lapsed stint isn't held). In role order, a stint right after the
 * seat's full term, so a cover sits under the holder it covers. A stint isn't a term: it shows who it
 * covers, if anyone, and its until date, its last acting day: "Jet for Smokey · since 05/11/2026 ·
 * until 13/12/2026".
 */
export function auditSeatRows(chapterId: string, raw: ClubData, today: string): AuditSeatRow[] {
  const data = settleActing(raw, today);
  const theirs = new Set(data.members.filter((m) => m.chapterId === chapterId).map((m) => m.id));
  const name = (id: string) => {
    const m = data.members.find((x) => x.id === id);
    return m ? displayName(m) : 'A former member';
  };
  return heldRows(data.positions)
    .filter((p) => p.chapterId === chapterId || (p.chapterId === null && theirs.has(p.memberId)))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || Number(isActing(a)) - Number(isActing(b)) || a.startedOn.localeCompare(b.startedOn))
    .map((p) => {
      const since = `since ${dmy(p.startedOn)}`;
      if (isActing(p)) {
        const covered = p.covers ? data.positions.find((x) => x.id === p.covers) : undefined;
        const who = covered ? `${name(p.memberId)} for ${name(covered.memberId)}` : name(p.memberId);
        return { id: p.id, title: ROLE_LABEL[p.role], line: `${who} · ${since} · until ${dmy(p.actingUntil!)}`, chip: { label: 'Acting', tone: 'bone' } };
      }
      const state = termState(p, today);
      const ends = termEndsOn(p);
      return {
        id: p.id, title: ROLE_LABEL[p.role],
        line: `${name(p.memberId)} · ${since}${ends ? ` · ${state === 'ended' ? 'ended' : 'ends'} ${dmy(ends)}` : ''}`,
        chip: state === 'ended' ? { label: 'Past term', tone: 'danger' } : state === 'ending' ? { label: 'Ending', tone: 'warn' } : null,
      };
    });
}

/**
 * The chapter's VP when they cast its NEC vote through the fallback (11.2): nobody holds the
 * President seat, not even as acting, so the VP votes without being formally Acting President. A
 * National Chairman who is also the President isn't this case (that's the follow-on). Feeds the
 * Board tab's line and its "Make Jet Acting President" button. Expects settled data.
 */
export function vpFallbackFor(chapterId: string, data: ClubData): { memberId: string } | null {
  if (heldRows(data.positions).some((p) => p.chapterId === chapterId && p.role === 'president')) return null;
  const voter = necVoterRow(chapterId, data.positions);
  return voter?.role === 'vice_president' ? { memberId: voter.memberId } : null;
}

/** When the cover of `seat` has run unbroken from: back from its current cover through covers with no day between. */
function coveredSince(seat: Position, current: Position, positions: Position[]): string {
  const covers = positions.filter((c) => c.covers === seat.id);
  let since = current.startedOn;
  for (;;) {
    const before = covers.filter((c) => c.startedOn < since && (!isEnded(c) || c.endedOn! >= since));
    if (before.length === 0) return since;
    since = before.reduce((min, c) => (c.startedOn < min ? c.startedOn : min), since);
  }
}

/** The acting findings (9.8, 9.5, 11.2). */
function actingChecks(data: ClubData, today: string): AuditCheck[] {
  const out: AuditCheck[] = [];
  const held = heldRows(data.positions);
  const acmScheduled = (chapterId: string) =>
    (data.meetings ?? []).some((m) => m.chapterId === chapterId && m.kind === 'agm' && m.cancelledAt === null && melbourneDate(m.startsAt) >= today);

  for (const p of held) {
    if (!isActing(p) || p.covers != null || p.chapterId === null || !BOARD_ROLES.includes(p.role)) continue;
    const name = personOf(p.memberId, data);
    const detail = `${name} · ${longSeatTitle(p, data.chapters)}`;
    if (!acmScheduled(p.chapterId)) {
      out.push({ key: `acting-no-election:${p.id}`, area: 'membership', chapterId: p.chapterId, ledgerEntryId: null,
        title: `No election scheduled while ${name} acts (9.8)`, detail });
    }
    const acm = actingRunAcm(p.chapterId, p.role, p.startedOn, data);
    if (acm !== null && p.actingUntil! > acm) {
      out.push({ key: `acting-past-acm:${p.id}`, area: 'membership', chapterId: p.chapterId, ledgerEntryId: null,
        title: `${name}’s acting runs past ${chapterName(p.chapterId, data)}’s ACM on ${dm(acm)} (9.8)`, detail });
    }
  }

  for (const seat of held) {
    const cover = isActing(seat) ? null : coverOf(seat, data.positions);
    if (!cover) continue;
    const since = coveredSince(seat, cover, data.positions);
    if (today <= addMonths(since, COVER_REVIEW_MONTHS)) continue;
    const holder = personOf(seat.memberId, data);
    out.push({ key: `cover-over-3-months:${seat.id}`, area: 'membership', chapterId: seat.chapterId, ledgerEntryId: null,
      title: `${holder}’s seat has been covered for more than three months in a row (9.5 review)`,
      detail: `${holder} · ${seatTitle(seat, data.chapters, ROLE_LABEL)} · covered since ${dmy(since)}` });
  }

  for (const chapter of data.chapters) {
    const vp = vpFallbackFor(chapter.id, data);
    if (!vp) continue;
    const name = personOf(vp.memberId, data);
    out.push({ key: `vp-fallback:${chapter.id}`, area: 'membership', chapterId: chapter.id, ledgerEntryId: null,
      title: `${name} casts ${chapter.name}’s NEC vote without being formally Acting President (11.2)`,
      detail: `${name} · ${ROLE_LABEL.vice_president} (${chapter.name})` });
  }
  return out;
}

/**
 * What the books and records show that the Auditor may want to ask about. Worked out from what the
 * Auditor can read, nothing stored. `now` is an instant; dates are the club's (Melbourne) day, and
 * stints past their until date are settled first.
 */
export function auditChecks(raw: ClubData, now: string): AuditCheck[] {
  const today = melbourneDate(now);
  const data = settleActing(raw, today);
  const checks: AuditCheck[] = [];
  const push = (c: AuditCheck) => checks.push(c);
  const lines = data.ledger ?? [];

  for (const e of lines) {
    const fund = fundName(e.chapterId, data);
    const what = `${e.description} · ${money(e.amountCents)} · ${fund} fund`;
    if (e.state === 'paid' && isDebit(e.code) && e.code !== BANK_FEES && e.approvals.length < 2) {
      push({ key: `one-approval:${e.id}`, area: 'controls', chapterId: e.chapterId, ledgerEntryId: e.id,
        title: 'Paid without two approvals (13.3)', detail: what });
    }
    if (e.state !== 'void' && e.payeeMemberId && e.approvals.some((a) => a.memberId === e.payeeMemberId)) {
      push({ key: `payee-approved:${e.id}`, area: 'controls', chapterId: e.chapterId, ledgerEntryId: e.id,
        title: 'The payee approved their own payment (13.3)', detail: what });
    }
    if (e.state !== 'void' && bankedLate(e)) {
      push({ key: `banked-late:${e.id}`, area: 'bank', chapterId: e.chapterId, ledgerEntryId: e.id,
        title: 'Banked more than five working days after it came in (13.1)',
        detail: `${what} · came in ${dmy(e.receivedOn!)}, banked ${dmy(e.entryOn!)}` });
    }
  }

  const inBooks = new Set(lines.map((e) => e.paymentId).filter(Boolean));
  for (const p of data.payments ?? []) {
    const charge = (data.charges ?? []).find((c) => c.id === p.chargeId);
    if (!charge || p.state !== 'confirmed' || inBooks.has(p.id)) continue;
    const who = data.members.find((m) => m.id === charge.memberId);
    push({ key: `fee-not-in-books:${p.id}`, area: 'transactions', chapterId: charge.chapterId, ledgerEntryId: null,
      title: 'A confirmed fee payment isn’t in the books',
      detail: `${who?.roadName ?? who?.fullName ?? 'A member'} · ${money(p.amountCents)} · paid ${dmy(p.paidOn)}` });
  }

  const thisMonth = monthOf(today);
  const presented = new Set((data.treasurerReports ?? []).map((r) => r.month));
  const months = new Set(lines.filter((e) => e.state === 'paid' && e.entryOn).map((e) => monthOf(e.entryOn!)));
  for (const month of [...months].sort()) {
    if (month >= thisMonth || presented.has(month)) continue;
    push({ key: `not-presented:${month}`, area: 'bank', chapterId: null, ledgerEntryId: null,
      title: 'A month’s Treasurer’s Report was never presented', detail: `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)} has lines in the books` });
  }

  const fy = fyOf(today);
  for (const chapterId of [null, ...data.chapters.map((c) => c.id)]) {
    const budget = budgetOf(chapterId, fy, data);
    if (budget?.approvedAt) continue;
    push({ key: `no-budget:${chapterId ?? 'club'}`, area: 'controls', chapterId, ledgerEntryId: null,
      title: budget ? 'This year’s budget isn’t approved yet (13.4)' : 'No budget for this year (13.4)',
      detail: `${fundName(chapterId, data)} fund` });
  }

  for (const p of data.positions) {
    // An acting stint isn't a term: it ends on its own at its until date.
    if (isEnded(p) || isActing(p) || termState(p, today) !== 'ended') continue;
    const holder = data.members.find((m) => m.id === p.memberId);
    push({ key: `term-ended:${p.id}`, area: 'membership', chapterId: p.chapterId, ledgerEntryId: null,
      title: 'A term has run past its end',
      detail: `${holder?.roadName ?? holder?.fullName ?? 'A member'} · ${p.role.replace(/_/g, ' ')} · ended ${dmy(termEndsOn(p)!)}` });
  }

  checks.push(...actingChecks(data, today));

  for (const m of data.meetings ?? []) {
    if (minutesState(m, now) !== 'overdue') continue;
    push({ key: `minutes-overdue:${m.id}`, area: 'policy', chapterId: m.chapterId, ledgerEntryId: null,
      title: 'Minutes not out within seven days (10.8)', detail: `${m.title} · ${dmy(melbourneDate(m.startsAt))}` });
  }

  for (const chapter of data.chapters) {
    const behind = data.members.filter((m) => m.chapterId === chapter.id && standingOf(m, data, today)?.lines.some((l) => l.state === 'behind'));
    if (behind.length === 0) continue;
    push({ key: `attendance-behind:${chapter.id}`, area: 'attendance', chapterId: chapter.id, ledgerEntryId: null,
      title: 'Members behind on attendance (5.2, 4.6)',
      detail: `${behind.length} in ${chapter.name}` });
  }

  return checks;
}
