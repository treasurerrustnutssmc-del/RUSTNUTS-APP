# The five audit decisions: design

29 October 2026. Jeff tapped these on the decision cards in the "Audit the whole app before launch" thread. The audit report is at https://claude.ai/artifact/DoyESGsD1JBXpd72VxXaNi (findings M3, M5, M6, L2, L5). Classified as architectural: it changes the board helper every policy leans on and adds a vote shape and a record table. Approved by Claude under Jeff's standing rule of 24 Oct; Jeff can veto any line of it.

Two pull requests, each with one migration, its tests and a paste file for the live database:

- **PR 3, who sees what:** M3 (chapter powers), M6 (open proposals and contributions), L5 (attendance and sign-ups). Built; the "As built" section at the end records where it differs from the first draft.
- **PR 4, who can act:** M5 (ending a term), L2 (the 5.5 gate). To build.

Every rule lives twice, as always: `src/domain/*.ts` for the app and `supabase/migrations` for the database, with the same words.

## PR 3: who sees what

### M3. See all, act in own chapter

Before this change `private.is_board_of(chapter)` (and `isBoardOf` in the app) was true for a seated board member of that chapter **or anyone national** (a sitting President, the National Chairman, the National Secretary). The decision splits it in two:

- `private.sees_board_of(chapter)`: a seated board member of that chapter, or anyone national. This is the old meaning, kept for **reading**.
- `private.is_board_of(chapter)`: a seated board member of that chapter only. Used for **acting**.

What switches to `sees_board_of` (reads):

- The ten row-level read policies that use it: `members_read`, `private_read`, `emergency_read`, `bikes_read`, `regos_read`, `attendance_read`, `attendance_exemptions_read`, `big4_waivers_read`, `member_decisions_read`, `status_notices_read`.
- The read helpers `private.sees_conduct`, `private.reviews_chapter` (the chapter's records, with the Auditor), `public.shared_phones`, and the board-chat rule in `private.chat_problem` (national roles keep reading and posting in every board chat, as before).
- Scope reads. `private.runs_scope(chapter)` decides who **runs** a scope (opens meetings and votes, proposes and decides merch). Reading a scope's business, votes and draft merch is a separate question, so a new `private.sees_scope(chapter)` answers it: the NEC for the national scope, `sees_board_of` for a chapter. `private.reviews_scope` (the Auditor's view) and the merch read helpers `private.sees_merch_item` and `private.sees_merch_order` move onto it. A West President still sees North's draft merch and board-only business; only North's board can act on them.

What keeps `is_board_of`, which now means the seated board only (acts): approving and declining applicants, recording application and FNG review decisions, changing a member's status, giving and closing 5.5 notices, recording conduct and setting hearings, the board side of lodging an appeal, marking attendance and excusing it, Big 4 waivers, running a chapter's check-in, opening meetings and votes in a chapter's scope (`private.runs_scope`), proposing and deciding merch, moderating a chapter or board chat, seating people in chapter roles, and ending terms.

Unchanged: national powers stay on `private.is_national()` (Big 4 designation, national votes and reinstatement, Road Rules, audits, proposals, contributions), and club-wide keeping stays on `private.is_any_board()` (sponsors, history, awards, listings, the bus).

One act is national rather than the chapter's and has to be checked first: bringing a Supporter, Family or Legacy member back to Full or Nomad (5.6). `set_member_status` and `statusChangeProblem` test for that move before the chapter-board gate, so a National Chairman without a seat in that chapter can still record a reinstatement after the carried NEC vote. Every other status change is the chapter board's (8.2).

In the app, `isBoardOf` becomes seated-only and a new `seesBoardOf` carries the old meaning, with `seesScope` and `reviewsScope` beside `runsScope` in `src/domain/meetings.ts`. Each call site is classified the same way: `canSeePhone`, `canSeePrivate`, `canSeeMember`, `reviewsChapter`, `seesConduct`, `seesBig4Records`, the board-chat read, the Attendance screen's chapter list and behind-count and the Manage member screen itself (`canManageMember`) use `seesBoardOf`; everything that changes a record uses `isBoardOf`. Manage member stays open to the national roles because their own acts live on it (the 5.6 reinstatement vote and record, the Auditor's and National Secretary's NEC votes, national seats); the chapter's acts on it refuse them with the chapter board's words.

