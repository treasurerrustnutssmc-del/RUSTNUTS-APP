# Acting in a Role, Until a Date: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can act in a chapter role until a date, in an empty seat or covering an away board holder. They show as "Acting <Role>", do only that seat's duties for their own chapter, and the stint ends on its own at Melbourne midnight, with the database and the app agreeing.

**Architecture:** Acting rows are `public.positions` rows with new columns. Three `private` views (held, duties, club-wide), plus "board member" (a distinct person with a held board row), give the spec's four readings. Every database helper that reads positions is re-pointed at one view, and `src/domain/acting.ts` mirrors the views over app rows settled on a ticking `today`. Expiry needs no job: the views check `club_date()`, writers close lapsed rows lazily, and providers settle in memory.

**Tech Stack:** PostgreSQL migrations (plpgsql, security-definer helpers, RLS), TypeScript rules under `node --test` via tsx, Expo/React Native screens, the shared parity fixture. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-acting-roles-design.md` (architectural; Jeff picked both kinds; money and member data "Go as designed"). Read it first. This plan does not repeat its reasons.

## Spec changes (applied to the spec on 15/11/2026; each narrows or pins, none widens a power)

Migration `20270870000000` (`main` has `20270860000000`, PR #164); `request_cover(p_position, ...)` names the caller's own open, non-acting board row; `withdraw_acting_request` and request outcomes `confirmed`, `withdrawn`, `lapsed`; `ended_reason` `left_board`; `appoint_position` keeps chair and books apart both ways; `Position.appointedBy` and `actingVote`; `acting_changes.chapter_id`; `acting_why` 1–120 characters; parity `with`, `withRequests`, `withVotes`, `castBallot` and seven new actions; `set_acting_until` never before today; the hiatus words ("can’t lead rides", where `crew.ts:35` says "can’t crew a ride"); the 8.6 words on both request routes; the Why is readable by every approved member, so its hint says "Every member can read this. Keep health details out." (board-only is a follow-on: hiding the column breaks old apps' `select('*')`); the NEC backfill takes the elector's President or VP chapter; and spec call 26, the readers the spec didn't name (club-wide: `is_feedback_keeper`, `push_feedback_sent`, `isFeedbackKeeper`, other chapters' chapter chats at `family_chat.sql:45` and `chat.ts:125`; NEC business: `club_audit`, `assistant_status`; duties: `signoffChapters`, `can_designate_big4`). Jeff can veto any of these.

**Revision notes.** The critic returned no findings (null). A repo check changed the draft: `has_carried_removal_vote` moved to Task 5 (Task 5's `removed` ending and Task 12's voted end need it); Task 9 waits for Task 2 (its smoke case needs held `electors_for`); NEC electors keep `electors_for('nec')`'s filters and skip voterless chapters; the ballot pass-over locks the elector row; Task 23 commits only repo files (queue item 80); line numbers follow `main`.

## Global Constraints

- Branch `claude/project-thread-uuwiox`; merge `main` first (it moves `liveRide.ts` up two lines; nothing else cited moves). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01MyjnUrnEZ8ecDYD7iXSxXi`. No push, reset or force.
- Install nothing; no change to `app.json`, `ios/`, `android/`, `package.json`, the lockfile or plugins (an over-the-air update). Never copy the review code in `src/domain/reviewer.ts` anywhere. Test first: see each test fail for the stated reason. `access.ts` and the migration change together.
- **One migration**, `supabase/migrations/20270870000000_acting_roles.sql`, sections `-- §1` to `-- §8`. One section per function, edited in place by later tasks (never a second `create or replace`), from the latest definition named here, keeping signature, `security definer`, `set search_path = ''` and qualified names. New RPCs: `revoke all ... from public, anon`, `grant execute ... to authenticated` (`removal_and_gate.sql:230`). `close_lapsed_acting`, `lock_seat`, `acting_problem`, `approval_conflict`, `sees_every_chapter` and select on the views: revoked from `public, anon, authenticated`.
- **One DB test file**, `supabase/tests/acting_test.sql`: header and helpers from `removal_and_gate_test.sql:9-92`; checks are `\echo <name>` then `do $$ ... assert ... $$`; its `test-db.sh` block copies `:587-594` as `rustnuts_acting`, at `:595`. Time moves only by replacing `private.club_date(at_time timestamptz default now())` inside `begin … rollback` (as `access_rules_test.sql:393`), with `select ((at_time at time zone 'Australia/Melbourne') + interval 'N days')::date` where vote recency matters.
- **Dates:** stored ISO, shown `DD/MM/YYYY` (`formatAuDate`; `to_char(d,'DD/MM/YYYY')`). Until is the last acting day, inclusive. A lapse gives `ended_on = acting_until + 1`; an early end gives `greatest(club_date(), started_on)`.
- **Caps** run from `started_on`; months clamp to month end (`addMonths`, PG `+ interval`). Empty seat: up to the Melbourne date of the chapter's next `agm`/`special` meeting with `cancelled_at is null` on or after the start, else +6 months; default that meeting, else +3 months. Cover: +3 months, default +28 days. Carried votes used by acting count for 90 days.
- **Words:** names are `displayName` / `private.short_name(m)`; curly apostrophes, no em-dashes, `houseWording.test.ts` passes; `ConfirmButton`, never `Alert`; Rustnuts Stencil for titles, chips, names, buttons and card dates.
- **UI tasks:** read `.claude/skills/impeccable/reference/craft-floor.md` first; afterwards run critique, audit and polish by hand, and check the changed screens at 390×844 and 360 wide in the demo web build ("check" below).
- **Done means** `npm test`, `npm run typecheck` and `npx expo lint` green, plus `npm run test:db` (`ALL DATABASE CHECKS PASSED`) for SQL or parity work.
- Each task ends with one commit, `feat(acting): <what the task did>` (`test(acting): ...` in Task 23).
- This plan doesn't run the live SQL. Task 23 stages it; the "Apply pending SQL in Supabase" thread runs it under Jeff's 1 Nov rule, before the app's update.

## Review Focus

1. **The stand-in's own board seat ends mid-cover:** the cover ends (`left_board`). Tasks 1, 5, 9.
2. **Two confirms at once, or a double tap:** one acting row; the other gets `NO_REQUEST`. Tasks 4, 5 (two sessions), 11.
3. **A request goes stale before confirm** (date, holder's seat, stand-in's board seat or other stint, a VP seated): confirm re-runs every check; a lapsed request frees the seat. Tasks 4, 11.
4. **The phone stays open past midnight on the last acting day:** the button goes without a reload, the guard refuses, the database refuses an old app. Tasks 9, 16, and the lapsed parity cases in 9, 10, 13, 14.
5. **A full appointment over chair and books, or over the acting person's own seat:** refused; ends the acting with `replaced`. Tasks 5, 11, 12.
6. **An NEC ballot moves:** only an uncast one, under a row lock, to the chapter's voter now. Tasks 8, 13.

## Words (exported constants in `access.ts` / `votes.ts` / `ledger.ts`, same text in SQL)

