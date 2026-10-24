# Meetings and votes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board runs meetings (agenda, minutes, action items) and the club runs every kind of vote in the app, with the same rules in the demo and the database.

**Architecture:**
- **Rules:** pure functions in `src/domain/meetings.ts` and `src/domain/votes.ts`. They return a refusal message, or null when the action is allowed.
- **Database:** the same rules live in SECURITY DEFINER functions in one new migration, and the tables can't be reached directly.
- **App:** one read RPC, `club_business()`, feeds live mode. The demo keeps everything in memory through `demoActions`.
- **Parity:** shared cases in `parity.json` prove the demo and the database refuse with identical words.

**Tech Stack:**
- Expo SDK 58, React Native and React Navigation;
- Supabase Postgres (plpgsql);
- `node --test` through tsx.

**Spec:** `docs/superpowers/specs/2026-10-24-stage-5-meetings-and-votes-design.md`

## Global Constraints
- **Migration:** `supabase/migrations/20270101000000_meetings_votes.sql`. It only adds, and the word "drop" never appears in it.
- **Shared files** (`types.ts`, `labels.ts`, `liveData.ts`, `demoData.ts`, `database.types.ts`, `RootNavigator.tsx`, `navigation/types.ts`, `parity.json`, `clubContext.ts`): changes are added in one marked block (`// Stage 5: meetings and votes`). New `ClubData` fields are optional.
- **No tab bar changes.** Screens are reached from Home, Board and Manage member.
- **Dates and times:** dates are stored ISO and shown DD/MM/YYYY. Times are Melbourne time, as in `src/domain/rides.ts`.
- **No `Alert`.** Ballots, approving minutes and cancelling use `ConfirmButton`.
- **Fonts:** Rustnuts Stencil for titles, chips, buttons, numbers and dates. The body font is only for sentences and typed input.
- *(inferred)* values, kept as named constants in `votes.ts` and `meetings.ts`:
  - `MINUTES_DUE_DAYS = 14`;
  - `MAX_OPEN_DAYS = 60`;
  - `defaultQuorum(n) = floor(n / 2) + 1`;
  - unanimous means at least one yes and no "no" votes;
  - a majority tie goes to the chair's casting vote;
  - with no chair, a tie is lost.

## Refusal messages (identical in TS and SQL)
| Rule | Message |
|---|---|
| no session | `Sign in first.` |
| not approved | `Only approved members can do that.` |
| chapter scope, not its board | `Only that chapter’s board can do that.` |
| whole club, not NEC | `Only the NEC can do that.` |
| meeting title blank | `Give the meeting a title.` |
| no start | `Pick a date and time.` |
| nec kind with a chapter, or board kind with none | `That kind of meeting doesn’t fit here.` |
| agenda item title blank | `Each agenda item needs a title.` |
| meeting missing | `No such meeting.` |
| meeting cancelled (edit, minutes, cancel) | `That meeting was cancelled.` |
| cancel after start | `That meeting has already started.` |
| minutes approved (edit or approve again) | `Those minutes are approved and locked.` |
| approve before start | `The meeting hasn’t happened yet.` |
| approve blank minutes | `Write the minutes first.` |
| action title blank | `Give the action item a title.` |
| owner missing, not approved, Legacy, or outside the chapter scope | `Pick an approved member of this chapter.` (whole club: any approved non-Legacy member) |
| action item missing | `No such action item.` |
| tick by someone other than the owner or the scope's runners | `Only the owner or the board can tick this off.` |
| question blank | `Ask a question.` |
| electorate wrong for scope | `That electorate doesn’t fit here.` |
| empty electorate | `Nobody can vote in that electorate yet.` |
| quorum out of range | `` `Quorum must be between 1 and ${n}.` `` |
| closes in the past | `Pick a closing time in the future.` |
| closes more than 60 days out | `Votes can stay open for 60 days at most.` |
| patch subject isn't an approved FNG of the chapter | `A patch vote is for an approved FNG of that chapter.` |
| patch vote not chapter_patched plus unanimous | `A patch vote is unanimous, among the chapter’s patched members.` |
| vote missing | `No such vote.` |
| not an elector | `You’re not on this vote.` |
| voted already | `You’ve already voted.` |
| casting after close or past `closes_at` | `That vote has closed.` |
| close when already closed | `That vote has already closed.` |
| close too early | `Wait until it closes, or until everyone has voted.` |
| tie and no casting, or casting by a non-chair | `It’s a tie. The chair closes it with the casting vote.` |
| casting vote given without a tie | `There’s no tie, so no casting vote.` |

