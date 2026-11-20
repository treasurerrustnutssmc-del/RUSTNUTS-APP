// The Treasurer's Report for a meeting as one statement, laid out like Jeff's November 2026 PDF:
// opening funds, every credit and debit code (nil ones too), the provisional balances, each fund's
// allocation and the net change. The screen and the shared PDF both draw it from here.

import { formatCents } from './fees';
import { CREDIT_CODES, DEBIT_CODES, fundKey, fundName } from './ledger';
import { bankCents, monthName, spokenCents } from './meetingReport';
import type { ClubData, LedgerCode, MeetingFigures } from './types';

/** Each code as Jeff words it on his report. */
export const STATEMENT_LABEL: Record<LedgerCode, string> = {
  'CR-001': 'Members’ fees',
  'CR-002': 'Donations to RSMC',
  'CR-003': 'Club payment',
  'CR-004': 'Bank payments (interest)',
  'CR-005': 'Merchandise sales',
  'CR-006': 'Meeting food purchases',
  'CR-007': 'Event buy-in',
  'DB-001': 'Club expenses',
  'DB-002': 'Donations to charity',
  'DB-003': 'Miscellaneous',
  'DB-004': 'Bank payments (fees)',
  'DB-005': 'Merchandise purchases',
  'DB-006': 'Refunds',
  'DB-007': 'Club meeting expenses',
};

/** The club's details for the letterhead, as on Jeff's report. */
export const CLUB_LETTERHEAD = [
  'Rustnuts Social Motorcycle Club Incorporated',
  'Incorporation No. A0119901K',
  'A.B.N 13188715331',
  '38 Delaney Boulevard, Williams Landing VIC 3027',
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY = 86_400_000;
const dayBefore = (iso: string) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - DAY).toISOString().slice(0, 10);

/** "8 November 2026", "21 October" or "Saturday 21 November 2026", as Jeff writes dates. */
export function longDate(iso: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const d = `${Number(iso.slice(8, 10))} ${monthName(iso)}${opts.year === false ? '' : ` ${iso.slice(0, 4)}`}`;
  return opts.weekday ? `${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${d}` : d;
}

/** head: a bold total; item: a line under it; section: a heading with no amount. */
export interface StatementRow {
  kind: 'head' | 'item' | 'section';
  label: string;
  cents: number | null;
}

export interface MeetingStatement {
  title: string;
  subtitle: string;
  period: string;
  rows: StatementRow[];
}

/** The statement for figures `f`, for the meeting on `meetingOn`. */
export function meetingStatement(f: MeetingFigures, data: Pick<ClubData, 'chapters'>, meetingOn: string): MeetingStatement {
  const head = (label: string, cents: number): StatementRow => ({ kind: 'head', label, cents });
  const item = (label: string, cents: number): StatementRow => ({ kind: 'item', label, cents });
  const byCode = (list: MeetingFigures['credits'], code: LedgerCode) => list.find((c) => c.code === code)?.cents ?? 0;
  const float = f.floatCents > 0 ? `, including ${spokenCents(f.floatCents)} float` : '';
  const net = f.closingCents - f.openingCents;
  const funds = [null, ...data.chapters.map((c) => c.id)];
  const sameYear = f.from.slice(0, 4) === f.to.slice(0, 4);
  const openedOn = dayBefore(f.from);
  return {
    title: 'Club Treasurer’s Report',
    subtitle: `${longDate(meetingOn, { weekday: true })} • Provisional figures`,
    period: `Cashbook period ${longDate(f.from, { year: !sameYear })} to ${longDate(f.to)}`,
    rows: [
      head(`Opening club funds at ${longDate(openedOn, { year: openedOn.slice(0, 4) !== f.to.slice(0, 4) })}${float}`, f.openingCents),
      item('Opening bank balance', bankCents(f, 'opening')),
      head('Total credits', f.receiptsCents),
      ...CREDIT_CODES.map((c) => item(STATEMENT_LABEL[c], byCode(f.credits, c))),
      head('Total debits', f.paymentsCents),
      ...DEBIT_CODES.map((c) => item(STATEMENT_LABEL[c], byCode(f.debits, c))),
      { kind: 'section', label: `Provisional balances at ${longDate(f.to)}`, cents: null },
      item('Closing bank balance per cashbook', bankCents(f, 'closing')),
      ...(f.floatCents > 0 ? [item('Cash float carried forward', f.floatCents)] : []),
      head('Total club funds', f.closingCents),
      ...funds.map((id) => item(`${fundName(id, data)} allocation`, f.funds[fundKey(id)]?.closingCents ?? 0)),
      head(net === 0 ? 'No change in recorded club funds' : `Net ${net > 0 ? 'increase' : 'decrease'} in recorded club funds`, Math.abs(net)),
    ],
  };
}

/** The statement as plain text: label and amount on each line. */
export const statementAmount = (r: StatementRow) => (r.cents === null ? '' : formatCents(r.cents));

/**
 * The treasurer's notes as paragraphs (a blank line between). A short opening sentence of a few
 * words ("Club expenses.", two to five) becomes the paragraph's bold lead, as in Jeff's PDF.
 */
export function noteParagraphs(notes: string): { lead: string | null; text: string }[] {
  return notes.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = /^([A-Z][^.\n\d$]{0,38}\.)[ \t]+(\S[\s\S]*)$/.exec(p);
    const words = m ? m[1].split(/\s+/).length : 0;
    return m && words >= 2 && words <= 5 ? { lead: m[1], text: m[2] } : { lead: null, text: p };
  });
}