| Constant | Text |
|---|---|
| `ACTING_CHAPTER_ONLY` | Acting is for chapter roles, not national seats or honours. |
| `SEAT_HAS_HOLDER` | That seat has a holder. Arrange a cover instead. |
| `SEAT_HAS_ACTING` | Someone is already acting in that seat, or a request is waiting. |
| `ONE_STINT` | They’re already acting in a role. One stint at a time. |
| `OWN_SEAT_COVERED` | Their own seat is covered, so they can’t act for anyone. |
| `CHAIR_NOT_BOOKS` | An Acting President can’t also keep the chapter’s books (9.5). |
| `BOOKS_NOT_CHAIR` | An Acting Treasurer can’t also be the chapter’s President (9.5). |
| `HIATUS_NO_LEAD` | Members on hiatus can’t lead rides. |
| `COVER_BOARD_SEATS` | Only board seats can be covered. |
| `COVER_FROM_BOARD` | A cover goes to someone already on that chapter’s board. |
| `PRESIDENT_NEEDS_BOARD_VOTE` | Anyone but the sitting VP needs a carried board vote to act as President (8.2, 10.9). |
| `WHY_NEEDED` | Say why, in 120 characters or fewer. |
| `untilRange(cap)` | Pick an until date from today to DD/MM/YYYY. |
| `SMALL_BOARD` | A board of fewer than three can’t arrange this in the app. Refer it to the NEC (8.6). |
| `AUDITOR_STAYS_OUT` | The National Auditor doesn’t seat or unseat a President or Treasurer (11.8). |
| `BOARD_RECORDS_ACTING` | Only that chapter’s board can record acting here. |
| `NOT_YOURSELF` | You can’t record yourself as acting. |
| `OWN_SEAT_ONLY` | You can only ask for cover of your own board seat. |
| `NO_REQUEST` | That request isn’t open. |
| `CONFIRM_NOT_STANDIN` | The stand-in can’t confirm their own acting. |
| `CONFIRM_NOT_HOLDER` | A third board member confirms the cover you asked for (8.2). |
| `NEEDS_ACTING_VOTE` | This needs a carried board vote on the request in the last 90 days. |
| `NO_VOTE_NEEDED` | This request doesn’t need a vote. A third board member confirms it. |
| `SEAT_ENDED` | The seat they asked to cover has ended. |
| `WITHDRAW_WHO` | Only the person who asked, the stand-in or the holder can withdraw this. |
| `NOT_ACTING` | That isn’t an acting seat. |
| `UNTIL_NOT_PAST` | Pick today or later. To end it now, step down. |
| `EARLIER_WHO` | Only the acting person or the holder can bring the date forward. |
| `LATER_WHO_EMPTY` | Only another board member can give this more time. |
| `laterWhoCover(holder)` | Only Smokey can keep this cover going longer. |
| `VOTED_NEEDS_NEW_VOTE` | A voted cover needs a new vote to run longer. |
| `ACTING_END_NEEDS_VOTE` | Ending someone’s acting needs a carried majority vote of the chapter board in the last 90 days (9.3). |
| `ACTING_END_SHAPE` | Ending someone’s acting is a majority vote of the chapter board (9.3). |
| `CAST_BOARD_ENDED` | Your board seat has ended, so this ballot isn’t yours now. |
| `castNecNotYours(ch)` | You don’t cast North’s NEC vote now, so this ballot isn’t yours. |
| `castNecCast(ch)` | North’s NEC ballot has already been cast. |
| `independentSeated(name)` | You’re acting because Penny put you there, so you can’t be the second approver on their entry (13.3). |
| `independentStandIn(name)` | You’re covering Torque’s seat, so their payment goes to the other approvers (13.3). |
| `COVERS_POINT` (trigger) | A cover must point at the open holder of the same seat. |

Existing texts are reused unchanged: the not-a-member, already-hold, board-ends-this, already-ended, `hold_problem`, delete-account, `set_member_status` and `open_vote` quorum and closing texts.

## The `is_national` callers (21 live, in 15 of the 24 files; the other 9 hold dropped or superseded copies)

- **Member data → Club-wide** via `private.sees_every_chapter()`: `sees_board_of`'s national branch, and `chat_problem` at `family_chat.sql:45`.
- **NEC business → stays Duties:** `chat_problem` at `family_chat.sql:51, :54`, `sees_scope`, `runs_scope`, `can_moderate`, `is_any_board`, `manages_ride`, `manages_chapter_rides`, `manages_ride_category`, `manages_bus`, `manages_site_photo_crew`, `can_run_checkin`, `publish_road_rules`, `propose_contribution`, `withdraw_contribution`, `propose_chapter`, `settle_chapter_proposal`, `withdraw_chapter_proposal`, `club_audit`, `assistant_status` and `set_member_status`.

## File Structure

- DB: the migration (§1 schema, views, lazy close · §2–§3 readers · §4 acting RPCs · §5 writers and endings · §6 votes · §7 money · §8 tightenings), `supabase/tests/acting_test.sql`, `scripts/test-db.sh`. Parity: `scripts/parity-sql.mts`, `src/data/parityFixture.testkit.ts`, `parity.json`.
- App: new `src/domain/acting.ts`, `actingCopy.ts`, `src/data/actingActions.ts`, `useClubToday.ts`, `src/actingSource.test.ts`; rules in `access.ts`, `votes.ts`, `ledger.ts`; copy helpers in `boardLayout.ts`, `meLayout.ts`. Each task names the rest.

## Order and parallel lanes

- **DB, sequential** (one migration file, one test file): Task 1 → 8.
- **App, sequential** (they share `access.ts` and the parity files): 9 after 2; 10 after 3 and 9; 11 after 10; 12 after 5 and 11; 13 after 8 and 12; 14 after 7 and 13.
- **Parallel:** Task 15 (display files only) beside Tasks 10 to 14 and DB Tasks 4 to 8, once Task 9 is in. Task 22 (demo seed) beside Task 16, once Task 15 is in.
- **Screens, after Tasks 16 and 22, three chains in parallel:** 17 → 20 (`members.tsx`, `me.tsx`, `src/ui/*`, `meLayout.ts`); 18 → 19 (`board.tsx`, `attendance.tsx`, `actingCopy.ts`, `boardLayout.ts`); 21 (`audit.tsx`, `history.tsx`, `business.tsx`, `reminders.tsx`).
- **Task 23 last.**

---

### Task 1: DB foundations

**Files:** Create the migration (§1) and `supabase/tests/acting_test.sql` (§1). Modify `scripts/test-db.sh:595`.

**Interfaces:**
- Produces:
  - The spec's Data shape columns and checks on `public.positions`, with `left_board`.
  - The two tables (`acting_changes` with `chapter_id`; `acting_requests.outcome` checked to `confirmed`, `withdrawn`, `lapsed`), `votes.acting_request uuid null references public.acting_requests(id)` and `vote_electors.for_chapter uuid null references public.chapters(id)`.
  - Views `private.held_positions`, `private.duty_positions`, `private.clubwide_positions`.
  - `private.lock_seat(p_chapter uuid, p_role public.position_role) returns void`: `pg_advisory_xact_lock(hashtextextended(coalesce(p_chapter::text,'national') || ':' || p_role::text, 0))`.
  - `private.close_lapsed_acting() returns void`.
  - Triggers: `private.check_covers()` (before insert or update of `covers`: a non-null `covers` points at an open, non-acting row of the same chapter and role, started on or before the cover, else `COVERS_POINT`) and `private.on_position_end()` (after update of `ended_on`: both cascades, logged with note `Holder’s seat ended` or `Stand-in left the board`).

- [ ] **Step 1: Write the failing tests.** Owner fixtures: North has Smokey (president), Crank (road_captain), Jet (VP); West has Rusty (president), Torque (secretary), Penny (treasurer), Spanner, Hal and Kim.
  - `acting: an elected holder and an empty-seat acting row clash`; `a cover sits beside the holder; a second cover clashes`; `one stint per member`
  - `acting: the checks`: each refuses its bad row, including a 121-character and a blank why.
  - `acting: covers must point at the open, non-acting holder of the same seat`
  - `acting: ending the covered row turns the cover into empty-seat acting` (`covers` null, `acting_until` kept, `old_covers` logged); `ending the stand-in's last board seat ends the cover (left_board); a second board seat keeps it`
  - `acting: the views at Melbourne midnight` (offset clock): until today is held, until yesterday isn't; a covered row is held, not duty; a cover is duty, not club-wide.
  - `acting: close_lapsed_acting`: `ended_on = acting_until + 1`, `lapsed`, `ended_by` null; an elected insert then fits; old requests lapse; a second run changes nothing.
  - `acting: who reads requests and changes` (board and stand-in read requests, Spanner doesn't; board and Kim read changes; `authenticated` can't use the views, `close_lapsed_acting` or `lock_seat`); `unchanged rows` (null acting columns; `access_rules_test.sql:478-487` passes)
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL with `column "acting_until" does not exist`.
- [ ] **Step 3: Implement §1.**
  - Index swap (`foundations.sql:110`): create `one_holder_per_board_seat_v2 on public.positions (chapter_id, role) where ended_on is null and covers is null and role in (<the six board roles>)` and `one_cover_per_board_seat` (`covers is not null`); drop `public.one_holder_per_board_seat`; rename v2.
  - Indexes `one_acting_per_member`, `positions_covers_idx`, `one_open_request_per_seat` (`(chapter_id, role) where closed_at is null`), and `check ((closed_at is null) = (outcome is null))`.
  - Policies: `acting_requests_read` is `is_board_of(chapter_id) or member_id = auth.uid()`; `acting_changes_read` is `is_board_of(chapter_id) or is_auditor()`. Writes revoked.
  - NEC backfill: on `vote_electors` of open `nec` votes, `for_chapter = coalesce(<chapter of the elector's open president or vice_president row, president first>, members.chapter_id)`.
  - Views:

```sql
create view private.held_positions as select * from public.positions
  where ended_on is null and (acting_until is null or acting_until >= private.club_date());
create view private.duty_positions as select h.* from private.held_positions h
  where not exists (select 1 from private.held_positions c where c.covers = h.id);
create view private.clubwide_positions as select * from private.duty_positions where acting_until is null;
```
- [ ] **Step 4: Run** `npm run test:db`. Expected: every `acting:` echo prints, then `ALL DATABASE CHECKS PASSED`.
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
  - `private.sees_every_chapter() returns boolean` (new): an approved member with a `clubwide_positions` row in `nec_chair`, `nec_secretary` or `president`.
  - Duties: `is_national`, `is_nec_officer`, `is_chairman`, `is_auditor`, `chair_of`, `nec_voter_for`, `can_manage_fees`, `is_on_committee`, `manages_site_photo_crew`, `runs_charity`. Calls in place of inline reads: `can_designate_big4` calls `is_national()`, `record_agm` calls `is_nec_officer()`, `sees_ledger` calls `is_auditor()`.
  - `keeps_books`: chapter = duty Treasurer; null = club-wide Treasurer of any chapter; national money roles unchanged. `approves_for`: chapter = held board rows; null = club-wide Presidents; `nec_chair`/`nec_secretary` from duties.
  - Club-wide: `shop_seat`, `is_feedback_keeper`, `push_feedback_sent`. `sees_board_of` = approved and (`sees_every_chapter()` or a held board row in the chapter). `chat_problem` (`family_chat.sql:21`): line 45 calls `sees_every_chapter()`.
  - `minutes_draft_start`: held seats plus `'acting', p.acting_until is not null`; its NEC branch lists duty presidents. `minutesDraft.ts`'s `board` type gains `acting?: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `duties: Jet chairs North and casts its NEC vote; Smokey is off the NEC`
  - `duties: an Acting Treasurer keeps only their chapter's books` (`keeps_books(north)` true, `keeps_books(null)` false, `can_manage_fees(north)` true)
  - `club-wide: no acting row reaches the Club fund, the shop, feedback or every chapter` (as Jet: `approves_for(null)`, `shop_seat()`, `is_feedback_keeper()`, `sees_every_chapter()`, `sees_board_of(west)` all false)
  - `club-wide: a covered President keeps sees_board_of(north) and loses sees_board_of(west) and approves_for(null)`; `an Acting President can't read West's chapter chat; a sitting President can`
  - `lapsed: a lapsed but open row loses approves_for, keeps_books, nec_voter_for, chair_of and sees_board_of`
  - `minutes: the draft flags Jet's acting row and its NEC list names Jet, not Smokey`
  - `catalogue: no live function or policy names public.positions off the allow-list`: scans `public` and `private` `prosrc` for `public\.positions\b`, and policy `qual`/`with_check` for `positions`. The allow-list is a `values` list with a reason per entry: writers (`appoint_position`, `end_position`, `renew_auditor`, `forget_member`, `add_roster_position`, `settle_chapter_proposal`, `appoint_acting`, `confirm_acting`, `set_acting_until`, `close_lapsed_acting`, `check_covers`, `on_position_end`); `has_carried_nec_vote` (history read); pending `has_carried_removal_vote`, `set_member_status`, `delete_my_account` (Task 5) and `open_vote` (Task 6).
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL; the catalogue lists about 20 functions.
- [ ] **Step 3: Implement §3**; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 4: DB acting RPCs and caps

**Files:** Migration §4; `acting_test.sql` §4.

