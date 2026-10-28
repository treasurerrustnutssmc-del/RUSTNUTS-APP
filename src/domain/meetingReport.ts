// The Treasurer's Report for a meeting, laid out like Jeff's October 2026 report: any period
// inside one financial year, its cash position, each fund's movement, a row per month, receipts
// and payments by code, the checks and a read-out for the meeting. The database works out the
// same figures (private.meeting_report in supabase/migrations/20270430000000_meeting_reports.sql)
// and refuses with the same words.

import { activePositions } from './access';
import { formatAuDate } from './dates';
import { formatCents, fyOf } from './fees';
import {
  CREDIT_CODES, DEBIT_CODES, floatFor, fundBalance, fundKey, isCredit, keepsBooks, KEEPS_ONLY, monthEnd, seesLedger,
} from './ledger';
import { signedInProblem } from './meetings';
import type { ClubData, LedgerCode, LedgerEntry, MeetingFigures, MeetingReport, Member } from './types';

export const MR_RANGE = 'Pick the first and last day of the report.';
export const MR_ORDER = 'The report has to start before it ends.';
export const MR_FUTURE = 'The report can’t run past today.';
export const MR_ONE_YEAR = 'Keep the report inside one financial year (1 July to 30 June).';
export const MR_NOTES = 'Keep the notes under 4,000 characters.';
export const MR_LOCKED = 'That report is presented and can’t be changed.';
export const MR_NOTES_MAX = 4000;

/** The club's incorporation number, for the report's footer. */
export const INCORPORATION_NO = 'A0119901K';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];

const DAY = 86_400_000;
const shift = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
const isIsoDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const funds = (data: Pick<ClubData, 'chapters'>): (string | null)[] => [null, ...data.chapters.map((c) => c.id)];

const paidBetween = (e: LedgerEntry, from: string, to: string) =>
  e.state === 'paid' && e.entryOn !== null && e.entryOn >= from && e.entryOn <= to;

/** A fund's balance as `from` starts. On 1 July, the new year's opening when there is one. */
function openingOn(chapterId: string | null, from: string, data: ClubData): number {
  const opening = from.slice(5) === '07-01'
    ? (data.fundOpenings ?? []).find((o) => o.chapterId === chapterId && o.fy === fyOf(from))
    : undefined;
  return opening ? opening.amountCents : fundBalance(chapterId, shift(from, -1), data);
}

const sum = (lines: LedgerEntry[]) => lines.reduce((s, e) => s + e.amountCents, 0);

export function meetingFigures(from: string, to: string, data: ClubData): MeetingFigures {
  const lines = (data.ledger ?? []).filter((e) => paidBetween(e, from, to));
  const credits = lines.filter((e) => isCredit(e.code));
  const debits = lines.filter((e) => !isCredit(e.code));
  const byFund: MeetingFigures['funds'] = {};
  for (const f of funds(data)) {
    const mine = (l: LedgerEntry[]) => sum(l.filter((e) => e.chapterId === f));
    byFund[fundKey(f)] = {
      openingCents: openingOn(f, from, data),
      receiptsCents: mine(credits),
      paymentsCents: mine(debits),
      closingCents: fundBalance(f, to, data),
    };
  }
  const total = (key: 'openingCents' | 'closingCents') => Object.values(byFund).reduce((s, m) => s + m[key], 0);
  const months: MeetingFigures['months'] = [];
  for (let m = `${from.slice(0, 7)}-01`; m <= to; m = shift(monthEnd(m), 1)) {
    const a = m < from ? from : m;
    const b = monthEnd(m) > to ? to : monthEnd(m);
    const inMonth = (l: LedgerEntry[]) => sum(l.filter((e) => e.entryOn! >= a && e.entryOn! <= b));
    months.push({ month: m, from: a, to: b, receiptsCents: inMonth(credits), paymentsCents: inMonth(debits) });
  }
  const byCode = (codes: LedgerCode[]) => codes.map((code) => ({ code, cents: sum(lines.filter((e) => e.code === code)) }));
  const changes = (data.ledger ?? []).filter((e) => e.entryOn !== null && e.entryOn >= from && e.entryOn <= to).map((e) => e.updatedAt).sort();
  return {
    from,
    to,
    funds: byFund,
    credits: byCode(CREDIT_CODES),
    debits: byCode(DEBIT_CODES),
    receiptsCents: sum(credits),
    paymentsCents: sum(debits),
    openingCents: total('openingCents'),
    closingCents: total('closingCents'),
    floatCents: floatFor(fyOf(to), data),
    months,
    lineCount: lines.length,
    lastChangeAt: changes[changes.length - 1] ?? null,
  };
}