Messages, the same in both layers: a national role acting in another chapter is told "Only that member's chapter board can do that." (conduct, merch, votes), "Only that chapter's board can change this member's status.", "Only their chapter's board can excuse them.", "You can only remove your own messages." (chat). Setting a hearing says "Only the board, apart from whoever recorded it, can set up the hearing."

What it means for people: Jeff holds Treasurer seats in both chapters, so nothing changes for him. Roger (West President) keeps seeing North's board data (private details, conduct, notices, board chat, draft merch) but can no longer approve or decline North applicants, change a North member's status, give notices, record conduct, excuse Big 4s, mark attendance or end North terms. The National Chairman and Secretary likewise.

### M6. Board and NEC while open

`public.club_admin()` filters two lists:

- Chapter proposals: everyone sees a proposal once it is decided or withdrawn; while it is still `proposed`, only chapter boards and national roles (`private.is_any_board()`), whoever put it forward and the named founders see it (a founder has to be able to see and withdraw their own proposal).
- National contributions: everyone sees a contribution once settled or withdrawn; while `proposed`, only chapter boards and national roles.

The National Auditor is not a board and does not see open proposals or contributions; the Auditor's work is the decided record (13.8).

The app mirrors it with `visibleProposals(me, data)` and `visibleContributions(me, data)` in `src/domain/national.ts`, used by the National screen and the admin rows on Home, so the demo build shows exactly what the live build does.

### L5. Own record plus board

