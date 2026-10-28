# Stage 5D: conduct records, merch, national contributions and new chapters

**Type:** architectural. New tables, new database actions, new screens.

Thread "Build merch orders and disciplinary records", branch `claude/project-thread-tsl3th`, migration
prefix `20270420`. Claude approved this spec on 28/10/2026 under Jeff's standing rule; Jeff can veto any
line. Lines marked *inferred* are calls the constitution doesn't make, and are the ones most worth a look.
Section numbers are constitution v4 (25/10/2026). Term limits are left for a later piece (5C handed them
to 5D; not in this one).

## 1. Conduct records (6.9, 14)

The club keeps a short factual record when a board acts on someone's conduct: a vest direction, a ride
safety call, an attendance status call, or the outcome of formal Association discipline. Records
delete themselves after 12 months, and the member can ask for a review or appeal in time.

### Words
- **Kinds.** Internal decisions: **Vest** (6.9), **Ride safety** (7.9), **Attendance** (5.5), **Other
  internal**. Formal Association discipline (14.4, Registered Rules 19–24): **Reprimand**, **Suspension**,
  **Expulsion**.
- **Two paths (14 box, 14.4B, 14.6A).** An internal decision has an internal **review**: requested within
  **14 days of written notice**. A formal outcome has an **appeal**: notice within **7 days of the vote**.
  The screens say "review" or "appeal" to match.
- **Record:** the member, their chapter, the kind, what happened (≤1000 characters, factual), the rule
  (≤200, optional), the decision date, the written notice date (internal only; defaults to the decision
  date), the suspension's end (suspensions only), who recorded it and when.