/** What's in the bank: total funds less the cash float. */
export const bankCents = (f: MeetingFigures, at: 'opening' | 'closing') =>
  (at === 'opening' ? f.openingCents : f.closingCents) - f.floatCents;

/** Paid lines in the period under their codes, by date, for whoever reads the lines. */
export function meetingLines(from: string, to: string, data: ClubData): Partial<Record<LedgerCode, LedgerEntry[]>> {
  const out: Partial<Record<LedgerCode, LedgerEntry[]>> = {};
  const lines = (data.ledger ?? []).filter((e) => paidBetween(e, from, to))
    .sort((a, b) => a.entryOn!.localeCompare(b.entryOn!) || a.recordedAt.localeCompare(b.recordedAt));
  for (const e of lines) (out[e.code] ??= []).push(e);
  return out;
}

/** The report's own checks, as in Jeff's "Basis and checks". */
export function meetingChecks(f: MeetingFigures): { label: string; ok: boolean }[] {
  const fs = Object.values(f.funds);
  const add = (pick: (m: MeetingFigures['months'][number]) => number) => f.months.reduce((s, m) => s + pick(m), 0);
  return [
    {
      label: 'Every fund’s opening, plus receipts, less payments, gives its closing balance.',
      ok: fs.every((m) => m.openingCents + m.receiptsCents - m.paymentsCents === m.closingCents),
    },
    {
      label: 'The months add up to the period’s receipts and payments.',
      ok: add((m) => m.receiptsCents) === f.receiptsCents && add((m) => m.paymentsCents) === f.paymentsCents,
    },
    {
      label: 'The funds add up to total recorded cash funds.',
      ok: fs.reduce((s, m) => s + m.closingCents, 0) === f.closingCents
        && fs.reduce((s, m) => s + m.receiptsCents, 0) === f.receiptsCents
        && fs.reduce((s, m) => s + m.paymentsCents, 0) === f.paymentsCents,
    },
  ];
}

/** "October", or "October (to 21/10/2026)" when the period cuts the month short. */
export function monthRowLabel(m: MeetingFigures['months'][number]): string {
  const cutStart = m.from !== m.month;
  const cutEnd = m.to !== monthEnd(m.month);
  const name = monthName(m.month);
  if (cutStart && cutEnd) return `${name} (${formatAuDate(m.from)} to ${formatAuDate(m.to)})`;
  if (cutStart) return `${name} (from ${formatAuDate(m.from)})`;
  if (cutEnd) return `${name} (to ${formatAuDate(m.to)})`;
  return name;
}

/** Money read aloud: "$400" for whole dollars, "$120.40" otherwise. */
export const spokenCents = (cents: number) => formatCents(cents).replace(/\.00$/, '');

function bankChange(net: number, what: string): string {
  if (net === 0) return `so the bank balance didn’t change`;
  return `${net > 0 ? 'increasing' : 'reducing'} ${what} by ${spokenCents(Math.abs(net))}`;
}

/** The paragraph to read at the meeting. */
export function readOut(f: MeetingFigures): string {
  const net = f.receiptsCents - f.paymentsCents;
  const at = f.floatCents > 0
    ? `At ${formatAuDate(f.to)}, the club had ${spokenCents(bankCents(f, 'closing'))} in the bank and a recorded cash float of ${spokenCents(f.floatCents)}, giving total recorded cash funds of ${spokenCents(f.closingCents)}.`
    : `At ${formatAuDate(f.to)}, the club had ${spokenCents(bankCents(f, 'closing'))} in the bank.`;
  const moved = `we received ${spokenCents(f.receiptsCents)} and paid ${spokenCents(f.paymentsCents)}`;
  const since = net === 0
    ? `Since ${formatAuDate(f.from)}, ${moved}, so the bank balance didn’t change.`
    : `Since ${formatAuDate(f.from)}, ${moved}, a net ${net > 0 ? 'increase' : 'decrease'} of ${spokenCents(Math.abs(net))}.`;
  if (f.months.length < 2) return `${at} ${since}`;
  const m = f.months[f.months.length - 1];
  const label = monthRowLabel(m).replace(/ \((.*)\)$/, ' $1');
  const mNet = m.receiptsCents - m.paymentsCents;
  return `${at} ${since} In ${label}, the club received ${spokenCents(m.receiptsCents)} and paid ${spokenCents(m.paymentsCents)}, ${bankChange(mNet, 'the bank balance')}.`;
}

