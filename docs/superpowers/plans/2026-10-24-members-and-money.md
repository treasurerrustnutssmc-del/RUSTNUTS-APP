# Members and money Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attendance check-in, the introduction tracker with a recorded vote, the FNG review tracker, and fees with PayID claims and receipts, in the demo and live builds.

**Architecture:** Rules live in three new domain files, each action's refusal message defined once and used by the demo (`demoActions.ts`) and checked against the database by the shared parity cases. The database gets one additive migration with SECURITY DEFINER actions and RLS reads, plus one SECURITY INVOKER `members_money()` that returns everything a person may see as one JSON value (no API row limit). Screens are new files reached from existing screens.

**Tech Stack:** Expo SDK 58, React Native 0.88, React Navigation 7, Supabase (Postgres 16 locally), `expo-camera` (scan), `qrcode` (QR matrix), node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-24-members-and-money-design.md`

## Global Constraints
- Lane C: migration file prefix `20261201`; never edit an existing migration; the word "drop" never appears in the migration.
- Shared files (`types.ts`, `labels.ts`, `liveData.ts`, `demoData.ts`, `database.types.ts`, `RootNavigator.tsx`, `navigation/types.ts`, `parity.json`, `PRODUCT.md`, `DESIGN.md`, `clubContext.ts`, both providers, `demoActions.ts`, `parityFixture.testkit.ts`, `parity-sql.mts`): add one Stage 4 block each; new `ClubData` fields optional.
- No tab bar changes. No `Alert`; destructive actions use `ConfirmButton`.
- Dates stored ISO `YYYY-MM-DD`, shown `DD/MM/YYYY`; Melbourne time; money stored as integer cents, shown `$250.00`.
- Stencil (`fonts.stencil`) for titles, names, buttons, chips, numbers, dates, the check-in code; body font for sentences and inputs.
- No messages to members (no email, no push). No card payments.
- Install packages with `npx expo install`.

## Review Focus
1. A rider checks in twice, or scans the QR from yesterday's meeting: second is a silent no-op; yesterday's says "That check-in isn’t for today." (Task 1 and Task 4 tests.)
2. A part payment, then a claim larger than what's left: refused "That’s more than you owe."; confirming an old claim after a direct payment covered the charge: refused the same way. (Task 3, Task 4.)
3. An FNG 20 months in with no recorded reviews: the due review is the 18-month one, overdue, not the 6-month one. (Task 2.)
4. `raise_fees` run twice, or after a member changed status: no duplicate annual charge. (Task 4.)
5. A member reading another member's charges, the code column, or the vote tallies through the API: nothing comes back. (Task 4.)

---

### Task 1: Attendance rules

**Files:** Create `src/domain/attendance.ts`, `src/domain/attendance.test.ts`. Modify `src/domain/types.ts` (Stage 4 block).

**Interfaces (produces):**
- Types in `types.ts`: `CheckinKind = 'ride'|'meeting'`; `CheckinSession {id, kind, chapterId: string|null, rideId: string|null, title, heldOn, openedBy: string|null, closedAt: string|null, code?: string|null}`; `Attendance {sessionId, memberId, checkedInAt, markedBy: string|null}`. Also the decision and fee types (Tasks 2–3) in the same block. `ClubData` gains optional `checkinSessions?, attendance?, decisions?, feeRates?, continuationFees?, charges?, payments?, paymentDetails?`.
- `CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'`, `normalizeCode(raw: string): string` (uppercase, strips spaces and a `RUSTNUTS:` prefix), `qrPayload(code) = 'RUSTNUTS:' + code`.
- `rideChapterId(ride: Ride, chapters: Chapter[]): string|null` (north/west → that chapter by slug; otherwise null).
- `canRunCheckin(viewer, chapterId: string|null, positions): boolean` (chapter: `isBoardOf`; null: any board seat or national).
- `canCheckIn(viewer): boolean` — approved, or pending with status `introduced`.
- `openCheckinProblem(me, input: {kind, rideId: string|null, chapterId: string|null, title: string, heldOn: string}, data, today): string|null` — messages in order: `Sign in first.` / `Only approved members can do that.` / ride: `No such ride.`, `That ride was cancelled.`, `Check-in for this ride is already open.` / meeting: `Pick a chapter.`, `Add a title.`, `Pick today or a later date.` / `Only that chapter’s board can open a check-in.`
- `checkInProblem(me, session|undefined, today): string|null` — `Sign in first.` / `Only members and applicants can check in.` / `That code doesn’t match a check-in.` / `That check-in has closed.` / `That check-in isn’t for today.`
- `markProblem(me, session, target: Member|undefined, data, today): string|null` — `Only that chapter’s board can run this check-in.` / `That member no longer exists.` / `They can’t be checked in.` / `That check-in hasn’t started yet.`
- `closeProblem(me, session, data): string|null` — runner rule, then `That check-in is already closed.`
- `attendanceCount(memberId, data, from: string, to?: string): {rides: number, meetings: number}` (by session `heldOn`).

