// The Treasurer's Report for a meeting as an A4 page to print or share as a PDF, laid out like
// Jeff's October 2026 report: the club's logo, the cash position, each fund's movement, the
// months, the read-out, receipts and payments, the treasurer's notes and the basis and checks.
// Everything typed (notes, line descriptions) is escaped.

import { formatAuDate } from './dates';
import { formatCents } from './fees';
import { CODE_LABEL, fundKey } from './ledger';
import {
  bankCents, INCORPORATION_NO, meetingChecks, monthName, monthRowLabel, readOut,
} from './meetingReport';
import type { ClubData, LedgerCode, LedgerEntry, MeetingFigures } from './types';

export interface MeetingReportPrint {
  figures: MeetingFigures;
  data: Pick<ClubData, 'chapters'>;
  notes: string;
  preparedBy: string;
  /** The day it's printed, or the day it was presented. */
  preparedOn: string;
  /** Each paid line under its code, for whoever reads the lines; left out for members. */
  lines?: Partial<Record<LedgerCode, LedgerEntry[]>>;
  /** The club's logo, as a data URI or URL. */
  logoSrc: string | null;
  /** Rustnuts Stencil, as a data URI or URL, for the headings. */
  fontSrc: string | null;
}

/** The club red (src/theme.ts colors.red), for rules and headings on paper. */
const RED = '#8C1C24';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = formatCents;
const out = (cents: number) => `(${formatCents(cents)})`;
const signed = (cents: number) => (cents > 0 ? `+${formatCents(cents)}` : formatCents(cents));