Check order for each action: session, then approved, then the target exists, then the scope's runners, then the field checks in the order listed.

## Review Focus
1. **A member changes chapter or status while a vote is open.** The electorate snapshot keeps their ballot. Test: someone set to Legacy after opening can still cast.
2. **A secret ballot read back through `club_business()` after closing.** The ballot list is empty and the counts are present. Test this in SQL.
3. **An all-abstain unanimous vote** (quorum met, zero yes). It is lost. Test in `votes.test.ts`.
4. **Closing early once everyone has voted, before `closes_at`.** It's allowed. Test in TS and in parity.
5. **A meeting just before midnight.** Minutes are due 14 Melbourne days later. The `minutesState` test uses `2026-11-03T12:30:00Z`, which is 23:30 on 03/11 in Melbourne, so they're due 17/11.

---

### Task 1: Types, labels and meeting rules
**Files:**
- Modify: `src/domain/types.ts`, `src/domain/labels.ts`.
- Create: `src/domain/meetings.ts` and `src/domain/meetings.test.ts`.

**Interfaces (produces):**
- Types:
  - `MeetingKind`, `AgendaItem {title, notes}`;
  - `Meeting {id, chapterId|null, kind, title, startsAt, location, agenda, minutes, minutesApprovedAt, minutesApprovedBy, cancelledAt, createdBy}`;
  - `ActionItem {id, meetingId, chapterId, title, ownerId, dueOn, doneOn}`.
- `ClubData` gets optional `meetings?`, `actionItems?` and `votes?`.
- Labels: `MEETING_KIND_LABEL`, `kindsFor(chapterId)`.
- `runsScope(me, chapterId|null, positions): boolean`, which is `isBoardOf` or `isNational`.
- `scopeRefusal(chapterId)`, which returns the right "Only …" message.
- `canSeeMeeting`, `canSeeMinutes` and `canSeeActionItem` (all `(me, x, positions) => boolean`).
- `minutesState(meeting, now): 'upcoming' | 'cancelled' | 'approved' | 'due' | 'overdue'`, plus `minutesDueOn(meeting): string`.
- Problem functions, each returning `string | null`:
  - `saveMeetingProblem(me, input: MeetingInput, existing, data)`, with `MeetingInput {id|null, chapterId, kind, title, startsAt, location, agenda}`;
  - `cancelMeetingProblem(me, meeting, data, now)`;
  - `saveMinutesProblem(me, meeting, data)`;
  - `approveMinutesProblem(me, meeting, data, now)`;
  - `actionItemProblem(me, input: ActionItemInput, data)`, with `ActionItemInput {id|null, chapterId, meetingId, title, ownerId, dueOn}`;
  - `setDoneProblem(me, item, data)`.

- [ ] **Step 1:** Write the tests:
  - each message in the table for meetings and action items;
  - a West VP runs West but not North;
  - Sam, with an NEC role, runs the whole club;
  - a member sees a general meeting but not a board meeting;
  - draft minutes are hidden from members;
  - `minutesState` covers the Review Focus case (due `2026-11-17`) and is overdue the day after.
- [ ] **Step 2:** `npm test`. Expected: it fails because the module is missing.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: it passes.
- [ ] **Step 5:** Commit: "Meetings: types and rules".

