# Meetings and votes (Stage 5, part A)

**Type:** architectural (new tables, new database actions, new screens). Claude approved this spec
on 24 Oct 2026 under the self-approval rule in AGENTS.md. Jeff can veto any of it.

## Stage 5 in four parts
Stage 5 (board and documents) is too big for one spec. It is split into four parts. Each part
gets its own spec, plan, tests and review, and they're built in this order:

1. **A: meetings and votes** (this spec): meetings, agendas, minutes, action items and votes.
2. **B: treasurer:**
   - the ledger, using the club's own CR/DB payment codes;
   - the Club, West and North funds and the monthly Treasurer's Report;
   - budgets;
   - a read-only view for the National Auditor.
3. **C: document library:** the constitution, Road Rules and bylaws, with versions, review dates
   and member sign-off.
4. **D: national level:**
   - chapter contributions worked out from member numbers;
   - setting up a new chapter;
   - term limits;
   - disciplinary records that delete themselves after 12 months.

The board's private chat belongs to Stage 3 (lane B), and notifications to Stage 6 (lane E).
Part A records what notifications will need (when minutes are due, when a vote closes) but sends
nothing.

## The constitution
The constitution isn't in the repo, the treasurer Drive or the project files, so Jeff has been
asked for it. Until it arrives, every rule below that should come from it is marked
*(inferred)* and kept in one place (`src/domain/votes.ts`, mirrored in SQL), so it is easy to
change. One rule comes from the code already: Full membership needs a unanimous vote of patched
members (5.4).

## Goal
- The board runs its meetings in the app:
  - it puts up the agenda;
  - it writes the minutes and approves them;
  - it hands out action items with an owner and a due date.
- Any vote the club takes happens in the app:
  - the right people get a ballot;
  - the quorum and the pass mark are checked;
  - a tied vote goes to the chair;
  - a secret ballot stays secret.
- Members see what concerns them: the votes they can cast, the meetings they can attend, the
  minutes once they're approved, and their own action items.

## Who's who
- **Scope.** A meeting or a vote belongs either to one chapter (`chapter_id`) or to the whole
  club (`chapter_id` null, run by the NEC).
- **Runs it:** for a chapter, that chapter's board (`isBoardOf`). For the whole club, anyone on
  the NEC (`isNational`).
- **The chair**, who has the casting vote: the sitting chapter President, or the National
  Chairman for the whole club *(inferred)*.

## Meetings

### Data
`public.meetings`:
- `id`.
- `chapter_id`, which is null for the whole club.
- `kind`, one of:
  - `board`: a chapter board meeting;
  - `general`: a members' meeting;
  - `agm`: the annual general meeting;
  - `special`: a special general meeting;
  - `nec`: an NEC meeting (whole club only).
- `title`, `starts_at` (timestamptz), `location`.
- `agenda`: a jsonb array of `{title, notes}`, kept in order. One field is enough, because the
  agenda is only ever edited as a whole.
- `minutes`: the draft text.
- `minutes_approved_at` and `minutes_approved_by`.
- `cancelled_at`.
- `created_by` and `created_at`.

`public.action_items`:
- `id`, `meeting_id` (may be null), `chapter_id` (null for the whole club).
- `title`, `owner_id` (a member) and `due_on` (date).
- `done_on` and `created_by`.

### Who sees what
- **Board and NEC meetings** are seen by the people who run that scope.
- **General, AGM and special meetings** are seen by every approved member, whatever the
  chapter. Before the minutes are approved, only the people who run the meeting see the draft.
  After that, everyone who can see the meeting can read them.
- **Action items** are seen by the people who run that scope, and by the item's owner.
- Applicants, the public and the anon key see nothing.

### Who does what
- **People who run the scope:**
  - create and edit a meeting;
  - cancel it, but only before it starts;
  - edit its agenda;
  - edit the minutes until they're approved.
- **Approving the minutes** is open to the same people, but only once the meeting has started.
  After approval the minutes are locked.
- **Action items** can be added by the people who run the scope. The owner can be any approved
  member of that scope who isn't Legacy. The owner, or anyone who runs the scope, can mark an item
  done or not done.