- [ ] Write tests for each message and the allowed path (including a pending Introduced applicant checking in, a pending Supporter refused, a club ride run by North's board), and for `normalizeCode('rustnuts: ab c12 3') === 'ABC123'`. Run `npm test`: fails (module missing).
- [ ] Implement. Run `npm test`: passes. Commit.

### Task 2: Joining and FNG rules

**Files:** Create `src/domain/joining.ts`, `src/domain/joining.test.ts`. Modify `src/domain/profile.ts` (export `addMonths`), `types.ts` block.

**Interfaces (produces):**
- Types: `DecisionKind = 'application'|'fng_review'`; `DecisionOutcome = 'approved'|'declined'|'continue'|'patch'|'not_continuing'`; `Votes {for: number|null, against: number|null, abstained: number|null}`; `MemberDecision {id, memberId, kind, atMonths: number|null, outcome, status: MemberStatus|null, votesFor, votesAgainst, votesAbstained, note: string|null, decidedOn, recordedBy: string|null}`.
- `INTRO = {months: 3, meetings: 2, rides: 1}`.
- `introProgress(member, data, today) → {startedOn, endsOn, daysLeft, meetings, rides, timeDone, meetingsDone, ridesDone, ready}` (start = `appliedOn ?? joinedOn ?? today`; counts attendance from start).
- `fngDue(member, decisions, today) → {atMonths, date, overdue} | null` — slots 6, 9, 12, 15…; slots after the last recorded `fng_review`'s `atMonths`; due = the latest such slot dated before today, else the first coming. Null if not an FNG or no `fngStartedOn`.
- `votesProblem(v: Votes): string|null` — `Vote counts can’t be negative.` (non-integers too).
- `decideApplicationProblem(me, target, status: MemberStatus|null, votes, data): string|null` — existing approve/decline words (`Only the West board can approve this applicant.` / `Only that chapter’s board can decline this applicant.`, `This person isn’t waiting for approval.`, `Let them in as Introduced, FNG, Supporter or Family.`), then `votesProblem`.
- `fngReviewProblem(me, target, atMonths, outcome, votes, data, today): string|null` — `Sign in first.` / `You can’t record your own review.` / `Only that chapter’s board can record this review.` / `They’re not an FNG.` / `Record the review that’s due.` / `That review isn’t due yet.` (due date more than 30 days away) / votes / patch: `Full membership needs a unanimous vote: at least one for and none against.`
- `fngOutcomeStatus(outcome) → 'fng'|'full'|'supporter'`.

- [ ] Tests: progress at day 0 and after 3 months with 2 meetings and 1 ride → ready; `fngDue` for 0, 7, 20 months in with no reviews (20 → 18-month, overdue), after a recorded 6-month review at 7 months (→ 9-month, upcoming); each problem message. Run: fail.
- [ ] Implement. Run `npm test`: pass. Commit.

### Task 3: Fee rules

**Files:** Create `src/domain/fees.ts`, `src/domain/fees.test.ts`; `types.ts` block.

**Interfaces (produces):**
- Types: `ChargeKind = 'annual'|'continuation'|'other'`; `PaymentMethod = 'payid'|'bank'|'cash'|'card'`; `PaymentState = 'claimed'|'confirmed'|'rejected'`; `FeeRate {chapterId, fy, status, amountCents, dueOn}`; `ContinuationFee {chapterId, fy, amountCents}`; `Charge {id, memberId, chapterId, fy, kind, description: string|null, amountCents, dueOn, createdAt, waivedAt: string|null}`; `Payment {id, chargeId, amountCents, paidOn, method, reference: string|null, state, claimedBy: string|null, receiptNo: string|null, decidedAt: string|null}`; `PaymentDetails {chapterId, payid, payidName, bsb, accountNo}` (all `string|null` but chapterId).
- `PAYING_STATUSES = ['full','nomad','fng','supporter','family']`; `fyOf(iso) → number` (July starts the year); `fyLabel(2026) === 'FY26–27'`; `formatCents(125000) === '$1,250.00'`; `parseDollars('250') === 25000`, `parseDollars('12.5') === 1250`, invalid → null.
- `chargeBalance(charge, payments) → {paidCents, owingCents, state: 'paid'|'part'|'owing'|'waived'}` (confirmed only); `dueState(charge, balance, today) → 'overdue'|'soon'|'later'|'settled'` (soon = due within 30 days).
- `receiptNo(slug, fy, seq) === 'W26-0001'`; `paymentReference(member) ` = road name or surname, uppercase, max 18 chars, plus ` FEES`.
- `canManageFees(viewer, chapterId, positions)` (approved; treasurer seat in that chapter, or `nec_chair`/`nec_secretary`); `canSeeFees(viewer, chapterId, positions)` (manage, or `isBoardOf`).
- Problems (`MONEY_ONLY = 'Only the chapter treasurer, or the National Chairman or Secretary, handles fees.'`; `amount` = `Enter an amount over $0.`): `feeRateProblem`, `continuationFeeProblem`, `raiseFeesProblem` (`Set this year’s fees first.`), `raiseChargeProblem` (`Approve them first.`, `Add what it’s for.`), `waiveProblem` (`That charge is already waived.`, `That charge is already paid.`), `claimProblem` (`You can only pay your own fees.`, `That charge was waived.`, `That’s already paid.`, `That’s more than you owe.`, `The payment date can’t be in the future.`, `Card payments aren’t set up yet.`), `recordPaymentProblem` (same minus own), `decidePaymentProblem` (`That payment has already been dealt with.`, and on confirm `That’s more than they owe.`), `paymentDetailsProblem`.

- [ ] Tests for each helper and message, including part payments and a rejected claim not counting. Fail, implement, pass, commit.

### Task 4: Database

**Files:** Create `supabase/migrations/20261201000000_members_and_money.sql`, `supabase/tests/members_money_test.sql`. Modify `scripts/test-db.sh` (one block running the new test on a fresh schema).

**Interfaces (produces):** tables and actions exactly as the spec's Data section; argument names `p_*`, e.g. `open_checkin(p_kind, p_ride, p_chapter, p_title, p_held_on) returns uuid`, `checkin_code(p_session) returns text`, `check_in(p_code) returns uuid`, `mark_attendance(p_session, p_member, p_present boolean)`, `close_checkin(p_session)`, `decide_application(p_member, p_status, p_for, p_against, p_abstained, p_note)` (null status = decline), `record_fng_review(p_member, p_at_months, p_outcome, p_for, p_against, p_abstained, p_note)`, `set_fee_rate(p_chapter, p_fy, p_status, p_amount_cents, p_due_on)`, `set_continuation_fee(p_chapter, p_fy, p_amount_cents)`, `set_payment_details(p_chapter, p_payid, p_payid_name, p_bsb, p_account_no)`, `raise_fees(p_chapter, p_fy) returns int`, `raise_charge(p_member, p_description, p_amount_cents, p_due_on) returns uuid`, `waive_charge(p_charge)`, `claim_payment(p_charge, p_amount_cents, p_paid_on, p_method, p_reference) returns uuid`, `record_payment(...)` same args `returns uuid`, `confirm_payment(p_payment)`, `reject_payment(p_payment)`, `members_money() returns jsonb` (SECURITY INVOKER; keys `sessions, attendance, decisions, rates, continuation, charges, payments, details`). Every refusal uses Task 1–3's exact words.

- [ ] Write `members_money_test.sql` (pattern of `rides_test.sql`): reads per person, code hidden, direct writes refused, Review Focus 1, 2, 4, 5, continuation fee raised at 12 months, receipts `W26-0001`, `W26-0002`. Run `npm run test:db`: fails.
- [ ] Write the migration. Run: `ALL DATABASE CHECKS PASSED`. Commit.

### Task 5: Demo actions and parity

**Files:** Modify `src/data/clubContext.ts`, `demoActions.ts`, `DemoClubProvider.tsx`, `demoData.ts`, `parityFixture.testkit.ts`, `scripts/parity-sql.mts`, `supabase/tests/parity.json`.

**Interfaces (produces):** context actions `openCheckin(input) → Promise<string>` (session id), `checkinCode(sessionId) → Promise<string>`, `checkIn(code) → Promise<void>`, `markAttendance(sessionId, memberId, present)`, `closeCheckin(sessionId)`, `decideApplication(memberId, status|null, votes, note)`, `recordFngReview(memberId, atMonths, outcome, votes, note)`, `setFeeRate(chapterId, fy, status, amountCents, dueOn)`, `setContinuationFee(chapterId, fy, amountCents)`, `setPaymentDetails(details)`, `raiseFees(chapterId, fy) → Promise<number>`, `raiseCharge(memberId, description, amountCents, dueOn)`, `waiveCharge(id)`, `claimPayment(chargeId, amountCents, paidOn, method, reference)`, `recordPayment(...)`, `confirmPayment(id)`, `rejectPayment(id)`. Demo action names in `DemoAction`: `openCheckin, checkIn, markAttendance, closeCheckin, decideApplication, fngReview, setFeeRate, raiseFees, raiseCharge, waiveCharge, claimPayment, recordPayment, confirmPayment, rejectPayment`. Fixture gains `sessions`, `attendance`, `fngStarts`, `decisions`, `rates`, `charges`, `payments`.
- [ ] Add parity cases (allowed and refused for each action, ≥ 40) to `parity.json`. Run `npm test`: fails.
- [ ] Implement demo actions, demo data (a meeting today with code `RN2026`, attendance, an applicant 2 months in, FNGs at 5 and 13 months, FY26–27 rates, charges with one part-paid and one claim waiting). Run `npm test` and `npm run test:db`: pass. Commit.

### Task 6: Live data

**Files:** Modify `src/data/liveData.ts` (+ test), `LiveClubProvider.tsx`, `database.types.ts`.
- [ ] Test in `liveData.test.ts`: `members_money()` rows map to the app types (cents, dates, instants). Fail, implement (one `rpc('members_money')` in the existing `Promise.all`), pass. Provider actions call each RPC after the same domain check. `npm run typecheck` clean. Commit.

### Task 7: Screens

**Files:** Create `src/screens/checkin.tsx`, `src/screens/fng.tsx`, `src/screens/fees.tsx`, `src/ui/QrCode.tsx`. Modify `navigation/types.ts`, `RootNavigator.tsx` (routes `CheckIn`, `RunCheckin {sessionId}`, `OpenMeeting`, `FngReview {memberId}`, `MyFees`, `ChapterFees {chapterId}`; `CheckIn` also in the pending stack), and one inserted block each in `members.tsx` (Home: check-in button, fees card; profile: attendance), `public.tsx` (Pending: progress and check-in), `rides.tsx` (ride check-in card), `board.tsx` (applicant progress and votes, FNG rows → FngReview, attendance and fees sections), `me.tsx` (Fees row). `npx expo install expo-camera qrcode` and `@types/qrcode`; `expo-camera` plugin in `app.json` with the camera text "Scan the club’s check-in code at rides and meetings."
- [ ] `QrCode` test: `qrMatrix('RUSTNUTS:RN2026')` is square and odd-sized. Then build the screens; read Impeccable's craft floor first.
- [ ] `npm test`, `npm run typecheck`, `npx expo lint` clean; screenshots at 390×844 of each new screen in the demo build. Commit.

### Task 8: Review and docs
- [ ] PRODUCT.md and DESIGN.md Stage 4 blocks; handover note.
- [ ] Independent reviewer (fresh subagent: diff + spec only). Fix Critical and Important findings test-first.
- [ ] Impeccable critique, audit, polish on changed screens. All four checks green; PR.
