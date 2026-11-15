# Acting in a Role, Until a Date: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can act in a chapter role until a date, in an empty seat or covering an away board holder. They show as "Acting <Role>", do only that seat's duties for their own chapter, and the stint ends on its own at Melbourne midnight, with the database and the app agreeing.

**Architecture:** Acting rows are `public.positions` rows with new columns. Three `private` views (held, duties, club-wide), plus "board member" (a distinct person with a held board row), give the spec's four readings. Every database helper that reads positions is re-pointed at one view, and `src/domain/acting.ts` mirrors the views over app rows settled on a ticking `today`. Expiry needs no job: the views check `club_date()`, writers close lapsed rows lazily, and providers settle in memory.

**Tech Stack:** PostgreSQL migrations (plpgsql, security-definer helpers, RLS), TypeScript rules under `node --test` via tsx, Expo/React Native screens, the shared parity fixture. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-acting-roles-design.md` (architectural; Jeff picked both kinds; money and member data "Go as designed"). Read it first. This plan does not repeat its reasons.

## Spec changes

All applied to the spec on 15/11/2026 (second and third drafts; its Review notes list the third draft's fixes). Each narrows or pins a rule, none widens a power, and Jeff can veto any. Spec questions 4 and 5 are open; the plan builds the design as it stands.

## Global Constraints

- Branch `claude/project-thread-uuwiox`; merge `main` first (it moves `liveRide.ts` up two lines; nothing else cited moves). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01MyjnUrnEZ8ecDYD7iXSxXi`. No push, reset or force.
- Install nothing; no change to `app.json`, `ios/`, `android/`, `package.json`, the lockfile or plugins (an over-the-air update). Never copy the review code in `src/domain/reviewer.ts` anywhere. `access.ts` and the migration change together.
- **One migration**, `supabase/migrations/20270870000000_acting_roles.sql`, sections `-- §1` to `-- §8`. One section per function, edited in place by later tasks (never a second `create or replace`), from the latest definition named here, keeping signature, settings and qualified names. New RPCs: `revoke all ... from public, anon`, `grant execute ... to authenticated` (`removal_and_gate.sql:230`). Every new `private` function (helpers and trigger functions) and select on the views: revoked from `public, anon, authenticated`; new readers are `stable security definer set search_path = ''`.
- **One DB test file**, `supabase/tests/acting_test.sql`: the `\set` lines and helpers from `removal_and_gate_test.sql:9-12, 19-21, 58-92` (not its f1-f14 fixtures); checks are `\echo <name>` then `do $$ ... assert ... $$`; its `test-db.sh` block copies `:587-594` as `rustnuts_acting`, at `:595`. Time moves only by replacing `private.club_date(at_time timestamptz default now())` inside `begin … rollback` (as `access_rules_test.sql:393`), adding `interval 'N days'` where vote recency matters.
- **Dates:** stored ISO, shown `DD/MM/YYYY` (`formatAuDate`; `to_char(d,'DD/MM/YYYY')`). Until is the last acting day, inclusive. A lapse gives `ended_on = acting_until + 1`; an early end gives `greatest(club_date(), started_on)`.
- **Caps** run from the start; months clamp to month end (`addMonths`, PG `+ interval`). Empty seat: the run starts at the earliest `started_on` among the seat's acting rows that are open or ended after its last non-acting row ended; cap = the Melbourne date of the chapter's next `agm` with `cancelled_at is null` on or after the run start, at most run start + 12 months, else run start + 6 months; default that agm, else +3 months, within the cap. Cover: +3 months from its own start, default +28 days. Carried votes used by acting count for 90 days and only if closed at least 48 hours after opening.
- **Words:** names are `displayName` / `private.short_name(m)`; curly apostrophes, no em-dashes, `houseWording.test.ts` passes; `ConfirmButton`, never `Alert`; Rustnuts Stencil for titles, chips, names, buttons and card dates.
- **UI tasks:** read `.claude/skills/impeccable/reference/craft-floor.md` first; afterwards run critique, audit and polish by hand, and check the changed screens at 390×844 and 360 wide in the demo web build ("check" below).
- **Done means** `npm test`, `npm run typecheck` and `npx expo lint` green, plus `npm run test:db` (`ALL DATABASE CHECKS PASSED`) for SQL or parity work. Test first: each red step names its command and first failure.
- **Lanes** work in their own worktrees and merge at each task's commit; red tests are committed only with their implementation.
- Each task ends with one commit, `feat(acting): <what the task did>` (`test(acting): ...` in Task 23).
- This plan doesn't run the live SQL. Task 23 stages it; the "Apply pending SQL in Supabase" thread runs it under Jeff's 1 Nov rule, before the app's update.

## Review Focus

1. **The stand-in's own board seat ends mid-cover:** the cover ends (`left_board`). Tasks 1, 5, 9.
2. **Two confirms at once; a confirm racing the stand-in's other seat:** one acting row, the other `NO_REQUEST`; the person lock serializes cross-seat checks. Tasks 4, 5 (two sessions), 11.
3. **A request goes stale before confirm** (date, holder's seat, stand-in's board seat, VP seat or other stint): confirm re-runs every check; a lapsed request frees the seat. Tasks 4, 11.
4. **The phone stays open past midnight on the last day:** the button goes without a reload; guard and database refuse. Tasks 9, 16; lapsed parity cases in 9, 10, 12, 13, 14.
5. **A full appointment over acting:** chair and books refused only against an acting row; `replaced` only for the acting person or after an ACM; otherwise `REPLACE_NEEDS_ACM`. Tasks 5, 11, 12.
6. **An NEC ballot moves:** only an uncast one, under a row lock, to the chapter's voter now, whose row started by the day the vote opened. Tasks 8, 13.
7. **Independence (13.3):** refused in both orders, and through `requested_by`. Tasks 7, 14.
8. **Conflicts on acting votes:** the stand-in, the holder and the Auditor are never electors; fewer than three left gives `SMALL_BOARD`. Tasks 4, 6, 13.

## Words and `is_national` callers

The exact texts, as exported constants with the same text in SQL, are the spec's Appendix A. Every `is_national` caller, sorted into member data (club-wide) and NEC business (duties), is its Appendix B. Tasks name constants from there.

## File Structure

- DB: the migration (§1 schema, views, lazy close · §2–§3 readers · §4 acting RPCs · §5 writers and endings · §6 votes · §7 money · §8 tightenings), `supabase/tests/acting_test.sql`, `scripts/test-db.sh`. Parity: `scripts/parity-sql.mts`, `src/data/parityFixture.testkit.ts`, `parity.json`.
- App: new `src/domain/acting.ts`, `actingCopy.ts`, `src/data/actingActions.ts`, `useClubToday.ts`, `src/actingSource.test.ts`; rules in `access.ts`, `votes.ts`, `ledger.ts`; copy helpers in `boardLayout.ts`, `meLayout.ts`. Each task names the rest.

## Order and parallel lanes