- **Minutes due:** 14 days after the meeting *(inferred)*. The Business screen shows "Minutes
  due" and "Minutes overdue" to the people who run the meeting.

## Votes

### Data
`public.votes`:
- `id` and `chapter_id`, which is null for the whole club.
- `meeting_id` (may be null) and `subject_member_id` (may be null; used for a patch vote).
- `question` and `details`.
- `electorate`, one of:
  - `chapter_board`: the chapter's board;
  - `chapter_patched`: the chapter's Full members and Nomads (whole club: not allowed);
  - `club_patched`: every Full member and Nomad (whole club only);
  - `nec`: the NEC (whole club only).
- `threshold`, one of:
  - `majority`: more yes than no;
  - `two_thirds`: yes is at least two-thirds of yes plus no;
  - `unanimous`: at least one yes and no "no" votes. Abstaining doesn't block it *(inferred)*.
- `secret` (boolean).
- `quorum`: the number of ballots needed for the result to count.
  - The default is more than half the electorate *(inferred)*.
  - It must be between 1 and the size of the electorate.
- `opened_at` and `closes_at`, which must be in the future and at most 60 days ahead.
- `closed_at`, `result` (`carried`, `lost` or `no_quorum`) and `casting_vote` (`yes`, `no` or
  null).
- The final `yes`, `no` and `abstain` counts, written when the vote closes.
- `created_by`.

`public.vote_electors`: `vote_id`, `member_id` and `voted_at`. This is taken when the vote opens,
so people joining or leaving afterwards don't move the goalposts. It records *that* someone voted,
never how.

`public.vote_ballots`: `id` (random), `vote_id`, `member_id` and `choice` (`yes`, `no` or
`abstain`).
- On a secret vote, `member_id` is always null, and a ballot can't be linked back to an elector
  through any column.
- On an open vote, `member_id` is filled in.

### Rules
- **Opening a vote** is for the people who run the scope, with an electorate that suits that
  scope.
  - The electorate has to have at least one person in it.
  - A patch vote must be about an approved FNG of that chapter, with `chapter_patched` and
    `unanimous`. The Manage member screen starts one.
- **Casting a ballot:** only electors can vote, once each, while the vote is open and before
  `closes_at`. A ballot is final.
- **Closing a vote** is for the people who run the scope, once `closes_at` has passed or every
  elector has voted.
  - Not enough ballots means `no_quorum`.
  - Otherwise the threshold decides.
  - **A majority vote tied yes and no** needs the chair's casting vote *(inferred)*.
    - Only the sitting chair can close it, giving `yes` or `no`.
    - Anyone else who tries is told: "It's a tie. The chair closes it with the casting vote."
    - With nobody in the chair, a tie is lost.
- **Results:**
  - While a vote is open, everyone who can see it sees how many have voted, out of how many.
    They don't see which way it's going.
  - After it closes, they see the counts and the result.
  - On an open vote, they also see who voted which way. A secret vote never shows who voted
    which way, to anyone in the app. No column links a secret ballot to its voter. Someone with
    raw database access could still try to match them by the order rows were written, so the
    database's admin access stays with Jeff alone.
- **Who can see a vote:** its electors and the people who run that scope.
- **What a vote does:** nothing by itself. A carried patch vote shows on that member's Manage
  member screen. The board still records the new status, as it does today.

## Plumbing (same pattern as rides)
- Direct table access is revoked for `anon` and `authenticated`, and row-level security is on with
  no policies. Everything goes through SECURITY DEFINER functions.
- **Reading:** `club_business()` returns one jsonb holding every meeting, action item and vote
  this person may see.
  - Draft minutes are left out unless the person runs the meeting.
  - Tallies are left out until the vote closes.
  - Open-vote ballots are left out until it closes. Secret ballots are never included.
  - It also gives `my_vote` (whether I've voted) and the electorate size and voted count.
- **Actions:**
  - `save_meeting(id, chapter, kind, title, starts_at, location, agenda)`;
  - `cancel_meeting(id)`;
  - `save_minutes(id, text)` and `approve_minutes(id)`;
  - `save_action_item(id, chapter, meeting, title, owner, due_on)` and `set_action_done(id, done)`;
  - `open_vote(chapter, meeting, subject, question, details, electorate, threshold, secret,
    quorum, closes_at)`;
  - `cast_ballot(vote, choice)`;
  - `close_vote(vote, casting)`.
- Each action refuses with the same words as the app's rule functions (`src/domain/meetings.ts`
  and `src/domain/votes.ts`). Shared cases go in `parity.json`.