### Task 2: Vote rules and tally
**Files:**
- Create: `src/domain/votes.ts` and `src/domain/votes.test.ts`.
- Modify: `types.ts` and `labels.ts`, in the same block as Task 1.

**Interfaces:**
- Types:
  - `Electorate`, `Threshold`, `BallotChoice`, `VoteResult`, `Tally {yes, no, abstain}`;
  - `Vote {id, chapterId, meetingId, subjectMemberId, question, details, electorate, threshold, secret, quorum, openedAt, closesAt, closedAt, result, castingVote, tally|null, electorIds, votedIds, ballots: {memberId|null, choice}[], createdBy}`.
- Labels: `ELECTORATE_LABEL`, `THRESHOLD_LABEL`, `electoratesFor(chapterId)`.
- `electorsFor(electorate, chapterId, data): string[]`:
  - board-seat holders who are approved and not Legacy;
  - patched means approved with status full or nomad;
  - `nec` is `isNational`;
  - sorted.
- `defaultQuorum(n)`.
- `decide(threshold, quorum, tally, casting): { result: VoteResult; tied: boolean }`.
- Problem functions:
  - `openVoteProblem(me, input: VoteInput, data, now)`, with `VoteInput {chapterId, meetingId, subjectMemberId, question, details, electorate, threshold, secret, quorum, closesAt}`;
  - `castProblem(me, vote, now)`;
  - `closeProblem(me, vote, casting, data, now)`.
- `canSeeVote(me, vote, positions)`.
- `ruleLine(vote): string`, for example "Two-thirds of votes cast · Quorum 5 of 9 · Secret ballot".
- `chairOf(chapterId, positions): string | null`.

- [ ] **Step 1:** Write the tests:
  - every message in the vote rows;
  - `decide`:
    - majority 3–2 is carried;
    - two-thirds 4–2 is carried and 3–2 is lost;
    - unanimous 5–0 with 1 abstain is carried, 4–1 is lost, and all-abstain is lost;
    - under quorum is `no_quorum`;
    - a tie with no casting is `tied: true`;
    - a tie with casting `yes` is carried;
  - early close is allowed when `votedIds.length === electorIds.length`;
  - `electorsFor('chapter_patched', 'west')` leaves out FNG, Legacy and North members.
- [ ] **Step 2:** It fails. **Step 3:** Implement. **Step 4:** It passes. **Step 5:** Commit: "Votes: rules and tally".

### Task 3: Database
**Files:**
- Create:
  - `supabase/migrations/20270101000000_meetings_votes.sql`;
  - `supabase/tests/meetings_votes_test.sql`.
- Modify: `scripts/test-db.sh`, adding the new database block in the same shape as rides.

The SQL mirrors Tasks 1 and 2 using `private.is_approved_member()`, plus new helpers:
- `private.runs_scope(chapter uuid)`;
- `private.chair_of(chapter uuid)`;
- `private.electors_for(electorate, chapter)`.

The functions are the ones the spec names. `club_business()` returns `{meetings, action_items, votes}` in snake_case:
- each vote has `elector_ids`, `voted_ids` and `my_voted`;
- `tally` and `ballots` are null or empty while the vote is open;
- `ballots` is always empty for a secret vote.

Grants: `authenticated` executes the functions. Revoke all table privileges.

