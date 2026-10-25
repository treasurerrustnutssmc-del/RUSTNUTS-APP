# Treasurer (Stage 5, part B)

**Type:** architectural (new tables, new database actions, new screens). Claude approved this spec
on 25 Oct 2026 under the self-approval rule in AGENTS.md. Jeff can veto any of it. Rules marked
*(inferred)* are Claude's reading where the constitution or Jeff's sheets don't settle it.

## Where this comes from
- **Constitution v4, section 13** (in /mnt/project-files/reference/):
  - 13.1: deposit money within five working days of receiving it.
  - 13.3: chapter treasurers record and reconcile. Every payment, withdrawal or transfer needs two
    distinct authorised approvers, neither of them the payee, and the approval is recorded before
    payment.
  - 13.4: the Chapter Board approves its annual budget, and members don't vote on it.
  - 13.5: the financial year ends 30 June. Records are kept at least seven years.
  - 13.8: members can inspect presented statements.
  - 11.8: the National Auditor reviews bank records, transactions and controls.
- **Jeff's treasurer Drive** (read for shape only, nothing loaded):
  - "Rustnuts Financials" has one sheet per financial year with Date, Payment Code, Transaction By,
    Description, and credit and debit columns per fund (West, North, Club; debits also "Joint").
  - Fourteen payment codes, CR-001 to CR-007 and DB-001 to DB-007.
  - The monthly Treasurer's Report gives:
    - the opening balance;
    - credits and debits totalled by code;
    - the closing bank balance and a $400 cash float;
    - the Club, West and North balances;
    - total club funds.

    Total funds = bank + float = the sum of the fund balances.

## Goal
- Treasurers keep the club's books in the app instead of the spreadsheet: one ledger, split into
  funds, using the club's own codes.
- Spending follows 13.3. Every debit gets two approvals, neither from the payee, before it's paid.
- The monthly Treasurer's Report builds itself. The treasurer presents it, and then members can
  read it (13.8).
- Each fund has a budget for the year. The board approves it by a carried vote (13.4), and the
  budget shows against actual spending.
- The National Auditor can read everything and change nothing.

## Funds
A fund is a chapter (`chapter_id`) or the Club fund (`chapter_id` null), the same scope rule as
meetings and votes. There is one bank account, so the funds are shares of it.

## Codes
Fixed, seeded, and the same in the app and the database:

| Code | Label | Code | Label |
|---|---|---|---|
| CR-001 | Member fees | DB-001 | Club expenses |
| CR-002 | Donations to RSMC | DB-002 | Donations to charity |
| CR-003 | Club payment | DB-003 | Misc |
| CR-004 | Bank interest | DB-004 | Bank fees |
| CR-005 | Merchandise sales | DB-005 | Merchandise purchase |
| CR-006 | Meeting food | DB-006 | Refund |
| CR-007 | Event buy-in | DB-007 | Club meeting expense |

## Who's who
- **Keeps a fund's books** (`keepsBooks`):
  - a chapter fund: that chapter's Treasurer, the National Chairman or the National Secretary
    (the same people as `canManageFees`);
  - the Club fund: any chapter Treasurer, the National Chairman or the National Secretary
    *(inferred, standing in for the Association Treasurer)*.
- **Approves a fund's spending** (`approvesFor`):
  - a chapter fund: that chapter's board seats, the National Chairman and the National
    Secretary;
  - the Club fund: the National Chairman, the National Secretary and sitting Presidents.
  - The National Auditor never approves, because they review the controls (11.8).
- **Reads the ledger** (`seesLedger`): the book-keepers and approvers of that fund, plus the
  National Auditor for every fund.
- **Reads presented reports:** every approved member who isn't Legacy.

## Ledger entries
`public.ledger_entries`:
- `id` and `chapter_id`, which is null for the Club fund.
- `code` (one of the 14), `description`, and `amount_cents` (more than 0; the code's direction
  sets the sign).