- **DB, sequential** (one migration file, one test file): Task 1 → 8.
- **App, sequential** (they share `access.ts` and the parity files): 9 after 2; 10 after 3 and 9; 11 after 10; 12 after 5 and 11; 13 after 8 and 12; 14 after 7 and 13.
- **Parallel:** Task 15 (display files only; `necVoterFor` comes from Task 9) beside Tasks 10 to 14 and DB Tasks 4 to 8, once Task 9 is in. Task 16 after Tasks 14 and 15 (it uses Tasks 11 to 14's checks and writers). Task 22 (demo seed) beside Task 16, once Task 15 is in.
- **Screens, after Tasks 16 and 22, three chains in parallel:** 17 → 20 (`members.tsx`, `me.tsx`, `src/ui/*`, `meLayout.ts`); 18 → 19 (`board.tsx`, `attendance.tsx`, `actingCopy.ts`, `boardLayout.ts`); 21 (`audit.tsx`, `history.tsx`, `business.tsx`, `reminders.tsx`).
- **Task 23 last.**

---

### Task 1: DB foundations

**Files:** Create the migration (§1) and `supabase/tests/acting_test.sql` (§1). Modify `scripts/test-db.sh:595`.

**Interfaces:**
- Produces:
  - The spec's Data shape columns and checks on `public.positions` (with `acting_request` and `left_board`).
  - The two tables (`acting_changes`: identity `id` primary key, `chapter_id`; `acting_requests.outcome` in `confirmed`, `withdrawn`, `lapsed`, `rejected`), RLS on, `revoke all` from `anon, authenticated`, `grant select` to `authenticated`; `votes.acting_request` (→ `acting_requests`), `vote_electors.for_chapter` (→ `chapters`); a `<table>_<column>_idx` per new foreign key (`performance_tidy.sql`).
  - Views `private.held_positions`, `private.duty_positions`, `private.clubwide_positions`.
  - `private.lock_seat(p_chapter uuid, p_role public.position_role) returns void`: `pg_advisory_xact_lock(hashtextextended(coalesce(p_chapter::text,'national') || ':' || p_role::text, 0))`.
  - `private.lock_people(p_members uuid[]) returns void`: the same lock on `'member:' || id`, per distinct id in uuid order, after `lock_seat`.
  - `private.close_lapsed_acting() returns void`: lapsed rows; requests past `until` or 28 days old (`lapsed`), or whose acting vote closed not carried (`rejected`).
  - Triggers: `private.check_covers()` (before insert or update of `covers`: a non-null `covers` points at an open, non-acting row of the same chapter and role, started on or before the cover, else `COVERS_POINT`) and `private.on_position_end()` (after update of `ended_on`: the two cascades, plus a President stint with `acting_vote` null ends `left_board` when its member's VP row ends; logged with note `Holder’s seat ended` or `Stand-in left the board`); `private.push_acting_holder()` (after insert on `acting_requests` or a cover on `positions`, unless the holder asked: `coverPush` into `private.push_outbox`, as `push_ride_alert`).

- [ ] **Step 1: Write the failing tests.** Owner fixtures for §1–§8: North: Smokey (president), Jet (VP), Crank (road_captain), Lou (`nec_secretary`), Ned and Gus (no seat; seated where a case needs five board members). West: Rusty (president), Torque (secretary), Penny (treasurer), Spanner, Hal, Kim (`nec_auditor`; a West VP row only in Auditor cases).
  - `acting: an elected holder and an empty-seat acting row clash`; `a cover sits beside the holder; a second cover clashes`; `one stint per member`
  - `acting: the checks`: each refuses its bad row, including a 121-character and a blank why.
  - `acting: covers must point at the open, non-acting holder of the same seat`
  - `acting: ending the covered row turns the cover into empty-seat acting` (`covers` null, `acting_until` kept, `old_covers` logged); `ending the stand-in's last board seat ends the cover (left_board); a second board seat keeps it`
  - `acting: the views at Melbourne midnight` (offset clock): until today held, until yesterday not; a covered row held, not duty; a cover duty, not club-wide.
  - `acting: close_lapsed_acting`: `ended_on = acting_until + 1`, `lapsed`, `ended_by` null; an elected insert then fits; requests lapse at their until or at 28 days; one with a lost acting vote closes `rejected`; a second run changes nothing.
  - `acting: a no-vote Acting President's VP row ending ends the stint (left_board); a voted one stays`; `a cover asked by Crank pushes Smokey; Smokey's own request doesn't`
  - `acting: who reads requests and changes` (board and stand-in read requests, Spanner doesn't; board and Kim read changes; both tables have `relrowsecurity` and no `anon` grant; `authenticated` can't execute any new `private` function or select the views); `unchanged rows` (null acting columns; `access_rules_test.sql:478-487` passes)
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL with `column "acting_until" does not exist`.
- [ ] **Step 3: Implement §1.**
  - Index swap (`foundations.sql:110`): create `one_holder_per_board_seat_v2 on public.positions (chapter_id, role) where ended_on is null and covers is null and role in (<the six board roles>)` and `one_cover_per_board_seat` (`covers is not null`); drop `public.one_holder_per_board_seat`; rename v2.
  - Indexes `one_acting_per_member`, `positions_covers_idx`, `one_open_request_per_seat` (`(chapter_id, role) where closed_at is null`), and `check ((closed_at is null) = (outcome is null))`.
  - Policies: `acting_requests_read` is `is_board_of(chapter_id) or member_id = (select auth.uid())`; `acting_changes_read` is `is_board_of(chapter_id) or is_auditor()`. Writes revoked.
  - NEC backfill: on `vote_electors` of open `nec` votes, `for_chapter = coalesce(<chapter of the elector's open president or vice_president row, president first>, members.chapter_id)`.
  - Views:

```sql
create view private.held_positions as select * from public.positions
  where ended_on is null and (acting_until is null or acting_until >= private.club_date());
create view private.duty_positions as select h.* from private.held_positions h
  where not exists (select 1 from private.held_positions c where c.covers = h.id);
create view private.clubwide_positions as select * from private.duty_positions where acting_until is null;
```
- [ ] **Step 4: Run** `npm run test:db`. Expected: `PERFORMANCE CHECKS PASSED` (no unwrapped `auth.uid()`, every foreign key indexed, `acting_changes` has a primary key), every `acting:` echo, then `ALL DATABASE CHECKS PASSED`.
- [ ] **Step 5: Commit.**

### Task 2: DB readers: Board member and Held eligibility

**Files:** Migration §2; `acting_test.sql` §2.

**Interfaces:**
- Consumes Task 1's views. Produces the same signatures, re-pointed, keeping every other line of each body:
  - Board member (held board rows; their `ride_committee`/`is_national` parts stay Duties): `is_board_of`, `holds_board_seat`, `is_any_board`, `manages_bus`, `can_run_checkin`, `electors_for` (`chapter_board`), `push_applicant`, `sees_site_enquiry`, `is_ride_leader` (held rows of its roles), `manages_ride`, `manages_chapter_rides`, `manages_ride_category`.
  - `can_set_fees` = `private.can_manage_fees(c) or private.is_board_of(c)`. Held: `hold_problem`.

- [ ] **Step 1: Write the failing tests** (Jet covers Smokey; Hal acts in West's empty VP seat; `helper_as`):
  - `board member: a covered President keeps every board-member helper above`; `North still has three chapter_board electors under a cover`; `empty-seat acting makes a board member`
  - `board member: a lapsed but open row loses it` (offset clock, row not closed): Hal false everywhere, missing from `electors_for`, no push row from a West applicant insert.
  - `board member: the ride_committee branch is unchanged`; `can_set_fees = can_manage_fees or is_board_of`
  - `held: hold_problem sees a covered Treasurer as Treasurer and ignores a lapsed stint`
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL at `a lapsed but open row loses it`.
- [ ] **Step 3: Implement §2**; run again. Expected: PASS, parity and access suites unchanged.
- [ ] **Step 4: Commit.**

### Task 3: DB readers: Duties, Club-wide, and the positions catalogue

**Files:** Migration §3; `acting_test.sql` §3; `supabase/functions/_shared/minutesDraft.ts:37` (type only, no redeploy).

**Interfaces:**
- Produces:
  - `private.sees_every_chapter() returns boolean` (new, `stable security definer set search_path = ''`): an approved member with a `clubwide_positions` row in `nec_chair`, `nec_secretary` or `president`.
  - Duties: `is_national`, `is_nec_officer`, `is_chairman`, `is_auditor`, `chair_of` and `nec_voter_for` (their VP fallback reads a `clubwide_positions` VP row: never an Acting VP or a VP's stand-in), new `private.nec_voter_since(p_chapter uuid) returns date` (the `started_on` of the row `nec_voter_for` picks), `can_manage_fees`, `is_on_committee`, `manages_site_photo_crew`, `runs_charity`. Calls in place of inline reads: `can_designate_big4` calls `is_national()`, `record_agm` calls `is_nec_officer()`, `sees_ledger` calls `is_auditor()`.
  - `keeps_books`: chapter = duty Treasurer; null = club-wide Treasurer of any chapter; national money roles unchanged. `approves_for`: chapter = held board rows; null = club-wide Presidents; `nec_chair`/`nec_secretary` from duties.
  - Club-wide: `shop_seat`, `is_feedback_keeper`, `push_feedback_sent`. `sees_board_of` = approved and (`sees_every_chapter()` or a held board row in the chapter). `chat_problem` (`family_chat.sql:21`): line 45 calls `sees_every_chapter()`.
  - `minutes_draft_start`: held seats plus `'acting', p.acting_until is not null`; its NEC branch lists duty presidents. `minutesDraft.ts`'s `board` type gains `acting?: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `duties: Jet chairs North and casts its NEC vote; Smokey is off the NEC`; `an Acting VP (West, no President) neither chairs nor casts West's NEC vote; nor does a VP's stand-in`
  - `duties: an Acting Treasurer keeps only their chapter's books` (`keeps_books(north)` true, `keeps_books(null)` false, `can_manage_fees(north)` true)
  - `club-wide: no acting row reaches the Club fund, the shop, feedback or every chapter` (as Jet: `approves_for(null)`, `shop_seat()`, `is_feedback_keeper()`, `sees_every_chapter()`, `sees_board_of(west)` all false)
  - `club-wide: a covered President keeps sees_board_of(north) and loses sees_board_of(west) and approves_for(null)`; `an Acting President can't read West's chapter chat; a sitting President can`
  - `lapsed: a lapsed but open row loses approves_for, keeps_books, nec_voter_for, chair_of and sees_board_of`
  - `minutes: the draft flags Jet's acting row and its NEC list names Jet, not Smokey`
  - `catalogue: no live function or policy names public.positions off the allow-list`: `prosrc` in `public` and `private` matching `public\.positions\y` (`\y` is PG's word boundary; `\b` is backspace), and policy `qual`/`with_check` naming `positions`. Allow-list (`values`, a reason each): the writers (`appoint_position`, `end_position`, `renew_auditor`, `forget_member`, `add_roster_position`, `settle_chapter_proposal`, `appoint_acting`, `confirm_acting`, `set_acting_until`, `close_lapsed_acting`, `check_covers`, `on_position_end`), `has_carried_nec_vote` (history), and pending `has_carried_removal_vote`, `set_member_status`, `delete_my_account` (Task 5), `open_vote` (Task 6).
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL at `duties: Jet chairs North` (`chair_of` still returns Smokey). Run once with the catalogue first: it lists about 20 functions, proving the regex.
- [ ] **Step 3: Implement §3**; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 4: DB acting RPCs and caps

**Files:** Migration §4; `acting_test.sql` §4.

**Interfaces:**
- Private helpers (`role` = `public.position_role`): `acting_problem(p_member uuid, p_chapter uuid, p_role role, p_covers uuid, p_until date) returns text`; `acting_cap(p_chapter uuid, p_role role, p_cover boolean, p_start date) returns date` (Global caps; run start from the seat's rows); `acting_needs_vote(p_member uuid, p_chapter uuid, p_role role) returns boolean` (president, and no held non-acting VP row there); `request_needs_vote(p_request uuid) returns boolean` (`covers` set and `requested_by` isn't the holder, or `acting_needs_vote`); `has_carried_acting_vote(p_request uuid) returns uuid` (the carried vote naming it, closed in 90 days and 48+ hours after opening, else null); `auditor_stays_out(p_role role) returns boolean`; `acting_electors(p_chapter uuid, p_role role, p_member uuid, p_covers uuid) returns setof uuid` (held board members minus the stand-in, the holder and, for president or treasurer, any `nec_auditor`).
- Public RPCs: `appoint_acting(p_member uuid, p_chapter uuid, p_role role, p_until date, p_why text) returns uuid`; `request_cover(p_position uuid, p_member uuid, p_until date, p_why text) returns uuid`; `request_acting(p_member uuid, p_chapter uuid, p_role role, p_covers uuid, p_until date, p_why text) returns uuid` (`p_covers` null for an empty seat; only requests that need a vote, else `RECORD_INSTEAD`); `withdraw_acting_request(p_request uuid) returns void`; `confirm_acting(p_request uuid) returns uuid` (sets `appointed_by`, `acting_request`, and `acting_vote` when a vote was needed); `set_acting_until(p_position uuid, p_until date) returns void`. Each takes `lock_seat`, `lock_people` (target, stand-in, holder), then `close_lapsed_acting()`; one starting from a row or request reads it unlocked for the seat, then re-reads it `for update` after the locks.

**Check order** (Task 11 mirrors it): 1 signed in and approved; 2 caller standing (`BOARD_RECORDS_ACTING`, `NOT_YOURSELF`, `OWN_SEAT_ONLY`, `CONFIRM_*`, `WITHDRAW_WHO`; an NEC officer has none); 3 `AUDITOR_STAYS_OUT`; 4 `SMALL_BOARD` (`request_cover`: fewer than three board members; `request_acting`: fewer than three `acting_electors`), then `RECORD_INSTEAD`; 5 `acting_problem`: `ACTING_CHAPTER_ONLY`, not a member of that chapter, `hold_problem`, already holds that role, `SEAT_HAS_HOLDER`, `SEAT_HAS_ACTING`, `ONE_STINT`, `OWN_SEAT_COVERED`, `CHAIR_NOT_BOOKS`/`BOOKS_NOT_CHAIR`, `HIATUS_NO_LEAD` (every role `is_ride_leader` counts), `LICENCE_ENDS` (a learner, or `licence_expiry` before the until), then with covers `COVER_BOARD_SEATS` and `COVER_FROM_BOARD`; 6 the vote rule: `PRESIDENT_NEEDS_BOARD_VOTE` on `appoint_acting` and `request_cover` for anyone but the sitting VP, `NEEDS_ACTING_VOTE` on `confirm_acting` when `request_needs_vote` and `has_carried_acting_vote` is null; 7 `WHY_NEEDED`; 8 `untilRange(cap)`: today ≤ until ≤ cap, with today as the start. `set_acting_until` later: `VOTED_NEEDS_NEW_VOTE` for any row with `acting_vote`; a no-vote President stint re-runs step 6. `withdraw_acting_request`: any board member for an empty-seat request.

- [ ] **Step 1: Write the failing tests.**
  - `routes: Smokey records Crank as Acting Treasurer (North)` (until, why, `appointed_by` Smokey, started today); `every refusal, in order`, matched exactly (hiatus on an Acting Secretary; a licence expiring before the until).
  - `routes: President` (North's seat empty): Crank records Jet (sitting VP), no vote; Crank records Ned, with or without a VP, `PRESIDENT_NEEDS_BOARD_VOTE`; Rusty asking for Torque (West, no VP) the same. `Lou can't record, propose, confirm or open a vote on North's Acting President`.
  - `caps: from 30/11/2026 and 31/01/2027`: cover `'2027-02-28'`, empty `'2027-05-30'`; then cover `'2027-04-30'`, empty `'2027-07-31'`. `a North agm on 14/02/2027 caps the empty seat at 2027-02-14` (cancelled agm, `special`, `general` and West meetings ignored); `a 2029 agm caps at run start + 12 months`; `re-recorded the day after stepping down keeps the first start`.
  - `routes: Smokey asks for Jet; Crank confirms` (`confirmed`, `covers` Smokey's row, `appointed_by` Crank, `acting_vote` null; a second confirm `NO_REQUEST`); `confirm re-runs every check` (Smokey's row ended `SEAT_ENDED`; Jet's VP row ended `COVER_FROM_BOARD`; Jet acting elsewhere `ONE_STINT`; a passed date `NO_REQUEST`, then a new request fits; Smokey `CONFIRM_NOT_HOLDER`; Jet `CONFIRM_NOT_STANDIN`; Jet, also seated Secretary, losing his VP row `NEEDS_ACTING_VOTE`)
  - `routes: a voted cover` (Ned and Gus seated): Crank's `request_acting` gives `NEEDS_ACTING_VOTE` at confirm; allowed after a carried acting vote opened 8 and closed 1 day ago (`acting_vote` is it, `acting_request` set); refused when closed 91 days ago or open only 24 hours. Three-member North: `SMALL_BOARD`; an empty Treasurer seat: `RECORD_INSTEAD`.
  - `withdraw by requester, stand-in and holder, and by any board member on an empty-seat request; Spanner gets WITHDRAW_WHO`
  - `dates: set_acting_until`: earlier by the acting person or holder (yesterday `UNTIL_NOT_PAST`; another board member `EARLIER_WHO`); later on an empty seat by another board member (the acting person `LATER_WHO_EMPTY`; past the cap `untilRange`); later on an agreed cover by Smokey (Jet `laterWhoCover('Smokey')`); `VOTED_NEEDS_NEW_VOTE` for a voted cover, a voted empty-seat President and a voted cover turned empty-seat; a normal row `NOT_ACTING`; one `acting_changes` row per change, `started_on` kept.
  - `auditor: Kim in a West VP seat can't record, propose, confirm or change acting for West's President or Treasurer, but can for Secretary`
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL with `function public.appoint_acting does not exist`.
- [ ] **Step 3: Implement §4** with grants; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 5: DB writers and endings, the lock catalogue, two sessions

**Files:** Migration §5; `acting_test.sql` §5.

**Interfaces:**
- Same signatures, with both locks and the lazy close (only the lazy close for `forget_member`, `delete_my_account`, `set_member_status`): `appoint_position` (`audit_fixes.sql:207`), `end_position` (`chatgpt_audit_fixes.sql:319`), `add_roster_position` (`roster_seat_dates.sql:5`), `settle_chapter_proposal` (`board_admin.sql:766`; founders check held), `renew_auditor` (`national_auditor.sql:482`; `renewed`), `forget_member` (`chatgpt_audit_fixes.sql:372`; `forgotten`), `delete_my_account` (`:451`; any held acting row blocks, existing words), `set_member_status` (`downward_notice_gate.sql:8`; held reads). `end_position` reads its row unlocked, takes the locks, runs the lazy close, then re-reads it `for update`.
- `has_carried_removal_vote` (`removal_and_gate.sql:213`), reading `held_positions`: an acting row uses the `chapter_board` majority shape, closed at least 48 hours after it opened; every match needs `acting_request is null`; the "since the term began" line stays.
- Every end sets `ended_reason`. Drops the Task 5 pending entries.
- **`end_position`'s acting branch**, after "That term has already ended.": 1 your own row: `stepped_down`; 2 it covers your row: `holder_back`; 3 not `is_board_of(chapter)`: "Only that chapter’s board can end this term." (NEC officers have no branch); 4 `AUDITOR_STAYS_OUT` for President and Treasurer seats; 5 `has_carried_removal_vote`: `removed`, else `ACTING_END_NEEDS_VOTE`. A normal row ends `stepped_down` (your own) or `removed`.
- **`appoint_position`:** "They already hold that role." ignores the target's own empty-seat acting in that seat; "That seat is taken" ignores covers and empty-seat acting; chair and books apart only against an acting row (`CHAIR_NOT_BOOKS`/`BOOKS_NOT_CHAIR`); over empty-seat acting it ends that row (`replaced`, `ended_by` = caller) only when the target is the acting person or the chapter has an uncancelled `agm` that started since the stint did and in the last 30 days, else `REPLACE_NEEDS_ACM`.

- [ ] **Step 1: Write the failing tests:**
  - `writers: electing the acting person ends their acting (replaced)`; `Jet seating Lou over Crank's acting gets REPLACE_NEEDS_ACM; after a North agm since the stint began, replaced`; `Lou can't replace an Acting President without one`; `end the covered row, then appoint in full; one row has duties`; `full chair and books refused only against an acting row (a full Treasurer can be seated President, 17.6)`; `add_roster_position skips a live acting seat, fills a lapsed one`
  - `endings: stepped_down, holder_back (agreed and voted covers), removed with a carried chapter_board majority, ACTING_END_NEEDS_VOTE without or with one open under 48 hours, Lou refused`; `an acting vote never counts as a removal vote`; `a removal vote closed before the stint started doesn't count`; `end_position on a lapsed open row: "That term has already ended.", still lapsed`
  - `endings: ending the stand-in's own Road Captain row ends their cover (left_board)`; `renewed; forgotten (forgetting the stand-in ends the acting; forgetting the holder turns the cover into empty-seat acting)`; `delete_my_account refuses an acting Officer; set_member_status refuses an acting row and ignores a lapsed one`
  - `catalogue: every statement setting positions.ended_on names ended_reason` (split `prosrc` on `;`; `update\s+public\.positions\y` with `ended_on\s*=`); `every seat writer calls private.lock_seat` (`(insert\s+into|update)\s+public\.positions\y`; allow-list `close_lapsed_acting`, `forget_member`, `on_position_end`, `check_covers`, each with a reason)
  - `two sessions` (dblink and `pg_temp.open_as`/`waits`/`outcome` as in `rusty_bus_test.sql:820-980`, fixtures committed, A's transaction left open; B waits, then): A `appoint_acting` Crank as Treasurer, B Jet: `SEAT_HAS_ACTING`; A and B `confirm_acting(smokey-asks-jet)`: `NO_REQUEST`, one row; A confirms Jet's cover, B ends Jet's VP row: the cover ends `left_board`; A confirms Jet as Acting President, B appoints Jet Treasurer in full: `CHAIR_NOT_BOOKS`.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL at `electing the acting person ends their acting` with `They already hold that role.`
- [ ] **Step 3: Implement §5**; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 6: DB votes

**Files:** Migration §6; `acting_test.sql` §6.

**Interfaces:**
- `open_vote` (`removal_and_gate.sql:27`): lazy close first, held subject checks; when the subject's held row of that role is acting: a `chapter_board` majority (`ACTING_END_SHAPE` otherwise), electors = `acting_electors` for that row, `SMALL_BOARD` under three, `ACTING_VOTE_OPEN` when closing under 48 hours. NEC electors are the people `electors_for('nec', null)` returns (approved, not legacy), each inserted as `(vote, nec_voter_for(c.id), c.id)`, skipping chapters with no voter.
- `public.open_acting_vote(p_request uuid, p_quorum int, p_closes_at timestamptz, p_meeting uuid) returns uuid`: locks and lazy close; the request is open and needs a vote (`NO_VOTE_NEEDED`); a board member who isn't the stand-in; `AUDITOR_STAYS_OUT`; `SMALL_BOARD`; `ACTING_VOTE_OPEN`; `open_vote`'s quorum (on `acting_electors`), closing and meeting words. Inserts `chapter_board`, majority, not secret, subject = the stand-in, the role, `acting_request`; electors = `acting_electors`. Question: `'Jet acts as President (North) for Smokey until 13/12/2026: Smokey can’t be reached'`, or `'Jet acts as President (North) until 13/12/2026: <why>'` for an empty seat.
- `public.club_business()` (latest `audit_fixes.sql:333`), same signature and settings: each vote adds `'acting_request', v.acting_request` and `'elector_chapters'` (`jsonb_object_agg(e.member_id, e.for_chapter)` over its electors with `for_chapter` set, else `{}`).
- Drops the last pending entry.

- [ ] **Step 1: Write the failing tests:** `votes: a vote to end acting is a chapter_board majority` (two-thirds of patched members raises `ACTING_END_SHAPE`); `acting and end-acting votes leave out the stand-in, the holder and the Auditor; three-member North gets SMALL_BOARD; a 24-hour close gets ACTING_VOTE_OPEN`; `NEC electors carry for_chapter; North's is Jet under the cover; a chapter with no President or VP adds none`; `a lapsed stint gets no ballot`; `open_acting_vote builds the question and the shape`, then its refusals in order (Lou `BOARD_RECORDS_ACTING`); `club_business, read as Crank and as Smokey, carries acting_request and elector_chapters`.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL at `a vote to end acting is a chapter_board majority` (`open_vote` still wants the `chapter_patched` two-thirds shape).
- [ ] **Step 3: Implement §6**; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 7: DB money (13.3)

**Files:** Migration §7; `acting_test.sql` §7.

**Interfaces:**
- `private.approval_conflict(p_entry uuid, p_member uuid) returns text`. "Stands only through acting" = no non-acting held board row in that fund's chapter and no `nec_chair`/`nec_secretary`; "put there by" = the acting row's `appointed_by` or its request's `requested_by`. Null, or:
  - `independentSeated(short_name(x))`: the member stands only through acting, and `x` (the entry's `recorded_by`, its `payee_member_id`, or an approver already counted) put one of those rows there;
  - `independentPlanted(short_name(y))`: an approver already counted, `y`, stands only through acting, and the member put one of `y`'s rows there;
  - `independentStandIn(short_name(payee))`: a held cover of the member points at a payee row.
- `approve_debit` (`treasurer.sql:274`) raises it after "You’ve already approved this."; `record_debit` (`treasurer.sql:241`) skips its automatic approval on a conflict, with no error.

- [ ] **Step 1: Write the failing tests:** `money: Penny's appointee can't be the second approver on Penny's entry`; `Rusty's appointee can`; `Rusty can't approve after his own appointee approved first`; `with West's President seat empty, Hal, voted in on Penny's request and confirmed by Torque, can't approve Penny's reimbursement`; `the payee's stand-in can't approve the refund`; `record_debit records without self-approval on a conflict`; `a covered President still approves West spending`.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL at `Penny's appointee can't be the second approver` (`approve_debit` allows it).
- [ ] **Step 3: Implement §7**; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 8: DB tightenings for everyone, and the strict catalogue

**Files:** Migration §8, plus §5's `appoint_position` edited in place; `acting_test.sql` §8.

**Interfaces:**
- `cast_ballot` (`meetings_votes.sql:397`; the vote row stays `for share`), in order:
  1. "No such vote."
  2. NEC branch, on a vote with `for_chapter` rows: the caller may cast chapter C's ballot only while `nec_voter_for(C) = me` and `nec_voter_since(C) <= private.club_date(v.opened_at)`, else `castNecNotYours(name)` (own row) or step 3's words. With no row for the caller, take the chapter that passes and lock its elector row `for update`: cast gives `castNecCast`; uncast sets that row's `member_id = me`. A null `for_chapter` keeps today's rule.
  3. "You’re not on this vote." 4 "You’ve already voted." 5 "That vote has closed."
  6. `CAST_BOARD_ENDED` on a `chapter_board` vote when not `is_board_of(v.chapter_id)`.
  7. "Pick an answer."
- `appoint_position` adds `AUDITOR_STAYS_OUT` for President and Treasurer after the board check.

- [ ] **Step 1: Write the failing tests:** `tightening 1: a removed board member can't cast on an open board vote; the quorum stays fixed`; `tightening 2: Smokey casts the North NEC ballot Jet didn't (member_id moves); lapsed Jet gets castNecNotYours('North'); a cast ballot stands (castNecCast('North')); a President seated after the vote opened, and a cover confirmed after it opened, don't take it; the VP named at opening loses it once a President sits`; `tightening 3: Kim (Auditor, West VP) can't appoint a Treasurer in full, can appoint a Secretary`; `two sessions: two casts of North's uncast ballot by Smokey: one lands, the other castNecCast`; `catalogue: no pending entries remain`.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL at tightening 1.
- [ ] **Step 3: Implement §8**; run again. Expected: PASS, every existing `castBallot`/`appoint` parity case included.
- [ ] **Step 4: Commit.**

### Task 9: App foundations

**Files:**
- Create: `src/domain/acting.ts`, `acting.test.ts`, `src/actingSource.test.ts`.
- Modify: `src/domain/types.ts:117-124,522` and `ClubData`; `src/domain/access.ts:28-30`; `src/domain/votes.ts:122-127` (its private `necVoterFor` moves to `acting.ts`); `src/data/liveData.ts:127,317-324` (still `select('*')`), `businessLive.ts:17-25,74`, `database.types.ts:194` (positions, the two tables, the vote columns, by hand); `scripts/parity-sql.mts:1276`, `src/data/parityFixture.testkit.ts:42-53,314-316,633`, `parity.json`.

**Interfaces:**
- Types: `EndedReason`; optional `Position` fields `actingUntil`, `covers`, `actingWhy`, `actingVote`, `actingRequestId`, `appointedBy`, `endedReason`; `ActingRequest`, `ActingChange` (camelCase of Task 1); `ClubData.actingRequests?`, `actingChanges?`; `Vote.actingRequestId?`, `electorChapters?: Record<string, string>` (elector to chapter).
- `acting.ts` (readings expect settled rows): `isActing(p)`, `isEnded(p)`, `heldPositions(memberId, positions)`, `dutyPositions(...)`, `clubwidePositions(...)`, `heldRows(positions)`, `dutyRows(positions)`, `coverOf(position, positions): Position | null`, `openRows(positions)` (raw, for writers), `settleActing(data: ClubData, today: string): ClubData`, `lapsedOwnRows(raw: ClubData, today: string, memberId: string | null): boolean`, `endPositionRows(positions, id, how: { reason: EndedReason; by: string | null; today: string }): { positions: Position[]; changes: ActingChange[] }` (both cascades), `msUntilNextClubDay(nowIso: string): number`, `necVoterRow(chapterId, positions): Position | null` and `necVoterFor(chapterId, positions): string | null` (duty President who isn't the NEC Chair, else a club-wide VP row; `votes.ts` imports it). `activePositions = dutyPositions` (name kept).
- Parity (each side resolves `…Days` itself; `demoAnswer` settles first): `ParityCase.with?: { key, member, chapter, role, startedDays?, actingUntilDays?, covers?, why?, appointedBy?, requestedBy?, actingVote? }[]` (`requestedBy` links a confirmed request; `actingVote` names a `withVotes` key); `withRequests?: { key, chapter, role, member, covers?, untilDays, why, requestedBy }[]`; `withVotes?: { key, chapter, electorate, threshold, subject?, role?, actingRequest?, electors, voted?, result?, openedDays?, closedDays?, closesDays? }[]` (opened 7 days before closing unless `openedDays`); `ParityCase.message?`: `demoAnswer` asserts the demo refuses with exactly it.

- [ ] **Step 1: Write the failing tests** in `acting.test.ts`:
  - `settle closes a stint the day after its until date` (until `'2026-12-13'`: open that day; on `'2026-12-14'`, `endedOn: '2026-12-14'`, `endedReason: 'lapsed'`); `settle keeps the data object and unchanged row objects when nothing lapses` (identity on `DEMO_DATA`); `an old saved copy without acting fields settles unchanged`; `settle closes lapsed acting requests`
  - `Melbourne midnight in both daylight states`: `msUntilNextClubDay('2026-10-03T14:00:00.000Z') === 82_800_000`; `msUntilNextClubDay('2027-04-03T13:00:00.000Z') === 90_000_000`; `melbourneDate` (`rides.ts:19`) reads `'2026-10-03'` at `13:59:59Z` and `'2026-10-04'` at `14:00:00Z`
  - `the four readings` (Jet covers Smokey): Smokey's President row is held, not duty; Jet's duties are VP plus acting President; Jet is club-wide as VP only.
  - `a cover turning into empty-seat acting`; `the stand-in's last board seat ending ends the cover (left_board)`; `lapsedOwnRows is true only when a settle ends the viewer's own row`; `necVoterFor: an Acting President counts; an Acting VP and a VP's stand-in don't; the VP fallback stays`
- [ ] **Step 2: Write the failing source test** `no inline open-row checks outside acting.ts and access.ts` (`src/actingSource.test.ts`): over `src/**/*.ts(x)` without tests and testkits, it flags `/\.endedOn\s*(===|==|!==|!=)\s*null/`, `/!\s*[\w.]*\.endedOn\b/` and `/endedOn\s*\?\?/`. A line ending `// acting: pending` passes until Task 23: mark every flagged site, inverse checks included; `demoActions.ts:347` moves to `openRows` now.
- [ ] **Step 3: Add mapping tests:** `positions map the acting columns, appointed_by and ended_reason`; `acting requests and changes load`; `club_business's acting_request and elector_chapters (Task 6's JSON, added to BusinessJson) map to actingRequestId and electorChapters`.
- [ ] **Step 4: Add the parity smoke case** `A lapsed acting VP gets no board ballot` (West's held board is Rusty, Torque and Penny, so quorum 4 fails only without Spanner):
  - `{ as: "rusty", action: "openVote", chapter: "west", subject: null, electorate: "chapter_board", threshold: "majority", quorum: 4, days: 7, allowed: false }`
  - `with: [{ key: "spanner-acting-vp", member: "spanner", chapter: "west", role: "vice_president", startedDays: -30, actingUntilDays: -1, why: "No VP since the ACM" }]`
- [ ] **Step 5: Run** `npm test`. Expected: FAIL, `Cannot find module './acting'`.
- [ ] **Step 6: Implement.** The SQL hook inserts as the owner after `:1276` (after `without`), in list order: `with` rows into positions (`appointed_by` from `appointedBy`); `withRequests` into `acting_requests` as `id('ar', key)`; `withVotes` into votes and electors as at `:107-121`, NEC electors with their chapter as `for_chapter`, and `voted` adding `voted_at` and a `yes` ballot. `fixtureData` adds the same rows on the app side.
- [ ] **Step 7: Run** `npm test` and `npm run test:db`. Expected: PASS.
- [ ] **Step 8: Commit.**

### Task 10: App readings mirror the views

**Files:** `src/domain/access.ts` (`holdsBoardSeat`, `isNational`, `seesBoardOf`, `accessLevel :90`, `holdProblem`, `statusChangeProblem :389`, `appointWarnings :300`); `social/help.ts:101-105`, `bus.ts:106-110`, `attendance.ts:41`, `feedback.ts:73-76`, `national.ts:267-270`, `account.ts:16-46`, `chat.ts:125`, `shop.ts:107,172-180`, `liveRide.ts:94-96`; their tests; `parity.json`.

**Interfaces:**
- `seesEveryChapter(viewer: Member | null, positions: Position[]): boolean`; `seesBoardOf` is the held `holdsBoardSeat`, or `seesEveryChapter`.
- Held: `isRideLeader`, `holdProblem`, `statusChangeProblem`, `holdsChapterPost`, and `deleteAccountProblem`/`stepDownSeats` (acting rows of any role). Board member: `accessLevel`'s board line, `isAnyBoard`, `managesBus`, `canRunCheckin(null)`. Club-wide: `isFeedbackKeeper`, `holdsShopSeat`, `readProblem :125`. `appointWarnings`' `servedTerm` skips acting rows. The markers in these files go.

- [ ] **Step 1: Write the failing tests** (`DEMO_DATA` with Jet covering Smokey): `a covered President keeps the board level and board records and is off the NEC`; `an Acting President is national but sees no other chapter's private details` (no `seesEveryChapter`, no `canSeePrivate` for a West member); `empty-seat acting makes a board member; a settled lapsed one doesn't`; `board-member mirrors count a covered holder; club-wide mirrors skip acting rows`; `holdProblem: a covered Treasurer can't be seated as Auditor`; `an acting Officer must end their positions first`; `a stint isn't a 9.4 served term`; `an Acting President can't read West's chapter chat`; `Delete account lists an acting Officer seat`.
- [ ] **Step 2: Add parity cases** (`with`, VP rows before covers). Rows: `jet-north-vp {jet, north, vice_president}`; `jet-covers-smokey {jet, north, president, actingUntilDays 20, covers smokey-president, why "Smokey overseas", appointedBy crank}`; `torque-covers-rusty {torque, west, president, 20, covers rusty-president, why "Rusty overseas", appointedBy penny}`. Cases: smokey `openVote north chapter_board majority quorum 3 days 7` under Jet's cover true (three electors); smokey opens an `nec` majority vote, quorum 2, false; jet the same, true; rusty `approveDebit west-awaiting` under Torque's cover true; torque `club-awaiting` false; rusty `club-awaiting` false; spanner with Task 9's lapsed row `west-awaiting` false (Task 14's live twin is true).
- [ ] **Step 3: Run** `node --import tsx --test src/domain/access.test.ts`. Expected: FAIL at the first case (Smokey still reads as national).
- [ ] **Step 4: Implement**; run `npm test` and `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: App acting rules in `access.ts`

**Files:** `src/domain/access.ts`, `access.test.ts`; `appointProblem` callers (`LiveClubProvider.tsx:465`, `demoActions.ts`, `board.tsx`, the parity testkit) pass `today`.

**Interfaces** (Task 4's order and words):
- `actingProblem(target: Member, chapterId: string | null, role: PositionRole, covers: Position | null, data: ClubData): string | null`
- `actingCap(chapterId, role, cover: boolean, startedOn, data): string` and `actingDefaultUntil` (same parameters); `actingNeedsVote(memberId, chapterId, role, data)`; `requestNeedsVote(request, data)`; `actingElectors(chapterId, role, memberId, coversId, data): string[]`; `auditorStaysOut(me, role, positions)`
- Route checks (each ends `data, today`): `appointActingProblem(me, target, chapterId, role, until, why, …)`; `requestCoverProblem(me, seat, target, until, why, …)`; `requestActingProblem(me, target, chapterId, role, covers, until, why, …)`; `withdrawRequestProblem(me, request, data)`; `confirmActingProblem(me, request, …)`; `setActingUntilProblem(me, position, until, …)`.
- `actingWarnings(target, chapterId, role, covers, until, data, today): string[]`
- Existing rules: `endTermProblem` gets Task 5's acting branch; `appointProblem` takes a required `today` and gains `REPLACE_NEEDS_ACM`, chair and books against acting rows, and `AUDITOR_STAYS_OUT`; `hasCarriedRemovalVote` uses the acting shape and needs `actingRequestId == null`. Exports the Words constants.

- [ ] **Step 1: Write the failing tests:**
  - `actingProblem refuses, in order, with the shared words`
  - `caps`: Task 4's values and cases, plus defaults: from `'2026-11-30'` cover `'2026-12-28'`, empty `'2027-02-28'`; from `'2027-01-31'` cover `'2027-02-28'`, empty `'2027-04-30'`; North agm 2027-02-14 gives cap and default `'2027-02-14'`
  - `warnings`: 9.6 on every board-seat stint; 9.1 only for an empty-seat stand-in off the board; 9.4 only for a non-VP empty-seat President or VP; 9.7 on covers (the spec's new words); 9.5 for a stand-in already on the board; `Crank leads the 13/12 run. Acting ends that night. Pick 14/12 or later.`
  - `end branches` (acting person, holder, board with and without a vote, Lou); `the Auditor in a second seat`; `one stint; chair and books; hiatus; licence`; `only the sitting VP acts as President without a vote`; `confirm re-runs every check` (Task 4's cases); `a confirmed request isn't open`; `actingElectors leaves out the stand-in, the holder and the Auditor`
  - `appointProblem` (Task 5's cases): electing the acting person; `REPLACE_NEEDS_ACM` unless a recent agm; chair and books only against an acting row
- [ ] **Step 2: Run** `node --import tsx --test src/domain/access.test.ts`. Expected: FAIL, `actingProblem` is not a function.
- [ ] **Step 3: Implement**; run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 12: Demo acting writers and the shared route cases

**Files:** Create `src/data/actingActions.ts` and its test. Modify `src/data/demoActions.ts:347,354-377,701`, `auditActions.ts:83-85`, `adminActions.ts:244-251`, `scripts/parity-sql.mts:639+`, `parityFixture.testkit.ts`, `parity.json`.

**Interfaces:**
- Consumes the Task 11 checks and Task 9's `endPositionRows` and `openRows`.
- Demo writers `(ctx: DemoCtx, …): ClubData`, each throwing its check's words, setting `appointedBy`, `actingRequestId`, `actingVote` and `endedReason`, and logging `ActingChange`s: `appointActing(memberId, chapterId, role, until, why)`; `requestCover(positionId, memberId, until, why)`; `requestActing(memberId, chapterId, role, coversId | null, until, why)`; `withdrawActingRequest(requestId)`; `confirmActing(requestId)`; `setActingUntil(positionId, until)`.
- `DemoAction` and parity actions of the same names, with `…Days` for dates: `appointActing {member, chapter, role, untilDays, why}`; `requestCover {seat, member, untilDays, why}`; `requestActing {member, chapter, role, covers?, untilDays, why}`; `withdrawActingRequest {request}`; `confirmActing {request}`; `setActingUntil {position, untilDays}`.
- `appoint`, `endTerm` and `deleteMyAccount` use `endPositionRows`; `renewAuditor` writes `renewed`.

- [ ] **Step 1: Write the failing unit tests:** `confirmActing seats the cover, closes the request, sets actingVote for a voted one`; `a full appoint ends empty-seat acting with replaced`; `endTerm records stepped_down, holder_back or removed`; `endPositionRows with reason forgotten turns a cover into empty-seat acting` (forgetting itself is Task 5's DB test); `renewAuditor writes renewed`.
- [ ] **Step 2: Add parity cases**, each named as a sentence; each `false` sets `message` to its Words text; rows go in `with`, VP rows before covers.
  - Rows (why `"No Treasurer since the ACM"`): `jet-acting-treasurer {jet, north, treasurer, actingUntilDays 20}`; `crank-treasurer {crank, north, treasurer}`; `crank-acting-treasurer {crank, north, treasurer, startedDays -10, actingUntilDays 20, appointedBy smokey}`; `kim-west-vp {kim, west, vice_president}`. Requests: `smokey-asks-jet {north, president, jet, covers smokey-president, untilDays 28, why "Smokey overseas", requestedBy smokey}`; `crank-asks-jet` (the same, `requestedBy crank`).
  - Recording: smokey `appointActing jet north vice_president 28` true; jet (off the board) false; crank records jet as president (a holder sits) false; a second stint (jet-acting-treasurer) false; without smokey-president and with jet-north-vp: crank records jet as president true, crank records lou false (`PRESIDENT_NEEDS_BOARD_VOTE`), with crank-treasurer jet records crank false (`CHAIR_NOT_BOOKS`), lou records jet false.
  - Auditor, with kim-west-vp: Kim records an Acting Treasurer without penny-treasurer false.
  - Asking, with jet-north-vp: smokey `requestCover seat smokey-president jet 28 "Smokey overseas"` true; for crank (not the VP) false; for lou (off the board) false; without jet-north-vp (a board of two) false.
  - Confirming, with jet-north-vp: crank confirms smokey-asks-jet true; smokey confirms it false; at untilDays -1 false; crank-asks-jet with no vote false, after a carried acting vote closed -1 true, after one open only a day false; lou confirms it false; lou `requestActing crank north president` (seat empty) false.
  - Ending, with jet-north-vp and jet-covers-smokey: jet steps down true; smokey's "I'm back" true, and on a voted one (`actingVote`) true; crank without a vote false; crank after a carried north `chapter_board` majority vote on jet as president, closed -1, true; lou false.
  - Full appointments: smokey `appoint jet north treasurer` over crank-acting-treasurer false (`REPLACE_NEEDS_ACM`); crank elected Treasurer while acting in it true; rusty `appoint hal west vice_president` over Task 9's lapsed row true; without smokey-president, lou `appoint crank north president` with crank-acting-treasurer false (`BOOKS_NOT_CHAIR`).
  - Dates: crank to untilDays 7 true; smokey gives crank untilDays 40 true; crank gives himself more false; smokey extends jet-covers-smokey true; jet extends it false; smokey extends a voted one false. Lapsed crank-acting-treasurer (startedDays -30, actingUntilDays -1) `setActingUntil` false. Withdrawing: jet withdraws smokey-asks-jet true.
- [ ] **Step 3: Run** `npm test` and `npm run test:db`. Expected: FAIL with an unknown action `appointActing`.
- [ ] **Step 4: Implement** the writers and the dispatch on both sides (SQL passes requests as `id('ar', key)`); run both suites. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 13: App votes and ballots

**Files:** `src/domain/votes.ts` (`electorsFor :75`, `holderOf :109`, `chairOf`, `necVoterFor`, `castProblem :245`, `isRemovalVote`, `removalShape`, `removalVoteFor`, `openVoteProblem :202-221`); `businessActions.ts:128,143`, `actingActions.ts`; `castProblem` callers `business.ts:45`, `business.tsx:535,759`, `LiveClubProvider.tsx:579`; the parity files; `votes.test.ts`.

**Interfaces:**
- `necVoterFor` and `necVoterRow` come from `acting.ts` (Task 9); `castProblem(me, vote, now, data: ClubData)` with Task 8's order, words and started-by-opening rule; `electorsFor`'s acting shapes use `actingElectors`; `isRemovalVote` excludes votes with an `actingRequestId`; `removalShape(role, acting = false)`.
- `openActingVoteProblem(me, request, quorum, closesAt, meetingId, data, now)` (with `SMALL_BOARD` and `ACTING_VOTE_OPEN`) and `actingVoteQuestion(request, data)`.
- `stintVoteWarnings(input: VoteInput, data, today): string[]`: `Jet’s acting ends 13/12. Close before then, or Smokey votes for North instead.` (NEC) and `Crank’s acting ends 13/12. Close before then, or Crank can’t vote.` (empty-seat board elector).
- Demo: `openVote` writes `electorChapters`; `castBallot` passes an uncast NEC ballot over; new writer `openActingVote(ctx, requestId, quorum, closesAt, meetingId)` and parity action `openActingVote {request, quorum, days}`.

- [ ] **Step 1: Write the failing tests:** `North keeps three board electors under a cover`; `the cast-time board check`; `NEC ballot pass-over`, `no pass-over to a voter whose row started after the vote opened`; `chairOf follows duties, with a club-wide VP fallback`; `acting votes leave out the stand-in, the holder and the Auditor`; `acting votes aren't removal votes`; `the acting vote question` (`'Jet acts as President (North) for Smokey until 13/12/2026: Smokey can’t be reached'`); `the stint warning on opening`.
- [ ] **Step 2: Add parity cases:** spanner casts `yes` on an open west `chapter_board` vote (electors rusty, torque, penny, spanner) with the lapsed row, false; without torque-secretary, torque casts on a new open west `chapter_board` vote (torque uncast) false (`CAST_BOARD_ENDED`); smokey casts an open `nec` vote (electors jet, rusty) that Jet didn't, true; jet casts it after his stint, false; smokey casts after jet voted, false; an `nec` vote opened -2 with jet the VP elector, then `smokey-new-president` (startedDays 0, in place of smokey-president): smokey and jet cast false; with `lou-north-secretary` and `chair-north-saa`, crank `openActingVote crank-asks-jet 3 7` true, at 1 day false (`ACTING_VOTE_OPEN`); without them false (`SMALL_BOARD`); jet or lou opens it false; crank ends jet-covers-smokey with only a carried acting vote false; Kim (kim-west-vp, no penny-treasurer) `appoint`s a Treasurer in full false (Task 8).
- [ ] **Step 3: Run** `node --import tsx --test src/domain/votes.test.ts`. Expected: FAIL, `votes.ts` does not provide an export named `openActingVoteProblem`.
- [ ] **Step 4: Implement**, passing `data` at every `castProblem` caller; run both suites. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 14: App money

**Files:** `src/domain/ledger.ts:46-71,173-183`, `src/data/ledgerActions.ts:51`; `ledger.test.ts`, `parity.json`.

**Interfaces:** `keepsBooks` (chapter = duty Treasurer; null = club-wide Treasurer); `approvesFor` (chapter = held board; null = club-wide Presidents); `approvalConflict(memberId: string, entry: LedgerEntry, data: ClubData): string | null` (Task 7's rule in both orders, through `requestedBy` too, and its three words), returned by `approveProblem` after "You’ve already approved this."; the demo's `recordDebit` skips self-approval on a conflict.

- [ ] **Step 1: Write the failing tests:** `the Acting Treasurer keeps only the chapter's books`; `no acting row on the Club fund`; `Penny's appointee can't be the second approver`; `Rusty can't approve after his own appointee`; `a payee-requested Acting President can't approve`; `the payee's stand-in can't approve the refund`; `recordDebit skips self-approval on a conflict`.
- [ ] **Step 2: Add parity cases** (`west-awaiting` already carries Penny's approval): `Penny's appointee gives the second approval` (spanner acting West VP, appointedBy penny, untilDays 20, `approveDebit west-awaiting`, false); `Rusty's appointee gives the second approval` (the same row, appointedBy rusty, true); `The payee's stand-in approves the refund` (rusty covering torque-secretary, `west-refund`, false); `An Acting Treasurer records a Club fund line` (crank-acting-treasurer, with the fields of the existing `Bank fees, dated` case, false); `An Acting Treasurer records a North line` (true); `A lapsed Acting Treasurer records a North line` (startedDays -30, actingUntilDays -1, false); `A payee-requested Acting President gives the second approval` (no rusty-president; hal acting West President, appointedBy torque, requestedBy penny; `west-awaiting`; false).
- [ ] **Step 3: Run** `node --import tsx --test src/domain/ledger.test.ts` (FAIL: `ledger.ts` does not provide an export named `approvalConflict`), **implement**, **run** both suites (PASS).
- [ ] **Step 4: Commit.**

### Task 15: Display domain (parallel with Tasks 10 to 14)

**Files:** `src/domain/home.ts:14-34`, `terms.ts:18-31`, `audit.ts:178-180,213-275`; `social/history.ts:280-292`, `glossary.ts:34-43`; `notifications.ts:126-136`, `assistant.ts:103-107,338-347,383`, `meetingReport.ts:233-246`; `src/ui/primitives.tsx:341-343`; `DESIGN.md`; tests beside each.

**Interfaces:**
- Titles: `PositionTitle.until: string | null`; `positionTitles` groups by role and acting (`Acting Treasurer (North)`, until `'13/12/2026'`); `longTitle(t)` adds `until 13/12/2026`. `chipLabel(position, chapters)` gives `ACTING TREASURER (NORTH)`, else `ROLE_SHORT`. `RoleChip({ role, label? })` shows `label` when given; callers pass `chipLabel(...)`. `necRows(data): { chapterId: string; text: string }[]` (from Task 9's `necVoterFor`) gives `Jet, Acting President (North), for Smokey until 13/12/2026`.
- Cover copy: `coverNote(seat, standIn, until, data)`. President: the spec's Me note. Treasurer: `Jet keeps North’s books until …`. Otherwise: `Jet does the <Role>’s duties for North until …`. `coveredNotice(seat, cover, data)`: the spec's covered-holder text.
- Terms: `termEndsOn` returns `actingUntil` for acting rows; `termState` uses `isEnded`.
- Audit: `onAnyBoard` reads held; `auditChecks` skips acting rows in the term-ended check and adds keys `acting-no-election:`, `acting-past-acm:`, `cover-over-3-months:` and `vp-fallback:` with the spec's four titles; `vp-fallback` has no fix; `vpFallbackFor(chapterId, data): { memberId: string } | null` feeds Task 19's board line and button. `pastOfficeHolders` skips acting rows.
- Glossary: `Acting`: `Doing a role until a set date: in an empty seat, or covering a holder who is away.`; `Cover`: `A board member doing an away holder’s duties until a date. The holder keeps the seat and board vote.`
- Reminders: `Reminder.rideId` optional; `actingReminderPlan(meId, data, now): Reminder[]`, ids `acting-<positionId>-7`/`-1`, 9:00 am Melbourne 7 days and 1 day before the until; titles `Acting ends in a week`, `Acting ends tomorrow`; bodies `You’re Acting Treasurer (North) until 13/12/2026.` (acting person) and `Jet is acting as President (North) until 13/12/2026. You take the seat back on 14/12/2026.` (covered holder).
- `preparedBy` and `positionsOf` read held, with the long form; `isRc` reads duties.

- [ ] **Step 1: Read the craft floor** (before touching `primitives.tsx` and `DESIGN.md`). **Write the failing tests:** one per Interfaces line, with these strings and the spec's (curly apostrophes), plus `a covered holder's title is unchanged`; `an acting and an elected Treasurer row never merge`; `reminders skip past times`; `the 11.2 finding doesn't fire when the Chair is a President` (the demo's Rusty); `meetingReport.test.ts:176 still gives one preparedBy`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL, `home.ts` does not provide an export named `longTitle`.
- [ ] **Step 3: Implement**, adding the title forms to `DESIGN.md` (long, chip, NEC row, the Home date on its own line); check the chip on `MemberRow` and `AuthorLine` at 390×844 and 360 wide; run `npm test`, typecheck and lint. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 16: Providers settle on a ticking `today`; acting actions

**Files:** Create `src/data/useClubToday.ts`. Modify `src/data/LiveClubProvider.tsx:127,136,143-205,258,462-478`, `DemoClubProvider.tsx:31-59`, `clubContext.ts:104`. Test: `src/data/providersSettle.test.ts`.

**Interfaces:**
- `useClubToday(): string`, re-read on `setTimeout(msUntilNextClubDay(now))` and on `AppState` `'change'` to `'active'` (as at `appUpdate.ts:35`).
- Both providers keep `raw` and expose `useMemo(() => settleActing(raw, today), [raw, today])`. The demo `ctx` (`:48`), `bindDemoLive` (`:47`) and `fresh()` (`:55`) read settled data; writing it back is the demo's lazy close. Live: `lapsedOwnRows` triggers `reload()`, and if that fails, `clubCache.clear()`.
- `ClubContext` gains `appointActing`, `requestCover`, `requestActing`, `withdrawActingRequest`, `confirmActing`, `setActingUntil`, `openActingVote`. Live does `db.rpc` behind the matching check; the demo uses the writers.

- [ ] **Step 1: Write the failing source test:** `both providers settle on the ticking today`; `useClubToday re-reads at the next club day and on foreground`; `a failed reload after a settle drops the saved copy`.
- [ ] **Step 2: Run** `node --import tsx --test src/data/providersSettle.test.ts`. Expected: FAIL at `both providers settle on the ticking today`.
- [ ] **Step 3: Implement**; run the checks; in the demo web build, move the clock past an until date: the row closes without a reload.
- [ ] **Step 4: Commit.**

### Task 17: Screens: titles everywhere, Home's club-wide scope

**Files:** `src/ui/MemberBits.tsx:11-15,57-59`, `ChatBits.tsx:157-167`; `src/screens/members.tsx` (`:178-188`, `:208-213`, `:239`, `:415-437`, `:474-490`, `:633-707`), `me.tsx:90,116-118`, `deleteAccount.tsx:47-71`, `meetingReport.tsx:241`. Test: `src/screens/actingTitles.test.ts`.

- [ ] **Step 1: Read the craft floor.** Write the failing source test: `members.tsx gates alerts and the All chapters chip on seesEveryChapter, not level === 'national'`; `sortedPositions uses heldPositions`; `the NEC list renders necRows`; `RoleChip gets a chipLabel in MemberRow and AuthorLine`.
- [ ] **Step 2: Run** `node --import tsx --test src/screens/actingTitles.test.ts`. Expected: FAIL at the `seesEveryChapter` case.
- [ ] **Step 3: Implement:** the Home header puts the date on its own line; the Chapters board lists use held rows and acting titles; `ChapterDetail` shows the acting subtitle; `MemberDetail` the long form; `StepDownButtons` reads `Step down from acting`; Me titles read held; Delete account lists acting seats; drop the pending markers.
- [ ] **Step 4: Check** (Crank, from Task 22): no title wraps to three lines. Then the checks.
- [ ] **Step 5: Commit.**

### Task 18: Screens: Manage member › Positions, TermActions

**Files:** Create `src/domain/actingCopy.ts`, `actingCopy.test.ts`; modify `src/screens/board.tsx:357-728`.

- [ ] **Step 1: Read the craft floor.** Write the failing tests:
  - The spec's Manage member strings (curly apostrophes): `appointChoices` (`'Acting'` the default for a board seat), `actingSeatLabel`, `whyLabel`, `replaceNote` (both forms) and `doneMessage`; plus `whyHint` `'Every member can read this. Keep health details out.'` and `untilHint` `'Last acting day. Up to 13/12/2026.'`
  - `termActionsFor(position, me, data)` gives `['Change date', 'Step down from acting']` for the acting person and `['Change date', 'Start a vote to end acting']` for another board member, never `Start removal vote`, and `['I’m back']` for the covered holder; `endActingQuestion` gives `'End Jet’s acting as President (North)?'`; `confirmText` repeats `actingWarnings` on Appoint and on `Arrange cover (board vote)`.
- [ ] **Step 2: Run** `node --import tsx --test src/domain/actingCopy.test.ts`; FAIL, `Cannot find module './actingCopy'`. Then **implement** in `board.tsx`: `Change date` opens a `DateField` that calls `setActingUntil`; `Start a vote to end acting` opens `NewVote` with the acting shape (`chapter_board`, majority, subject and role, `endActingQuestion`); the Choices pair with seats filtered by `actingProblem`; a `DateField` "Until" defaulting to `actingDefaultUntil`, and the required Why; `Acting until DD/MM/YYYY` on the Positions card; `Arrange cover (board vote)` on the away holder's page (`requestActing`, then `openActingVote`); the `:404`, `:412` and `:416` checks move to helpers; drop the markers.
- [ ] **Step 3: Check**, then run the checks. **Commit.**

### Task 19: Screens: the Board tab and "Attendance and terms"

**Files:** `src/domain/boardLayout.ts` and its test; `src/screens/board.tsx:147-352`, `attendance.tsx:166-207`.

- [ ] **Step 1: Read the craft floor.** Write the failing tests:
  - `requestLine` gives the spec's Board tab line; a voted request gives `'Crank asked for Jet to act as President until 13/12/2026: Smokey can’t be reached'`, whose button is `Start the board vote`, then `Confirm acting`.
  - `stintLine` gives the spec's two "Attendance and terms" lines; `stintTone` is `'warning'` within 7 days.
  - `scopeText`: `You sit on West’s board.` and `Each chapter’s board runs its own business.`; the club-wide first sentence is kept.
  - `requestActions(request, me, data)`: `Withdraw request` for the requester and the holder, `Decline` for the stand-in, `Withdraw request` for any board member on an empty-seat request, nothing for Spanner. `vpFallbackLine` gives the spec's 11.2 line, with `Make Jet Acting President` only when `appointActingProblem(me, …)` is null.
- [ ] **Step 2: Run** `node --import tsx --test src/domain/boardLayout.test.ts`; FAIL, no export `requestLine`. Then **implement:** the `Confirm cover` `ConfirmButton` shows where `confirmActingProblem` allows it, and the withdraw `ConfirmButton` where `withdrawRequestProblem` does; the vp-fallback line and button (`appointActing` for the VP); the `:186-190` text changes, and the `:154-155` and `:332-333` scopes use `seesEveryChapter`; BoardAttendance lists stints apart from terms.
- [ ] **Step 3: Check**, then run the checks. **Commit.**

### Task 20: Screens: Me and Home for cover

**Files:** `src/domain/meLayout.ts` and its test; `src/screens/me.tsx`, `members.tsx:173-330`.

- [ ] **Step 1: Read the craft floor.** Write the failing tests: `a board holder gets 'Arrange cover while I’m away'`; `standInChoices` gives `'Jet (VP)'` first (only the VP for a President); `the covered holder gets coveredNotice and an 'I’m back' ConfirmButton`; `a board of two gets the 8.6 refer-to-NEC line instead`; `the note is coverNote plus actingWarnings (9.6, 9.7, 9.5)`; `the holder's open request shows Withdraw request`.
- [ ] **Step 2: Run** `node --import tsx --test src/domain/meLayout.test.ts`; FAIL at the first case. Then **implement:** on Me, Choices, the DateField and the Why, with `coverNote` and `actingWarnings` as the `ConfirmButton` note, and `Withdraw request` on the holder's open request; on Me and Home, the notice and `I’m back` (`endPosition(cover.id)`); drop the markers.
- [ ] **Step 3: Check** in the switcher: Smokey asks for Jet, Crank confirms, Smokey sees the notice, then taps I'm back. Check, then run the checks. **Commit.**

### Task 21: Screens: audit, history, vote screens, reminders

**Files:** `src/screens/audit.tsx:204-262`, `history.tsx:159-240`, `business.tsx:741-,994-`, `src/data/reminders.tsx:66-70`; test `src/screens/actingScreens.test.ts`.

- [ ] **Step 1: Read the craft floor.** Write the failing source test: `reminders.tsx adds actingReminderPlan and its memo depends on data.positions`; `NewVote shows stintVoteWarnings; VoteScreen shows 'The stand-in and the holder aren’t on this vote (8.5, 11.10).' on acting votes`; `the Auditor's vp-fallback line has no button`.
- [ ] **Step 2: Run** `node --import tsx --test src/screens/actingScreens.test.ts`; FAIL at the reminders case. Then **implement:** an `Acting` chip on Membership records' Positions; the hall of fame leaves acting rows out, and the removal labels use the new `isRemovalVote`; drop the markers.
- [ ] **Step 3: Check**, then run the checks. **Commit.**

### Task 22: Demo seed p-19 (parallel with Task 16)

**Files:** `src/data/demoData.ts:977` (append after p-18, where `ago` is in scope), `src/data/demoFresh.test.ts:293-297,344,346`.

- [ ] **Step 1: Write the failing test.** Add `'positions.actingUntil'` to `PLANNED`; change `:344` to `16` and `:346` to `100`; add `p-19 is Crank, Acting Treasurer (North), 28 days each side of today`.
- [ ] **Step 2: Run** `node --import tsx --test src/data/demoFresh.test.ts`. Expected: FAIL at the `p-19` case.
- [ ] **Step 3: Implement.** Append `{ id: 'p-19', memberId: 'm-crank', chapterId: 'ch-north', role: 'treasurer', startedOn: ago(28), endedOn: null, actingUntil: ago(-28), actingWhy: 'No Treasurer since the ACM', covers: null, endedReason: null, appointedBy: 'm-smokey' }`. North has no Treasurer in the demo, so the seat is empty.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, every `DEMO_DATA` test included (re-check `meetingReport.test.ts:176`). **Commit.**

### Task 23: Strict source test, branch checks, paste-queue item

**Files:** `src/actingSource.test.ts`. Outside the repo, never committed: `/mnt/project-files/build/acting_roles.sql` and `paste-queue.md`.

- [ ] **Step 1:** Remove the `// acting: pending` tolerance. Run `npm test`. Expected: PASS, no markers left.
- [ ] **Step 2:** Run `npm test`, `npm run test:db`, `npm run typecheck` and `npx expo lint`. Expected: all green. In the demo at 390×844, walk the spec's cover: Smokey asks for Jet, Crank confirms, North's board vote has three electors, Jet chairs, and Jet is North's NEC voter.
- [ ] **Step 3: Commit.**
- [ ] **Step 4:** Copy the migration to `/mnt/project-files/build/acting_roles.sql`; `cmp` shows no difference; record its `sha256sum`.
- [ ] **Step 5:** Append item 80 to `paste-queue.md`, and do not run it. It gives the path and sha256; "Run once (it drops and renames an index)"; "apply via Supabase MCP `apply_migration`, name `acting_roles`"; "before the app's over-the-air update". **Before Run** (read-only; a mismatch stops it): `md5(prosrc)` and identity arguments of every replaced function equal the repo's latest (listed in the item), and `one_holder_per_board_seat`'s `pg_get_indexdef` is `foundations.sql:110-113`'s. **After Run**, read-only: six new `positions` columns (`acting_until`, `covers`, `acting_why`, `acting_vote`, `acting_request`, `ended_reason`) and their checks; the indexes `one_holder_per_board_seat`, `one_cover_per_board_seat`, `one_acting_per_member`; three views and the `check_covers`, `on_position_end` and `push_acting_holder` triggers; the new RPCs executable by `authenticated`, not `anon`; no new `private` function executable by `authenticated`; `select count(*) from public.positions where acting_until is not null` = 0; no open NEC vote has an elector with a null `for_chapter`; the board-seat index has `covers IS NULL`; both new tables have `relrowsecurity` and no `anon` grant; the two vote columns exist; `club_business()` has `elector_chapters`; replaced bodies' md5 equal the migration's. **Then**, before the update ships, "check" the changed screens in the live build.
