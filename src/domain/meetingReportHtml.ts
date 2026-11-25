// The Treasurer's Report for a meeting as an A4 page to print or share as a PDF, laid out like
// Jeff's November 2026 report: the club's details with the logo, then one boxed statement of
// opening funds, credits, debits, provisional balances and allocations, then the treasurer's
// notes. Everything typed (the notes) is escaped.

import { PRIVACY_LINE } from './financePrivacy';
import { CLUB_LETTERHEAD, meetingStatement, noteParagraphs, statementAmount } from './meetingStatement';
import type { ClubData, MeetingFigures } from './types';

export interface MeetingReportPrint {
  figures: MeetingFigures;
  data: Pick<ClubData, 'chapters'>;
  notes: string;
  /** The meeting's day: the day it was presented, or today for a draft. */
  meetingOn: string;
  /** The club's logo, as a data URI or URL. */
  logoSrc: string | null;
  /** Rustnuts Stencil, as a data URI or URL, for the title. */
  fontSrc: string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function meetingReportHtml(p: MeetingReportPrint): string {
  const s = meetingStatement(p.figures, p.data, p.meetingOn);
  const rows = s.rows.map((r) => `<tr class="${r.kind}"><td>${esc(r.label)}</td><td class="n">${statementAmount(r)}</td></tr>`).join('\n');
  const notes = noteParagraphs(p.notes)
    .map((n) => `<p>${n.lead ? `<b>${esc(n.lead)}</b> ` : ''}${esc(n.text).replace(/\n/g, '<br>')}</p>`).join('\n');
  const font = p.fontSrc ? `@font-face { font-family: 'RustnutsStencil'; src: url('${p.fontSrc}'); }` : '';
  const logo = p.logoSrc ? esc(p.logoSrc) : null;

  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><title>${esc(s.title)}</title>
<style>
${font}
@page { size: A4; margin: 14mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #111010; margin: 0; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14mm; }
header p { margin: 0; line-height: 1.35; }
header img { width: 46mm; height: auto; }
.box { position: relative; border: 1px solid #111010; padding: 8px 14px 12px; overflow: hidden; }
.box .mark { position: absolute; left: 50%; top: 45%; width: 70%; transform: translate(-50%, -50%); opacity: 0.06; z-index: 0; }
.box > *:not(.mark) { position: relative; z-index: 1; }
h1 { font-family: 'RustnutsStencil', Georgia, serif; font-size: 18pt; text-align: center; margin: 2px 0 2px; letter-spacing: 0.02em; }
.sub { text-align: center; font-weight: bold; margin: 0; }
.period { text-align: center; font-size: 8.5pt; margin: 2px 0 8px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 0.5px 0; vertical-align: top; }
.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; padding-left: 12px; }
tr.head td, tr.section td { font-weight: bold; padding-top: 6px; }
tr.head td { font-size: 10pt; }
.notes p { margin: 8px 0 0; line-height: 1.4; }
.source { font-style: italic; font-size: 8pt; margin: 8px 0 0; }
</style></head>
<body>
<header>
<div>${CLUB_LETTERHEAD.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
${logo ? `<img src="${logo}" alt="Rustnuts SMC, est. 2019">` : ''}
</header>
<div class="box">
${logo ? `<img class="mark" src="${logo}" alt="">` : ''}
<h1>${esc(s.title)}</h1>
<p class="sub">${esc(s.subtitle)}</p>
<p class="period">${esc(s.period)}</p>
<table>
${rows}
</table>
${notes ? `<div class="notes">\n${notes}\n</div>` : ''}
<p class="source">From the club’s cashbook in the Rustnuts app. ${esc(PRIVACY_LINE)}</p>
</div>
</body></html>`;
}