- `received_on` (date, credits only): when the money came in. It defaults to the banked date.
- `entry_on` (date): when it was banked, or for a debit when it was paid. Null until a debit is
  paid.
- `payee_member_id` or `payee_name` (debits only, at least one of them).
- `payment_id`: the Stage 4 fee payment this came from. It's unique, so a payment goes in once.
- `state`, one of:
  - `awaiting`: a debit waiting for approval;
  - `approved`: a debit with two approvals;
  - `paid`: banked or paid out;
  - `void`.
- `recorded_by`, `recorded_at`, and `void_reason`, `voided_by` and `voided_at`.

`public.ledger_approvals`: `entry_id`, `member_id` and `approved_at`, keyed on entry and member.

### Rules
- **Recording a credit** is for the fund's book-keepers. It's `paid` straight away.
  - If it was banked more than five working days after it was received (Monday to Friday, with
    public holidays ignored *(inferred)*), it's still saved, flagged "Banked late (13.1)".
- **Recording a debit** is for the fund's book-keepers. It starts `awaiting`.
  - If the recorder is an approver of that fund and not the payee, that counts as the first
    approval *(inferred)*.
- **Approving a debit** is for the fund's approvers. Refused if:
  - you're the payee: "The payee can’t approve their own payment (13.3).";
  - you've already approved it: "You’ve already approved this.";
  - it isn't awaiting.

  The second distinct approval makes it `approved`.
- **Bank fees (DB-004)** need no approval, because the bank takes them *(inferred)*. They're
  recorded straight to `paid`.
- **Marking a debit paid** is for the fund's book-keepers, and only once it's `approved`: "It
  needs two approvals before it’s paid (13.3)." They give the paid date.
- **Voiding** is for the fund's book-keepers, with a reason, on any entry that isn't void. Nothing
  is ever removed, because records are kept for seven years (13.5). Void entries stay listed and
  count for nothing.
- **Fee payments:** a confirmed Stage 4 payment that isn't in the ledger yet shows in a "Fees to
  add" list. "Add to ledger" records it as CR-001 in that chapter's fund, dated the day it was
  paid, with the member's name. It's one tap, not automatic, so lane C's functions stay
  untouched.
- **Only `paid` entries count** towards balances and reports.

## Openings and float
- `public.fund_openings`: `chapter_id` (null for the Club fund), `fy` and `amount_cents` (which
  can be negative). This is the fund's balance on 1 July. The fund's book-keepers set it.
- `public.cash_floats`: `fy` and `amount_cents`. The Club fund's book-keepers set it.
- **Live starts empty.** Copying Jeff's spreadsheet in is real financial data, so it waits for
  his yes. It isn't part of this build.

## Monthly report
`monthReport(month)` is one calendar month across every fund, in the same order as Jeff's doc:
- **Opening:** total funds at the start of the month. That's the openings for that financial year,
  plus paid entries from 1 July to the end of the previous month.
- **Credits** by code, all seven shown even at $0, with the total.
- **Debits** by code, all seven shown, with the total.
- **Fund balances** at the end of the month, for Club and each chapter.
- **Total club funds**, the **cash float**, and the **closing bank balance**, which is total
  minus float.

Presenting it:
- `public.treasurer_reports`: `month` (the 1st), `presented_at` and `presented_by`.
- The Club fund's book-keepers press "Present to members" once the month has ended.
- Members see presented months only. The numbers are worked out when read, so a later
  correction shows up. The report says "Presented 03/11/2026, updated since" if any entry for
  that month changed after it was presented *(inferred)*.

## Budgets
- `public.budgets`:
  - `chapter_id` (null for the Club fund) and `fy`;
  - `lines`: a jsonb of `{code: cents}` with whole cents of 0 or more;
  - `approved_vote_id`, `approved_at` and `approved_by`.
- **Editing:** the fund's book-keepers edit the lines while the budget isn't approved.
- **Approving:** someone who runs that scope approves it by naming a carried vote.
  - For a chapter, the vote is that chapter's `chapter_board` vote.
  - For the Club fund, it's an `nec` vote.
  - Wrong vote: "Pick a carried board vote for this budget (13.4)."
  - Once approved, the budget is locked.
