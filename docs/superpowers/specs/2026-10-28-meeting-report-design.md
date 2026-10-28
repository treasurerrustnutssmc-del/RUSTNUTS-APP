# Treasurer's Report for a meeting

**Type:** architectural (a new table, new database actions, a new screen, a printable PDF). Claude
approved this spec on 28 Oct 2026 under the self-approval rule in AGENTS.md. Jeff can veto any of
it. Rules marked *(inferred)* are Claude's reading where Jeff's report doesn't settle it.

## Where this comes from
Jeff's October 2026 Treasurer's Report (PDF, two pages, in
/mnt/project-files/reference/Rustnuts October 2026 Treasurer's Report.pdf). He built it by hand
from the "Rustnuts Financials" sheet. The same lines are already live in the app's ledger
(fy26-27-books.sql, loaded 25 Oct), so the app can produce every figure in it.

The app's Stage 5B report is one calendar month with totals by code and closing fund balances.
Jeff's report differs:

| Jeff's report | Stage 5B month report |
|---|---|
| Any period (1 August to 21 October), presented at a meeting | One whole calendar month |
| Cash position: opening bank, receipts, payments, closing bank, float, total funds, change | Opening total, closing by fund, float, bank |
| Each fund's opening, receipts, payments and closing | Closing only |
| A row per month in the period, the last one "to 21 October" | None |
| A meeting read-out paragraph | None |
| Receipts and payments with what each was for | Totals by code |
| The treasurer's notes (membership and payment classification) | None |
| Basis and checks, and what the report doesn't claim | None |
| Printed, with the club's name, the incorporation number A0119901K and page footers | Screen only |

## Goal
The treasurer picks the period, writes the notes, and gets Jeff's report: on screen, as a PDF to
share or print, and presented to members (13.8). Every figure comes from the ledger.

## The report
`meetingReport(from, to, data)` in `src/domain/meetingReport.ts` works out:

- **Cash position.** Opening total = each fund's balance as the period starts; the bank figure is
  that less the year's cash float. Receipts and payments are paid lines dated in the period.
  Closing total and bank the same way at the end. The change is closing bank less opening bank.
- **Funds.** For the Club fund and each chapter: opening, receipts, payments, closing. The Club fund
  holds the float, as in the books today.
- **Months.** One row per calendar month the period touches, cut to the period: receipts,
  payments, net.
- **Receipts and payments.** Totals by code, codes with nothing left out, largest first. Whoever
  reads the lines also gets each line under its code (date, description, amount).
- **Checks.** For every fund, opening + receipts − payments = closing; the months add up to the
  totals; the funds add up to total funds. The report shows each as passed or failed, and the
  number of paid lines it used.
- **Read-out.** A paragraph to read at the meeting, worked out from the figures, as in Jeff's
  report: the bank and float at the end, the period's receipts and payments and the net change,
  and the last month's receipts and payments and what they did to the bank.

A fund's balance as the period starts is its balance at the end of the day before, except on 1
July when the new year's opening is used, as the month report does.

**Rules** (same words in the database):
- Both days are needed: "Pick the first and last day of the report."
- From before to: "The report has to start before it ends."
- Not past today: "The report can’t run past today."
- Inside one financial year: "Keep the report inside one financial year (1 July to 30 June)."
  *(inferred: an opening on 1 July resets the balances, so a period across it can't add up)*
- Notes up to 4,000 characters.
- Only someone who keeps the Club fund's books saves, presents or deletes one (same as presenting
  a month). Building one on screen needs every fund's lines, so it's offered to whoever reads
  every fund *(inferred)*.
- A presented report is locked. A draft can be changed or deleted.

## Storing it
`public.treasurer_meeting_reports`: id, from_on, to_on, notes, saved_by, saved_at, presented_by,
presented_at. RLS on and no direct access, like the rest of the books. The figures are worked out
when read (`private.meeting_report(from, to)`, mirroring the TypeScript), so a later correction
shows, with the "changed since it was presented" notice the month report already has.

Actions: `save_meeting_report(id, from, to, notes) → id`, `present_meeting_report(id)`,
`delete_meeting_report(id)` (drafts only), and `meeting_reports()` to read. Readers of the Club
fund's books get drafts and presented reports; every approved member who hasn't left gets the
presented ones with their figures and notes, but never the lines (as 5B).

## Screens
- **Treasury** gets a "Treasurer's Report for a meeting" row next to the month report. It opens
  the latest draft, or starts one from the day after the last presented report's end (or 1 July)
  to today.
- **Meeting report screen**: From and To dates, the sections above in the order of Jeff's report,
  a notes box, Save draft, Share as PDF, Present to members (ConfirmButton), Delete draft.
- **Club finances** (members, from Me) lists presented meeting reports above the months.

## The PDF
`meetingReportHtml(report, …)` builds an A4 HTML page in the layout of Jeff's report: the club's
logo with the flag, "Social Motorcycle Club Incorporated", the title, the period, who prepared it
and when, the tables, the read-out in a box, the notes, basis and checks, and the footer
"RUSTNUTS SMC | A0119901K | Treasurer’s report • <month year>". Headings in Rustnuts Stencil.
On a phone `expo-print` writes the PDF and the share sheet opens; on the web the page opens the
browser's print dialog, where Save as PDF is one of the choices. `expo-print` is new native code,
so phones need a new build before the button works there.

The "prepared by" line is the presenter's full name and their treasurer seats ("Treasurer, West
and North Chapters"), or their NEC seat. Dates show as DD/MM/YYYY (project rule), not Jeff's
"1 August".

## What it doesn't do
- No real figures or notes are loaded. Jeff's October notes stay in his PDF unless he says to put
  them in.
- No grouping of lines under Jeff's own headings ("Ring patches and Dawn Studios merchandise");
  lines sit under their code. His notes box covers anything else.
- No bank-statement reconciliation, stock or cash count. The report says so, as his does.

## Tests
- Domain: the figures, the checks, the months cut to the period, the 1 July opening, the rules,
  the read-out wording, the HTML (sections present, figures shown, escaping).
- Database: the same figures on a fixture, the rules with the same words, who can save, present,
  delete and read, drafts hidden from members, lines never sent to members.
- Before shipping: the October lines (fy26-27-books.sql) through both the TypeScript and the
  database give Jeff's numbers ($8,297.71 opening bank, $5,319.40 in, $3,887.73 out, $9,729.38
  closing bank, $10,129.38 total).
