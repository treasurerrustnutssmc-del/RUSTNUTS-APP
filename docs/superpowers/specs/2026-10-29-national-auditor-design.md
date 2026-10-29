# The National Auditor, in full (constitution v4, 11.8 and 13.8)

29/10/2026. Architectural (it changes row-level security in many places), so it gets this spec and a
plan (`docs/superpowers/plans/2026-10-29-national-auditor.md`). Claude approved it under the
self-approval rule; Jeff can veto any line. Migration prefix `20270535`.

## What the constitution says

> 11.8. The NEC must appoint a neutral National Auditor by two-thirds vote for a renewable twelve-month
> term. The Auditor cannot also be a Chapter President, National Treasurer or Chapter Treasurer and has
> no ordinary NEC vote from that appointment. Within lawful records access and authority, the Auditor
> reviews Club policy compliance, membership and attendance records, event funds, bank records,
> transactions and controls; may request relevant information, issue written correction requests and
> report findings. […] It never replaces an independent external review or audit required by law […]

> 13.8. […] The National Auditor's internal role does not replace members' legal inspection rights.

## Where the app stands today

- The role exists (`nec_auditor`), the 12-month term is shown (terms.ts), and "can't also be a President
  or Treasurer" is enforced both ways. There's no National Treasurer role in the app, so that part has
  nothing to check.
- The Auditor reads every fund's books and never approves spending (Stage 5B).
- The Auditor can't designate Big 4s (Jeff, 28/10/2026).
- **But** the Auditor counts as "national" everywhere (`isNational`, `private.is_national()`), so today
  they hold the NEC's full powers: approving applicants in any chapter, changing members' status,
  seating and ending Presidents, running meetings and votes, moderating chats, publishing the Road Rules,
  reading conduct records and private details. The v4 audit (25/10/2026, item 4) flagged this.
- The Chairman hands out the role alone. There's no vote, no request or report.

## The design

### 1. The Auditor reviews; they don't run anything

The Auditor stops counting as NEC. `isNational` / `private.is_national()` become the National Chairman,
the National Secretary and the sitting Presidents. `isNecOfficer` / `private.is_nec_officer()` (who seats
and ends Presidents) become the Chairman and Secretary: a neutral reviewer shouldn't seat the people
they review. Everything that flows from those helpers follows, in the app and the database alike.

So the Auditor no longer approves, appoints, changes statuses, runs meetings or votes, runs check-ins,
manages rides or the bus, moderates chats, publishes Road Rules or proposes contributions and chapters.
They keep whatever their own membership and any other seat gives them. They're not in the NEC chat
(11.2 lists the Chair and the Presidents; findings go through requests and reports instead).

`accessLevel` follows: an Auditor with no other seat is a `member` for the tab bar. They reach their
work through a new **Audit** card on Me.

### 2. What the Auditor can read (11.8)

A new reviewer read, `isAuditor(me)` / `private.is_auditor()`, is added only where 11.8 names the record:

| Record (11.8) | Tables or reads | Change |
|---|---|---|
| Bank records, transactions, controls | ledger, budgets, openings, floats, Treasurer's reports | Already reads (5B) |
| Membership records | members (pending applicants too), application decisions, positions | `members_read`, `member_decisions_read` gain the Auditor |
| Attendance records | attendance, check-in sessions, exemptions | `attendance_read`, `attendance_exemptions_read` gain the Auditor (sessions are already member-readable) |
| Fees (transactions) | charges, payments | `private.can_see_fees` gains the Auditor |
| Policy compliance | board and NEC meetings, draft minutes, action items, votes (tallies, never secret ballots), document sign-offs | `club_business` and `club_documents` read with `private.reviews_scope()` = `runs_scope()` or the Auditor |
| Event funds | merch items and orders; contributions and chapter proposals | `club_admin` adds the Auditor to the merch reads (contributions and proposals are already member-readable) |

Left out on purpose (least privilege, Jeff can veto): private details (licence, first aid, emergency
contacts, regos), phones that weren't shared, conduct records and appeals, and chats. None is a record
11.8 names, and the board can always answer a request with what's needed.

Writes never widen: every write action keeps its own check, which no longer passes for the Auditor.

