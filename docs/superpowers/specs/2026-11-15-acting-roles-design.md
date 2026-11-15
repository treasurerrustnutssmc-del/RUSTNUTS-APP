# Acting in a role, until a date

Date: 15/11/2026 (second draft, after two independent reads; Jeff picked both kinds). Kind: architectural (new columns on
`positions`, two small tables, the seat index swapped for a pair, about 45 database helpers sorted
into four readings, and the app split the same way). Spec, then a plan in `docs/superpowers/plans/`.

Approval: **needs Jeff's yes on the money and member-data parts** (the Club fund, approvals, who
sees every chapter's private details), as AGENTS.md says. Claude approves the rest under Jeff's
24 Oct rule, and Jeff can veto any call below. Jeff asked on 15/11/2026: "can we add an 'acting'
for a role if someone is only doing a role short term?" On his card the same day he picked **both
kinds**: "Someone can act for a holder who's away (the holder keeps the seat), or fill an empty
seat for now." So this spec builds both. The empty-seats-only cut is kept below as the fallback.

## Intent and why

A President goes overseas for six weeks, a Treasurer has surgery, a seat falls empty mid-term.
Today the app knows only full terms. To cover, the board has to end someone's term (a 9.3 removal
vote unless they step down) and seat a new holder for two years. Nobody can see the cover is
temporary, and nothing ends it. The constitution already has acting:

- the VP "acts where the President is absent, unavailable or conflicted" (8.2);
- "A small chapter may temporarily combine compatible duties where necessary, with reasons and
  review recorded" (9.5);
- "An internal Chapter Board may fill a casual vacancy temporarily until the next eligible meeting
  or election" (9.8);
- "A Vice President participates as a Chapter President only while formally acting in that
  office", and each chapter votes on the NEC "through its sitting or acting President" (11.2).

## Goals

1. Put someone in a role as acting, with an "until" date (the last acting day, inclusive), and a
   one-line reason.
2. They show as "Acting <Role>" with the date wherever a title shows.
3. While acting they do the role's duties. Board ballots, quorum and approvals still count distinct
   people (8.1, 8.5, 13.3), and a chapter still has one NEC vote (11.2).
4. It ends on its own after the date with no scheduled job, and the app and database agree on the
   Melbourne day. The acting person can step down and an away holder can say "I'm back" at any
   time. Anyone else needs a board vote to end it early.

## Non-goals

- The acting chair of one meeting (10.9). Acting in national seats, Founder or honour titles.
- Acting across chapters (9.5 needs NEC approval, and appoint still refuses other chapters).
- **The 11.2 Chair-and-President vote.** "Where the Chairperson also holds a Chapter Presidency,
  the chapter's ordinary vote is cast by its acting President" describes a standing arrangement
  for as long as the Chair is a President, not a short stint. It becomes its own small follow-on
  (a "Casts West's NEC vote" designation, chosen by West's board, with no end date, worked out
  when a row is read). Until then the VP fallback stays exactly as it is (`votes.ts:123-127`). It
  works the same with or without covers.
- The 8.6 referral, where a board without quorum sends the matter to the NEC. A chapter with fewer
  than three board members can fill an empty seat as acting, but can't arrange a cover in the app.
  The panel says to refer it to the NEC (8.6).
- Relabelling 17.6's cross-chapter temporary Treasurer arrangement.

## Anti-goals (what must not happen)

- **Acting as discipline.** No cover on a sitting holder without their agreement or a carried
  board vote, and the holder can always end a cover of their own seat. A concern about someone is
  a 14.5 restriction or a 9.3 removal vote, never a cover.
- **One person alone reshaping who decides.** No officer, chapter or national, picks a stand-in
  alone over a sitting holder. NEC officers never pick anyone's Acting President.
- **Extra voters.** A cover never gives anyone a board ballot they didn't already have. One
  chapter never has two NEC votes or two NEC seats.
- **Two sets of office duties.** One seat never has two people chairing, two people keeping the
  books, or two NEC voters.
- **A lapsed stint keeping power** because one check was missed, a vote was already open, the row
  wasn't closed yet, or the phone stayed open past midnight.
- **A back door** past a two-thirds NEC vote (11.6, 11.8), past a 9.3 removal vote, past the 11.8
  Auditor separation, or into a permanent seat with no election (9.2, 9.8).
- **Any change to a sitting holder's powers at go-live**, beyond the three tightenings listed under
  "Rules tightened for everyone".

## Two kinds of acting

- **Empty seat (9.8).** Nobody holds the seat. The acting person is its only holder until the
  date, or until someone is elected to it. Board seats and non-board roles alike.
- **Cover (8.2, 9.5, 11.2).** Board seats only. The holder stays seated, keeps the title, the term
  clock, and everything that comes with being on the board. Someone **already on that chapter's
  board** takes over the seat's own duties until the date. Because the stand-in is already a board
  member, nobody gains a ballot and nobody loses one.