// Rules ----------------------------------------------------------------------------------------

export interface MeetingReportInput {
  fromOn: string;
  toOn: string;
  notes: string;
}

const reportOf = (id: string, data: ClubData) => (data.meetingReports ?? []).find((r) => r.id === id);

function booksProblem(me: Member | null, data: ClubData): string | null {
  return signedInProblem(me) ?? (keepsBooks(me, null, data.positions) ? null : KEEPS_ONLY);
}

/** Saving a new report (id null) or a draft. */
export function meetingProblem(me: Member | null, id: string | null, input: MeetingReportInput, data: ClubData, today: string): string | null {
  const books = booksProblem(me, data);
  if (books) return books;
  if (id !== null) {
    const report = reportOf(id, data);
    if (!report) return 'No such report.';
    if (report.presentedAt) return MR_LOCKED;
  }
  if (!isIsoDate(input.fromOn) || !isIsoDate(input.toOn)) return MR_RANGE;
  if (input.fromOn > input.toOn) return MR_ORDER;
  if (input.toOn > today) return MR_FUTURE;
  if (fyOf(input.fromOn) !== fyOf(input.toOn)) return MR_ONE_YEAR;
  if (input.notes.length > MR_NOTES_MAX) return MR_NOTES;
  return null;
}

export function presentMeetingProblem(me: Member | null, id: string, data: ClubData): string | null {
  const books = booksProblem(me, data);
  if (books) return books;
  const report = reportOf(id, data);
  if (!report) return 'No such report.';
  return report.presentedAt ? 'That report is already presented.' : null;
}

export function deleteMeetingProblem(me: Member | null, id: string, data: ClubData): string | null {
  const books = booksProblem(me, data);
  if (books) return books;
  const report = reportOf(id, data);
  if (!report) return 'No such report.';
  return report.presentedAt ? MR_LOCKED : null;
}

// Screens --------------------------------------------------------------------------------------

/** Reads every fund's lines, so the figures can be worked out on the phone. */
export function readsEveryFund(me: Member | null, data: ClubData): boolean {
  return funds(data).every((f) => seesLedger(me, f, data.positions));
}

/** A report's figures: the database's in live mode, else worked out here. */
export function figuresFor(report: Pick<MeetingReport, 'id' | 'fromOn' | 'toOn'>, data: ClubData): MeetingFigures {
  return (data.meetingTotals ?? []).find((t) => t.id === report.id) ?? meetingFigures(report.fromOn, report.toOn, data);
}

/** A new report runs on from the last presented one, inside this financial year, to today. */
export function defaultPeriod(data: ClubData, today: string): { fromOn: string; toOn: string } {
  const yearStart = `${fyOf(today)}-07-01`;
  const last = (data.meetingReports ?? []).filter((r) => r.presentedAt).map((r) => r.toOn).sort().pop();
  const next = last ? shift(last, 1) : yearStart;
  const fromOn = next < yearStart ? yearStart : next > today ? today : next;
  return { fromOn, toOn: today };
}

/** "Jeff Ostler, Treasurer, West and North Chapters", or their NEC seat. */
export function preparedBy(memberId: string | null, data: ClubData): string {
  const member = data.members.find((m) => m.id === memberId);
  if (!member) return 'the Treasurer';
  const seats = activePositions(member.id, data.positions);
  const chapters = data.chapters.filter((c) => seats.some((p) => p.role === 'treasurer' && p.chapterId === c.id)).map((c) => c.name);
  const name = member.fullName || member.roadName || 'Member';
  if (chapters.length > 0) {
    const list = chapters.length === 1 ? chapters[0] : `${chapters.slice(0, -1).join(', ')} and ${chapters[chapters.length - 1]}`;
    return `${name}, Treasurer, ${list} Chapter${chapters.length === 1 ? '' : 's'}`;
  }
  if (seats.some((p) => p.role === 'nec_chair')) return `${name}, National Chairman`;
  if (seats.some((p) => p.role === 'nec_secretary')) return `${name}, National Secretary`;
  return name;
}
