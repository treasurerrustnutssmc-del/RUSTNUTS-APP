// The treasurer's books: one bank account split into funds (the Club fund, chapterId null, and one
// per chapter), the club's own payment codes, two approvers for every payment, budgets and the
// monthly Treasurer's Report. Section numbers refer to the constitution (v4, section 13); rules
// marked (inferred) are ones it doesn't settle. The database's actions
// (supabase/migrations/20270101000200_treasurer.sql) apply the same rules with the same words.

import { activePositions, holdsBoardSeat } from './access';
import { fyOf } from './fees';
import { signedInProblem } from './meetings';
import { melbourneDate } from './rides';
import type {
  Budget, ClubData, LedgerCode, LedgerEntry, Member, MonthReport, Payment, Position, Vote,
} from './types';

export const CREDIT_CODES: LedgerCode[] = ['CR-001', 'CR-002', 'CR-003', 'CR-004', 'CR-005', 'CR-006', 'CR-007'];
export const DEBIT_CODES: LedgerCode[] = ['DB-001', 'DB-002', 'DB-003', 'DB-004', 'DB-005', 'DB-006', 'DB-007'];
export const LEDGER_CODES: LedgerCode[] = [...CREDIT_CODES, ...DEBIT_CODES];

/** The labels on the club's Treasurer's Report. */
export const CODE_LABEL: Record<LedgerCode, string> = {
  'CR-001': 'Member fees',
  'CR-002': 'Donations to RSMC',
  'CR-003': 'Club payment',
  'CR-004': 'Bank interest',
  'CR-005': 'Merchandise sales',
  'CR-006': 'Meeting food',
  'CR-007': 'Event buy-in',
  'DB-001': 'Club expenses',
  'DB-002': 'Donations to charity',
  'DB-003': 'Misc',
  'DB-004': 'Bank fees',
  'DB-005': 'Merchandise purchase',
  'DB-006': 'Refund',
  'DB-007': 'Club meeting expense',
};

/** The bank takes its fees, so they need no approval (inferred). */
export const BANK_FEES: LedgerCode = 'DB-004';
export const FEES_CODE: LedgerCode = 'CR-001';

/** Money in has to be banked within five working days (13.1). */
export const BANK_WITHIN_WORKING_DAYS = 5;

export const isCredit = (code: string): boolean => (CREDIT_CODES as string[]).includes(code);
export const isDebit = (code: string): boolean => (DEBIT_CODES as string[]).includes(code);

const holds = (me: Member, positions: Position[], test: (p: Position) => boolean) =>
  activePositions(me.id, positions).some(test);
const approved = (me: Member | null): me is Member => !!me && me.approval === 'approved';
const isNecMoney = (p: Position) => p.role === 'nec_chair' || p.role === 'nec_secretary';

/**
 * Keeps a fund's books: its chapter's Treasurer, or the National Chairman or Secretary. The Club
 * fund's books are kept by any chapter Treasurer too, standing in for the Association Treasurer (inferred).
 */
export function keepsBooks(me: Member | null, chapterId: string | null, positions: Position[]): boolean {
  if (!approved(me)) return false;
  return holds(me, positions, (p) => isNecMoney(p) || (p.role === 'treasurer' && (chapterId === null || p.chapterId === chapterId)));
}

/**
 * Can approve a fund's spending (13.3): a chapter's board seats, or for the Club fund the sitting
 * Presidents; the National Chairman and Secretary for both. Never the National Auditor (11.8).
 */
export function approvesFor(me: Member | null, chapterId: string | null, positions: Position[]): boolean {
  if (!approved(me)) return false;
  if (holds(me, positions, isNecMoney)) return true;
  return chapterId === null
    ? holds(me, positions, (p) => p.role === 'president')
    : holdsBoardSeat(me.id, chapterId, positions);
}

export function isAuditor(me: Member | null, positions: Position[]): boolean {
  return approved(me) && holds(me, positions, (p) => p.role === 'nec_auditor');
}

/** Reads a fund's lines: whoever keeps or approves for it, and the National Auditor (11.8). */
export function seesLedger(me: Member | null, chapterId: string | null, positions: Position[]): boolean {
  return keepsBooks(me, chapterId, positions) || approvesFor(me, chapterId, positions) || isAuditor(me, positions);
}

