# Members and money (Stage 4)

**Type:** architectural. It adds new tables, new database actions and new screens across four
features. It is lane C of the parallel build (`/mnt/project-files/build/parallel-stages.md`):
migrations use the `20261201` prefix, shared files only get one appended block each, and no tab
is added (lane B owns the tab bar). Claude approved this spec on 24 Oct 2026 under Jeff's
self-approval rule. Jeff can veto any of it.

## Goal
The board stops tracking joiners, FNGs, attendance and fees in spreadsheets. Riders check in at a
meeting or ride by scanning a QR code. An applicant can see how far through the introduction
phase they are. The board sees when each FNG review is due and records the outcome. Members see
what they owe, pay by PayID, and get a receipt once the treasurer confirms it.

## What the club's rules say (from the constitution, as already used in the code)
- **Introduction phase (3.2):** three months, two official club meetings, and a ride organised by
  a member, before the board votes on letting them in as an FNG.
- **FNG reviews (5.2, 5.4, 5.5):** at 6, 9 and 12 months, then every 3 months until a decision is
  made. Full membership needs a **unanimous** vote of patched members (5.4).
- **Continuation fee:** named in the Ambition list beside the FNG reviews. The amount and exact
  trigger aren't written down anywhere Claude can read. See the open questions.
- **Fees:** the treasurer's 2024–25 and 2025–26 ledgers show member fees paid from July onwards,
  mostly $250, some in parts ($100, $125). So fees run by **financial year (1 July to 30 June)**,
  part payments happen, and the amount is set by the club, not by the app.

## Design

### 1. Attendance check-in
- **Check-in sessions.** A chapter's board (or the NEC) opens a check-in for a **ride** from the
  calendar or for a **meeting**. A session has a kind, a chapter (null for a whole-club ride), the
  ride if there is one, a title, the date it's held (Melbourne date), a 6-character code, and
  when it was closed. One session per ride.
- **Checking in.** The leader's phone shows a big QR code (and the code in stencil underneath).
  A rider scans it with the app's camera, or types the code. That works only on the session's
  date and while it's open. A second check-in is a no-op, never an error.
- **Headcount.** The leader sees everyone checked in, and can tick people off by hand (someone
  with a flat battery, or an applicant). Ticks can be added or removed on the day or afterwards,
  so the record can be fixed.
- **Who can check in:** any approved member, and an **applicant still in their introduction
  phase** (pending, status Introduced), because their meetings and ride are what the phase
  counts. Nobody else.
- **The code stays secret.** Members can read sessions and who attended, but not the code. Only
  people who can run the session can read it, so nobody can check in from home.
- **Attendance shows** on the ride and meeting, on each member's profile (this financial year:
  rides and meetings), and drives the introduction tracker. Big 4 eligibility waits for Jeff's
  rule (open question 1); the attendance it needs is recorded from day one.
- **QR:** drawn by the app from the `qrcode` package's matrix as plain views (no native code).
  Scanning uses `expo-camera` (`CameraView`, `useCameraPermissions`), which is in Expo Go and works
  on the web preview. Typing the code always works too, and is the fallback when the camera is
  refused.

### 2. Join process and introduction tracker
- The current flow stays: ask to join → the chapter board decides. What's new is what the
  applicant and the board see in between, and a record of the vote.
- **Applicant (Pending screen):** a progress card: days left of the three months, meetings
  attended (x of 2), member rides attended (x of 1), each ticked as it's done, and a **Check in**
  button.
- **Board (applicant card):** the same progress, a "Ready for the vote" chip when all three are
  met, and a "not finished yet" note otherwise. The board can still decide early. The rules say
  what to do, and the app shows it but doesn't block it.
- **Recording the vote:** the applicant card gets optional **For / Against / Abstained** counts
  and a note. Approving or declining goes through one new action, `decide_application`, that
  does what `approve_member` / `decline_member` do now and stores the decision in
  `member_decisions`.