Non-board roles (Tail Gunner, Officer, committees) can have several holders, so they have no
covers. Acting there is a short appointment with an end date.

## The four readings of a seat

Every check that reads `positions` uses one of four readings. Each is written once in the
database (`private` views) and once in the app (`src/domain/acting.ts`), and the two mirror each
other.

| Reading | What it is | What reads it |
|---|---|---|
| **Held** | Open rows whose stint hasn't lapsed | Titles, eligibility (`hold_problem`), "end their positions first", history |
| **Board member** | A distinct person with a held board row in the chapter, covered or not | Board ballot and quorum (8.1, 8.5), acting as the board (`is_board_of`), board records, chapter-fund approvals (13.3), board notifications, ride leader |
| **Duties** | Held rows, minus any row a live cover points at | Chairing and the casting vote (`chair_of`), the NEC seat and vote (`nec_voter_for`, `is_national`), the chapter's books and fees (`keeps_books(chapter)`, `can_manage_fees`), every other check naming one role (Road Captain, Tail Gunner, committees) |
| **Club-wide** | Duties rows that aren't acting | Every chapter's private details (the national branch of `sees_board_of`), the Club fund's books (any chapter Treasurer, inferred) and approvals (sitting Presidents), the shop (`shop_seat`) |

What this means for each person:

- **The away holder (covered).** Keeps the title, the term, the board ballot and quorum place,
  chapter-fund approvals and board records, so they stay at the "board" access level. Pauses the
  seat's own duties and anything club-wide. A covered President is off the NEC until the cover
  ends.
- **The stand-in (cover).** Was a board member already and stays one, with no second ballot (8.1,
  9.5). Gains the seat's duties for their own chapter only. An Acting President chairs and has the
  casting vote on tied board motions (9.10; 10.9: "procedural and casting authority but no extra
  ordinary vote"), and sits on and votes on the NEC (11.2). An Acting Treasurer keeps the chapter's
  books.
- **Acting in an empty seat.** Holds the seat (9.8), so becomes a board member for a board seat,
  as a full appointment would today. Gets the seat's duties for their own chapter only.
- **Nobody acting reaches club-wide.** No acting row keeps the Club fund's books, approves Club fund
  spending, runs the shop, or opens other chapters' private details (emails, licences, emergency
  contacts). An Acting President does take part in NEC business, which means NEC meetings, votes
  and national events. A screen that assumes "national" means "can see private details" must ask
  `canSeePrivate`. The plan lists every `is_national` caller (24 migration files) and marks each one
  as NEC business or member data.

In the database, `private.held_positions`, `private.duty_positions` and
`private.clubwide_positions` are views. `held` is `ended_on is null and (acting_until is null or
acting_until >= private.club_date())`. Helpers are STABLE and row-level security calls them per
query, so a stint lapses at Melbourne midnight. Composite helpers (`runs_scope`, `sees_scope`,
`require_books` and the rest) inherit their reading unedited. In the app, `activePositions` keeps
its name and becomes the duties reading. `holdsBoardSeat`, `electorsFor`'s board branch,
`approvesFor`'s chapter branch and `isRideLeader` move to `heldPositions`. `seesBoardOf`'s national
branch, `keepsBooks(null)` and `approvesFor(null)` move to `clubwidePositions`.

## Who may act

Refused for everyone, with the same words in `actingProblem` (app) and `private.acting_problem`
(database):

- Not a chapter role: national seats, Founder and honour titles.
- `hold_problem` (only Full and Nomad members; Nomads only in non-board roles; the Auditor can't be
  President or Treasurer, 11.8).
- Already holding that role, or a stint already running or requested in that seat.
- **One stint at a time**: someone already acting anywhere, and anyone whose own seat is covered.
- **Chair and books stay apart**: no Acting President who holds any Treasurer row in the chapter,
  acting or elected, and no Acting Treasurer who holds a President row (9.5 "compatible duties",
  inferred).