/** Reads any fund's lines. */
export function seesAnyLedger(me: Member | null, data: ClubData): boolean {
  return [null, ...data.chapters.map((c) => c.id)].some((f) => seesLedger(me, f, data.positions));
}

/** Presented reports are for every approved member who hasn't left (13.8). */
export function seesReports(me: Member | null): boolean {
  return approved(me) && me.status !== 'legacy';
}

export function fundName(chapterId: string | null, data: Pick<ClubData, 'chapters'>): string {
  if (chapterId === null) return 'Club';
  return data.chapters.find((c) => c.id === chapterId)?.name ?? 'Chapter';
}

// Refusals --------------------------------------------------------------------------------------

export const KEEPS_ONLY = 'Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.';
export const APPROVERS_ONLY = 'You can’t approve spending from this fund.';
export const PAYEE_CANT_APPROVE = 'The payee can’t approve their own payment (13.3).';
export const NEEDS_TWO = 'It needs two approvals before it’s paid (13.3).';
export const AMOUNT = 'Enter an amount over $0.';
export const FUTURE = 'That date hasn’t happened yet.';
export const BUDGET_VOTE = 'Pick a carried board vote for this budget (13.4).';
export const BUDGET_LOCKED = 'That budget is approved and locked. Reopen it to change it.';
export const BUDGET_BOARD = 'Only that fund’s board, or the National Chairman or Secretary, approves its budget.';
export const BUDGET_STALE_VOTE = 'That vote closed before the budget’s last change. It needs a new vote (13.4).';
export const PAID_BEFORE_APPROVED = 'It can’t be paid before it was approved (13.3).';

const isAmount = (cents: number) => Number.isInteger(cents) && cents > 0;
const isIsoDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function fundProblem(me: Member | null, chapterId: string | null, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (chapterId !== null && !data.chapters.some((c) => c.id === chapterId)) return 'No such fund.';
  return keepsBooks(me, chapterId, data.positions) ? null : KEEPS_ONLY;
}

export interface CreditInput {
  chapterId: string | null;
  code: LedgerCode;
  description: string;
  amountCents: number;
  receivedOn: string | null;
  entryOn: string;
}

export function creditProblem(me: Member | null, input: CreditInput, data: ClubData, today: string): string | null {
  const fund = fundProblem(me, input.chapterId, data);
  if (fund) return fund;
  if (!isCredit(input.code)) return 'Pick a money-in code.';
  if (!input.description.trim()) return 'Say what it’s for.';
  if (!isAmount(input.amountCents)) return AMOUNT;
  if (!isIsoDate(input.entryOn)) return 'Pick the date it was banked.';
  if (input.entryOn > today) return FUTURE;
  if (input.receivedOn !== null && input.receivedOn > input.entryOn) return 'It can’t be banked before it came in.';
  return null;
}

export interface DebitInput {
  chapterId: string | null;
  code: LedgerCode;
  description: string;
  amountCents: number;
  payeeMemberId: string | null;
  payeeName: string | null;
  /** Bank fees only: they're paid when they're recorded. */
  paidOn: string | null;
}

export function debitProblem(me: Member | null, input: DebitInput, data: ClubData, today: string): string | null {
  const fund = fundProblem(me, input.chapterId, data);
  if (fund) return fund;
  if (!isDebit(input.code)) return 'Pick a money-out code.';
  if (!input.description.trim()) return 'Say what it’s for.';
  if (!isAmount(input.amountCents)) return AMOUNT;
  if (input.code === BANK_FEES) {
    if (!isIsoDate(input.paidOn)) return 'Pick the date the bank took it.';
    if (input.paidOn > today) return FUTURE;
    return null;
  }
  if (input.payeeMemberId !== null) {
    const payee = data.members.find((m) => m.id === input.payeeMemberId);
    if (!payee || payee.approval !== 'approved') return 'No such member.';
  } else if (!input.payeeName?.trim()) {
    return 'Say who’s being paid.';
  }
  return null;
}

const entryOf = (id: string, data: ClubData) => (data.ledger ?? []).find((e) => e.id === id);

