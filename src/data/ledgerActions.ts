// What each treasurer action does to the demo club, under the same rules as the database
// (src/domain/ledger.ts; checked by src/data/parity.test.ts).

import {
  addFeeProblem, approveBudgetProblem, approveProblem, approvesFor, BANK_FEES, budgetProblem, creditProblem, debitProblem,
  FEES_CODE, floatProblem, openingProblem, payProblem, presentProblem, reopenBudgetProblem, voidProblem,
  type CreditInput, type DebitInput,
} from '../domain/ledger';
import { deleteMeetingProblem, meetingProblem, presentMeetingProblem, type MeetingReportInput } from '../domain/meetingReport';
import type { Budget, ClubData, LedgerCode, LedgerEntry } from '../domain/types';
import { NotAllowedError } from './clubContext';
import type { DemoCtx } from './demoActions';

let idCounter = 0;
const newId = () => `le-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const nowOf = (ctx: DemoCtx) => ctx.now ?? new Date().toISOString();
const blankToNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

function refuse(problem: string | null): void {
  if (problem) throw new NotAllowedError(problem);
}

const ledgerOf = (data: ClubData) => data.ledger ?? [];

function withEntry(data: ClubData, id: string, change: (e: LedgerEntry) => LedgerEntry): ClubData {
  return { ...data, ledger: ledgerOf(data).map((e) => (e.id === id ? change(e) : e)) };
}

function added(ctx: DemoCtx, fields: Omit<LedgerEntry, 'id' | 'recordedBy' | 'recordedAt' | 'updatedAt' | 'voidReason' | 'voidedBy'>) {
  const now = nowOf(ctx);
  const entry: LedgerEntry = { id: newId(), ...fields, recordedBy: ctx.me!.id, recordedAt: now, updatedAt: now, voidReason: null, voidedBy: null };
  return { data: { ...ctx.data, ledger: [...ledgerOf(ctx.data), entry] }, id: entry.id };
}

export function recordCredit(ctx: DemoCtx, input: CreditInput): { data: ClubData; id: string } {
  refuse(creditProblem(ctx.me, input, ctx.data, ctx.today));
  return added(ctx, {
    chapterId: input.chapterId, code: input.code, description: input.description.trim(), amountCents: input.amountCents,
    receivedOn: input.receivedOn ?? input.entryOn, entryOn: input.entryOn, payeeMemberId: null, payeeName: null, paymentId: null,
    state: 'paid', approvals: [],
  });
}

/**
 * A debit waits for two approvals. Whoever records it counts as the first when they can approve
 * for that fund and aren't the payee (inferred). The bank takes its fees, so those are paid.
 */
export function recordDebit(ctx: DemoCtx, input: DebitInput): { data: ClubData; id: string } {
  refuse(debitProblem(ctx.me, input, ctx.data, ctx.today));
  const bank = input.code === BANK_FEES;
  const selfApproves = !bank && approvesFor(ctx.me, input.chapterId, ctx.data.positions) && input.payeeMemberId !== ctx.me!.id;
  return added(ctx, {
    chapterId: input.chapterId, code: input.code, description: input.description.trim(), amountCents: input.amountCents,
    receivedOn: null, entryOn: bank ? input.paidOn : null,
    payeeMemberId: bank ? null : input.payeeMemberId, payeeName: bank ? blankToNull(input.payeeName) ?? 'Bank' : blankToNull(input.payeeName),
    paymentId: null, state: bank ? 'paid' : 'awaiting',
    approvals: selfApproves ? [{ memberId: ctx.me!.id, approvedAt: nowOf(ctx) }] : [],
  });
}

/** The second distinct approval makes it approved (13.3). */
export function approveDebit(ctx: DemoCtx, id: string): ClubData {
  refuse(approveProblem(ctx.me, id, ctx.data));
  const now = nowOf(ctx);
  return withEntry(ctx.data, id, (e) => {
    const approvals = [...e.approvals, { memberId: ctx.me!.id, approvedAt: now }];
    return { ...e, approvals, state: approvals.length >= 2 ? 'approved' : 'awaiting', updatedAt: now };
  });
}

export function payDebit(ctx: DemoCtx, id: string, paidOn: string): ClubData {
  refuse(payProblem(ctx.me, id, paidOn, ctx.data, ctx.today));
  return withEntry(ctx.data, id, (e) => ({ ...e, state: 'paid', entryOn: paidOn, updatedAt: nowOf(ctx) }));
}

/** Nothing is ever removed (13.5): a void line stays, and counts for nothing. */
export function voidEntry(ctx: DemoCtx, id: string, reason: string): ClubData {
  refuse(voidProblem(ctx.me, id, reason, ctx.data));
  return withEntry(ctx.data, id, (e) => ({ ...e, state: 'void', voidReason: reason.trim(), voidedBy: ctx.me!.id, updatedAt: nowOf(ctx) }));
}

/** A confirmed fee payment, as CR-001 in its chapter's fund, on the day it was paid. */
export function addFeePayment(ctx: DemoCtx, paymentId: string): { data: ClubData; id: string } {
  refuse(addFeeProblem(ctx.me, paymentId, ctx.data));
  const payment = (ctx.data.payments ?? []).find((p) => p.id === paymentId)!;
  const charge = (ctx.data.charges ?? []).find((c) => c.id === payment.chargeId)!;
  const member = ctx.data.members.find((m) => m.id === charge.memberId);
  const name = member?.roadName ?? member?.fullName ?? 'Member';
  return added(ctx, {
    chapterId: charge.chapterId, code: FEES_CODE, description: `Member fees: ${name}`, amountCents: payment.amountCents,
    receivedOn: payment.paidOn, entryOn: payment.paidOn, payeeMemberId: null, payeeName: null, paymentId,
    state: 'paid', approvals: [],
  });
}

export function setOpening(ctx: DemoCtx, chapterId: string | null, fy: number, amountCents: number): ClubData {
  refuse(openingProblem(ctx.me, chapterId, fy, amountCents, ctx.data));
  const rest = (ctx.data.fundOpenings ?? []).filter((o) => !(o.chapterId === chapterId && o.fy === fy));
  return { ...ctx.data, fundOpenings: [...rest, { chapterId, fy, amountCents }] };
}

export function setCashFloat(ctx: DemoCtx, fy: number, amountCents: number): ClubData {
  refuse(floatProblem(ctx.me, fy, amountCents, ctx.data));
  const rest = (ctx.data.cashFloats ?? []).filter((f) => f.fy !== fy);
  return { ...ctx.data, cashFloats: [...rest, { fy, amountCents }] };
}

function withBudget(data: ClubData, chapterId: string | null, fy: number, change: (b: Budget | undefined) => Budget): ClubData {
  const budgets = data.budgets ?? [];
  const old = budgets.find((b) => b.chapterId === chapterId && b.fy === fy);
  const rest = budgets.filter((b) => b !== old);
  return { ...data, budgets: [...rest, change(old)] };
}

export function saveBudget(ctx: DemoCtx, chapterId: string | null, fy: number, lines: Partial<Record<LedgerCode, number>>): ClubData {
  refuse(budgetProblem(ctx.me, chapterId, fy, lines, ctx.data));
  return withBudget(ctx.data, chapterId, fy, () => ({ chapterId, fy, lines, approvedVoteId: null, approvedAt: null, approvedBy: null, updatedAt: nowOf(ctx) }));
}

export function approveBudget(ctx: DemoCtx, chapterId: string | null, fy: number, voteId: string): ClubData {
  refuse(approveBudgetProblem(ctx.me, chapterId, fy, voteId, ctx.data));
  return withBudget(ctx.data, chapterId, fy, (b) => ({ ...b!, approvedVoteId: voteId, approvedAt: nowOf(ctx), approvedBy: ctx.me!.id }));
}

export function reopenBudget(ctx: DemoCtx, chapterId: string | null, fy: number): ClubData {
  refuse(reopenBudgetProblem(ctx.me, chapterId, fy, ctx.data));
  return withBudget(ctx.data, chapterId, fy, (b) => ({ ...b!, approvedVoteId: null, approvedAt: null, approvedBy: null, updatedAt: nowOf(ctx) }));
}

export function presentReport(ctx: DemoCtx, month: string): ClubData {
  refuse(presentProblem(ctx.me, month, ctx.data, ctx.today));
  return { ...ctx.data, treasurerReports: [...(ctx.data.treasurerReports ?? []), { month, presentedAt: nowOf(ctx), presentedBy: ctx.me!.id }] };
}

/** Saves a new meeting report (id null) or changes a draft. */
export function saveMeetingReport(ctx: DemoCtx, id: string | null, input: MeetingReportInput): { data: ClubData; id: string } {
  refuse(meetingProblem(ctx.me, id, input, ctx.data, ctx.today));
  const reports = ctx.data.meetingReports ?? [];
  const fields = { fromOn: input.fromOn, toOn: input.toOn, notes: input.notes, savedBy: ctx.me!.id, savedAt: nowOf(ctx) };
  if (id !== null) {
    return { data: { ...ctx.data, meetingReports: reports.map((r) => (r.id === id ? { ...r, ...fields } : r)) }, id };
  }
  const report = { id: `mr-${newId()}`, ...fields, presentedBy: null, presentedAt: null };
  return { data: { ...ctx.data, meetingReports: [...reports, report] }, id: report.id };
}

export function presentMeetingReport(ctx: DemoCtx, id: string): ClubData {
  refuse(presentMeetingProblem(ctx.me, id, ctx.data));
  const meetingReports = (ctx.data.meetingReports ?? []).map((r) => (r.id === id ? { ...r, presentedBy: ctx.me!.id, presentedAt: nowOf(ctx) } : r));
  return { ...ctx.data, meetingReports };
}

export function deleteMeetingReport(ctx: DemoCtx, id: string): ClubData {
  refuse(deleteMeetingProblem(ctx.me, id, ctx.data));
  return { ...ctx.data, meetingReports: (ctx.data.meetingReports ?? []).filter((r) => r.id !== id) };
}

/** The treasurer actions the shared parity cases use, by name. Dates are ISO; a case gives them as …Days from today. */
export type LedgerAction =
  | { action: 'recordCredit'; chapter: string | null; code: LedgerCode; description: string; amountCents: number; receivedOn?: string; entryOn?: string }
  | {
      action: 'recordDebit'; chapter: string | null; code: LedgerCode; description: string; amountCents: number;
      payee?: string; payeeName?: string; paidOn?: string;
    }
  | { action: 'approveDebit'; entry: string }
  | { action: 'payDebit'; entry: string; paidOn?: string }
  | { action: 'voidEntry'; entry: string; reason: string }
  | { action: 'addFeePayment'; payment: string }
  | { action: 'setOpening'; chapter: string | null; fy: number; amountCents: number }
  | { action: 'setCashFloat'; fy: number; amountCents: number }
  | { action: 'saveBudget'; chapter: string | null; fy: number; lines: Partial<Record<LedgerCode, number>> }
  | { action: 'approveBudget'; chapter: string | null; fy: number; vote: string }
  | { action: 'reopenBudget'; chapter: string | null; fy: number }
  | { action: 'presentReport'; month: string }
  | { action: 'saveMeetingReport'; from?: string; to?: string; notes?: string };

export const LEDGER_ACTIONS = new Set<string>([
  'recordCredit', 'recordDebit', 'approveDebit', 'payDebit', 'voidEntry', 'addFeePayment', 'setOpening', 'setCashFloat',
  'saveBudget', 'approveBudget', 'reopenBudget', 'presentReport', 'saveMeetingReport',
]);

export function runLedgerAction(ctx: DemoCtx, a: LedgerAction): ClubData {
  switch (a.action) {
    case 'recordCredit':
      return recordCredit(ctx, {
        chapterId: a.chapter, code: a.code, description: a.description, amountCents: a.amountCents,
        receivedOn: a.receivedOn ?? null, entryOn: a.entryOn ?? '',
      }).data;
    case 'recordDebit':
      return recordDebit(ctx, {
        chapterId: a.chapter, code: a.code, description: a.description, amountCents: a.amountCents,
        payeeMemberId: a.payee ?? null, payeeName: a.payeeName ?? null, paidOn: a.paidOn ?? null,
      }).data;
    case 'approveDebit':
      return approveDebit(ctx, a.entry);
    case 'payDebit':
      return payDebit(ctx, a.entry, a.paidOn ?? '');
    case 'voidEntry':
      return voidEntry(ctx, a.entry, a.reason);
    case 'addFeePayment':
      return addFeePayment(ctx, a.payment).data;
    case 'setOpening':
      return setOpening(ctx, a.chapter, a.fy, a.amountCents);
    case 'setCashFloat':
      return setCashFloat(ctx, a.fy, a.amountCents);
    case 'saveBudget':
      return saveBudget(ctx, a.chapter, a.fy, a.lines);
    case 'approveBudget':
      return approveBudget(ctx, a.chapter, a.fy, a.vote);
    case 'reopenBudget':
      return reopenBudget(ctx, a.chapter, a.fy);
    case 'presentReport':
      return presentReport(ctx, a.month);
    case 'saveMeetingReport':
      return saveMeetingReport(ctx, null, { fromOn: a.from ?? '', toOn: a.to ?? '', notes: a.notes ?? '' }).data;
  }
}