**Interfaces:**
- Private helpers: `acting_problem(p_member uuid, p_chapter uuid, p_role public.position_role, p_covers uuid) returns text`; `acting_cap(p_chapter uuid, p_cover boolean, p_start date) returns date`; `acting_needs_vote(p_member uuid, p_chapter uuid, p_role public.position_role) returns boolean` (a president who isn't the duty VP of a chapter that has one); `has_carried_acting_vote(p_request uuid) returns boolean`; `auditor_stays_out(p_role public.position_role) returns boolean` (the caller holds `nec_auditor` and the role is president or treasurer); `board_size(p_chapter uuid) returns int` (distinct held board members).
- Public RPCs: `appoint_acting(p_member uuid, p_chapter uuid, p_role public.position_role, p_until date, p_why text) returns uuid`; `request_cover(p_position uuid, p_member uuid, p_until date, p_why text) returns uuid`; `request_acting(p_member uuid, p_chapter uuid, p_role public.position_role, p_covers uuid, p_until date, p_why text) returns uuid` (`p_covers` null for an empty seat); `withdraw_acting_request(p_request uuid) returns void`; `confirm_acting(p_request uuid) returns uuid` (locks the request row `for update`); `set_acting_until(p_position uuid, p_until date) returns void`. Each starts with `lock_seat`, then `close_lapsed_acting()`.

**Check order** (Task 11 mirrors it): 1 signed in and approved; 2 caller standing (`BOARD_RECORDS_ACTING`, `NOT_YOURSELF`, `OWN_SEAT_ONLY`, `CONFIRM_*`, `WITHDRAW_WHO`); 3 `AUDITOR_STAYS_OUT`; 4 `SMALL_BOARD` (request routes only); 5 `acting_problem`: `ACTING_CHAPTER_ONLY`, not a member of that chapter, `hold_problem`, already holds that role, `SEAT_HAS_HOLDER`, `SEAT_HAS_ACTING`, `ONE_STINT`, `OWN_SEAT_COVERED`, `CHAIR_NOT_BOOKS`/`BOOKS_NOT_CHAIR`, `HIATUS_NO_LEAD` (road_captain, tail_gunner, assistant_tail_gunner), then with covers `COVER_BOARD_SEATS` and `COVER_FROM_BOARD`; 6 the vote rule: `PRESIDENT_NEEDS_BOARD_VOTE` on `appoint_acting` and `request_cover`, `NEEDS_ACTING_VOTE` on `confirm_acting` for a voted request or an agreed one that now needs a vote; 7 `WHY_NEEDED`; 8 `untilRange(cap)`: today ≤ until ≤ cap, with today as the start.

- [ ] **Step 1: Write the failing tests.**
  - `routes: Smokey records Crank as Acting Treasurer (North)`: the until, the why, `appointed_by` Smokey, a start of today. `routes: every refusal, in order`, matched exactly.
  - `caps: from 30/11/2026 and 31/01/2027`: cover `'2027-02-28'`, empty `'2027-05-30'`; then cover `'2027-04-30'`, empty `'2027-07-31'`. `caps: a North agm on 14/02/2027 caps the empty seat at 2027-02-14` (a cancelled agm, a `general` meeting and a West agm are ignored).
  - `routes: Smokey asks for Jet; Crank confirms` (`confirmed`, `covers` Smokey's row, `appointed_by` Crank; a second confirm `NO_REQUEST`); `confirm re-runs every check` (Smokey's row ended `SEAT_ENDED`; Jet acting elsewhere `ONE_STINT`; a passed date `NO_REQUEST`, then a new request fits; Smokey `CONFIRM_NOT_HOLDER`; Jet `CONFIRM_NOT_STANDIN`)
  - `routes: a voted cover`: Crank's `request_acting` gives `NEEDS_ACTING_VOTE` at confirm; allowed after a carried `acting_request` vote one day ago, refused for one 91 days ago.
  - `routes: a chapter with no VP lets any board member cover the President` (Torque covers Rusty); `withdraw by requester, stand-in and holder; Spanner gets WITHDRAW_WHO`
  - `dates: set_acting_until`: earlier by the acting person or holder (yesterday `UNTIL_NOT_PAST`; another board member `EARLIER_WHO`); later on an empty seat by another board member (the acting person `LATER_WHO_EMPTY`; past the cap `untilRange`); later on an agreed cover by Smokey (Jet `laterWhoCover('Smokey')`; voted `VOTED_NEEDS_NEW_VOTE`); a normal row `NOT_ACTING`; one `acting_changes` row per change, `started_on` kept.
  - `auditor: Kim in a West VP seat can't record, propose, confirm or change acting for West's President or Treasurer, but can for Secretary`
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL with `function public.appoint_acting does not exist`.
- [ ] **Step 3: Implement §4** with grants; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 5: DB writers and endings, the lock catalogue, two sessions

**Files:** Migration §5; `acting_test.sql` §5.

**Interfaces:**
- Same signatures, with lock and lazy close (lazy close only for `forget_member`, `delete_my_account`, `set_member_status`): `appoint_position` (`audit_fixes.sql:207`), `end_position` (`chatgpt_audit_fixes.sql:319`), `add_roster_position` (`roster_seat_dates.sql:5`), `settle_chapter_proposal` (`board_admin.sql:766`; founders check held), `renew_auditor` (`national_auditor.sql:482`; `renewed`), `forget_member` (`chatgpt_audit_fixes.sql:372`; `forgotten`), `delete_my_account` (`:451`; any held acting row blocks, existing words), `set_member_status` (`downward_notice_gate.sql:8`; held reads).
- `has_carried_removal_vote` (`removal_and_gate.sql:213`), reading `held_positions`: an acting row uses the `chapter_board` majority shape, every match needs `acting_request is null`, and the "since the term began" line stays.
- Every end sets `ended_reason`. Drops the Task 5 pending entries.
- **`end_position`'s acting branch**, after "That term has already ended.": 1 your own row: `stepped_down`; 2 it covers your row: `holder_back`; 3 not `is_board_of(chapter)`: "Only that chapter’s board can end this term." (NEC officers have no branch); 4 `AUDITOR_STAYS_OUT` for President and Treasurer seats; 5 `has_carried_removal_vote`: `removed`, else `ACTING_END_NEEDS_VOTE`. A normal row ends `stepped_down` (your own) or `removed`.
- **`appoint_position`:** "They already hold that role." ignores the target's own empty-seat acting in that seat; "That seat is taken" ignores covers and empty-seat acting; chair and books apart, both ways; it ends empty-seat acting in the seat before inserting (`replaced`, `ended_by` = caller).

- [ ] **Step 1: Write the failing tests:**
  - `writers: a full appointment ends empty-seat acting (replaced), even electing the acting person`; `end the covered row, then appoint in full; only one row has duties`; `chair and books apart, both ways`; `add_roster_position skips a live acting seat and fills a lapsed one`
  - `endings: stepped_down, holder_back, removed with a carried chapter_board majority, ACTING_END_NEEDS_VOTE without, Lou refused`; `an acting vote never counts as a removal vote`; `a removal vote closed before the stint started doesn't count`
  - `endings: ending the stand-in's own Road Captain row ends their cover (left_board)`; `renewed; forgotten (forgetting the stand-in ends the acting; forgetting the holder turns the cover into empty-seat acting)`; `delete_my_account refuses an acting Officer; set_member_status refuses an acting row and ignores a lapsed one`
  - `catalogue: every statement setting positions.ended_on names ended_reason` (split `prosrc` on `;`; `update public\.positions` with `ended_on\s*=`); `every seat writer calls private.lock_seat` (any `insert into|update public\.positions`; allow-list `close_lapsed_acting`, `forget_member`, `on_position_end`, `check_covers`, each with a reason)
  - `two sessions: the seat lock serializes writers`: dblink as in `rusty_bus_test.sql:820-980` (`pg_temp.waits(pid)`, `pg_temp.outcome(conn)`), fixtures committed. A holds `lock_seat(north,'treasurer')` and seats Crank; B's call for Jet waits, then returns `SEAT_HAS_ACTING`.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL at `replaced`.
- [ ] **Step 3: Implement §5**; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 6: DB votes

**Files:** Migration §6; `acting_test.sql` §6.

**Interfaces:**
- `open_vote` (`removal_and_gate.sql:27`): lazy close first, held subject checks, a `chapter_board` majority when the subject's held row of that role is acting (`ACTING_END_SHAPE` otherwise). NEC electors are the people `electors_for('nec', null)` returns (approved, not legacy), each inserted as `(vote, nec_voter_for(c.id), c.id)`, skipping chapters with no voter.
- `public.open_acting_vote(p_request uuid, p_quorum int, p_closes_at timestamptz, p_meeting uuid) returns uuid`: lock and lazy close first; the request is open and needs a vote (`NO_VOTE_NEEDED`); the caller is a board member who isn't the stand-in; `AUDITOR_STAYS_OUT`; at least three board members ("A board vote needs at least three board members (8.5)."); `open_vote`'s quorum, closing and meeting words. It inserts `chapter_board`, majority, not secret, subject = the stand-in, the role, and `acting_request`. Question: `'Jet acts as President (North) for Smokey until 13/12/2026: Smokey can’t be reached'`, or `'Jet acts as President (North) until 13/12/2026: <why>'` for an empty seat.
- Drops the last pending entry.

- [ ] **Step 1: Write the failing tests:** `votes: a vote to end acting is a chapter_board majority` (two-thirds of patched members raises `ACTING_END_SHAPE`); `NEC electors carry for_chapter; North's is Jet under the cover; a chapter with no President or VP adds none`; `a lapsed stint gets no ballot`; `open_acting_vote builds the question and the shape`, then its refusals in order.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement §6**; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 7: DB money (13.3)

**Files:** Migration §7; `acting_test.sql` §7.

**Interfaces:**
- `private.approval_conflict(p_entry uuid, p_member uuid) returns text`, null or:
  - `independentSeated(short_name(appointer))`: the member's only standing in that chapter fund comes from held acting rows (no non-acting held board row there, no `nec_chair`/`nec_secretary`), and one of those rows' `appointed_by` is the entry's `recorded_by`, its `payee_member_id`, or an approver already counted;
  - `independentStandIn(short_name(payee))`: a held cover of the member points at a payee row.
- `approve_debit` (`treasurer.sql:274`) raises it after "You’ve already approved this."; `record_debit` (`treasurer.sql:241`) skips its automatic approval on a conflict, with no error.

- [ ] **Step 1: Write the failing tests:** `money: Penny's appointee can't be the second approver on Penny's entry`; `Rusty's appointee can`; `the payee's stand-in can't approve the refund`; `record_debit records without self-approval on a conflict`; `a covered President still approves West spending`.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement §7**; run again. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 8: DB tightenings for everyone, and the strict catalogue

**Files:** Migration §8, plus §5's `appoint_position` edited in place; `acting_test.sql` §8.

**Interfaces:**
- `cast_ballot` (`meetings_votes.sql:397`; the vote row stays `for share`), in order:
  1. "No such vote."
  2. NEC branch, on a vote with `for_chapter` rows: the caller's own row with `nec_voter_for(for_chapter) <> me` gives `castNecNotYours(name)`. With no row for the caller, take the chapter whose `nec_voter_for` is the caller and lock its elector row `for update`: cast gives `castNecCast`; uncast sets that row's `member_id = me`. A null `for_chapter` keeps today's rule.
  3. "You’re not on this vote." 4 "You’ve already voted." 5 "That vote has closed."
  6. `CAST_BOARD_ENDED` on a `chapter_board` vote when not `is_board_of(v.chapter_id)`.
  7. "Pick an answer."
- `appoint_position` adds `AUDITOR_STAYS_OUT` for President and Treasurer after the board check.

- [ ] **Step 1: Write the failing tests:** `tightening 1: a removed board member can't cast on an open board vote; the quorum stays fixed`; `tightening 2: Smokey casts the North NEC ballot Jet didn't (member_id moves); lapsed Jet gets castNecNotYours('North'); a cast ballot stands (castNecCast('North'))`; `tightening 3: Kim (Auditor, West VP) can't appoint a Treasurer in full, can appoint a Secretary`; `catalogue: no pending entries remain`.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL at tightening 1.
- [ ] **Step 3: Implement §8**; run again. Expected: PASS, every existing `castBallot`/`appoint` parity case included.
- [ ] **Step 4: Commit.**

### Task 9: App foundations

**Files:**
- Create: `src/domain/acting.ts`, `acting.test.ts`, `src/actingSource.test.ts`.
- Modify: `src/domain/types.ts:117-124,522` and `ClubData`; `src/domain/access.ts:28-30`; `src/data/liveData.ts:127,317-324` (still `select('*')`), `businessLive.ts:74`, `database.types.ts:194` (positions, the two tables, the vote columns, by hand); `scripts/parity-sql.mts:1276`, `src/data/parityFixture.testkit.ts:42-53,314-316,633`, `parity.json`.

**Interfaces:**
- Types: `EndedReason`; optional `Position` fields `actingUntil`, `covers`, `actingWhy`, `actingVote`, `appointedBy`, `endedReason`; `ActingRequest`, `ActingChange` (camelCase of Task 1); `ClubData.actingRequests?`, `actingChanges?`; `Vote.actingRequestId?`, `electorChapters?: Record<string, string>` (elector to chapter).
- `acting.ts` (readings expect settled rows): `isActing(p)`, `isEnded(p)`, `heldPositions(memberId, positions)`, `dutyPositions(...)`, `clubwidePositions(...)`, `heldRows(positions)`, `dutyRows(positions)`, `coverOf(position, positions): Position | null`, `openRows(positions)` (raw, for writers), `settleActing(data: ClubData, today: string): ClubData`, `lapsedOwnRows(raw: ClubData, today: string, memberId: string | null): boolean`, `endPositionRows(positions, id, how: { reason: EndedReason; by: string | null; today: string }): { positions: Position[]; changes: ActingChange[] }` (both cascades), `msUntilNextClubDay(nowIso: string): number`. `activePositions = dutyPositions` (name kept).
- Parity (each side resolves `…Days` itself; `demoAnswer` settles first): `ParityCase.with?: { key, member, chapter, role, startedDays?, actingUntilDays?, covers?, why?, appointedBy? }[]`; `withRequests?: { key, chapter, role, member, covers?, untilDays, why, requestedBy }[]`; `withVotes?: { key, chapter, electorate, threshold, subject?, role?, actingRequest?, electors, voted?, result?, closedDays?, closesDays? }[]`.

- [ ] **Step 1: Write the failing tests** in `acting.test.ts`:
  - `settle closes a stint the day after its until date` (until `'2026-12-13'`: open that day; on `'2026-12-14'`, `endedOn: '2026-12-14'`, `endedReason: 'lapsed'`); `settle keeps the data object and unchanged row objects when nothing lapses` (identity on `DEMO_DATA`); `an old saved copy without acting fields settles unchanged`; `settle closes lapsed acting requests`
  - `Melbourne midnight in both daylight states`: `msUntilNextClubDay('2026-10-03T14:00:00.000Z') === 82_800_000`; `msUntilNextClubDay('2027-04-03T13:00:00.000Z') === 90_000_000`; `melbourneDate` (`rides.ts:19`) reads `'2026-10-03'` at `13:59:59Z` and `'2026-10-04'` at `14:00:00Z`
  - `the four readings` (Jet covers Smokey): Smokey's President row is held, not duty; Jet's duties are VP plus acting President; Jet is club-wide as VP only.
  - `a cover turning into empty-seat acting`; `the stand-in's last board seat ending ends the cover (left_board)`; `lapsedOwnRows is true only when a settle ends the viewer's own row`
- [ ] **Step 2: Write the failing source test** `no inline open-row checks outside acting.ts and access.ts` (`src/actingSource.test.ts`): over `src/**/*.ts(x)` without tests and testkits, it flags `/\.endedOn\s*(===|==|!==|!=)\s*null/`, `/!\s*[\w.]*\.endedOn\b/` and `/endedOn\s*\?\?/`. A line ending `// acting: pending` passes until Task 23: mark every flagged site, inverse checks included; `demoActions.ts:347` moves to `openRows` now.
- [ ] **Step 3: Add mapping tests:** `positions map the acting columns, appointed_by and ended_reason`; `acting requests and changes load`; `for_chapter and acting_request map to electorChapters and actingRequestId`.
- [ ] **Step 4: Add the parity smoke case** `A lapsed acting VP gets no board ballot` (West's held board is Rusty, Torque and Penny, so quorum 4 fails only without Spanner):
  - `{ as: "rusty", action: "openVote", chapter: "west", subject: null, electorate: "chapter_board", threshold: "majority", quorum: 4, days: 7, allowed: false }`
  - `with: [{ key: "spanner-acting-vp", member: "spanner", chapter: "west", role: "vice_president", startedDays: -30, actingUntilDays: -1, why: "No VP since the ACM" }]`
- [ ] **Step 5: Run** `npm test`. Expected: FAIL, `acting.ts` is missing.
- [ ] **Step 6: Implement.** The SQL hook inserts as the owner after `:1276` (after `without`), in list order: `with` rows into positions (`appointed_by` from `appointedBy`); `withRequests` into `acting_requests` as `id('ar', key)`; `withVotes` into votes and electors as at `:107-121`, NEC electors with their chapter as `for_chapter`, and `voted` adding `voted_at` and a `yes` ballot. `fixtureData` adds the same rows on the app side.
- [ ] **Step 7: Run** `npm test` and `npm run test:db`. Expected: PASS.
- [ ] **Step 8: Commit.**

### Task 10: App readings mirror the views

**Files:** `src/domain/access.ts` (`holdsBoardSeat`, `isNational`, `seesBoardOf`, `accessLevel :90`, `holdProblem`, `statusChangeProblem :389`, `appointWarnings :300`); `social/help.ts:101-105`, `bus.ts:106-110`, `attendance.ts:41`, `feedback.ts:73-76`, `national.ts:267-270`, `account.ts:16-46`, `chat.ts:125`, `shop.ts:107,172-180`, `liveRide.ts:94-96`; their tests; `parity.json`.

**Interfaces:**
- `seesEveryChapter(viewer: Member | null, positions: Position[]): boolean`; `seesBoardOf` is the held `holdsBoardSeat`, or `seesEveryChapter`.
- Held: `isRideLeader`, `holdProblem`, `statusChangeProblem`, `holdsChapterPost`, and `deleteAccountProblem`/`stepDownSeats` (acting rows of any role). Board member: `accessLevel`'s board line, `isAnyBoard`, `managesBus`, `canRunCheckin(null)`. Club-wide: `isFeedbackKeeper`, `holdsShopSeat`, `readProblem :125`. `appointWarnings`' `servedTerm` skips acting rows. The markers in these files go.

- [ ] **Step 1: Write the failing tests** (`DEMO_DATA` with Jet covering Smokey): `a covered President keeps the board level and board records and is off the NEC`; `an Acting President is national but sees no other chapter's private details` (no `seesEveryChapter`, no `canSeePrivate` for a West member); `empty-seat acting makes a board member; a settled lapsed one doesn't`; `board-member mirrors count a covered holder; club-wide mirrors skip acting rows`; `holdProblem: a covered Treasurer can't be seated as Auditor`; `an acting Officer must end their positions first`; `a stint isn't a 9.4 served term`; `an Acting President can't read West's chapter chat`; `Delete account lists an acting Officer seat`.
- [ ] **Step 2: Add parity cases**, rows in `with`, the VP row before the cover. Rows: `jet-north-vp {jet, north, vice_president}`; `jet-covers-smokey {jet, north, president, actingUntilDays 20, covers smokey-president, why "Smokey overseas", appointedBy crank}`; `torque-covers-rusty {torque, west, president, 20, covers rusty-president, why "Rusty overseas", appointedBy penny}`. Cases: smokey `openVote north chapter_board majority quorum 3 days 7` under Jet's cover true (three electors); smokey opens an `nec` majority vote, quorum 2, false; jet the same, true; rusty `approveDebit west-awaiting` under Torque's cover true; torque `club-awaiting` false; rusty `club-awaiting` false; spanner with Task 9's lapsed row `west-awaiting` false (Task 14's live twin is true).
- [ ] **Step 3: Run** `npm test`. Expected: FAIL.
- [ ] **Step 4: Implement**; run `npm test` and `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: App acting rules in `access.ts`

**Files:** `src/domain/access.ts`, `access.test.ts`; `appointProblem` callers (`LiveClubProvider.tsx:465`, `demoActions.ts`, `board.tsx`, the parity testkit) pass `today`.

**Interfaces** (Task 4's order and words):
- `actingProblem(target: Member, chapterId: string | null, role: PositionRole, covers: Position | null, data: ClubData): string | null`
- `actingCap(chapterId: string, cover: boolean, startedOn: string, data: ClubData): string`, and `actingDefaultUntil` with the same parameters; `actingNeedsVote(memberId, chapterId, role, data): boolean`; `auditorStaysOut(me: Member, role: PositionRole, positions: Position[]): boolean`
- Route checks: `appointActingProblem(me, target, chapterId, role, until, why, data, today)`; `requestCoverProblem(me, seat: Position | undefined, target, until, why, data, today)`; `requestActingProblem(me, target, chapterId, role, covers: Position | null, until, why, data, today)`; `withdrawRequestProblem(me, request: ActingRequest | undefined)`; `confirmActingProblem(me, request, data, today)`; `setActingUntilProblem(me, position, until, data, today)`.
- `actingWarnings(target, chapterId, role, covers, until, data, today): string[]`
- Existing rules: `endTermProblem` gets Task 5's acting branch; `appointProblem` takes a required `today` and gains `replaced` awareness, chair and books, and `AUDITOR_STAYS_OUT`; `hasCarriedRemovalVote` uses the acting shape and needs `actingRequestId == null`. Exports the Words constants.

- [ ] **Step 1: Write the failing tests:**
  - `actingProblem refuses, in order, with the shared words`
  - `caps from 30/11 and 31/01`: Task 4's values, plus defaults: from `'2026-11-30'` cover `'2026-12-28'`, empty `'2027-02-28'`; from `'2027-01-31'` cover `'2027-02-28'`, empty `'2027-04-30'`. `caps against a scheduled ACM` (North agm 2027-02-14 gives cap and default `'2027-02-14'`)
  - `warnings`: 9.6 on every board-seat stint; 9.1 only for an empty-seat stand-in off the board; 9.4 only for a non-VP empty-seat President or VP; 9.7 on covers; `Crank leads the 13/12 run. Acting ends that night. Pick 14/12 or later.`
  - `end branches` (acting person, holder, board with and without a vote, Lou); `the Auditor in a second seat`; `one stint; chair and books apart; hiatus`; `confirm re-runs every check`; `a confirmed request isn't open`
  - `appointProblem: electing the acting person and appointing over empty-seat acting are allowed; chair and books both ways are refused`
- [ ] **Step 2: Run** `node --import tsx --test src/domain/access.test.ts`. Expected: FAIL, `actingProblem` is not a function.
- [ ] **Step 3: Implement**; run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 12: Demo acting writers and the shared route cases

**Files:** Create `src/data/actingActions.ts` and its test. Modify `src/data/demoActions.ts:347,354-377,701`, `auditActions.ts:83-85`, `adminActions.ts:244-251`, `scripts/parity-sql.mts:639+`, `parityFixture.testkit.ts`, `parity.json`.

**Interfaces:**
- Consumes the Task 11 checks and Task 9's `endPositionRows` and `openRows`.
- Demo writers; each throws its check's words, sets `appointedBy` and `endedReason`, and logs `ActingChange`s: `appointActing(ctx: DemoCtx, memberId, chapterId, role, until, why): ClubData`; `requestCover(ctx, positionId, memberId, until, why)`; `requestActing(ctx, memberId, chapterId, role, coversId | null, until, why)`; `withdrawActingRequest(ctx, requestId)`; `confirmActing(ctx, requestId)`; `setActingUntil(ctx, positionId, until)`.
- `DemoAction` variants and parity actions of the same names: `appointActing {member, chapter, role, untilDays, why}`; `requestCover {seat, member, untilDays, why}`; `requestActing {member, chapter, role, covers?, untilDays, why}`; `withdrawActingRequest {request}`; `confirmActing {request}`; `setActingUntil {position, untilDays}`.
- `appoint`, `endTerm` and `deleteMyAccount` use `endPositionRows`; `renewAuditor` writes `renewed`.

- [ ] **Step 1: Write the failing unit tests:** `confirmActing seats the cover and closes the request`; `a full appoint ends empty-seat acting with replaced`; `endTerm records stepped_down, holder_back or removed`; `deleteMyAccount and forget turn a cover into empty-seat acting`; `renewAuditor writes renewed`.
- [ ] **Step 2: Add parity cases**, each named as a sentence; each `false` expects its Words text; rows go in `with`, VP rows before covers.
  - Rows: `jet-acting-treasurer {jet, north, treasurer, actingUntilDays 20, why "No Treasurer since the ACM"}`; `crank-treasurer {crank, north, treasurer}`; `crank-acting-treasurer {crank, north, treasurer, startedDays -10, actingUntilDays 20, why "No Treasurer since the ACM", appointedBy smokey}`; `kim-west-vp {kim, west, vice_president}`. Requests: `smokey-asks-jet {north, president, jet, covers smokey-president, untilDays 28, why "Smokey overseas", requestedBy smokey}`; `crank-asks-jet` (the same, `requestedBy crank`).
  - Recording: smokey `appointActing jet north vice_president 28` true; jet (off the board) false; crank records jet as president (a holder sits) false; a second stint (jet-acting-treasurer) false; without smokey-president, with jet-north-vp and crank-treasurer, jet records crank as president false.
  - Auditor, with kim-west-vp: Kim records an Acting Treasurer without penny-treasurer false; Kim `appoint`s a Treasurer in full false.
  - Asking, with jet-north-vp: smokey `requestCover seat smokey-president jet 28 "Smokey overseas"` true; for crank (not the VP) false; for lou (off the board) false; without jet-north-vp (a board of two) false.
  - Confirming, with jet-north-vp: crank confirms smokey-asks-jet true; smokey confirms it false; at untilDays -1 false; crank-asks-jet with no vote false, and after a carried acting vote closed -1 true.
  - Ending, with jet-north-vp and jet-covers-smokey: jet steps down true; smokey's "I'm back" true; crank without a vote false; crank after a carried north `chapter_board` majority vote on jet as president, closed -1, true; lou false.
  - Full appointments: smokey `appoint jet north treasurer` over crank-acting-treasurer true; crank elected Treasurer while acting in it true; rusty `appoint hal west vice_president` over Task 9's lapsed row true.
  - Dates: crank to untilDays 7 true; smokey gives crank untilDays 40 true; crank gives himself more false; smokey extends jet-covers-smokey true; jet extends it false. Withdrawing: jet withdraws smokey-asks-jet true.
- [ ] **Step 3: Run** `npm test` and `npm run test:db`. Expected: FAIL with an unknown action `appointActing`.
- [ ] **Step 4: Implement** the writers and the dispatch on both sides (SQL passes requests as `id('ar', key)`); run both suites. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 13: App votes and ballots

**Files:** `src/domain/votes.ts` (`electorsFor :75`, `holderOf :109`, `chairOf`, `necVoterFor`, `castProblem :245`, `isRemovalVote`, `removalShape`, `removalVoteFor`, `openVoteProblem :202-221`); `businessActions.ts:128,143`, `actingActions.ts`; `castProblem` callers `business.ts:45`, `business.tsx:535,759`, `LiveClubProvider.tsx:579`; the parity files; `votes.test.ts`.

**Interfaces:**
- `export necVoterFor(chapterId, positions): string | null` (duties); `castProblem(me, vote, now, data: ClubData)` with Task 8's order and words; `isRemovalVote` excludes votes with an `actingRequestId`; `removalShape(role, acting = false)`.
- `openActingVoteProblem(me, request, quorum, closesAt, meetingId, data, now)` and `actingVoteQuestion(request, data)`.
- `stintVoteWarnings(input: VoteInput, data, today): string[]`. NEC: `Jet’s acting ends 13/12. Close before then, or Smokey votes for North instead.` Empty-seat board elector: `Crank’s acting ends 13/12. Close before then, or Crank can’t vote.`
- Demo: `openVote` writes `electorChapters`; `castBallot` passes an uncast NEC ballot over; new writer `openActingVote(ctx, requestId, quorum, closesAt, meetingId)` and parity action `openActingVote {request, quorum, days}`.

- [ ] **Step 1: Write the failing tests:** `North keeps three board electors under a cover`; `the cast-time board check`; `NEC ballot pass-over`; `chairOf follows duties`; `necVoterFor: an Acting President counts, then the VP with duties`; `acting votes aren't removal votes`; `the acting vote question` (`'Jet acts as President (North) for Smokey until 13/12/2026: Smokey can’t be reached'`); `the stint warning on opening`.
- [ ] **Step 2: Add parity cases:** spanner casts `yes` on an open west `chapter_board` vote (electors rusty, torque, penny, spanner) with the lapsed row, false; torque casts without torque-secretary, false; smokey casts an open `nec` vote (electors jet, rusty) that Jet didn't, true; jet casts it after his stint, false; smokey casts after jet voted, false; crank `openActingVote crank-asks-jet 3 7` true; jet opens it, false; crank ends jet-covers-smokey with only a carried acting vote, false.
- [ ] **Step 3: Run** both suites. Expected: FAIL.
- [ ] **Step 4: Implement**, passing `data` at every `castProblem` caller; run both suites. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 14: App money

**Files:** `src/domain/ledger.ts:46-71,173-183`, `src/data/ledgerActions.ts:51`; `ledger.test.ts`, `parity.json`.

**Interfaces:** `keepsBooks` (chapter = duty Treasurer; null = club-wide Treasurer); `approvesFor` (chapter = held board; null = club-wide Presidents); `approvalConflict(memberId: string, entry: LedgerEntry, data: ClubData): string | null` (Task 7 rule and words), returned by `approveProblem` after "You’ve already approved this."; the demo's `recordDebit` skips self-approval on a conflict.

- [ ] **Step 1: Write the failing tests:** `the Acting Treasurer keeps only the chapter's books`; `no acting row on the Club fund`; `Penny's appointee can't be the second approver`; `the payee's stand-in can't approve the refund`; `recordDebit skips self-approval on a conflict`.
- [ ] **Step 2: Add parity cases** (`west-awaiting` already carries Penny's approval): `Penny's appointee gives the second approval` (spanner acting West VP, appointedBy penny, untilDays 20, `approveDebit west-awaiting`, false); `Rusty's appointee gives the second approval` (the same row, appointedBy rusty, true); `The payee's stand-in approves the refund` (rusty covering torque-secretary, `west-refund`, false); `An Acting Treasurer records a Club fund line` (crank-acting-treasurer, with the fields of the existing `Bank fees, dated` case, false); `An Acting Treasurer records a North line` (true).
- [ ] **Step 3: Run** both suites (FAIL), **implement**, **run** (PASS).
- [ ] **Step 4: Commit.**

### Task 15: Display domain (parallel with Tasks 10 to 14)

**Files:** `src/domain/home.ts:14-34`, `terms.ts:18-31`, `audit.ts:178-180,213-275`; `social/history.ts:280-292`, `glossary.ts:34-43`; `notifications.ts:126-136`, `assistant.ts:103-107,338-347,383`, `meetingReport.ts:233-246`; `src/ui/primitives.tsx:341-343`; `DESIGN.md`; tests beside each.

**Interfaces:**
- Titles: `PositionTitle.until: string | null`. `positionTitles` groups by role and acting: `Acting Treasurer (North)`, until `'13/12/2026'`. `longTitle(t)` gives `… until 13/12/2026`. `chipLabel(position, chapters)` gives `ACTING TREASURER (NORTH)`, else `ROLE_SHORT`. `RoleChip({ role, position? })` uses `chipLabel`. `necRows(data): { chapterId: string; text: string }[]` gives `Jet, Acting President (North), for Smokey until 13/12/2026`.
- Cover copy: `coverNote(seat, standIn, until, data)`. President: the spec's Me note. Treasurer: `Jet keeps North’s books until …`. Otherwise: `Jet does the <Role>’s duties for North until …`. `coveredNotice(seat, cover, data)`: the spec's covered-holder text.
- Terms: `termEndsOn` returns `actingUntil` for acting rows; `termState` uses `isEnded`.
- Audit: `onAnyBoard` reads held; `auditChecks` skips acting rows in the term-ended check and adds keys `acting-no-election:`, `acting-past-acm:`, `cover-over-3-months:` and `vp-fallback:` with the spec's four titles; `vp-fallback` gets `fix: { kind: 'make-acting-president'; memberId: string; chapterId: string }` and the label `Make Jet Acting President`. `pastOfficeHolders` skips acting rows.
- Glossary: `Acting`: `Doing a role until a set date: in an empty seat, or covering a holder who is away.`; `Cover`: `A board member doing an away holder’s duties until a date. The holder keeps the seat and board vote.`
- Reminders: `Reminder.rideId` becomes optional; `actingReminderPlan(meId: string | null, data: ClubData, now: string): Reminder[]`, ids `acting-<positionId>-7` and `-1`, at 9:00 am Melbourne 7 days and 1 day before the until date; titles `Acting ends in a week` and `Acting ends tomorrow`; body for the acting person `You’re Acting Treasurer (North) until 13/12/2026.`; for the covered holder `Jet is acting as President (North) until 13/12/2026. You take the seat back on 14/12/2026.`
- `preparedBy` and `positionsOf` read held, with the long form; `isRc` reads duties.

- [ ] **Step 1: Write the failing tests:** one per Interfaces line, with these strings and the spec's (curly apostrophes), plus `a covered holder's title is unchanged`; `an acting and an elected Treasurer row never merge`; `reminders skip past times`; `the 11.2 finding doesn't fire when the Chair is a President` (the demo's Rusty); `meetingReport.test.ts:176 still gives one preparedBy`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement**, adding the title forms to `DESIGN.md` (long, chip, NEC row, the Home date on its own line); run `npm test`, typecheck and lint. Expected: PASS.
- [ ] **Step 4: Commit.**

### Task 16: Providers settle on a ticking `today`; acting actions

**Files:** Create `src/data/useClubToday.ts`. Modify `src/data/LiveClubProvider.tsx:127,136,143-205,258,462-478`, `DemoClubProvider.tsx:31-59`, `clubContext.ts:104`. Test: `src/data/providersSettle.test.ts`.

**Interfaces:**
- `useClubToday(): string`, re-read on `setTimeout(msUntilNextClubDay(now))` and on `AppState` `'change'` to `'active'` (as at `appUpdate.ts:35`).
- Both providers keep `raw` and expose `useMemo(() => settleActing(raw, today), [raw, today])`. The demo `ctx` (`:48`), `bindDemoLive` (`:47`) and `fresh()` (`:55`) read settled data; writing it back is the demo's lazy close. Live: `lapsedOwnRows` triggers `reload()`, and if that fails, `clubCache.clear()`.
- `ClubContext` gains `appointActing`, `requestCover`, `requestActing`, `withdrawActingRequest`, `confirmActing`, `setActingUntil`, `openActingVote`. Live does `db.rpc` behind the matching check; the demo uses the writers.

- [ ] **Step 1: Write the failing source test:** `both providers settle on the ticking today`; `useClubToday re-reads at the next club day and on foreground`; `a failed reload after a settle drops the saved copy`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement**; run the checks. In the demo web build, move the clock past an until date: the row closes without a reload.
- [ ] **Step 4: Commit.**

### Task 17: Screens: titles everywhere, Home's club-wide scope

**Files:** `src/ui/MemberBits.tsx:11-15,57-59`, `ChatBits.tsx:157-167`; `src/screens/members.tsx` (`:178-188`, `:208-213`, `:239`, `:415-437`, `:474-490`, `:633-707`), `me.tsx:90,116-118`, `deleteAccount.tsx:47-71`, `meetingReport.tsx:241`. Test: `src/screens/actingTitles.test.ts`.

- [ ] **Step 1: Read the craft floor.** Write the failing source test: `members.tsx gates alerts and the All chapters chip on seesEveryChapter, not level === 'national'`; `sortedPositions uses heldPositions`; `the NEC list renders necRows`; `RoleChip gets a position in MemberRow and AuthorLine`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement:** the Home header puts the date on its own line; the Chapters board lists use held rows and acting titles; `ChapterDetail` shows the acting subtitle; `MemberDetail` the long form; `StepDownButtons` reads `Step down from acting`; Me titles read held; Delete account lists acting seats; drop the pending markers.
- [ ] **Step 4: Check** (Crank, from Task 22): no title wraps to three lines. Then the checks.
- [ ] **Step 5: Commit.**

### Task 18: Screens: Manage member › Positions, TermActions

**Files:** Create `src/domain/actingCopy.ts`, `actingCopy.test.ts`; modify `src/screens/board.tsx:357-728`.

- [ ] **Step 1: Read the craft floor.** Write the failing tests:
  - The spec's Manage member strings (curly apostrophes): `appointChoices` (`'Acting'` the default for a board seat), `actingSeatLabel`, `whyLabel`, `replaceNote` (both forms) and `doneMessage`; plus `whyHint` `'Every member can read this. Keep health details out.'` and `untilHint` `'Last acting day. Up to 13/12/2026.'`
  - `termActionsFor(position, me, data)` gives `['Change date', 'Step down from acting']` for the acting person and `['Change date', 'Start a vote to end acting']` for another board member, never `Start removal vote`; `endActingQuestion` gives `'End Jet’s acting as President (North)?'`; `confirmText` repeats `actingWarnings`.
- [ ] **Step 2: Run**; FAIL. Then **implement** in `board.tsx`: the Choices pair with seats filtered by `actingProblem`; a `DateField` "Until" defaulting to `actingDefaultUntil`, and the required Why; `Acting until DD/MM/YYYY` on the Positions card; `Arrange cover (board vote)` on the away holder's page (`requestActing`, then `openActingVote`); the `:404`, `:412` and `:416` checks move to helpers; drop the markers.
- [ ] **Step 3: Check**, then run the checks. **Commit.**

### Task 19: Screens: the Board tab and "Attendance and terms"

**Files:** `src/domain/boardLayout.ts` and its test; `src/screens/board.tsx:147-352`, `attendance.tsx:166-207`.

- [ ] **Step 1: Read the craft floor.** Write the failing tests:
  - `requestLine` gives the spec's Board tab line; a voted request gives `'Crank asked for Jet to act as President until 13/12/2026: Smokey can’t be reached'`, whose button is `Start the board vote`, then `Confirm acting`.
  - `stintLine` gives the spec's two "Attendance and terms" lines; `stintTone` is `'warning'` within 7 days.
  - `scopeText`: `You sit on West’s board.` and `Each chapter’s board runs its own business.`; the club-wide first sentence is kept.
- [ ] **Step 2: Run**; FAIL. Then **implement:** the `Confirm cover` `ConfirmButton` shows where `confirmActingProblem` allows it; the `:186-190` text changes, and the `:154-155` and `:332-333` scopes use `seesEveryChapter`; BoardAttendance lists stints apart from terms.
- [ ] **Step 3: Check**, then run the checks. **Commit.**

### Task 20: Screens: Me and Home for cover

**Files:** `src/domain/meLayout.ts` and its test; `src/screens/me.tsx`, `members.tsx:173-330`.

- [ ] **Step 1: Read the craft floor.** Write the failing tests: `a board holder gets 'Arrange cover while I’m away'`; `standInChoices` gives `'Jet (VP)'` first (only the VP for a President); `the covered holder gets coveredNotice and an 'I’m back' ConfirmButton`; `a board of two gets the 8.6 refer-to-NEC line instead`.
- [ ] **Step 2: Run**; FAIL. Then **implement:** on Me, Choices, the DateField and the Why, with `coverNote` as the `ConfirmButton` note; on Me and Home, the notice and `I’m back` (`endPosition(cover.id)`); drop the markers.
- [ ] **Step 3: Check** in the switcher: Smokey asks for Jet, Crank confirms, Smokey sees the notice, then taps I'm back. Check, then run the checks. **Commit.**

### Task 21: Screens: audit, history, vote screens, reminders

**Files:** `src/screens/audit.tsx:204-262`, `history.tsx:159-240`, `business.tsx:741-,994-`, `src/data/reminders.tsx:66-70`; test `src/screens/actingScreens.test.ts`.

- [ ] **Step 1: Read the craft floor.** Write the failing source test: `reminders.tsx adds actingReminderPlan and its memo depends on data.positions`; `NewVote shows stintVoteWarnings; VoteScreen shows 'The stand-in and the holder shouldn’t vote on this (11.10).' on acting votes`.
- [ ] **Step 2: Run**; FAIL. Then **implement:** an `Acting` chip on Membership records' Positions; the `vp-fallback` button calls `appointActing` for the VP; the hall of fame leaves acting rows out, and the removal labels use the new `isRemovalVote`; drop the markers.
- [ ] **Step 3: Check**, then run the checks. **Commit.**

### Task 22: Demo seed p-19 (parallel with Task 16)

**Files:** `src/data/demoData.ts:977` (append after p-18, where `ago` is in scope), `src/data/demoFresh.test.ts:293-297,344,346`.

- [ ] **Step 1: Write the failing test.** Add `'positions.actingUntil'` to `PLANNED`; change `:344` to `16` and `:346` to `100`; add `p-19 is Crank, Acting Treasurer (North), 28 days each side of today`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Append `{ id: 'p-19', memberId: 'm-crank', chapterId: 'ch-north', role: 'treasurer', startedOn: ago(28), endedOn: null, actingUntil: ago(-28), actingWhy: 'No Treasurer since the ACM', covers: null, endedReason: null, appointedBy: 'm-smokey' }`. North has no Treasurer in the demo, so the seat is empty.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, every `DEMO_DATA` test included (re-check `meetingReport.test.ts:176`). **Commit.**

### Task 23: Strict source test, branch checks, paste-queue item

**Files:** `src/actingSource.test.ts`. Outside the repo, never committed: `/mnt/project-files/build/acting_roles.sql`, `/mnt/project-files/build/paste-queue.md`.

- [ ] **Step 1:** Remove the `// acting: pending` tolerance. Run `npm test`. Expected: PASS, no markers left.
- [ ] **Step 2:** Run `npm test`, `npm run test:db`, `npm run typecheck` and `npx expo lint`. Expected: all green. In the demo at 390×844, walk the spec's cover: Smokey asks for Jet, Crank confirms, North's board vote has three electors, Jet chairs, and Jet is North's NEC voter.
- [ ] **Step 3: Commit.**
- [ ] **Step 4:** Copy the migration to `/mnt/project-files/build/acting_roles.sql`; `cmp` shows no difference; record its `sha256sum`.
- [ ] **Step 5:** Append item 80 to `paste-queue.md`, and do not run it. It gives the path and sha256; "Run once (it drops and renames an index)"; "apply via Supabase MCP `apply_migration`, name `acting_roles`"; "before the app's over-the-air update"; and read-only checks: five new `positions` columns (`acting_until`, `covers`, `acting_why`, `acting_vote`, `ended_reason`) and their checks; the indexes `one_holder_per_board_seat`, `one_cover_per_board_seat`, `one_acting_per_member`; three views and two triggers; the new RPCs executable by `authenticated`, not `anon`; `close_lapsed_acting` and `lock_seat` not executable by `authenticated`; `select count(*) from public.positions where acting_until is not null` = 0; no open NEC vote has an elector with a null `for_chapter`.