export function approveProblem(me: Member | null, entryId: string, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const entry = entryOf(entryId, data);
  if (!entry) return 'No such entry.';
  if (!approvesFor(me, entry.chapterId, data.positions)) return APPROVERS_ONLY;
  if (entry.state !== 'awaiting') return 'That isn’t waiting for approval.';
  if (entry.payeeMemberId === me!.id) return PAYEE_CANT_APPROVE;
  if (entry.approvals.some((a) => a.memberId === me!.id)) return 'You’ve already approved this.';
  return null;
}

export function payProblem(me: Member | null, entryId: string, paidOn: string, data: ClubData, today: string): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const entry = entryOf(entryId, data);
  if (!entry) return 'No such entry.';
  if (!keepsBooks(me, entry.chapterId, data.positions)) return KEEPS_ONLY;
  if (entry.state === 'awaiting') return NEEDS_TWO;
  if (entry.state !== 'approved') return 'That’s already been paid or voided.';
  if (!isIsoDate(paidOn)) return 'Pick the date it was paid.';
  if (paidOn > today) return FUTURE;
  const approvedOn = entry.approvals.map((a) => melbourneDate(a.approvedAt)).sort().pop();
  if (approvedOn && paidOn < approvedOn) return PAID_BEFORE_APPROVED;
  return null;
}

export function voidProblem(me: Member | null, entryId: string, reason: string, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const entry = entryOf(entryId, data);
  if (!entry) return 'No such entry.';
  if (!keepsBooks(me, entry.chapterId, data.positions)) return KEEPS_ONLY;
  if (entry.state === 'void') return 'That’s already void.';
  if (!reason.trim()) return 'Say why it’s being voided.';
  return null;
}

export function addFeeProblem(me: Member | null, paymentId: string, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  const payment = (data.payments ?? []).find((p) => p.id === paymentId);
  const charge = payment && (data.charges ?? []).find((c) => c.id === payment.chargeId);
  if (!payment || !charge) return 'No such payment.';
  if (!keepsBooks(me, charge.chapterId, data.positions)) return KEEPS_ONLY;
  if (payment.state !== 'confirmed') return 'Only a confirmed payment goes in the ledger.';
  if ((data.ledger ?? []).some((e) => e.paymentId === paymentId)) return 'That payment is already in the ledger.';
  return null;
}

export function openingProblem(me: Member | null, chapterId: string | null, fy: number, amountCents: number, data: ClubData): string | null {
  const fund = fundProblem(me, chapterId, data);
  if (fund) return fund;
  if (!Number.isInteger(fy) || fy < 2019 || fy > 2100) return 'Pick a financial year.';
  return Number.isInteger(amountCents) ? null : 'Enter an amount.';
}

export function floatProblem(me: Member | null, fy: number, amountCents: number, data: ClubData): string | null {
  const fund = fundProblem(me, null, data);
  if (fund) return fund;
  if (!Number.isInteger(fy) || fy < 2019 || fy > 2100) return 'Pick a financial year.';
  return Number.isInteger(amountCents) && amountCents >= 0 ? null : 'Enter an amount of $0 or more.';
}

export const budgetOf = (chapterId: string | null, fy: number, data: ClubData): Budget | undefined =>
  (data.budgets ?? []).find((b) => b.chapterId === chapterId && b.fy === fy);

export function budgetProblem(
  me: Member | null, chapterId: string | null, fy: number, lines: Partial<Record<string, number>>, data: ClubData,
): string | null {
  const fund = fundProblem(me, chapterId, data);
  if (fund) return fund;
  if (!Number.isInteger(fy) || fy < 2019 || fy > 2100) return 'Pick a financial year.';
  if (budgetOf(chapterId, fy, data)?.approvedAt) return BUDGET_LOCKED;
  for (const [code, cents] of Object.entries(lines)) {
    if (!(LEDGER_CODES as string[]).includes(code)) return 'Pick a payment code.';
    if (!Number.isInteger(cents) || cents! < 0) return 'Budget amounts must be $0 or more.';
  }
  return null;
}

/** The vote that approves a budget: carried, in the fund's scope, by its board or the NEC (13.4). */
export function budgetVoteFits(vote: Vote | undefined, chapterId: string | null): boolean {
  if (!vote || vote.result !== 'carried' || vote.chapterId !== chapterId) return false;
  return vote.electorate === (chapterId === null ? 'nec' : 'chapter_board');
}