- **Reopening:** someone who runs the scope reopens it. This clears the approval so a new vote can
  approve the amended budget. The old vote stays in the votes history.
- **Budget against actual:** each line shows the year's paid amount for that code and fund, the
  amount budgeted, and what's left.

## Plumbing (same pattern as meetings and votes)
- Revoke table access for `anon` and `authenticated`, and turn row-level security on with no
  policies. All access goes through SECURITY DEFINER functions with `search_path = ''`.
- **Reading:** `club_ledger()` returns jsonb:
  - `entries` and `approvals` for the funds the viewer can read;
  - `openings`, `floats`, `budgets` and `reports` (presented months) for every approved member,
    since these are totals, not lines;
  - `report_totals`: for a member who can't read the ledger, the database works out each
    presented month's report (`private.month_report`) so they never get the lines.
- **Actions:**
  - `record_credit(chapter, code, description, amount_cents, received_on, entry_on)`;
  - `record_debit(chapter, code, description, amount_cents, payee_member, payee_name)`;
  - `approve_debit(id)`, `pay_debit(id, paid_on)` and `void_entry(id, reason)`;
  - `add_fee_payment(payment)`;
  - `set_opening(chapter, fy, amount_cents)` and `set_cash_float(fy, amount_cents)`;
  - `save_budget(chapter, fy, lines)`, `approve_budget(chapter, fy, vote)` and
    `reopen_budget(chapter, fy)`;
  - `present_report(month)`.
- Refusals use the same words as `src/domain/ledger.ts`. Shared cases go in `parity.json`, and the
  report totals get a parity case of their own.
- **Migration:** `20270101000200_treasurer.sql`. It only adds. It has no "drop" and no "delete
  from".

## Screens
These are reached from existing screens. The tab bar is lane B's.
- **Board screen:** a "Treasury" row for anyone who reads a ledger. It opens **Treasury**:
  - fund balance cards (Club, West, North);
  - "Needs your approval", with debits you can approve;
  - "Fees to add";
  - buttons for Add money in, Add spending, Monthly report and Budgets.
- **Ledger list:** filter by fund and month. Each row shows the date as DD/MM/YYYY, the code chip,
  the description, the amount (credits in, debits out), and its state. Tapping a row opens the
  entry, where you can approve, mark paid, or void it (void uses `ConfirmButton`).
- **Monthly report:** a month picker, and the report laid out like Jeff's doc. Book-keepers get
  "Present to members".
- **Budgets:** pick a fund and year. Each line shows budget, actual and left. Book-keepers edit the
  lines, and the board approves with a carried-vote picker.
- **Me → Club finances:** for every approved member. It lists the presented months and opens a
  read-only report.
- Everything follows DESIGN.md. Codes, amounts and dates are in Rustnuts Stencil on cards. Amounts
  use `formatCents`, and "in" and "out" are told apart by sign and label, not by colour alone.

## Tests
- `src/domain/ledger.test.ts`:
  - who keeps, approves and reads each fund;
  - the two-approver rule, including that the payee can't approve and an approval can't count
    twice;
  - bank fees skipping approval;
  - pay only after approval;
  - void;
  - the banked-late flag across a weekend;
  - month report totals, opening rollover across financial years, and float;
  - budget against actual;
  - budget approval needing the right carried vote.
- `src/data/ledger.test.ts`: demo actions and the live read mapping.
- `supabase/tests/treasurer_test.sql`: each action's refusals, members getting report totals but
  no lines, and the auditor reading but not writing.
- Parity cases for every refusal and one report.

## Not covered yet
- Transfers between funds, and "joint" debits split across chapters. For now these are entered as
  separate lines.
- The asset register (13.7) and auditor correction requests (11.8).
- National contributions (13.6), which belong to 5D.
- Bank import or reconciliation against a statement.
- Loading the FY26–27 spreadsheet into live, which needs Jeff's yes.