- [ ] **Step 1:** Write `meetings_votes_test.sql`, with asserts for the spec's database test list and the first two Review Focus lines.
- [ ] **Step 2:** `npm run test:db`. Expected: it fails because the functions are missing.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run test:db`. Expected: `ALL DATABASE CHECKS PASSED`.
- [ ] **Step 5:** Commit: "Meetings and votes: database".

### Task 4: Demo and live data, actions and parity
**Files:**
- Modify:
  - `src/data/clubContext.ts`;
  - `demoActions.ts`;
  - `DemoClubProvider.tsx`;
  - `LiveClubProvider.tsx`;
  - `liveData.ts` and `liveData.test.ts`;
  - `demoData.ts`;
  - `database.types.ts`;
  - `parityFixture.testkit.ts`;
  - `scripts/parity-sql.mts`;
  - `supabase/tests/parity.json`.
- Create: `src/data/business.test.ts`, covering the demo actions.

**Interfaces:**
- `ClubContextValue` gets:
  - `saveMeeting(input: MeetingInput): Promise<void>`;
  - `cancelMeeting(id)`;
  - `saveMinutes(id, text)`;
  - `approveMinutes(id)`;
  - `saveActionItem(input: ActionItemInput)`;
  - `setActionDone(id, done: boolean)`;
  - `openVote(input: VoteInput): Promise<string>`, returning the vote id;
  - `castBallot(voteId, choice)`;
  - `closeVote(voteId, casting: 'yes' | 'no' | null)`.
- Demo actions with the same names take `(ctx, …)` and return `ClubData` (`openVote` returns `{data, id}`).
- The demo stores secret ballots with `memberId: null`.
- `toBusiness(json)` in `liveData.ts` maps the RPC to `{meetings, actionItems, votes}`.
- New parity actions:
  - `saveMeeting`, `approveMinutes` and `saveActionItem`;
  - `openVote`, `castBallot` and `closeVote`.

  The fixture gets `meetings` and `votes`, the latter holding electors, who voted and the ballots.

- [ ] **Step 1:** Write the failing `business.test.ts`, the `liveData.test.ts` mapping test, and about 14 parity cases: each action allowed once, plus its most likely refusals.
- [ ] **Step 2:** `npm test` fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` and `npm run test:db` both pass.
- [ ] **Step 5:** Commit: "Meetings and votes: demo, live and shared cases".

### Task 5: Screens
**Files:**
- Create: `src/screens/business.tsx`, holding `BusinessScreen`, `MeetingScreen`, `EditMeetingScreen`, `VoteScreen` and `NewVoteScreen`.
- Create: `src/domain/business.ts`, with `businessFor(me, data, now)`. It groups everything for the Business screen and the Home row, and is tested in `business.test.ts`.
- Modify:
  - `navigation/types.ts` and `RootNavigator.tsx` (routes `Business`, `Meeting {meetingId}`, `EditMeeting {meetingId?, chapterId?}`, `Vote {voteId}`, `NewVote {chapterId?, meetingId?, subjectMemberId?}`);
  - `screens/members.tsx` (the Home row);
  - `screens/board.tsx` (the Board row, and the Manage member patch vote).
- Before editing: read `.claude/skills/impeccable` (its craft floor), `DESIGN.md` and the rides screens for patterns.

- [ ] **Step 1:** Write the `businessFor` tests:
  - ordering: needs-you first;
  - the Home summary line;
  - members don't get board items.
- [ ] **Step 2:** Run them and watch them fail. **Step 3:** Implement `businessFor`, then the screens.
- [ ] **Step 4:** `npm test`, `npm run typecheck` and `npx expo lint`.
- [ ] **Step 5:** Build the web preview and screenshot each screen at 390×844 in the demo build, as a member, a West board member and the NEC.
- [ ] **Step 6:** Run the Impeccable critique, audit and polish by hand, then fix what they find.
- [ ] **Step 7:** Commit: "Meetings and votes: screens".

### Task 6: Review and ship
- [ ] Have an independent reviewer (a fresh subagent) check the branch diff against the spec. Fix Critical and Important findings test-first.
- [ ] Update `PRODUCT.md` (Built so far), `DESIGN.md` if new patterns were added, and the lane memory.
- [ ] Rebase on `origin/main`, then run all four checks. Open the PR, subscribe to it, and report to Jeff.
- [ ] After merging, take the live slot in the Live log, apply the migration live (in parts if needed), and check `club_business()` as Jeff.