### 3. FNG tracker
- **Schedule:** review slots at 6, 9, 12, 15, 18 … months from `fng_started_on`. The **due**
  review is the latest slot that has passed without a recorded review, or else the next one
  coming. A review counts for the slot it was recorded against.
- **Recording a review** (chapter board, never yourself), with optional vote counts and a note:
  - **Continue:** stays an FNG. The next slot becomes due. At the 12-month review or later, a
    continuation fee is raised automatically **if** the chapter has set one for that year.
  - **Patch:** becomes Full (the disc is earned). The vote must be unanimous: at least one For,
    none Against (5.4).
  - **Not continuing:** stops being an FNG and becomes a **Supporter** *(inferred: open question
    3)*.
- **Screens:** the Board's FNG list shows due and overdue reviews, and taps through to an **FNG
  review** screen with the schedule, past reviews, meetings and rides attended since they
  started, and the record form. The member's profile shows the next review, as now.

### 4. Fees, receipts and reminders
- **Fee rates** per chapter and financial year: an amount for each status that pays (Full, Nomad,
  FNG, Supporter, Family; Legacy never pays), a due date, and an optional continuation fee.
- **Raising fees:** the treasurer taps **Raise FY26–27 fees** for their chapter. Every approved
  member of that chapter whose status has a rate gets one annual charge. Running it again only
  adds charges for people who don't have one yet. One-off charges (with a description) can be
  raised for a single member too.
- **Paying:** the member's **Fees** screen shows what's owing, the chapter's PayID (and BSB and
  account, if set) with a copy button, and the reference to use. They tap **I've paid**, with the
  amount, the date and their reference. The treasurer confirms or rejects it. The treasurer can
  also record a payment directly (cash, bank, PayID).
- **Receipts:** a confirmed payment gets a receipt number (`W26-0001`: chapter initial, year, and
  a running number per chapter and year). The member sees their receipts on the Fees screen.
- **Part payments** are fine. A charge is paid once its confirmed payments reach its amount. The
  treasurer can **waive** a charge (two-tap confirm).
- **Reminders (in the app only):** a Home card when you owe something, saying "due in 12 days"
  or "overdue". The Board shows outstanding fees and claims waiting to be confirmed. No emails or
  pushes (Stage 6, and nothing goes to members until launch).
- **Who handles money:** the chapter's **Treasurer**, or the National Chairman or Secretary. The
  chapter board and the National Auditor can see the chapter's fees but not change them. Members
  see only their own.
- **Card payments** need a payments account (Stripe or similar), keys and its terms: that's
  Jeff's yes, so it's left out. The `card` method is reserved so it slots in later.
- Amounts are stored as whole cents and shown as `$250.00`.

### Data (new migration `20261201000000_members_and_money.sql`, additive only)
- `public.checkin_sessions` (id, kind `ride`|`meeting`, chapter_id, ride_id unique, title,
  held_on, code, opened_by, opened_at, closed_at). Members get every column **except `code`**
  (column grants), and `checkin_code(session)` returns it to session runners.
- `public.attendance` (session_id, member_id, checked_in_at, marked_by: null when they checked
  themselves in). Primary key (session_id, member_id).
- `public.member_decisions` (id, member_id, kind `application`|`fng_review`, at_months, outcome,
  votes_for, votes_against, votes_abstained, note, decided_on, recorded_by).
- `public.fee_rates` (chapter_id, fy, status, amount_cents, due_on), `public.continuation_fees`
  (chapter_id, fy, amount_cents).
- `public.charges` (id, member_id, chapter_id, fy, kind `annual`|`continuation`|`other`,
  description, amount_cents, due_on, raised_by, created_at, waived_at). One annual and one
  continuation charge per member per year.
- `public.payments` (id, charge_id, amount_cents, paid_on, method, reference, state
  `claimed`|`confirmed`|`rejected`, claimed_by, confirmed_by, decided_at, receipt_no unique).