- Members on hiatus, for Road Captain, Tail Gunner and Assistant TG ("Members on hiatus can't lead
  rides", as `crew.ts:35`).
- A cover's stand-in must hold a board seat in that chapter. For a President that means **the
  sitting VP**. Anyone else on the board needs a carried board vote, unless the chapter has no VP
  with duties (8.2, 10.9).
- An empty-seat Acting President who isn't the sitting VP needs a carried board vote while the
  chapter has a VP with duties, for the same reason.
- A required "Why" of up to 120 characters ("Smokey overseas", "No Treasurer since the ACM"),
  stored on the row and shown on the Board tab and in the audit. This is 9.5's "reasons recorded",
  and the until date is its review.

Shown as warnings, like `appointWarnings` (`access.ts:288-308`), and repeated in the confirm text:

- 9.6 on every board-seat stint: "Immediate family can't sit on the same board, including the
  person they cover, without a two-thirds written exemption (9.6)." The app doesn't record family,
  so this can only warn.
- 9.1 (two years Full) for an empty-seat stand-in not already on the board. 9.4 (a full term in
  another seat) only for an empty-seat Acting President or VP who isn't the sitting VP. Acting
  isn't a nomination, and a VP acting under 8.2 is exactly what 8.2 describes.
- 9.7 in the cover flow: "If their licence is suspended or cancelled, the seat is vacant (9.7):
  fill it as an empty seat."
- A ride the stand-in is crewed to lead that starts on the until day, or runs past its midnight:
  "Crank leads the 13/12 run. Acting ends that night. Pick 14/12 or later."

## How a stint starts

Every route takes a seat lock and runs the lazy close first (see below).

1. **Empty seat, recorded by the board.** `appoint_acting(p_member, p_chapter, p_role, p_until,
   p_why)`. Any board member of the chapter who isn't the stand-in can record it, for board seats
   and non-board roles alike, including President. 9.8 gives casual vacancies to the chapter board,
   so the NEC officers have no part. This is the same trust a full appointment to an empty seat has
   today (`audit_fixes.sql:242`), so it adds no new power. It starts today.
2. **Agreed cover.** The away holder asks from their own Me page:
   `request_cover(p_member, p_until, p_why)`, naming the stand-in. That creates an
   `acting_requests` row and nothing moves yet. A board member who is **neither the holder nor the
   stand-in** then confirms it with `confirm_acting(p_request)`, which inserts the acting row (8.2:
   the board acts collectively). Agreed covers of a President need the sitting VP as stand-in, or
   route 3.
3. **Voted.** For a cover when the holder can't be asked (in hospital, say), a non-VP Acting
   President, or a non-VP empty-seat Acting President: a board member who isn't the stand-in
   proposes it with `request_acting(...)`, then opens a board vote with `open_acting_vote(p_request,
   p_quorum, p_closes_at, p_meeting)`. The vote is fixed as `chapter_board`, majority, with a
   question built from the request ("Jet acts as President (North) for Smokey until 13/12/2026:
   Smokey in hospital"). Once it has carried, in the last 90 days, a board member who isn't the
   stand-in confirms. The vote's screen notes that the stand-in and the holder shouldn't vote on it
   (11.10). That is a note only, as for every other vote in the app today.

**The Auditor stays out (11.8).** Someone with an open `nec_auditor` row who also sits on a board
can't record, confirm, change, propose or end acting for a President or Treasurer seat. The same
check goes into the full `appoint_position` (see "Rules tightened for everyone").

**Caps** (inferred, mirrored in the app, measured from `started_on`, never from today):

- **Empty seat**: up to the date of the chapter's next scheduled, uncancelled `agm` or `special`
  meeting (9.8, "until the next eligible meeting or election"; elections are at the ACM, 9.2). If
  none is scheduled, up to six months. The default is that meeting's date, or three months.
- **Cover**: up to three months (an absence, not a vacancy; a longer one is a 9.8 or 9.7 question).
  The default is four weeks. Going past three months needs a new agreed or voted cover, which is a
  new row with a new start, so the audit sees each one.

## Changing the date

`set_acting_until(p_position, p_until)`:

- **Earlier**: the acting person, and for a cover also the covered holder.
- **Later**: for an empty seat, a board member who isn't the acting person, within the cap. For an
  agreed cover, only the covered holder ("still away"), within the cap. A voted cover needs a new
  vote.
- Every change is logged in `public.acting_changes` with the old date, the new date, who and when.
  The row keeps its start date, so the audit sees the whole stint.

## How it ends

`end_position` gets an acting branch:

- **The date passes**: the stint ends on its own (`ended_reason = 'lapsed'`).
- **The acting person steps down**, free as now (`stepped_down`).
- **The covered holder says "I'm back"**, free, for any cover of their own seat, agreed or voted
  (`holder_back`). A cover is never discipline: keeping an available, willing holder out of their
  office would be a suspension, and that needs 14.5 or 9.3. Jeff decides whether voted covers exist
  at all (question 3).
- **Anyone else on the board** needs a carried chapter-board majority vote naming the acting row,
  closed in the last 90 days. This is the Non-Board removal shape in 9.3: the board appointed it
  (9.8), so the board ends it. `open_vote` and `has_carried_removal_vote` give that shape whenever
  the subject's open row of that role is an acting row (`removed`). NEC officers have no branch.
- **A full appointment to the seat** (recording an election, 9.2) ends empty-seat acting first,
  inside `appoint_position` (`replaced`), even when the acting person is the one elected. The
  Appoint screen says "This ends Crank's acting".
- **If the covered holder's own row ends** (stepping down, removal, `forget_member`, re-election
  by end-and-reappoint), a trigger turns the cover into empty-seat acting in the same statement
  (`covers = null`, logged in `acting_changes`). It keeps its date, so it carries on until the
  date or the election, and no one row is left pointing at an ended row. On re-election the
  screen says "This ends Jet's acting. Arrange a new cover if Smokey is still away."

`ended_on` is always the first day without the seat: today for an early end (as `end_position`
does now), and `acting_until + 1` for a lapse. History shows "Acting until DD/MM/YYYY" from
`acting_until`. `ended_reason` is set by every path that ends any row (`stepped_down`,
`holder_back`, `removed`, `replaced`, `lapsed`, `forgotten`, `renewed`, and any others the plan
finds). A catalogue test fails on any function that sets `ended_on` without it. Old rows stay
null.

## Votes and ballots

- **Board ballots belong to people** (8.1, 8.5). A cover doesn't change the board electorate, so
  North (Smokey, Jet, Crank) still opens board votes with three electors while Jet covers Smokey.
- **Checked when cast** (`cast_ballot`). For `chapter_board` votes the caller must still be a
  board member of that chapter: "Your board seat has ended, so this ballot isn't yours now." The
  quorum count stays fixed at opening.
- **An NEC ballot belongs to its chapter** (11.2, 11.6). `vote_electors` gains `for_chapter`, set
  for NEC votes at opening. When casting, the caller must be `nec_voter_for(for_chapter)` now. An
  uncast ballot passes to whoever that is (the row's `member_id` is updated to the caster), and a
  cast one stands. So a lapsed Acting President can't vote, the returning President can, and North
  never loses its one vote. The app's `Vote` gains `electorChapters` for NEC votes.
- **Opening a vote** warns when it closes after an elector's stint ends: "Jet's acting ends 13/12.
  Close before then, or Smokey votes for North instead."
- **The casting vote** goes to whoever has the chair's duties when the vote closes (`chair_of` at
  close, as now).
- **`nec_voter_for`**: the President with duties who isn't the NEC Chair (an Acting President
  counts), then the VP with duties (today's fallback, unchanged).

## Money (13.3)

- Chapter fund: approvers are board members (unchanged). The stand-in was one already. An Acting
  Treasurer keeps only their own chapter's books.
- Club fund: no acting row keeps its books or approves its spending.
- **Independent approvers.** 9.5 speaks of "the two-independent-approver control in clause 13.3".
  In `approve_debit`, in `record_debit`'s automatic approval and in the app's ledger guard, an
  approval is refused from:
  - a member whose standing as an approver in that fund comes only from an acting row that was
    recorded or confirmed (`appointed_by`) by the entry's recorder, its payee, or an approver
    already counted;
  - a stand-in covering the payee's seat. Their reimbursement goes to the other approvers, which
    is 13.3's "predesignated eligible alternates".

  Words: "You're acting because <name> put you there, so you can't be the second approver on their
  entry (13.3)." The parity cases cover both.

## Rules tightened for everyone

These are three small fixes the acting work exposed. Each one only takes power away from someone
who no longer has a right to it.

1. A board ballot can't be cast after the voter's board seat has ended (8.5, "currently holding
   office"). Today a removed or resigned member still votes on anything opened before.
2. NEC ballots pass to the chapter's current voter (11.6, "joins and leaves the NEC with that
   internal office").
3. Someone holding the National Auditor seat and a chapter board seat can't appoint, in full or
   acting, to a President or Treasurer seat (11.8, the repo's own rule "The Auditor doesn't seat
   the people they review", `national_auditor.sql:36`).

## Data shape

Columns on `public.positions`, not a new table of stints. An acting row is a position, so every
read that asks "who holds this seat" finds it with no join.

```
acting_until  date null     -- last acting day (inclusive); null = a normal term
covers        uuid null references public.positions(id) on delete restrict
acting_why    text null
acting_vote   uuid null references public.votes(id)   -- the carried vote, when one was needed
ended_reason  text null check (ended_reason in ('stepped_down','holder_back','removed','replaced',
                                                'lapsed','forgotten','renewed'))
check (acting_until is null or acting_until >= started_on)
check (acting_until is null or chapter_id is not null)          -- never national or Founder
check (covers is null or acting_until is not null)
check ((acting_until is null) = (acting_why is null))
check (acting_until is null or (ended_on is null) = (ended_reason is null))
```

- **The seat indexes.** One transaction creates `one_holder_per_board_seat_v2` on `(chapter_id,
  role) where ended_on is null and covers is null` (board roles), and `one_cover_per_board_seat` on
  the same columns `where ended_on is null and covers is not null`. It then drops
  `one_holder_per_board_seat` and renames v2 to that name. An elected holder and an empty-seat
  acting row therefore still clash, as two elected rows do now, and `access_rules_test.sql:478-487`
  still holds. `add_roster_position` still gets its `unique_violation` when a roster claimant
  arrives at a seat someone is acting in, and skips it as today.
- `one_acting_per_member` is unique on `(member_id) where ended_on is null and acting_until is not
  null`. `one_open_role_per_member` stays, which stops anyone acting in a seat they hold. Index
  `covers` where not null.
- **A trigger checks `covers`.** It must point to an open, non-acting row in the same chapter and
  role, started on or before the cover. The covered-row-ends trigger is described under "How it
  ends". `on delete restrict` is safe because positions are never deleted outside tests: the
  members row outlives the account, and `forget_member` deletes only future-dated rows, which a
  cover can't point at.
- **A seat lock.** `private.lock_seat(chapter, role)` (`pg_advisory_xact_lock`) runs first in
  every writer that touches a seat: `appoint_position`, `appoint_acting`, `confirm_acting`,
  `end_position`, `set_acting_until`, `add_roster_position`, `settle_chapter_proposal`,
  `renew_auditor`. Their plain `exists` checks then can't race.
- `public.acting_requests` (`id, chapter_id, role, member_id` = stand-in, `covers, until, why,
  requested_by, created_at, closed_at, outcome`). One open request per seat. A request lapses at
  read time once its until date passes. The chapter's board and the stand-in can read it, and only
  the RPCs write it.
- `public.acting_changes` (`position_id, old_until, new_until, old_covers, changed_by, changed_at,
  note`). The chapter's board and the Auditor can read it.
- `votes.acting_request` (null unless it's an acting vote). `isRemovalVote` becomes "a chapter
  vote naming a role, and not an acting vote". `vote_electors.for_chapter` is for NEC votes. Open
  NEC votes are backfilled from each elector's chapter.
- App: `Position` (`types.ts:117-124`) gains optional `actingUntil`, `covers`, `actingWhy` and
  `endedReason`, mapped in `liveData.ts:317-324`. They're optional, so the ~53 test literals and
  old offline copies still load. `database.types.ts` is regenerated.

## Ending on its own, with no scheduled job

1. **Read-time check (database).** The three views above. A lapsed row has no power from Melbourne
   midnight, closed or not.
2. **Lazy close (database).** `private.close_lapsed_acting()` sets `ended_on = acting_until + 1,
   ended_reason = 'lapsed', ended_by = null` on lapsed rows, so the partial indexes are free
   again (they can't use `club_date()`). Every writer above calls it first, and so do
   `set_member_status`, `delete_my_account`, `forget_member`, `open_vote` and `open_acting_vote`.
   No pg_cron job is added. (The repo has one, `purge-conduct-records` at
   `board_admin.sql:900`, but stints don't need one.)
3. **Settle (app).** `settleActing(data, today)` in `src/domain/acting.ts` closes lapsed rows in
   memory, using ISO string compares. Both providers keep the stored rows as `raw` and expose
   `const data = useMemo(() => settleActing(raw, today), [raw, today])`. Every existing use of
   `data` then reads settled rows: the access level (`LiveClubProvider.tsx:258`), the action guards
   (`:465`, `:474` and the rest), the demo actions (`DemoClubProvider.tsx:47`), the saved copy
   (`:148`) and fresh loads (`:188`). `today` becomes state from a new `useClubToday()` hook. That
   hook re-reads at the next Melbourne midnight on a timer, and whenever the app comes back to the
   foreground. When a settle ends one of the viewer's own rows, the provider reloads. If the reload
   fails, it drops the saved copy, since that copy holds board-only details the viewer may no
   longer see.

## Screens

Before the UI work, read Impeccable's craft floor. After it, run critique, audit and polish at
390×844 in the demo and live builds. Titles stay in Rustnuts Stencil, and `DESIGN.md` gets the
acting title forms.

- **Manage member › Positions** (`board.tsx`). Appoint gains a `Choices` pair, "Acting" (the
  default for a board seat) and "Full term (elected at a meeting)". Acting lists the empty seats
  this person could act in. If a seat needs a vote, the label says so: "President (needs a board
  vote)". It then shows a `DateField` "Until" with the cap in its hint, and a required "Why". If
  the stand-in isn't the VP, the Why is labelled "Why not Jet (VP)?". A full appointment over
  empty-seat acting says "This ends Crank's acting". The done message is "Crank is Acting Treasurer
  until 13/12/2026." An acting seat shows "Acting until DD/MM/YYYY", "Change date", and either
  "Start a vote to end acting" or "Step down from acting" for the acting person. It has no "Start
  removal vote".
- **The away holder's Manage member page.** "Arrange cover (board vote)" starts route 3.
- **Me, for a board holder.** "Arrange cover while I'm away" lists the stand-ins this seat allows.
  Choice labels carry the person: "Jet (VP)". The `ConfirmButton` note lists what moves and what
  stays: "Jet chairs North and casts its NEC vote until 13/12/2026. You keep your seat, board vote,
  approvals and board records. You're off the NEC until then."
- **Board tab.** Open requests show to board members who can confirm: "Smokey asked for Jet to
  cover as President until 13/12/2026: Smokey overseas", with a "Confirm cover" `ConfirmButton`.
  "Attendance and terms" lists stints apart. For empty seats: "Acting until 13/12/2026: hold the
  election at the ACM, change the date or let it end. If Crank stands, the VP or an elected person
  chairs that vote (9.9, 10.9)." For covers: "Smokey takes back the seat on 14/12/2026." Both turn
  warning colour in the last 7 days. "You act for West" and "Acting is each chapter board's"
  (`board.tsx:180-190`) become "You sit on West's board" and "Each chapter's board runs its own
  business". `termEndsOn` returns `actingUntil`.
- **The covered holder, on Me and Home.** "Jet is acting as President (North) until 13/12/2026.
  Until then Jet chairs and casts North's NEC vote. You keep your seat and board vote." Below it
  sits "I'm back" (a `ConfirmButton`). A test shows the button on the covered holder's screen.
- **Titles everywhere.** `positionTitles` (`home.ts:14-34`) groups by role and acting, so titles
  never merge. The long form is "Acting Treasurer (North) until 13/12/2026" (member detail, Me,
  treasurer report `preparedBy`, assistant). On the Home header the date goes on a second line, so
  it never wraps to three at 390 px. The chip form is "ACTING TREASURER (NORTH)": `RoleChip` takes
  the position, and `MemberRow`, `AuthorLine` and the Chapters list follow. A covered holder's title
  is unchanged. **The NEC list** shows one row per chapter: "Jet, Acting President (North), for
  Smokey until 13/12/2026". `minutes_draft_start` adds an `acting` flag so Otter names the Acting
  President.
- **Reminders on the phone** (as `reminders.tsx` does for rides, with no server job). The acting
  person and the covered holder get one 7 days and one 1 day before the date. Board members see the
  Board tab line instead.
- **Audit.** An "Acting" chip on the Positions list. "A term has run past its end" ignores acting
  rows. New findings:
  - "No election scheduled while Crank acts (9.8)", for empty-seat acting in a chapter with no
    `agm` or `special` meeting scheduled.
  - "Crank's acting runs past North's ACM on DD/MM (9.8)".
  - "Smokey's seat has been covered for more than three months in a row (9.5 review)".
  - "Jet casts North's NEC vote without being formally Acting President (11.2)", when the
    President seat is empty and the VP fallback applies, with a one-tap "Make Jet Acting
    President". It doesn't fire for the Chair-and-President case, which is the follow-on.
- **Elsewhere.** The hall of fame leaves acting out, and a stint isn't a 9.4 served term. Delete
  account lists acting seats. The glossary gets "Acting" and "Cover".

## Demo

There is one acting holder, in an empty seat, so the demo reads the same if covers are ever cut:
`p-19`, Crank, Acting Treasurer (North). Its `acting_why` is "No Treasurer since the ACM". It
started 28 days before the demo's today and runs to 28 days after, built with the helpers from
the 14/11 "demo dates follow today" spec. It's appended to `positions`. Crank is already North's
Road Captain, so this is 9.5 combined duties: no ballot count moves, and Crank gains North's books
but not the Club fund's. `actingUntil` joins `demoFresh.test.ts`'s future-date list. The screen
check walks a cover through the switcher: Smokey asks for Jet, Crank confirms, North's board vote
still has three electors, Jet chairs, and Jet is North's NEC voter.

## Tests (written first, each seen failing)

- **`npm test`.**
  - `acting.test.ts`: settle at Melbourne midnight in both daylight states; the memo crossing
    midnight without a reload; the saved copy; the four readings; a cover turning into empty-seat
    acting.
  - `access.test.ts`: every `actingProblem` refusal and warning; caps from 30/11 and 31/01 and
    against a scheduled ACM; the end branches (acting person, holder, board without and with a
    vote); the Auditor in a second seat; one stint; chair and books apart; hiatus.
  - `votes.test.ts`: North keeps three board electors under a cover; the cast-time board check;
    NEC ballot pass-over; `chairOf`; `necVoterFor`; acting votes aren't removal votes.
  - `ledger.test.ts`: the Acting Treasurer keeps only the chapter's books; no acting row on the
    Club fund; both independence refusals.
  - `terms`, `home` (titles, NEC rows), `audit`, `history`, `demoFresh`.
  - A source test fails on any inline open-row check (`endedOn === null`, `== null`, `!p.endedOn`)
    outside `acting.ts` and `access.ts`.
- **`npm run test:db`.** A new `supabase/tests/acting_test.sql`, with `club_date()` overridden in a
  transaction:
  - the index pair (an elected and an empty-seat acting row clash; a cover doesn't);
  - the `covers` trigger, and the covered-row-ends trigger: end the covered row, then appoint in
    full, and only one row has duties;
  - every RPC route and refusal, and the caps;
  - the lazy close;
  - a lapsed but open row losing every power (`is_board_of`, `approves_for`, `keeps_books`,
    `electors_for`, `nec_voter_for`, `chair_of`, `push_applicant`, `sees_board_of`);
  - a roster claim landing on an acting seat and skipping;
  - the seat lock, as a two-session test if the runner can hold two connections, otherwise a
    catalogue test that every seat writer calls `private.lock_seat`.

  A catalogue test scans every function body and every policy (`pg_policies.qual` and
  `with_check`). It fails on any text that mentions `positions` unless it reads one of the three
  views or sits on a short allow-list with a one-line comment for each entry: the writers,
  `has_carried_nec_vote`'s history read, and the views themselves.
- **Parity** (`supabase/tests/parity.json`). Each case gets an optional `with` list of extra
  position rows (`actingUntilDays`, `covers`, `why`), inserted after `begin;` in `parity-sql.mts`
  and added in `fixtureData` on the app side. The shared 12 rows and the existing 1,400 answers stay
  as they are. New actions: `appointActing`, `requestCover`, `confirmActing`, `setActingUntil`.
  About 30 cases:
  - each route and each refusal, including the Auditor in a second seat;
  - ending by each person, and by the board with and without a vote;
  - a full appointment ending acting;
  - North opening a board vote with three electors while Jet covers Smokey;
  - both independence refusals;
  - a lapsed row still open (`actingUntilDays: -1`) that can't `approveDebit`, can't `castVote`,
    gets no `openVote` ballot and leaves its seat free to `appoint`. That group proves expiry
    needs no cron.

## The live SQL step

One migration, `supabase/migrations/20270860000000_acting_roles.sql`, contains:

- the columns, checks, two tables, triggers and the `votes`/`vote_electors` columns, with the NEC
  backfill;
- the index swap (the first `drop index` in the migrations, after its replacement exists, then a
  rename);
- the three views and `close_lapsed_acting`;
- the re-pointed helpers (`create or replace`, same signatures);
- the new RPCs (new names, so no overload to drop) and the edited ones (`appoint_position`,
  `end_position`, `cast_ballot`, `approve_debit`, `record_debit`, `open_vote`,
  `has_carried_removal_vote` and the other writers, same signatures).

Grants follow the repo's pattern (`removal_and_gate.sql:230`). The migration runs `revoke all ...
from public, anon` on every new RPC, then grants execute to `authenticated`. It revokes `public,
anon, authenticated` on `private.close_lapsed_acting()`, `private.lock_seat()`,
`private.acting_problem()` and select on the three views. Every existing row gets `acting_until`
null, so nothing changes except the three tightenings.

There is one paste-queue item, `build/acting_roles.sql`, byte for byte the same. The "Apply pending
SQL in Supabase" thread loads and checks it, Run is pressed, and read-only checks confirm the
columns, indexes, views, triggers, grants and function bodies. Under Jeff's rule of 1 Nov 2026 Claude
presses Run itself; if a guard blocks the press, Jeff gets the one press that is left. The SQL goes first,
then the app as an over-the-air update (no `app.json` change). An old app shows acting rows as
plain titles while the database enforces the rules.

## The empty-seats-only variant (not chosen; the fallback cut)

Jeff picked both kinds on 15/11/2026. This section stays so covers can be cut cleanly if the
build or a review shows they cost more than they give.

None of the attack surface either reviewer found applies here. One board member can already fill
an empty seat for a full term (`audit_fixes.sql:242`), so empty-seat acting gives nobody a new
power.

**It drops** covers: `covers`, `request_cover`, the cover trigger, the index pair (the old
`one_holder_per_board_seat` stays as it is), "I'm back", the covered holder's notice and the cover
screens. Without covers, the duties reading is the same as held. What that costs:

- The VP can't formally act for an absent President who stays seated (8.2). The informal VP
  fallback for the NEC vote stays.
- An away Treasurer can't hand over the books without stepping down.
- 9.5 combined duties only work in empty seats.

A holder who steps down to be covered loses the term clock, the 17.6 start date and their 9.4
record. A President's re-seating also goes through the NEC officers.

**It keeps** everything else: the caps, the reason, routes 1 and 3 (a non-VP Acting President
still needs a board vote), the club-wide limits, the independence rule, the three tightenings, the
lazy close and settle, the NEC ballot pass-over, the audit lines, and about two thirds of the
tests. The 11.2 Chair case isn't lost, because it's a follow-on either way.

## Calls Claude made (Jeff can veto any)

1. Both cases, as Jeff picked, built so empty-seats-only stays a clean cut.
2. Columns on `positions`, not a separate table of stints. Two small side tables: requests and the
   change log.
3. Acting only in chapter roles: board seats (empty or covered) and non-board roles (empty only).
   Never national seats, Founder or titles.
4. A cover moves only the seat's own duties. The covered holder keeps board membership: ballot,
   quorum place, chapter approvals and board records (8.1, 8.5, 9.5). The stand-in must already be
   on that chapter's board.
5. Nobody acting reaches club-wide. That means no Club fund books or approvals, no shop, and no
   other chapters' private details, while an Acting President still takes part in NEC business.
   (Money and member data: Jeff's yes, question 2.)
6. The chapter board appoints every acting seat, including President (9.8). NEC officers have no
   part. The VP comes first for President (8.2, 10.9), and anyone else needs a board vote.
7. An agreed cover is asked for by the holder and confirmed by a third board member (8.2).
8. A voted cover, for a holder who can't be asked, is a board majority. (Whether it exists at all:
   Jeff, question 3.)
9. The holder can always end a cover of their own seat, and the acting person can always step
   down. Anyone else needs a carried board-majority vote naming the acting row (9.3's Non-Board
   shape).
10. Caps run from the start date. An empty seat runs to the next scheduled ACM or special meeting,
    or six months if none is scheduled. A cover runs three months, and past that needs a new
    cover.
11. One stint per person. Chair and books stay apart. Hiatus is refused for ride-lead roles. A
    reason is required.
12. 9.6 family and 9.7 licence are warnings, and 9.4 shows only where it fits.
13. A full appointment ends empty-seat acting. When a covered row ends, the cover becomes
    empty-seat acting.
14. Board ballots are checked when cast. NEC ballots belong to the chapter.
15. Independent approvers (13.3, 9.5): no second approval from someone the recorder, payee or
    first approver put in the seat, and none from the payee's own stand-in.
16. Three tightenings for everyone: board ballots after a seat ends, NEC ballot pass-over, and the
    Auditor seating Presidents and Treasurers.
17. `ended_reason` on every ending, and a log of every date change. `ended_on` is the first day
    without the seat.
18. No cron job: a read-time check, a lazy close, and an app settle keyed on a ticking `today`.
19. Reminders go on the phone to the acting person and the covered holder.
20. The 11.2 Chair-and-President vote is a follow-on, and the VP fallback stays until then.
21. No 8.6 NEC fallback for covers in small boards.
22. Conflicts on acting votes are a note, as for every vote in the app today.
23. Acting stints stay out of the hall of fame and aren't a 9.4 served term.
24. The demo seed is Crank, Acting Treasurer (North), in an empty seat.
25. Not fixed here, seen: `one_holder_per_national_role` also covers Founder, so live allows one
    open Founder row and `add_roster_position` skips a second silently. `approvesFor` lets an
    Auditor in another board seat approve chapter spending. A board member who fills an empty seat
    in full can then be that person's second approver; the independence rule covers acting only.

## Review notes

Two independent reads raised 6 Critical, 12 Important and 11 Minor findings against the first
draft. Every one was checked against the code and holds as described (one names the cast function
`cast_vote`; it is `cast_ballot`). Most are fixed by the design changes above: board membership split from
duties, covers only by board members with the holder's agreement or a vote, NEC officers out, the
index pair, chapter-owned NEC ballots, nothing acting reaching club-wide, and the `with` fixtures.
Where this draft takes a different route from a suggested fix:

- **"A board-imposed cover can only be ended by the board."** Not taken. A cover that the holder
  can't end would be a suspension by board majority, which 9.3 and 14.5 don't allow. Voted covers
  are for a holder who can't be asked, and whether they exist at all is put to Jeff (question 3),
  as the second reader asked for call 4.
- **"Cap the stint at `started_on` + 3 months (9.8 transition)."** The cap runs from the start, as
  suggested, but for covers only, and it isn't cited to 9.8. The second reader is right that 9.8's
  three months is about handovers. Empty seats run to the next ACM (9.8, 9.2).
- **"Refuse `open_vote` on the NEC while any cover is under N days old."** Not taken. NEC officers
  no longer pick stand-ins, and chapter-owned NEC ballots stop a lapsed stand-in voting, so it
  isn't needed and would hold up NEC business.
- **"When a cover ends, add the returning holder to `vote_electors`."** Done for the NEC, as
  ballot pass-over. Not needed for board votes, because a covered holder never loses their board
  ballot under the split.
- **"Optionally re-check approvals in `pay_debit`."** Not taken. Approvals are checked when given,
  and a later stint can't make an earlier approval dependent.
- **"NEC officers as the 8.6 fallback."** Not built. 8.6 asks for a quorate, impartial NEC
  decision, not one officer, so it's left as a non-goal.
- **"Keep leader powers until the ride's live window closes."** A warning instead. Covers go only
  to board members, who are ride leaders through their own seat, so only an outsider in an empty
  Road Captain seat can lapse mid-ride, and the warning catches it when the date is picked.
- **"Reminders for the acting person and the board."** The board gets the Board tab line, not a
  push, to keep notifications down.
- **"Offer Jeff three options."** The middle option ("covers by board members only") is now the
  design's cover rule, so his card still has two answers.
- **"Make the 11.2 case its own designation."** Agreed on the shape, but it's moved out of this job
  as a follow-on. Jeff asked about short-term acting. Removing it also removes the stored
  `nec_vote_only` flag that both readers found going stale.

## Questions for Jeff

1. **His card**: answered 15/11/2026, both kinds.
2. **Money and member data (needs his yes)**: an acting Treasurer keeps only their own chapter's
   books. No acting row keeps or approves the Club fund, or runs the shop. An Acting President
   doesn't see other chapters' private details, and a covered President drops to board-level reach
   while covered. The independence rule applies to approvals. Claude recommends all of it.
3. **A cover without the holder's say**: when the holder can't be asked (in hospital, say), may a
   board-majority vote put a cover on their seat? They could end it with "I'm back" once they're
   able. Claude recommends yes.
