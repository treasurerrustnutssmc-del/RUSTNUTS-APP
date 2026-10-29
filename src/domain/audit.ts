// The National Auditor's work (constitution v4, 11.8): written requests to a board or the NEC,
// findings reports, and the checks the app runs over the books and records. The Auditor reads
// and asks; they never change the records themselves. The database's actions
// (supabase/migrations/20270535000000_national_auditor.sql) apply the same rules with the same words.

import { activePositions, isAuditor, isNational } from './access';
import { BOARD_ROLES } from './labels';
import { BANK_FEES, bankedLate, budgetOf, fundName, monthOf, isDebit } from './ledger';
import { fyOf } from './fees';
import { minutesState, runsScope, signedInProblem } from './meetings';
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

/** A board seat in any chapter, or the NEC. */
function onAnyBoard(me: Member, positions: Position[]): boolean {
  return isNational(me.id, positions) || activePositions(me.id, positions).some((p) => BOARD_ROLES.includes(p.role));
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
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * What the books and records show that the Auditor may want to ask about. Worked out from what the
 * Auditor can read, nothing stored. `now` is an instant; dates are the club's (Melbourne) day.
 */
export function auditChecks(data: ClubData, now: string): AuditCheck[] {
  const today = melbourneDate(now);
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
      title: 'A month’s Treasurer’s Report was never presented', detail: `${dmy(month).slice(3)} has lines in the books` });
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
    if (p.endedOn !== null || termState(p, today) !== 'ended') continue;
    const holder = data.members.find((m) => m.id === p.memberId);
    push({ key: `term-ended:${p.id}`, area: 'membership', chapterId: p.chapterId, ledgerEntryId: null,
      title: 'A term has run past its end',
      detail: `${holder?.roadName ?? holder?.fullName ?? 'A member'} · ${p.role.replace(/_/g, ' ')} · ended ${dmy(termEndsOn(p)!)}` });
  }

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