### 3. Appointment by a two-thirds NEC vote, renewable for twelve months

- A new kind of national subject vote: **"Appoint National Auditor"**, an NEC vote at the two-thirds
  threshold about one member. `open_vote` accepts it when the subject is an approved Full Member who
  isn't a sitting President or Treasurer. (Today a national subject vote can only be a reinstatement,
  which stays a majority vote on someone who isn't Full, Nomad or an FNG.)
- Appointing `nec_auditor` needs that vote **carried and closed in the last 90 days** (the same window
  as reinstatement, inferred). The Chairman still records the appointment (they hand out national roles).
- **Renewal:** with a fresh carried vote, the Chairman can renew the sitting Auditor: the old term ends
  today and a new twelve-month term starts today, so the history shows each term. The Appoint screen
  offers "Renew" when the Auditor's term is ending (60 days) or ended.
- A refusal says why: "Appointing the National Auditor needs a carried two-thirds NEC vote about them
  in the last 90 days (11.8)."

### 4. Requests and findings

**Requests** (`audit_requests`): the Auditor writes to one chapter's board, or to the NEC for the Club
fund and national matters.

- Kind: **information request** ("may request relevant information") or **correction request** ("issue
  written correction requests").
- Area: policy compliance, membership, attendance, event funds, bank records, transactions, controls.
- Title, details, optional due date (no earlier than today), and optionally the ledger line it's about.
- That chapter's board (or for national, the Chairman, Secretary and Presidents) answers in writing.
  An answer can be updated until the Auditor closes it.
- The Auditor closes it with a note (satisfied, or not, or withdrawn). Closed is final.
- Seen by the Auditor, whoever answers for that scope, and the NEC. Never by ordinary members.

**Findings reports** (`audit_reports`): title, period (from, to), findings, recommendations.

- The Auditor saves drafts (only they see them) and issues one when ready. Issued is final and dated.
- An issued report is read by the NEC and every chapter board. Members keep their own inspection
  rights under 13.8; the report screen says the Auditor's review doesn't replace them or an external
  audit.

### 5. The checks (computed on the phone, nothing stored)

An Audit home lists what the books and records show, each with an **Ask about this** that starts a
correction request already filled in:

- Money: a paid payment without two approvals; a payee who approved their own payment; money banked
  more than five working days after it came in (13.1); money in that still isn't banked after five
  working days; confirmed fee payments not yet in the books; a past month with lines that was never
  presented; this year's budget not approved for a fund.
- Records: a term past its end date (including the Auditor's own); board or NEC minutes overdue past
  seven days (10.8); members behind on attendance standing (count per chapter, from standing.ts).

### 6. Screens

- **Me → Audit** (Auditor only): the checks, open requests, reports, and shortcuts into the books
  (Treasury), meetings and votes (Business) and the members' records.
- **Audit records**: per chapter, every member's status, patched and FNG dates, positions and attendance
  standing, read only.
- **New request**, **Request** (answer, close), **Report** (draft, issue, read).
- **Board** gets an "Auditor's requests" row when there's an open request for that board or the NEC,
  and the issued reports.

Stencil for titles, chips, dates and numbers; body font for the written requests and findings. No
pop-ups: Issue and Close use `ConfirmButton`.

## Testing

- App rules (`npm test`): the narrowed NEC helpers, each new read, the vote and appointment rules, the
  request and report rules, each check.
- Database (`npm run test:db`): an `auditor_test.sql` that signs in as the Auditor and proves each read
  (and each left-out read) and every refused write, plus shared demo/database cases in `parity.json`.
- Existing tests that assumed the Auditor runs things are updated to the new rule, not deleted.

## Live

One file, `20270535000000_national_auditor.sql`, queued in "Apply pending SQL in Supabase" for
29/10/2026's Run. None of the roster loads seated a National Auditor, so the split changes nothing for
anyone on live until one is appointed. It contains `drop policy` lines (to replace four read policies).

## Not in scope

- A National Treasurer role (11.2, 11.6), so "can't also be National Treasurer" waits for it.
- Push for requests and reports (push is held until launch); they show on the Board and Audit screens.
- An external auditor's login.