- `public.payment_details` (chapter_id, payid, payid_name, bsb, account_no).
- **Row-level security:** reads as described above. Every write goes through a SECURITY DEFINER
  action: `open_checkin`, `close_checkin`, `check_in`, `mark_attendance`, `decide_application`,
  `record_fng_review`, `set_fee_rate`, `set_continuation_fee`, `set_payment_details`,
  `raise_fees`, `raise_charge`, `waive_charge`, `claim_payment`, `record_payment`,
  `confirm_payment`, `reject_payment`.
- The word "drop" stays out of the migration (Supabase's prompt can't reach Jeff).

### App code
- **Rules:** `src/domain/attendance.ts`, `src/domain/joining.ts` (introduction progress and the
  FNG schedule) and `src/domain/fees.ts` (financial years, balances, receipt numbers, and who can
  do what). Each action's refusal check lives there, so the demo and the live build say the same
  thing.
- **Data:** a Stage 4 block in `types.ts`, `clubContext.ts`, `demoActions.ts`, `demoData.ts`,
  `liveData.ts`, both providers, `database.types.ts` and `parity.json`. All new `ClubData` fields
  are optional.
- **Screens** (new files): `src/screens/checkin.tsx` (Check in, Run check-in),
  `src/screens/fng.tsx` (FNG review), `src/screens/fees.tsx` (My fees, Chapter fees).
  Entry points from existing screens: Home (check-in button, fees reminder), Pending (progress,
  check in), Ride (open or run the check-in), Board (attendance, FNG reviews, fees), Me (fees),
  and the member profile (attendance this year).

## Tests
- **`npm test`:** introduction progress; the FNG schedule (missed slots, after 12 months, past
  reviews); financial years and labels; balances, part payments, waivers; receipt numbers; every
  refusal message; code format; the QR matrix.
- **`npm run test:db`:** a new `members_money_test.sql`. Reads for each kind of person (member,
  board, treasurer, auditor, applicant, stranger, anon); the code column hidden; nothing writable
  except through the actions; each action allowed and refused; the continuation fee raised at 12
  months; `raise_fees` run twice; receipt numbers in order.
- **Parity cases** for each new action, allowed and refused, with the same words.
- A look at every new and changed screen at 390×844 in the demo and live builds, plus the
  Impeccable critique, audit and polish passes.

## Open questions for Jeff (defaults used until he says otherwise)
1. **Big 4 eligibility:** what attendance makes someone eligible? *Default: not computed yet;
   attendance is recorded.*
2. **Continuation fee:** how much, and is it paid when an FNG goes past 12 months? *Default: the
   board sets an amount per year; it's raised when a 12-month or later review says Continue.*
3. **An FNG who doesn't continue:** Supporter, or out of the club? *Default: Supporter.*
4. **Members on hiatus:** ~~do they pay that year?~~ **Decided by Jeff (24 Oct 2026): they don't
   pay.** No yearly fee and no continuation fee while on hiatus. Fee amounts are set by the
   chapter board.
5. **PayID details** for each chapter: Jeff (or the treasurer) types them in the app. That's real
   club data, so it waits for him.

## Added after review (24 Oct 2026)
- Nobody waives, records, confirms or rejects money on their own fees. A treasurer claims their own
  like any member, and the National Chairman or Secretary confirms it.
- A decision's vote tally and note are the board's only.

## Not in this spec
- Card payments (needs Jeff's yes for an account), the treasurer ledger and budgets (Stage 5),
  notifications and emailed receipts (Stage 6), and the digital membership card.
- Board votes as ballots (Stage 5). This spec records the tally the board already took.

## Before it can go live
- Merge, then apply the migration live by the Live log rules.
- Jeff (or the treasurers) set the FY26–27 rates and PayID details. Raising fees for real members
  is real member data, so it waits for his yes.