- **Meeting check-ins become private.** The `attendance` read policy becomes: your own rows; `sees_board_of` your chapter; the Auditor; and any approved member for **ride** check-ins. Ride check-ins stay visible because badges, ride walls and "who rode" are built on them; meetings are the record 5.5 is about.
- **Profiles show badges, not counts.** The "Turned up" card (meetings and rides this club year) shows on your own profile and to the board of your chapter and the Auditor (`canSeeAttendance(viewer, target, positions)`, which is own-or-`reviewsChapter`); other members see the badges only. The Attendance screen itself (the board's list) is gated by `seesBoardOf`, so national roles keep reading it.
- **Hub and charity sign-ups: own, board and the ride's organisers.** `hub_registrations` and `charity_signups` read policies become: your own row; `private.manages_ride(ride)` or `private.runs_charity(ride)`; `sees_board_of` the member's chapter. The Auditor is not on that list. Everyone still sees the numbers: a new `public.signup_counts()` returns, per ride, the hub counts (riders, pillions, staying as a group, own tent, camping, day riders, and the group beds taken, where a pillion counts as a second bed) and the charity counts (riding, pillions, guests, helping, and the people on the day, which is every rider, every pillion and every guest including the helpers' guests), leaving withdrawn rows out. In the app `hubCounts`, `charityCounts`, `groupBedsTaken` and `placesTaken` read the counts row (`data.signupCounts`) and fall back to the rows the viewer can see; the name lists and the share buttons show only to those who can see the rows (`visibleRegistrations`, `visibleSignups`). The demo holds every row, so its counts come straight from the rows; both builds show the same numbers. The live loader tolerates a database without the function (the app works before the paste is live; it just shows what the rows allow).
- **Unchanged:** invites to and from other clubs and the other-clubs list. Their spec of 29 Oct chose every approved member on purpose, and an invite is club business, not a personal record. Attendance exemptions, Big 4 waivers and 5.5 notices were already own-plus-board.

## PR 4: who can act

### M5. Vote to remove, free to resign

Constitution 9.3: an elected Chapter Board holder is removed by a two-thirds vote of eligible Full Members at a notified, quorate chapter meeting; a Non-Board holder by a majority Chapter Board vote. Resignation is free.

- `votes.subject_role` (added in PR 2 for the Auditor and Secretary seats) widens to any position role. Its meaning follows the electorate: an NEC vote about a national seat is an appointment (11.6, 11.8); a chapter vote about a chapter role is a removal (9.3). Nothing else has a role on it.
- `open_vote` accepts a chapter vote with a Full or Nomad subject who holds `p_role` in that chapter: a board seat (President, Vice President, Secretary, Treasurer, Sergeant-at-Arms, Road Captain) needs `chapter_patched` and `two_thirds`; any other chapter role needs `chapter_board` and `majority`. The chapter's board opens it, as for every chapter vote.
- `private.has_carried_removal_vote(p_position)`: a carried vote of the right shape about that holder and role in that chapter, closed in the last 90 days and after the term started.
- `end_position`: your own term ends when you say so (resignation), except the honours the admin records (Founder) and the National Chairman's seat (changes after the vote). Ending someone else's term: national roles by the Chairman, as now; a President after a carried two-thirds chapter vote, recorded by that chapter's board or a national officer; any other board seat after a carried two-thirds chapter vote, recorded by that chapter's board; any other chapter role after a carried board majority vote, recorded by that chapter's board. A term that simply expires (two years, 9.2) is not in the app and stays that way.
- App: `endTermProblem` mirrors it; `removalVoteFor(position, votes)` finds the vote; the Manage member screen shows "Step down" on your own seats, and for others "Start removal vote" (opens New vote with the subject, seat and electorate preset and the question "Remove Jo Bloggs from the West Secretary seat? (9.3)") or "End term" once a carried vote exists. The vote list shows a "Removal vote" chip.

### L2. Gate, with a by-request exception

- A new `status_changes` table records every status change a board makes: member, chapter, from, to, `by_request`, the 5.5 notice relied on (when any), who changed it and the club date. Read by the member, `sees_board_of` their chapter and the Auditor; written only by `set_member_status`.
- `set_member_status(p_member, p_status, p_by_request boolean default false)`: moving an FNG, Full Member or Nomad to Supporter needs a 5.5 notice about them that the board has decided (outcome `decided`) in the last 90 days, unless `p_by_request` is true. The change is recorded either way. Every other move is as today.
- App: `statusChangeProblem` takes `byRequest`; the Manage member screen shows an "At the member's request" checkbox only for that move, and a line under the status with the last recorded change ("Supporter since 12/10/2026, at their request" or "after the 5.5 notice of 28/09/2026"). `ClubData.statusChanges`, the live loader, the demo action and the database types follow.

## Tests and checks

- Database: `supabase/tests/audit_decisions_test.sql` (PR 3: the helper split, a West President reads North's records and draft merch but every North action refuses them, reinstatement stays the NEC's, the proposal and contribution filters per role, the attendance and sign-up policies, `signup_counts`) and `supabase/tests/removal_and_gate_test.sql` (PR 4: resignation, removal vote shapes, the 90-day window, the 5.5 gate with and without the box, the `status_changes` rows). Shared demo/database cases in `supabase/tests/parity.json`: the five cases that had national roles acting inside another chapter now refuse, and PR 4 adds the new `open_vote` shapes and `set_member_status`. Existing tests that had national roles acting inside other chapters are updated to the new rule (a seated board member does the act instead).
- App: tests beside each domain function; `npm test`, `npm run typecheck`, `npx expo lint`.
- The audit's 21-persona who-sees-what matrix is re-run on the new schema and the diff goes in each pull request.
- The changed screens (Manage member, Members profile, National, ride hub and charity pages, Attendance, Meetings and votes) are checked at 390×844 in the demo build.

## Live database

Two paste files for Jeff, after `audit-fixes.sql` (item 31): `audit-decisions.sql` (PR 3, item 32) and `removal-and-gate.sql` (PR 4), both additive apart from the policy and function rewrites, no data deleted, safe to run once. Each pull request merges only after its paste is live, because the preview channel updates from `main` on every merge and the app would call a function the database does not have yet.

## As built (PR 3)

Where building PR 3 changed the first draft:

- **`sees_scope`.** Moving `is_board_of` to seated-only made `runs_scope` seated-only too, which would have hidden other chapters' board-only business, votes and draft merch from national roles. The new `sees_scope` / `seesScope` (and `reviews_scope` / `reviewsScope` on top of it) keep those reads where the decision put them.
- **Reinstatement first.** `set_member_status` checked the chapter-board gate before the 5.6 gate, which would have stopped an NEC officer without a seat in that chapter from recording a reinstatement. Both layers now test for the 5.6 move first.
- **Hearing message.** "Only the board, apart from whoever recorded it, can set up the hearing." replaces the old wording in both layers.
- **Attendance screen.** The board's Attendance screen reads with `seesBoardOf`; the excuse button still acts with `isBoardOf`, and a member's row opens Manage member only when the viewer can manage them.
- **Counts.** `signup_counts` returns `hub_group_beds` (a pillion is a second bed) so the hub's "beds left" works for members who no longer see the rows, and the charity `people` figure counts every rider, pillion and guest, the same as the app's `onBikes`.
- **The Auditor** does not see open proposals and contributions or hub and charity sign-up lists; the decided record and the counts are enough for 13.8.

## As built (PR 4)

Where building PR 4 changed the first draft:

- **Order of the gates.** `set_member_status` and `statusChangeProblem` test the 5.5 gate last, after "End their positions first." and the Nomad seat check, so a member who still holds a seat hears about the seat, not the notice. The NEC's 5.6 branch never moves anyone to Supporter, so the gate sits in the board's branch alone.
- **Resignation and the Chairman's seat.** `end_position` and `endTermProblem` refuse the Chairman's seat and the Founder honour before they look at who is asking, so the Chairman can't end his own seat in the app either; everyone else steps down from their own role, national seats included.
- **Removal votes keep their count.** `close_vote` blanks the count and ballots only for a patch vote (a `chapter_patched` vote about a member that names no role). A removal vote of the chapter's Full Members keeps its tally like any other vote. The patch and reinstatement helpers (`has_carried_patch_vote`, `has_carried_reinstate_vote`, `patchVoteFor`, `reinstateVoteFor`) look only at votes that name no role, so a removal vote about a member can't stand in for either.
- **The vote's subject.** A removal vote is about a Full Member or Nomad who holds that role in that chapter; the member's home chapter isn't checked separately, the position is. `votes_subject_role_check` now excludes only `founder` and `nec_chair`.
- **Wording on screen.** The New vote question reads "Remove Jo Bloggs as West Secretary? (9.3)". The by-request control is a toggle ("At the member's request"), shown only when the chosen status is Supporter and the member is an FNG, Full Member or Nomad; a line above it names the decided 5.5 notice when there is one. Manage member lists the last five recorded status changes ("29/10/2026: Full to Supporter at their request, by Torque."). The holder's own profile shows "Step down as Tail Gunner" for each role they hold; Manage member shows "Step down" to the holder and "End term", "Start removal vote", "See the removal vote" or "See the result" to the chapter board. The Vote screen's chip says "Removal vote", and a carried one offers "End Jo Bloggs's Secretary term".
- **Readers of the record.** `status_changes` is read by the member, `sees_board_of` the chapter recorded on the row (the member's chapter at the time) and the Auditor; the live loader reads it with the notices. `set_member_status` takes `p_by_request` and the old two-argument form is dropped, so there is one.
- **Fixture.** The shared parity fixture gains a decided 5.5 notice for Gravel (`gravel-decided`, about dues, decided 40 days ago) so "Board moves a member to Supporter after a decided 5.5 notice" stays allowed on both sides, and the board's cases for Hal and Finn cover the gate with and without the request.