export function approveBudgetProblem(me: Member | null, chapterId: string | null, fy: number, voteId: string, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!approvesFor(me, chapterId, data.positions)) return BUDGET_BOARD;
  const budget = budgetOf(chapterId, fy, data);
  if (!budget) return 'Save the budget first.';
  if (budget.approvedAt) return 'That budget is already approved.';
  const vote = (data.votes ?? []).find((v) => v.id === voteId);
  if (!budgetVoteFits(vote, chapterId)) return BUDGET_VOTE;
  return (vote!.closedAt ?? '') > budget.updatedAt ? null : BUDGET_STALE_VOTE;
}

export function reopenBudgetProblem(me: Member | null, chapterId: string | null, fy: number, data: ClubData): string | null {
  const signedIn = signedInProblem(me);
  if (signedIn) return signedIn;
  if (!approvesFor(me, chapterId, data.positions)) return BUDGET_BOARD;
  return budgetOf(chapterId, fy, data)?.approvedAt ? null : 'That budget isn’t approved.';
}

/** "2026-08-14" → "2026-08-01". */
export const monthOf = (iso: string): string => `${iso.slice(0, 7)}-01`;

/** The last day of the month that `month` (its first day) starts. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export function presentProblem(me: Member | null, month: string, data: ClubData, today: string): string | null {
  const fund = fundProblem(me, null, data);
  if (fund) return fund;
  if (!/^\d{4}-\d{2}-01$/.test(month)) return 'Pick a month.';
  if (monthEnd(month) >= today) return 'Wait until the month is over.';
  if ((data.treasurerReports ?? []).some((r) => r.month === month)) return 'That month is already presented.';
  return null;
}

// Working it out --------------------------------------------------------------------------------

const DAY = 86_400_000;
const dayNo = (iso: string) => Math.round(new Date(`${iso}T00:00:00Z`).getTime() / DAY);

/** Monday to Friday after `from`, up to and including `to`. Public holidays aren't counted out (inferred). */
export function workingDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = dayNo(from) + 1; d <= dayNo(to); d++) {
    const weekday = new Date(d * DAY).getUTCDay();
    if (weekday !== 0 && weekday !== 6) n++;
  }
  return n;
}

/** Money banked more than five working days after it came in (13.1). */
export function bankedLate(entry: Pick<LedgerEntry, 'receivedOn' | 'entryOn' | 'code'>): boolean {
  if (!isCredit(entry.code) || !entry.receivedOn || !entry.entryOn) return false;
  return workingDaysBetween(entry.receivedOn, entry.entryOn) > BANK_WITHIN_WORKING_DAYS;
}

const signed = (e: LedgerEntry) => (isCredit(e.code) ? e.amountCents : -e.amountCents);
const fyStart = (fy: number) => `${fy}-07-01`;
const paidIn = (e: LedgerEntry, chapterId: string | null, from: string | null, to: string) =>
  e.state === 'paid' && e.chapterId === chapterId && e.entryOn !== null && e.entryOn <= to && (from === null || e.entryOn >= from);

/**
 * A fund's balance at the end of `upTo`: the latest opening set for that financial year or
 * before, plus everything paid since. With no opening at all, it counts from nothing.
 */
export function fundBalance(chapterId: string | null, upTo: string, data: ClubData): number {
  const fy = fyOf(upTo);
  const opening = (data.fundOpenings ?? [])
    .filter((o) => o.chapterId === chapterId && o.fy <= fy)
    .sort((a, b) => b.fy - a.fy)[0];
  const from = opening ? fyStart(opening.fy) : null;
  return (opening?.amountCents ?? 0) +
    (data.ledger ?? []).filter((e) => paidIn(e, chapterId, from, upTo)).reduce((s, e) => s + signed(e), 0);
}

/** The cash float for a year: the latest one set for that year or before. */
export function floatFor(fy: number, data: ClubData): number {
  return (data.cashFloats ?? []).filter((f) => f.fy <= fy).sort((a, b) => b.fy - a.fy)[0]?.amountCents ?? 0;
}

const dayBefore = (iso: string) => new Date((dayNo(iso) - 1) * DAY).toISOString().slice(0, 10);
export const fundKey = (chapterId: string | null) => chapterId ?? 'club';

