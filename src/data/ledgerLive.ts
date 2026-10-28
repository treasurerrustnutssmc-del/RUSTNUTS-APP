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
    approved_at: string | null; approved_by: string | null; updated_at: string;
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

const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export function toLedger(raw: LedgerJson | null | undefined): Required<Omit<LedgerData, 'meetingReports' | 'meetingTotals'>> {
  // Anything but a plain object (an old database without club_ledger, a stub) reads as no books.
  const json = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  return {
    ledger: list(json?.entries).map((e) => ({
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
      approvals: list(e.approvals).map((a) => ({ memberId: a.member_id, approvedAt: instant(a.approved_at) })),
    })),
    fundOpenings: list(json?.openings).map((o) => ({ chapterId: o.chapter_id, fy: o.fy, amountCents: o.amount_cents })),
    cashFloats: list(json?.floats).map((f) => ({ fy: f.fy, amountCents: f.amount_cents })),
    budgets: list(json?.budgets).map((b) => ({
      chapterId: b.chapter_id,
      fy: b.fy,
      lines: b.lines ?? {},
      approvedVoteId: b.approved_vote_id,
      approvedAt: maybeInstant(b.approved_at),
      approvedBy: b.approved_by,
      updatedAt: instant(b.updated_at),
    })),
    treasurerReports: list(json?.reports).map((r) => ({ month: r.month, presentedAt: instant(r.presented_at), presentedBy: r.presented_by })),
    reportTotals: list(json?.report_totals).map(toReport),
  };
}

// The Treasurer's Report for a meeting: meeting_reports() -------------------------------------

interface MovementJson { opening_cents: number; receipts_cents: number; payments_cents: number; closing_cents: number }

export interface MeetingReportJson {
  id: string; from_on: string; to_on: string; notes: string; saved_by: string | null; saved_at: string;
  presented_by: string | null; presented_at: string | null;
  figures: {
    from: string; to: string; funds: Record<string, MovementJson>;
    credits: { code: LedgerCode; cents: number }[]; debits: { code: LedgerCode; cents: number }[];
    receipts_cents: number; payments_cents: number; opening_cents: number; closing_cents: number; float_cents: number;
    months: { month: string; from: string; to: string; receipts_cents: number; payments_cents: number }[];
    line_count: number; last_change_at: string | null;
  };
}

const codes = (xs: { code: LedgerCode; cents: number }[] | undefined) => list(xs).map((c) => ({ code: c.code, cents: num(c.cents) }));

export function toMeetingReports(raw: MeetingReportJson[] | null | undefined): Required<Pick<LedgerData, 'meetingReports' | 'meetingTotals'>> {
  const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const rows = list(raw ?? undefined).filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && isDate(r.from_on) && isDate(r.to_on));
  return {
    meetingReports: rows.map((r) => ({
      id: r.id, fromOn: r.from_on, toOn: r.to_on, notes: r.notes ?? '', savedBy: r.saved_by, savedAt: instant(r.saved_at),
      presentedBy: r.presented_by, presentedAt: maybeInstant(r.presented_at),
    })),
    meetingTotals: rows.filter((r) => r.figures && typeof r.figures === 'object').map(({ id, figures: f }) => ({
      id,
      from: f.from,
      to: f.to,
      funds: Object.fromEntries(Object.entries(f.funds ?? {}).filter(([, m]) => m && typeof m === 'object').map(([k, m]) => [k, {
        openingCents: num(m.opening_cents), receiptsCents: num(m.receipts_cents), paymentsCents: num(m.payments_cents), closingCents: num(m.closing_cents),
      }])),
      credits: codes(f.credits),
      debits: codes(f.debits),
      receiptsCents: num(f.receipts_cents),
      paymentsCents: num(f.payments_cents),
      openingCents: num(f.opening_cents),
      closingCents: num(f.closing_cents),
      floatCents: num(f.float_cents),
      months: list(f.months).map((m) => ({ month: m.month, from: m.from, to: m.to, receiptsCents: num(m.receipts_cents), paymentsCents: num(m.payments_cents) })),
      lineCount: num(f.line_count),
      lastChangeAt: maybeInstant(f.last_change_at),
    })),
  };
}