- **Migration:** `supabase/migrations/20270101000000_meetings_votes.sql`. It only adds, and the
  word "drop" never appears in it.
- **App side:** new optional `ClubData` fields `meetings`, `actionItems` and `votes`. Demo data in
  `demoData.ts` and demo actions in `demoActions.ts` follow the existing pattern, each added in one
  block.

## Screens
These are reached from existing screens, since the tab bar belongs to lane B.
- **Home:** a "Club business" row when there's something for you:
  - "2 votes need you";
  - "Next meeting Tue 04/11";
  - "1 action item due".

  It sits under the board card and opens the Business screen.
- **Board tab:** a "Meetings and votes" row near the top that opens the same screen.
- **Business screen** (`src/screens/business.tsx`):
  - votes waiting on you, first;
  - open votes;
  - your action items;
  - upcoming meetings;
  - past meetings, marked "Minutes approved", "Minutes due" or "Minutes overdue";
  - closed votes.

  People who run a scope also get New meeting and New vote buttons, and a scope chip
  (chapter or All chapters).
- **Meeting screen:**
  - the kind chip, date and time in stencil, the place, and the agenda as numbered items;
  - the minutes: a big text box and Save for those running it, then a two-tap "Approve
    minutes";
  - action items with tick boxes, plus Add action item;
  - this meeting's votes.
- **Edit meeting screen:**
  - kind, title, date (DD/MM/YYYY), time and place;
  - the agenda items: add, edit, remove and move up or down.
- **Vote screen:**
  - the question and details;
  - a plain-words rule line, such as "Two-thirds of votes cast · Quorum 5 of 9 · Secret ballot";
  - a progress bar showing how many of the electorate have voted;
  - Yes, No and Abstain as big stencil buttons, each a two-tap confirm because the ballot is
    final;
  - after closing: the counts, a CARRIED or LOST stamp, and on an open vote, who voted which
    way.
  - People running it get "Close vote", plus Casting vote: Yes or No when the vote is tied and
    they're the chair.
- **New vote screen:**
  - the question and details;
  - the electorate as choices limited to the scope;
  - the threshold;
  - a Secret toggle;
  - the quorum, pre-filled;
  - the closing date and time.
- **Manage member:** for an approved FNG, a "Start patch vote" button. It opens New vote already
  filled in. The Stage 5 line under Status changes to show the latest patch vote's result.
- The usual rules apply: Rustnuts Stencil for titles, chips, numbers and dates; dates DD/MM/YYYY;
  Melbourne time; no Alert; `ConfirmButton` for anything final.

## Tests
- **`npm test`:**
  - the meeting and vote rule functions (each refusal);
  - the electorate builder;
  - tally and result, including quorum, each threshold, the tie, the casting vote and no chair;
  - minutes due;
  - the Business screen grouping;
  - the demo actions.
- **`npm run test:db`:** `supabase/tests/meetings_votes_test.sql`:
  - nobody can touch the tables directly;
  - who sees which meetings, minutes, action items and votes through `club_business()`;
  - every action allowed and refused;
  - the electorate snapshot;
  - a secret ballot can't be linked to a voter (no `member_id`, and no shared timestamp with
    `vote_electors`);
  - the close results.
- **`parity.json`:** cases for opening, casting and closing votes, saving and approving minutes,
  and action items, run against both the demo and the database.
- **Screens:** the changed screens at 390×844 in the demo build, plus the Impeccable critique,
  audit and polish passes.