/** The monthly Treasurer's Report, worked out from the paid entries. */
export function monthReport(month: string, data: ClubData): MonthReport {
  const end = monthEnd(month);
  const funds: (string | null)[] = [null, ...data.chapters.map((c) => c.id)];
  const inMonth = (data.ledger ?? []).filter((e) => e.entryOn !== null && e.entryOn >= month && e.entryOn <= end);
  const paid = inMonth.filter((e) => e.state === 'paid');
  const total = (code: LedgerCode) => paid.filter((e) => e.code === code).reduce((s, e) => s + e.amountCents, 0);
  const credits = CREDIT_CODES.map((code) => ({ code, cents: total(code) }));
  const debits = DEBIT_CODES.map((code) => ({ code, cents: total(code) }));
  const balances: Record<string, number> = {};
  for (const f of funds) balances[fundKey(f)] = fundBalance(f, end, data);
  const totalCents = Object.values(balances).reduce((s, n) => s + n, 0);
  const floatCents = floatFor(fyOf(month), data);
  const changes = inMonth.map((e) => e.updatedAt).sort();
  return {
    month,
    openingCents: funds.reduce((s, f) => s + balanceBefore(f, month, data), 0),
    credits,
    creditTotal: credits.reduce((s, c) => s + c.cents, 0),
    debits,
    debitTotal: debits.reduce((s, c) => s + c.cents, 0),
    funds: balances,
    totalCents,
    floatCents,
    bankCents: totalCents - floatCents,
    lastChangeAt: changes[changes.length - 1] ?? null,
  };
}

/**
 * A fund's balance as a month starts. On 1 July a fund with an opening for the new year starts
 * from it, not from June's running balance.
 */
function balanceBefore(chapterId: string | null, month: string, data: ClubData): number {
  const opening = month.slice(5, 7) === '07'
    ? (data.fundOpenings ?? []).find((o) => o.chapterId === chapterId && o.fy === fyOf(month))
    : undefined;
  return opening ? opening.amountCents : fundBalance(chapterId, dayBefore(month), data);
}

/** A presented month's report: the database's totals in live mode for members, else worked out here. */
export function reportFor(month: string, data: ClubData): MonthReport {
  return (data.reportTotals ?? []).find((r) => r.month === month) ?? monthReport(month, data);
}

/** Changed after it was presented. */
export function updatedSince(report: MonthReport, presentedAt: string): boolean {
  return report.lastChangeAt !== null && report.lastChangeAt > presentedAt;
}

export interface BudgetLine {
  code: LedgerCode;
  budgetCents: number | null;
  actualCents: number;
  /** Budget minus actual, or null with no budget for the code. */
  leftCents: number | null;
}

/** Budget against actual for a fund's year, for every code that has either. */
export function budgetLines(chapterId: string | null, fy: number, data: ClubData): BudgetLine[] {
  const budget = budgetOf(chapterId, fy, data);
  const from = fyStart(fy);
  const to = `${fy + 1}-06-30`;
  return LEDGER_CODES.flatMap((code) => {
    const actualCents = (data.ledger ?? [])
      .filter((e) => e.code === code && paidIn(e, chapterId, from, to))
      .reduce((s, e) => s + e.amountCents, 0);
    const budgetCents = budget?.lines[code] ?? null;
    if (budgetCents === null && actualCents === 0) return [];
    return [{ code, budgetCents, actualCents, leftCents: budgetCents === null ? null : budgetCents - actualCents }];
  });
}

/** Confirmed fee payments, in funds `me` keeps, that aren't in the ledger yet. */
export function feesToAdd(me: Member | null, data: ClubData): { payment: Payment; chapterId: string; memberId: string }[] {
  const inLedger = new Set((data.ledger ?? []).map((e) => e.paymentId).filter(Boolean));
  return (data.payments ?? []).flatMap((payment) => {
    const charge = (data.charges ?? []).find((c) => c.id === payment.chargeId);
    if (!charge || payment.state !== 'confirmed' || inLedger.has(payment.id)) return [];
    if (!keepsBooks(me, charge.chapterId, data.positions)) return [];
    return [{ payment, chapterId: charge.chapterId, memberId: charge.memberId }];
  });
}

/** Debits waiting on `me`'s approval. */
export function needsMyApproval(me: Member | null, data: ClubData): LedgerEntry[] {
  return (data.ledger ?? []).filter((e) => approveProblem(me, e.id, data) === null);
}
