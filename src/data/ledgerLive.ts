// The live database's club_ledger() read (snake_case JSON) as the app's treasurer data.

import type { EntryState, LedgerCode, LedgerData, MonthReport } from '../domain/types';

interface ReportJson {
  month: string; opening_cents: number; credits: { code: LedgerCode; cents: number }[]; credit_total: number;
  debits: { code: LedgerCode; cents: number }[]; debit_total: number; funds: Record<string, number>;
  total_cents: number; float_cents: number; bank_cents: number; last_change_at: string | null;
}

export interface LedgerJson {
  entries: {
    id: string; chapter_id: string | null; code: LedgerCode; description: string; amount_cents: number;
    received_on: string | null; entry_on: string | null; payee_member_id: string | null; payee_name: string | null;
    payment_id: string | null; state: EntryState; recorded_by: string | null; recorded_at: string; updated_at: string;
    void_reason: string | null; voided_by: string | null; approvals: { member_id: string; approved_at: string }[];
  }[];
  openings: { chapter_id: string | null; fy: number; amount_cents: number }[];
  floats: { fy: number; amount_cents: number }[];
  budgets: {
    chapter_id: string | null; fy: number; lines: Partial<Record<LedgerCode, number>>; approved_vote_id: string | null;
    approved_at: string | null; approved_by: string | null;
  }[];
  reports: { month: string; presented_at: string; presented_by: string | null }[];
  report_totals: ReportJson[];
}

const instant = (ts: string) => new Date(ts).toISOString();
const maybeInstant = (ts: string | null) => (ts ? instant(ts) : null);
const num = (n: number | string) => Number(n);

function toReport(r: ReportJson): MonthReport {
  return {
    month: r.month,
    openingCents: num(r.opening_cents),
    credits: (r.credits ?? []).map((c) => ({ code: c.code, cents: num(c.cents) })),
    creditTotal: num(r.credit_total),
    debits: (r.debits ?? []).map((c) => ({ code: c.code, cents: num(c.cents) })),
    debitTotal: num(r.debit_total),
    funds: Object.fromEntries(Object.entries(r.funds ?? {}).map(([k, v]) => [k, num(v)])),
    totalCents: num(r.total_cents),
    floatCents: num(r.float_cents),
    bankCents: num(r.bank_cents),
    lastChangeAt: maybeInstant(r.last_change_at),
  };
}

export function toLedger(json: LedgerJson | null | undefined): Required<LedgerData> {
  return {
    ledger: (json?.entries ?? []).map((e) => ({
      id: e.id,
      chapterId: e.chapter_id,
      code: e.code,
      description: e.description,
      amountCents: e.amount_cents,
      receivedOn: e.received_on,
      entryOn: e.entry_on,
      payeeMemberId: e.payee_member_id,
      payeeName: e.payee_name,
      paymentId: e.payment_id,
      state: e.state,
      recordedBy: e.recorded_by,
      recordedAt: instant(e.recorded_at),
      updatedAt: instant(e.updated_at),
      voidReason: e.void_reason,
      voidedBy: e.voided_by,
      approvals: (e.approvals ?? []).map((a) => ({ memberId: a.member_id, approvedAt: instant(a.approved_at) })),
    })),
    fundOpenings: (json?.openings ?? []).map((o) => ({ chapterId: o.chapter_id, fy: o.fy, amountCents: o.amount_cents })),
    cashFloats: (json?.floats ?? []).map((f) => ({ fy: f.fy, amountCents: f.amount_cents })),
    budgets: (json?.budgets ?? []).map((b) => ({
      chapterId: b.chapter_id,
      fy: b.fy,
      lines: b.lines ?? {},
      approvedVoteId: b.approved_vote_id,
      approvedAt: maybeInstant(b.approved_at),
      approvedBy: b.approved_by,
    })),
    treasurerReports: (json?.reports ?? []).map((r) => ({ month: r.month, presentedAt: instant(r.presented_at), presentedBy: r.presented_by })),
    reportTotals: (json?.report_totals ?? []).map(toReport),
  };
}