## Not in this part
- Notifications for agendas, minutes or votes (Stage 6).
- The board chat (Stage 3).
- Proxy votes.
- Attaching files to minutes (that comes with the document library, part C).
- Meeting attendance (Stage 4's check-in).
- AI-written minutes (Stage 7).

## Constitution alignment (24 Oct 2026)

Jeff sent the constitution (29 Jul 2026 draft, in the project files at `reference/Rustnuts SMC Constitution 2026-07-29.pdf`) but can't yet confirm it's the current one. The rules now follow it:

- **Minutes (10.8):** due 7 days after the meeting, not 14.
- **Electorates:**
  - Nomads vote on national matters only (10.7). `chapter_patched` is the chapter's Full Members, and `club_patched` is every Voting Member (Full and Nomad).
  - The NEC has one vote per chapter, cast by its President (11.2). The National Chairperson only breaks a tie.
- **Default quorum:** a third of voters, rounded up, for chapter and national votes (10.6). The NEC needs 51% (11.5). A board needs more than half (inferred).
- **Unanimous (4.9):** every elector must vote yes, so an abstention or a missing ballot stops it.
- **Patch votes (4.7, 4.9):** always secret and unanimous. They can't open before nine months into the trial, though a start date nobody recorded doesn't block one.
- **Chair (10.9):** the President, then the Vice President. With no chair, a tie is lost (9.10).

**After review:**
- When a chapter's President chairs the NEC, that chapter's NEC vote passes to its Vice President (11.2).
- A quorum below the constitution's minimum is refused.
- A closed patch vote keeps no counts and no ballots, only the result (4.9).
- The nine-month date clamps to the month's end, the same way in the app and the database.
- During a handover, the newer seat-holder chairs (9.8).

**Not covered yet:**
- The 51%-of-chapters part of the national quorum (10.6).
- Who conducts a patch vote: any board member can open one, rather than only the President (4.8).
- Changing an FNG to Full on Manage member isn't tied to a carried patch vote.
- A President of two chapters casts a single NEC ballot.

## Constitution v4 (25 Oct 2026)

Jeff sent v4, the Final Club Edition (`reference/Rustnuts SMC Constitution v4 2026-10-25.pdf`). It replaces the 29 Jul draft, which is now in `reference/superseded/`. Bounded change, self-approved. It's built in `20270101000100_constitution_v4.sql` (min_quorum, open_vote, close_vote, club_business), with no change to any signature.

- **Board quorum (8.5, new):** a majority of the board's distinct members, with at least three taking part. A board of fewer than three can't hold a vote: "A board vote needs at least three board members (8.5)." The vote form says so in place of the quorum field.
- **Ties (9.10):** the chair may give the casting vote or decline, and a declined tie is lost. `close_vote` takes `'decline'` as well as yes and no, and stores no casting vote for it. Closing a tie with nothing passed is refused for everyone, the chair included, so the chair always makes a deliberate choice: "It’s a tie. The chair gives a casting vote or lets it fall." The chair's card has "Close with casting vote" and "Let it fall".
- **Minutes (10.8):** draft minutes go to everyone who sees the meeting once it's been held, marked as a draft. The board then confirms them at the next meeting, and the screens say "confirm" rather than "approve". Board and NEC meeting minutes still stay with whoever runs them. Notes saved before the meeting stay with the board.
- **Unchanged and still right under v4:** a third for chapter and national quorums (10.6), 51% of the NEC (11.5), Nomads off chapter votes (10.7), the NEC vote cast by a chapter's sitting or acting President with the Chairperson voting only on a tie (11.2), patch votes (4.7–4.9), the chair order (10.9), and abstentions not being votes cast (2.4).

**Not covered yet (v4):**
- The 51%-of-chapters part of the national quorum (10.6).
- The National Chairperson conducting a patch vote when the President can't (4.8).
- Good Standing as a condition of voting (2, "Club Voting Member").
- Conflicted people left out of a vote and its quorum (8.5, 11.10).
- No casting vote on elections, discipline or amendments (9.10, 10.7). Votes have no purpose field yet, so every vote is treated as ordinary business.
- Thresholds counted against everyone eligible rather than votes cast (16.2, 14.4A).
- Confirming minutes isn't tied to the next meeting having been held.

