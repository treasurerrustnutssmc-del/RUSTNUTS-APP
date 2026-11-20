# Members' report in Jeff's layout, and Club spending

Date: 21/11/2026 (Melbourne). Asked by Jeff (Treasurer) in the project thread "Add a Treasurer report in the app":
"that's what I need the report to look like members see" (his uploaded November 2026 PDF), and "members should
be able to see all expenses" (he chose "Hide member names"), then "my format and all expenses clear to understand".
Kind of work: architectural (a new database action). Claude approved this design (Jeff's 24 Oct rule).

## 1. The Report for a meeting, as Jeff's PDF

Reference: `/mnt/project-files/reference/Rustnuts November 2026 Treasurer's Report (Jeff upload).pdf`.

- `src/domain/meetingStatement.ts` builds one statement from the meeting figures, shared by the screen and the PDF:
  - Letterhead: the club's legal name, incorporation number, ABN and address, with the logo.
  - Title block: "Club Treasurer's Report", then the meeting's day (presented day, or today for a draft) with
    "Provisional figures", then "Cashbook period 22 October to 8 November 2026".
  - Rows, in Jeff's order:
    - Opening club funds (with the float), then the opening bank balance.
    - Total credits, with all 7 credit codes in Jeff's wording, $0.00 lines included.
    - Total debits, with all 7 debit codes in the same way.
    - Provisional balances: closing bank and the float.
    - Total club funds, with each fund's allocation.
    - Net increase or decrease in recorded club funds.
  - Notes are paragraphs. A short opening sentence ("Club expenses.") is shown in bold, as in Jeff's PDF.
- **Share as PDF** makes this one-page statement for everyone.
- Whoever reads every fund's lines also keeps the old long report:
  - on screen, the months, the read-out, each line and the checks;
  - **Share the full workings**, which makes the old multi-section PDF (`meetingReportFullHtml`).
- Long dates ("8 November 2026") on this report only, because Jeff's report uses them. The rest of the app stays DD/MM/YYYY.
- No database change: the figures already come from `meeting_reports()`.

## 2. Club spending

- Club finances gets a **Club spending** row, showing this financial year's total. It opens a page with:
  - the financial year (this one or last);
  - the total spent, then the total for each kind of expense;
  - every paid expense, grouped by month, showing description, date, kind, fund, who was paid and amount.
- Member names are taken out (Jeff's choice):
  - Any member's full or road name (3+ characters, whole words, any case) becomes "a member".
  - The payee is "A member" when it's a member.
  - Money coming in isn't listed, because it would show who paid fees.
- Readers are the same as presented reports: approved members who haven't left, and the books keepers. Never Family.
- Database: `public.club_spending()` (migration `20270890000100_club_spending.sql`) and `private.hide_member_names(text)`.
  Members never receive the ledger lines themselves.
- The app uses the database's lines when the function exists. Otherwise (the demo, or before the migration runs) it
  works them out from the ledger with the same rule (`src/domain/clubSpending.ts`).

## Tests

- `npm test`: the statement's order and figures, long dates, note leads, the PDF's layout and escaping, spending
  lines and name hiding, the live parser.
- `npm run test:db`: `supabase/tests/club_spending_test.sql` (paid debits only, names hidden, who can read).

## Going live

1. Run the migration in the SQL editor. It only adds functions, so it's safe to run twice.
2. Merge, then send the production over-the-air update. Before the migration runs, the app still works:
   members see spending only once the function exists.