const row = (cells: string[], cls = '') =>
  `<tr${cls ? ` class="${cls}"` : ''}>${cells.map((c, i) => `<td${i > 0 ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`;
const table = (head: string[], rows: string[]) =>
  `<table><thead><tr>${head.map((h, i) => `<th${i > 0 ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;

function codeTable(title: string, codes: { code: LedgerCode; cents: number }[], total: number, lines: MeetingReportPrint['lines']): string {
  const used = codes.filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents || a.code.localeCompare(b.code));
  const rows = used.flatMap((c) => [
    row([`${esc(CODE_LABEL[c.code] ?? c.code)} <span class="code">${c.code}</span>`, money(c.cents)]),
    ...(lines?.[c.code] ?? []).map((e) => row([`${formatAuDate(e.entryOn)} · ${esc(e.description)}`, money(e.amountCents)], 'line')),
  ]);
  if (used.length === 0) rows.push(row(['Nothing in this period', money(0)], 'line'));
  rows.push(row([`Total ${title.toLowerCase()}`, money(total)], 'total'));
  return `<h3>${title}</h3>${table(['Code / description', 'AUD'], rows)}`;
}

export function meetingReportHtml(p: MeetingReportPrint): string {
  const f = p.figures;
  const title = `${monthName(f.to)} ${f.to.slice(0, 4)}`;
  const from = formatAuDate(f.from);
  const to = formatAuDate(f.to);
  const change = bankCents(f, 'closing') - bankCents(f, 'opening');
  const funds = [null, ...p.data.chapters.map((c) => c.id)];
  const fundLabel = (id: string | null) => (id === null ? 'Club / shared funds' : `${esc(p.data.chapters.find((c) => c.id === id)?.name ?? 'Chapter')} Chapter`);
  const ordered = [...funds.slice(1), null]; // chapters first, the Club fund last, as Jeff's report
  const move = (id: string | null) => f.funds[fundKey(id)] ?? { openingCents: 0, receiptsCents: 0, paymentsCents: 0, closingCents: 0 };
  const notes = p.notes.trim();
  const checks = meetingChecks(f);

  const cash = table(['Cash movement', 'AUD'], [
    row([`Opening bank balance at ${from}`, money(bankCents(f, 'opening'))]),
    row(['Receipts during the reporting period', money(f.receiptsCents)]),
    row(['Payments during the reporting period', out(f.paymentsCents)]),
    row([`Closing bank balance at ${to}`, money(bankCents(f, 'closing'))], 'total'),
    row(['Recorded cash float', money(f.floatCents)]),
    row(['Total recorded cash funds', money(f.closingCents)], 'total'),
  ]);
  const changeLine = change === 0
    ? 'The bank balance didn’t change over the reporting period.'
    : `The bank balance ${change > 0 ? 'increased' : 'decreased'} by ${money(Math.abs(change))} over the reporting period.`;
  const floatLine = f.floatCents > 0
    ? ` The ${money(f.floatCents).replace(/\.00$/, '')} float is carried from the books and has not been independently cash-counted for this report.`
    : '';

  const allocations = table(['Allocation', 'Opening funds', 'Receipts', 'Payments', 'Closing funds'], [
    ...ordered.map((id) => {
      const m = move(id);
      return row([fundLabel(id), money(m.openingCents), money(m.receiptsCents), money(m.paymentsCents), money(m.closingCents)]);
    }),
    row(['Total', money(f.openingCents), money(f.receiptsCents), money(f.paymentsCents), money(f.closingCents)], 'total'),
  ]);

  const months = table(['Month', 'Receipts', 'Payments', 'Net movement'],
    f.months.map((m) => row([monthRowLabel(m), money(m.receiptsCents), money(m.paymentsCents), signed(m.receiptsCents - m.paymentsCents)])));

  const font = p.fontSrc ? `@font-face { font-family: 'RustnutsStencil'; src: url('${p.fontSrc}'); }` : '';
  const footer = `RUSTNUTS SMC | ${INCORPORATION_NO} | Treasurer’s report • ${title}`;

  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>Treasurer’s Report ${title}</title>
<style>
${font}
@page { size: A4; margin: 14mm 14mm 10mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #111010; margin: 0; }
h1, h2, h3, th, .club { font-family: 'RustnutsStencil', "Arial Black", sans-serif; letter-spacing: 0.04em; }
header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid ${RED}; padding-bottom: 10px; margin-bottom: 12px; }
header img { width: 120px; height: auto; }
.club { font-size: 9pt; color: ${RED}; text-transform: uppercase; }
h1 { font-size: 22pt; margin: 2px 0 4px; }
h2 { font-size: 13pt; margin: 18px 0 6px; color: ${RED}; text-transform: uppercase; }
h3 { font-size: 11pt; margin: 14px 0 4px; }
.meta { margin: 1px 0; color: #333; }
table { width: 100%; border-collapse: collapse; margin: 4px 0; }
tr, .readout, li { break-inside: avoid; }
h2, h3 { break-after: avoid; }
th { text-align: left; font-size: 9pt; font-weight: normal; border-bottom: 1px solid #111010; padding: 4px 6px; }
td { padding: 3px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr.total td { font-weight: bold; border-top: 1px solid #111010; }
tr.line td { font-size: 9pt; color: #555; padding-left: 18px; }
.code { color: #777; font-size: 8.5pt; }
.small { font-size: 9pt; color: #444; }
.readout { border-left: 4px solid ${RED}; background: #f6f3ee; padding: 10px 12px; font-style: italic; }
.fail { color: ${RED}; font-weight: bold; }
/* The footer sits on every page; the page table's empty tfoot keeps room for it. */
footer { position: fixed; bottom: 0; left: 0; right: 0; height: 9mm; font-size: 8pt; color: #666; border-top: 1px solid #ccc; padding-top: 4px; background: #fff; }
table.page, table.page > tbody > tr > td, table.page > tfoot > tr > td { border: 0; padding: 0; margin: 0; }
.footer-room { height: 11mm; }
</style></head>
<body>
<footer>${footer}</footer>
<table class="page"><tfoot><tr><td><div class="footer-room"></div></td></tr></tfoot><tbody><tr><td>
<header>
${p.logoSrc ? `<img src="${esc(p.logoSrc)}" alt="Rustnuts SMC, est. 2019">` : ''}
<div>
<div class="club">Social Motorcycle Club Incorporated</div>
<h1>Treasurer’s Report</h1>
<p class="meta">${title} | Reporting period: ${from} to ${to}</p>
<p class="meta">Prepared by ${esc(p.preparedBy)}</p>
<p class="meta">Prepared ${formatAuDate(p.preparedOn)} from the club’s books in the Rustnuts app.</p>
</div>
</header>

<h2>Cash position</h2>
${cash}
<p class="small">${changeLine}${floatLine}</p>

<h2>Chapter and shared-fund allocations</h2>
${allocations}
<p class="small">These are ledger allocations within the one club, not separate bank balances.${f.floatCents > 0 ? ' Club / shared funds include the recorded cash float.' : ''}</p>

<h2>Monthly cash movement</h2>
${months}

<h2>Meeting read-out</h2>
<p class="readout">“${esc(readOut(f))}”</p>

<h2>Receipts, payments and record checks</h2>
<p class="small">${from} to ${to} | All amounts in Australian dollars</p>
${codeTable('Receipts', f.credits, f.receiptsCents, p.lines)}
${codeTable('Payments', f.debits, f.paymentsCents, p.lines)}
<p class="small">Merchandise receipts and supplier payments are cash movements, not a merchandise-profit calculation; stock and order timing are not reconciled in this report.</p>
${notes ? `
<h2>Treasurer’s notes</h2>
${notes.split(/\n\s*\n/).map((para) => `<p>${esc(para.trim()).replace(/\n/g, '<br>')}</p>`).join('\n')}` : ''}

<h2>Basis and checks</h2>
<p>Worked out from the club’s books in the Rustnuts app. Each of the ${f.lineCount} paid lines dated ${from} to ${to} is counted once, under its payment code and its fund.</p>
<ul>
${checks.map((c) => `<li>${c.ok ? '' : '<span class="fail">Check failed: </span>'}${esc(c.label)}</li>`).join('\n')}
</ul>
<p class="small">This is an unaudited cash-movement report, not a complete financial-position statement. It does not verify cash on hand, bank-statement agreement, stock, assets, unpaid bills or transactions after ${to}. No annual-reporting or CAV-compliance claim is made.</p>
</td></tr></tbody></table>
</body></html>`;
}