- **Deletes itself (6.9):** 12 months after the decision, or after a suspension ends if later
  (*inferred*: the 12 months in 6.9 applied to every kind, and counted from a suspension's end).
  - A **hold** keeps it longer while an active disciplinary, grievance or legal matter, or a legal
    retention duty, needs it (6.9): a reason (≤300) and a date, at most 7 years out (*inferred*, the
    club's longest retention period).
  - It is never deleted while its review or appeal is open.
  - A review **set aside**, or an appeal **revoked**, deletes it straight away (6.9).
  - Deleted means deleted: the database removes the rows daily and before every conduct action, and no
    read ever returns one past its day.
- The app is a working record. The Association Secretary keeps the legal register (15.6).

### Who
- **Sees a record:** the member it's about, their chapter's board, the NEC, and its hearing panel. "Their
  chapter" is the one they're in now, so a record follows them when they move (12.4).
- **Records, holds and removes one:** the member's chapter board or the NEC, never about themselves.
  Removing is for mistakes (`ConfirmButton`).
- **Lodges a review or appeal:** the member, or their board on their behalf. One per record.
- **Sets up the hearing:** the member's board or the NEC, apart from the member and whoever recorded it
  ("an affected officer cannot appoint their own appeal panel", 14.3): three different approved
  members, none of them the member or the recorder, and a hearing date.
- **Records the outcome:** one of the three panellists, on or after the hearing date. Internal reviews:
  Confirmed, Varied (with a note) or Set aside (14.6B). Formal appeals: Upheld or Revoked (14.6).
- **Withdraws:** the member, while it's open.
- Due dates shown, not enforced: hearing within 21 days of lodging (14.6, 14.6B); an internal decision
  within 14 days of the hearing (14.6B).

### Refusals (same words in the app and the database, in this order)
Every action starts with `Sign in first.` and `Only approved members can do that.`
- **Record:** `Pick an approved member.` · `You can’t record one about yourself.` ·
  `Only that member’s chapter board or the NEC can do that.` · `Pick what kind of record it is.` ·
  `Say what happened.` · `Keep what happened to 1000 characters at most.` ·
  `Keep the rule to 200 characters at most.` · `Pick the date of the decision.` ·
  `The decision can’t be in the future.` · (suspension) `Pick when the suspension ends.` ·
  `That decision is more than 12 months old, so it isn’t kept.` · (internal) `Pick when written notice was given.` ·
  `Written notice can’t come before the decision.` · `Written notice can’t be in the future.`
- **Hold:** `No such record.` · board rule · self rule · (setting) `Say which matter needs it kept.` ·
  `Keep the reason to 300 characters at most.` · `Pick a date after today.` · `Hold it at most 7 years.`
- **Remove:** `No such record.` · board rule · self rule.
- **Lodge:** `No such record.` · `Only the member or their board can lodge this.` ·
  `A review or appeal has already been lodged.` · `Say why.` · `Keep it to 1000 characters at most.` ·
  `The window closed on DD/MM/YYYY.`
- **Hearing:** `No review or appeal is lodged.` · `That one is settled.` ·
  `Only the board or NEC, apart from whoever recorded it, can set up the hearing.` ·
  `Pick three different people.` · `Pick approved members for the panel.` ·
  `The panel can’t include the member or whoever recorded it.` · `Pick the hearing date.`
- **Outcome:** `No review or appeal is lodged.` · `That one is settled.` ·
  `Only the hearing panel can record the outcome.` · `Wait until the hearing.` · (database only, for a value the
  app can't send) `Pick an outcome.` ·
  `A formal appeal is upheld or revoked (14.6).` · `Say how it was varied.` ·
  `Keep it to 1000 characters at most.`
- **Withdraw:** `No review or appeal is lodged.` · `That one is settled.` ·
  `Only the member can withdraw it.`

## 2. Merch (15.1, 13.1)

Members order club merch with sizes; boards approve the designs and the orders; money comes in by
PayID, bank or cash and lands in the books. **No card payments** (a payments account needs Jeff's yes).

- **Item:** a chapter's (or the whole club's, chapter null), with a name (≤80), details (≤500), sizes
  (0–12 short labels, each ≤10, no repeats; none means one size), a price ($0.01 to $1,000), and
  "Full and Nomad members only" for anything carrying the patch.
- **Design approval (15.1):** the chapter's board (the NEC for club-wide items, since they affect
  national identity) puts an item up, and **someone else** in that group approves it (*inferred* two-person
  rule, like the money rules). Then it's **On sale** until closed. Declined items keep their reason.
- **Order:** any approved member who hasn't left (not Legacy) picks a size and a quantity (1–10), with an
  optional note (≤300). The price is fixed when ordered.
  - **Waiting** → the board says yes (**Approved**: the member is shown how to pay, with the chapter's
    PayID) or no.
  - **Paid:** whoever keeps that fund's books (13.3) records the day the money came in. That adds a
    CR-005 Merchandise sales line to the ledger, banked that day, in the item's fund.
  - **Handed over:** the board marks it collected.
  - Cancelled by the member or the board until it's paid.
  - Nobody approves or records payment on their own order (*inferred*, as with fees).
- Members see items on sale and their own orders; the board and book-keepers of that fund see all of
  its items and orders.

Refusals: `No such chapter.` · `Only that chapter’s board can do that.` / `Only the NEC can do that.` ·
`Name it.` · `Keep the name to 80 characters at most.` · `Keep the details to 500 characters at most.` ·
`Keep sizes to 10 characters, no repeats, 12 at most.` · `Enter a price from $0.01 to $1,000.` ·
`No such item.` · `That item has already been decided.` ·
`Someone other than whoever put it up approves it (15.1).` · `Keep the reason to 300 characters at most.` ·
`Only an item on sale can be closed.` · `That item isn’t on sale.` · `Legacy members can’t order merch.` ·
`That item is for Full and Nomad members only.` · `Pick a size.` · `Order 1 to 10.` ·
`Keep the note to 300 characters at most.` · `No such order.` · `That order has already been decided.` ·
`Someone else approves your own order.` · `Approve the order first.` · `That order is already paid.` ·
`Pick the day it was paid.` · `Someone else records your own payment.` · `Mark it paid first.` ·
`Only whoever ordered it or the board can cancel it.` · `That order can’t be cancelled now.` · and the
ledger's own `Only that fund’s treasurer, or the National Chairman or Secretary, keeps its books.`

## 3. National contributions (13.6)

- The NEC proposes a national event or project budget: a title (≤80), what it's for (≤1000) and a total.
- Each chapter's share is worked out **when proposed**, in proportion to its Voting Members (approved
  Full and Nomad members), to the cent, remainders to the largest fractions (ties by chapter slug).
- Each chapter's board records its decision by naming its own closed board vote on it, opened after
  the proposal (13.6: "each decision minuted"): carried means yes, anything else no. A vote that already
  stands for another contribution decision, a new chapter or a budget can't be used again, and the
  screen shows the vote's question in a confirm step before it's recorded.
- A majority of the chapters at proposal saying yes approves it; once a majority can't be reached it's
  not approved. The NEC can withdraw it while it's open.
- Paying shares between funds is left for later (the ledger has no transfer code yet).

Refusals: `Only the NEC can propose a national contribution (13.6).` · `Give it a title.` ·
`Keep the title to 80 characters at most.` · `Say what it’s for.` · `Keep it to 1000 characters at most.` ·
`Enter a total from $1 to $100,000.` · `There are no Voting Members to share it between.` ·
`No such contribution.` · `That contribution is settled.` · `Only that chapter’s board can record its decision.` ·
`That chapter has already decided.` · `Pick that chapter board’s closed vote on it (13.6).` ·
`Only the NEC can withdraw it.`

## 4. New chapter setup (12.1)

- A proposal has a name (≤40, not taken), an area (≤80), a state (default VIC), the five parts of the
  written proposal (location, membership, leadership, budget, operations, each 1–2000), at least five
  founders who are approved Full or Nomad members, and a founding President and Sergeant-at-Arms from
  among them (Full only: Nomads hold no board seat, 9.1).
- Put forward by the NEC or one of the founders.
- **Approved** by an NEC member naming a carried NEC vote opened after the proposal and not used for
  anything else, through a confirm step that shows its question (12.1 "majority
  NEC approval"). Approval, in one go: the chapter is created (its chats make themselves), the founders
  move to it (12.4 transfer), and the President and SAA take their seats from today. A vote that didn't
  carry marks it **Not approved**. The NEC or whoever proposed it can withdraw it while open.
- Founders still holding a position in their old chapter end it first (*inferred*, so nobody sits on two
  boards).
- The chapter only exists inside the club (12.2): no bank account or fees until the board sets them up.

Refusals: `Only the NEC or one of the founders can put it forward.` · `Name the chapter.` ·
`Keep the name to 40 characters at most.` · `There’s already a chapter called that.` · `Say where it’s based.` ·
`Keep the area to 80 characters at most.` · `Pick a state.` · `Cover the <part> in the proposal (12.1).` ·
`Keep each part to 2000 characters at most.` · `A new chapter needs at least five founders (12.1).` ·
`Founders must be approved Full or Nomad members (12.1).` ·
`Pick a founding President and Sergeant-at-Arms from the founders (12.1).` ·
`Nomads can’t hold a board seat (9.1).` · `No such proposal.` · `That proposal is settled.` ·
`Only the NEC can approve a new chapter (12.1).` · `Pick the NEC’s closed vote on it (12.1).` ·
`Founders have to end their positions in their old chapter first.` · `Only the NEC or whoever put it forward can withdraw it.`

## Data (migration `20270420000000_board_admin.sql`)
Tables (RLS on, no direct API access; `club_admin()` reads, SECURITY DEFINER actions write):
`conduct_records`, `conduct_appeals`, `merch_items`, `merch_orders`, `national_contributions`,
`contribution_decisions`, `chapter_proposals`. Helpers reuse `private.require_member`, `is_board_of`,
`is_national`, `runs_scope`, `keeps_books`, `club_date`, `trim_like_app`. `private.purge_conduct()` runs
daily through pg_cron where it exists and at the start of each conduct action. Its `delete from` is the
point of the feature; the paste file says so.

## App
- Rules in `src/domain/conduct.ts`, `merch.ts`, `national.ts`, each with tests; demo actions in
  `src/data/adminActions.ts`; live read in `src/data/adminLive.ts`; parity cases appended to `parity.json`.
- **Board screen:** a card of its own under the first one (the tab bar and that card belong to other lanes),
  with Conduct records, Merch and National, each showing what's waiting.
- **Me screen:** a "Club gear" section with Merch for everyone, plus "Your records" when someone has one, so
  they can ask for a review or appeal.
- **Chapters screen:** a "New chapters" row, so a founder who isn't on a board can put one forward.
- Screens: Conduct (also "Your records"), ConductRecord, RecordConduct, Merch, MerchItem, MerchOrder,
  ProposeMerch, National, Contribution, ProposeContribution, ChapterProposal, ProposeChapter. No Alert dialogs. Stencil for titles, names,
  buttons, chips, numbers and dates. Checked at 390×844.

## Known limits (from the review, left for later)
- A vote isn't formally tied to its subject; the rules only stop an old or already-used vote, and the
  confirm step names the vote so the wrong one is easy to spot.
- If whoever recorded a record leaves the database, the "apart from whoever recorded it" panel rule
  can't apply to them.
- A member can be a founder in two open proposals; approving both moves them twice.
- For club-wide merch, any chapter treasurer can see and mark paid the orders (the books' existing
  rule: the club fund is kept by the NEC money officers and treasurers).
- Order refusals check Legacy before "That item isn't on sale."
