# Acting in a role, until a date

Date: 15/11/2026 (fifth draft, after five independent reads; Jeff picked both kinds). Kind: architectural (new columns on
`positions`, two small tables, the seat index swapped for a pair, about 45 database helpers sorted
into four readings, and the app split the same way). Spec, then a plan in `docs/superpowers/plans/`.

Approval: Jeff said yes to the money and member-data parts (the Club fund, approvals, who sees
every chapter's private details) and to voted covers on his card of 15/11/2026, "Go as designed".
Claude approves the rest under Jeff's 24 Oct rule, and Jeff can veto any call below. Jeff asked on 15/11/2026: "can we add an 'acting'
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
- The 8.6 referral, where vacancy or conflict leaves a board without quorum and the matter goes to
  the NEC. 8.5 says "A conflicted person does not vote or count", so a vote about acting leaves out
  the stand-in, the covered holder and, for a President or Treasurer seat, the National Auditor,
  and needs three board members left. An agreed cover needs a third board member to confirm it.
  Where the board can't do that, the panel says to refer it to the NEC (8.6), and `request_cover`,
  `request_acting`, `open_acting_vote` and the end-by-vote branch refuse with the same words.
  Recording an empty non-President seat as acting mirrors today's single-member full appointment
  and has no such check.
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
  member, nobody gains a ballot and nobody loses one. Apart from the VP acting for the President
  (8.2), a cover combines duties under 9.5, which allows it "temporarily ... where necessary, with
  reasons and review recorded". The confirm text says so through a 9.5 warning. The app limits it by the
  reason, the cap and the review, not by board size, because the constitution doesn't define a
  small chapter.

Non-board roles (Tail Gunner, Officer, committees) can have several holders, so they have no
covers. Acting there is a short appointment with an end date, beside any other holders: the seat
checks (a holder, a stint or a request already there, and a full appointment ending acting) are
for the six board seats only.

## The four readings of a seat

Every check that reads `positions` uses one of four readings. Each is written once in the
database (`private` views) and once in the app (`src/domain/acting.ts`), and the two mirror each
other.

| Reading | What it is | What reads it |
|---|---|---|
| **Held** | Open rows whose stint hasn't lapsed | Titles, eligibility (`hold_problem`), "end their positions first", history |
| **Board member** | A distinct person with a held board row in the chapter, covered or not | Board ballot and quorum (8.1, 8.5), acting as the board (`is_board_of`), board records, chapter-fund approvals (13.3), board notifications, ride leader |
| **Duties** | Held rows, minus any row a live cover points at | Chairing and the casting vote (`chair_of`), the NEC seat and vote (`nec_voter_for`, `is_national`), the chapter's books and fees (`keeps_books(chapter)`, `can_manage_fees`), every other check naming one role (Road Captain, Tail Gunner, committees) |
| **Club-wide** | Duties rows that aren't acting | Every chapter's private details (the national branch of `sees_board_of`, other chapters' chapter chats), the Club fund's books (any chapter Treasurer, inferred) and approvals (sitting Presidents), the shop (`shop_seat`), the app feedback inbox (`is_feedback_keeper`) |

What this means for each person:

- **The away holder (covered).** Keeps the title, the term, the board ballot and quorum place,
  chapter-fund approvals and board records, so they stay at the "board" access level. Pauses the
  seat's own duties and anything club-wide. A covered President is off the NEC until the cover
  ends. This reads "participates in the internal NEC" (8.2's President duties) as a duty that the
  cover moves to the acting President (11.2). It goes past the letter of 11.6 ("joins and leaves
  the NEC with that internal office"), so it is put to Jeff (question 5).
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
  `canSeePrivate`. Appendix B lists every `is_national` caller (24 migration files) and marks each one
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
- Already holding that role, or, in a board seat, a holder, a stint or a request already there.
- **One stint at a time**: someone already acting anywhere, and anyone whose own seat is covered.
- **Chair and books stay apart**: no Acting President who holds any Treasurer row in the chapter,
  acting or elected, and no Acting Treasurer who holds a President row (9.5 "compatible duties",
  inferred). A full `appoint_position` refuses only where the other row is acting (seating an
  Acting Treasurer as President in full, or the reverse). So no sitting holder and no 17.6
  arrangement changes at go-live: the founder seed seats Jeff as Treasurer of West and North
  (`founder.sql:33-36`), and an ACM could still elect him President.
- Members on hiatus, for every role `is_ride_leader` counts: every board seat, Road Captain, Tail
  Gunner and Assistant TG (`national_auditor.sql:62-71`). The words are "Members on hiatus can't
  lead rides", like `crew.ts:35`'s crew refusal.
- A recorded licence that is a learner's, or ends before the until date (9.7): "Their recorded
  licence ends before the until date (9.7)." When no licence is recorded, the app only warns.
- A cover's stand-in must hold a board seat in that chapter.
- **Anyone but the sitting VP needs a carried board vote to act as President**, in an empty seat
  or as a cover. The sitting VP is a held, non-acting VP row (8.2: the VP "acts where the
  President is absent, unavailable or conflicted"). For an empty seat it must have started before
  the seat's last non-acting President row ended: 8.2 names the VP in office when the President
  went, so one board member can't seat someone as VP and then make them Acting President without
  a vote. There's no exception for a chapter with no VP: 8.2 gives the acting role to the VP
  alone, and otherwise filling a vacancy is the board's (9.8).
- A President stint recorded with no vote because the person was the sitting VP ends when their
  VP row ends (`left_board`), and extending it re-checks the rule.
- A carried vote that removed someone from a seat (9.3, in the role's shape) or ended their acting
  there holds for 90 days: recording them there again in that time needs a new carried acting vote
  (`ENDED_BY_VOTE`), so one board member can't undo the decision by re-recording them the next day.
  A full appointment to a board seat checks the vote that ended acting too. Only acting has that
  board-majority shape on a board seat, so nothing changes at go-live (re-seating someone in full
  after a 9.3 removal is today's gap, call 25).
- A required "Why" of up to 120 characters ("Smokey overseas", "No Treasurer since the ACM"),
  stored on the row and shown on the Board tab and in the audit. This is 9.5's "reasons recorded",
  and the until date is its review. Every approved member can read it, as with every position row,
  so its hint says "Every member can read this. Keep health details out."

Shown as warnings, like `appointWarnings` (`access.ts:288-308`), and repeated in the confirm text:

- 9.6 on every board-seat stint: "Immediate family can't sit on the same board, including the
  person they cover, without a two-thirds written exemption (9.6)." The app doesn't record family,
  so this can only warn.
- 9.1 (two years Full) for an empty-seat stand-in not already on the board. 9.4 (a full term in
  another seat) only for an empty-seat Acting President or VP who isn't the sitting VP. Acting
  isn't a nomination, and a VP acting under 8.2 is exactly what 8.2 describes.
- 9.7 in the cover flow: "If their licence is suspended or cancelled, their seat is vacant (9.7).
  The app can't record that yet: they step down, then the board fills the seat." (A 9.7 ending
  reason is on the later list.)
- 9.5 when the stand-in already holds a board seat, which combines duties: "A small chapter may
  combine duties for a while where it's necessary, with the reason recorded (9.5)."
- A ride the stand-in is crewed to lead that starts on the until day, or runs past its midnight:
  "Crank leads the 13/12 run. Acting ends that night. Pick 14/12 or later."

## How a stint starts

Every route takes a seat lock and a lock on each person it checks, then runs the lazy close (see
below).

1. **Empty seat, recorded by one board member.** `appoint_acting(p_member, p_chapter, p_role,
   p_until, p_why)`. Any board member of the chapter who isn't the stand-in can record it, for
   board seats and non-board roles. For President, only the sitting VP can be recorded this way;
   anyone else goes through route 3. For other seats this mirrors today's full appointment to an
   empty seat, which one board member records with no vote (`audit_fixes.sql:242`). It isn't a 9.8
   Board decision under 8.5, and the design doesn't claim it is. A full President appointment
   needs an NEC officer today (`audit_fixes.sql:238-241`). Recording the sitting VP adds the title
   and NEC business, because `is_national` counts President rows and the VP fallback gives only the
   chair and the NEC vote. That is what 8.2 and 11.2 give a VP formally acting. No NEC officer
   takes part. It starts today.
2. **Agreed cover.** The away holder asks from their own Me page:
   `request_cover(p_position, p_member, p_until, p_why)`, naming their own board seat and the
   stand-in. That creates an `acting_requests` row and nothing moves yet. A board member who is
   **neither the holder nor the stand-in** then confirms it with `confirm_acting(p_request)`, which
   inserts the acting row. This records the holder's own arrangement (9.5, reasons and review
   recorded). It isn't a Board decision under 8.5 either. An agreed cover of a President needs the
   sitting VP as stand-in, or route 3.
3. **Voted.** This route covers a cover that someone other than the holder asks for (because the
   holder can't be asked, in hospital say) and any Acting President who isn't the sitting VP. A
   board member who isn't the stand-in proposes it with `request_acting(...)`, which only takes
   requests that need a vote. They then open a board vote with `open_acting_vote(p_request,
   p_quorum, p_closes_at, p_meeting)`. The vote is fixed as `chapter_board`, majority, with a
   question built from the request ("Jet acts as President (North) for Smokey until 13/12/2026:
   Smokey can't be reached"). Its electors are the board minus the stand-in, the covered holder
   and, for a President or Treasurer seat, the National Auditor (8.5, 9.9, 11.10, 11.8). Quorum is
   worked out on them, and with fewer than three it refuses with the 8.6 words. It stays open at
   least 48 hours, and `close_vote` won't close it sooner even when everyone has voted, so the
   holder can answer and nobody can void it by closing early. Once it has carried, in the last 90
   days, a board member who isn't the stand-in confirms it, and the row records the vote
   (`acting_vote`).

**Requests.** The stand-in (declining) or the holder can close an open request with
`withdraw_acting_request(p_request)`, and the requester can only while no vote on it is open or
has carried, so no one board member can undo a vote that is running or has carried (8.2). A
request lapses at its until date or 28 days after it was made, whichever comes first. Any vote on
it that closes `lost` closes it as `rejected`, even while another vote on it is open, so a declined
one never blocks the seat, and its requester can't ask for that seat again for 28 days
(`ASKED_RECENTLY`). A `no_quorum` vote leaves it open for another vote, so a vote set up to fail
can't sink it.

**The holder hears about it.** When someone else asks to cover a holder's seat (at most once a
day per seat, however often it's re-filed), and whenever a cover of their seat is confirmed, their
own request included, the holder gets a push whatever their settings, as `push_ride_alert` does:
"Crank asked for Jet to act as President (North) for you until 13/12/2026. If you're available, tap
I'm back."

**The Auditor stays out (11.8).** Someone with an open `nec_auditor` row who also sits on a board
can't record, confirm, change, propose or end acting for a President or Treasurer seat, and isn't
an elector on acting or end-acting votes for those seats. The same check goes into the full
`appoint_position` (see "Rules tightened for everyone").

**Caps** (inferred, mirrored in the app, measured from the start, never from today):

- **Empty board seat**: up to the date of the chapter's first uncancelled `agm` on or after the
  run's start, still to come or already held (9.8, "until the next eligible meeting or election".
  Elections are at the ACM, 9.2, so a `special` meeting doesn't count). That date is never more
  than 12 months after the run's start, and the cap is six months when no ACM is saved. Once the
  run's ACM has passed, the cap is behind today, so no stint in the seat can start or run longer
  (`RUN_OVER`), and the stint ends by its date at the latest, so the elected holder is seated then.
  A back-dated ACM can only make the cap earlier, so it gives nobody time. Back-to-back stints
  share one run: chained back from the new stint, it takes in each of the seat's acting rows that
  is open or ended within 28 days before the next one started, after the seat's last non-acting
  row ended. So stepping down and being recorded again within four weeks doesn't restart the cap,
  and a seat with nobody acting for four weeks starts afresh. The default is that ACM's date, or
  three months, within the cap. If the ACM is cancelled or moved, the date already set stands, and
  the audit's "No election scheduled" line flags it.
- **Non-board role**: several people can hold it and the board appoints it (9.2), so there's no
  run and no ACM: each stint runs up to six months from its own start, default three.
- **Cover**: up to three months (an absence, not a vacancy; a longer one is a 9.8 or 9.7 question).
  The default is four weeks. Going past three months needs a new agreed or voted cover, which is a
  new row with a new start, so the audit sees each one.

## Changing the date

`set_acting_until(p_position, p_until)`, never to a date before today:

- **Earlier**: the acting person, and for a cover also the covered holder.
- **Later**: for an empty seat recorded without a vote, a board member who isn't the acting person,
  within the cap. For an agreed cover, only the covered holder ("still away"), within the cap. Any
  row with a carried vote behind it (`acting_vote` set) needs a new vote. That covers voted covers
  and voted empty-seat Presidents. A President stint
  recorded because the person was the sitting VP is extended only while they still are.
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
  closed in the last 90 days. Like an acting vote, it can't close within 48 hours of opening. Its
  electors leave out the acting person, the covered holder and, for President or Treasurer, the
  Auditor, with the 8.6 words when fewer than three remain. `open_vote` gives that shape whenever
  the subject's open row of that role is an acting row (`removed`). It is the majority shape 9.3
  gives a Non-Board removal. `has_carried_removal_vote` also takes a carried 9.3 removal in the
  role's own shape that closed since the stint started, so a holder facing a 9.3 vote can't step
  down, be recorded as acting and outlast it. The app doesn't record 9.3's written notice and
  response, as for every removal today: that's a known gap. NEC officers have no branch.
- **A full appointment to a board seat** ends empty-seat acting (`replaced`) only when the person
  seated is the acting person. Otherwise it refuses: "Someone is acting in that seat. They step
  down first, or a carried board vote ends their acting." Even after an ACM elects someone else,
  the acting person steps down or the board votes, because any one board member can save a
  meeting row with any date, so no meeting row proves an election. So one board member, or for a
  President one NEC officer, can't end someone's acting by seating someone else. The wait is
  bounded, because no stint can be extended past its run's ACM. A roster claimant
  is the exception: the club sheet records their 2026 election (17.6), so their claim ends acting
  in their seat (`replaced`). The Appoint screen says "This ends Crank's acting". A non-board role
  takes a full holder beside any acting one.
- **If the covered holder's own row ends** (stepping down, re-election by end-and-reappoint,
  removal, `forget_member`), a trigger ends the cover in the same statement (`left_board`, logged
  in `acting_changes`), because a cover rests on the seat it covers. So a re-elected holder is
  seated again as usual, and a stand-in never keeps a seat its holder has left. The covered
  holder's step-down confirm says "This ends Jet's acting too. If you're re-elected and still
  away, arrange a new cover."
- **If the stand-in's own last non-acting board seat in the chapter ends**, the same trigger ends
  their cover there (`left_board`), or the cover alone would be a board ballot ("Extra voters").
  When the VP row of someone in a President stint with no vote behind it ends, that stint ends the
  same way.

`ended_on` is always the first day without the seat: today for an early end (as `end_position`
does now), and `acting_until + 1` for a lapse. History shows "Acting until DD/MM/YYYY" from
`acting_until`. `ended_reason` is set by every path that ends any row (`stepped_down`,
`holder_back`, `removed`, `replaced`, `lapsed`, `forgotten`, `renewed`, `left_board` (the seat the
stint rested on ended), and any others
the plan finds). A catalogue test fails on any function that sets `ended_on` without it. Old rows stay
null.

## Votes and ballots

- **Board ballots belong to people** (8.1, 8.5). A cover doesn't change the board electorate, so
  North (Smokey, Jet, Crank) still opens board votes with three electors while Jet covers Smokey.
- **Checked when cast** (`cast_ballot`). For `chapter_board` votes the caller must still be a
  board member of that chapter: "Your board seat has ended, so this ballot isn't yours now." The
  quorum count stays fixed at opening.
- **An NEC ballot belongs to its chapter** (11.2, 11.6). `vote_electors` gains `for_chapter`, set
  for NEC votes at opening. `nec_voter_before(chapter, day)` is the chapter's voter counting only
  rows that started before that day. A cover with no vote behind it counts from the covered row's
  start, because the holder chose the stand-in. While a President row that started before the day
  is under a cover that doesn't count, it is nobody: the covered President is off the NEC, and the
  board didn't pick who casts. The person named at opening casts while they are the chapter's
  `nec_voter_for` or its voter before the opening day. Anyone else casts an uncast ballot only as
  its voter before the opening day (the row's `member_id` moves to them), and a cast one stands.
  So a lapsed Acting President can't vote, the returning President can, and a VP named at opening
  keeps the ballot when a President is seated after it opened: a seat that starts on or after the
  opening day neither takes a chapter's ballot nor takes it away, and no one officer can choose who
  casts on a vote that is already open (`started_on` is a date, so "before the day" keeps a
  same-day seat out). A roster claim is the 17.6 exception: claimed seats are terms from 1/8/2026,
  so a claimant takes their chapter's uncast ballot. While a voted cover of a President that
  started after a vote opened runs, the chapter's ballot on it waits, and the request and confirm
  warn: "North can’t cast its ballot on 2 open NEC votes while this runs, so they may close
  without quorum (11.2, 11.5)." The app's `Vote` gains `electorChapters` for NEC votes.
- **The live app reads votes only through `club_business()`** (the tables are revoked,
  `meetings_votes.sql:88`). Its JSON gains `acting_request` and `elector_chapters` (elector to
  chapter, NEC votes only), and it lists an NEC vote to whoever would take a chapter's uncast
  ballot (`nec_voter_before`), so a VP who takes one sees it. The app's `canSeeVote` does the same.
- **Opening a vote** warns when it closes after an elector's stint ends: "Jet's acting ends 13/12.
  Close before then, or Smokey votes for North instead."
- **The casting vote** goes to whoever has the chair's duties when the vote closes (`chair_of` at
  close, as now).
- **`nec_voter_for`**: the President with duties who isn't the NEC Chair (an Acting President
  counts). Failing that, it's today's VP fallback, which reads only a non-acting VP row that no
  cover points at. A VP takes part "only while formally acting" as President (11.2), so an Acting
  VP or a VP's stand-in never casts the NEC vote. `chair_of`'s VP fallback reads the duty VP row
  instead: 10.9 puts the VP next in the chair, and an Acting VP or a VP's stand-in has the VP
  seat's duties, so they chair. Leaving the NEC Chair out of the VP branch belongs to the 11.2
  Chair follow-on.

## Money (13.3)

- Chapter fund: approvers are board members (unchanged). The stand-in was one already. An Acting
  Treasurer keeps only their own chapter's books.
- Club fund: no acting row keeps its books or approves its spending.
- **Independent approvers.** 9.5 speaks of "the two-independent-approver control in clause 13.3".
  "Put there by" means the acting row's `appointed_by`, or the `requested_by` of the request it
  was confirmed from. "Stands only through acting" means no non-acting held board row in that fund
  and no `nec_chair` or `nec_secretary` row. The member approving is judged by their rows now, and
  each approver already counted by their rows on the day they approved, read against them: an
  acting row held at any time that day, a non-acting one only if held all day. So stepping down or
  lapsing after approving changes nothing, and a same-day step-down or seating can't make them
  look independent. In `approve_debit`, in `record_debit`'s automatic
  approval and in the app's ledger guard, an approval is refused in either order from:
  - a member who stands only through acting rows that the entry's recorder, its payee or an
    approver already counted put there;
  - a member who put there an approver already counted who stands only through acting rows;
  - a stand-in covering the payee's seat. Their reimbursement goes to the other approvers. The app
    records no predesignated alternates (13.3), so this rests on 9.5's two-independent-approver
    control.

  Words: "You're acting because <name> put you there, so you can't be the second approver on their
  entry (13.3)." and "<name> is acting because you put them there, so you can't be the second
  approver after them (13.3)." The parity cases cover each, in both orders.

## Rules tightened for everyone

These are three small fixes the acting work exposed. Each one only takes power away from someone
who no longer has a right to it.

1. A board ballot can't be cast after the voter's board seat has ended (8.5, "currently holding
   office"). Today a removed or resigned member still votes on anything opened before.
2. NEC ballots belong to the chapter (11.2, 11.6, "joins and leaves the NEC with that internal
   office"). A named voter who is neither the chapter's voter now nor its voter before the opening
   day can't cast one, and an uncast one passes only to its voter before the opening day (for an
   agreed cover, judged by the holder's row). A VP named at opening keeps it when a President is
   seated after it opened, and that President doesn't take it, so a seating never costs the
   chapter its ballot.
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
acting_request uuid null references public.acting_requests(id)  -- the request it was confirmed from
ended_reason  text null check (ended_reason in ('stepped_down','holder_back','removed','replaced',
                                                'lapsed','forgotten','renewed','left_board'))
check (acting_until is null or acting_until >= started_on)
check (acting_why is null or char_length(btrim(acting_why)) between 1 and 120)
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
  still holds. A roster claimant whose board seat holds empty-seat acting ends that row first
  (`replaced`, logged): the sheet records their 2026 election (17.6), so the seat was never a 9.8
  casual vacancy. A seat with a holder still gets its `unique_violation` and is skipped as today.
- `one_acting_per_member` is unique on `(member_id) where ended_on is null and acting_until is not
  null`. `one_open_role_per_member` stays, which stops anyone acting in a seat they hold. Index
  `covers` where not null.
- **A trigger checks `covers`.** It must point to an open, non-acting row in the same chapter and
  role, started on or before the cover. The covered-row-ends trigger is described under "How it
  ends". `on delete restrict` is safe because positions are never deleted outside tests: the
  members row outlives the account, and `forget_member` deletes only future-dated rows, which a
  cover can't point at.
- **A seat lock and a person lock.** `private.lock_seat(chapter, role)` (`pg_advisory_xact_lock`)
  runs first in every writer that touches a seat: `appoint_position`, `appoint_acting`,
  `confirm_acting`, `end_position`, `set_acting_until`, `add_roster_position`,
  `settle_chapter_proposal`, `renew_auditor`, and the request RPCs. Then
  `private.lock_people(uuid[])` locks every member the writer checks (the target, the stand-in, the
  holder, the row's member), in uuid order. So the checks that span two seats can't race:
  `COVER_FROM_BOARD` against the `left_board` cascade, chair and books, and `OWN_SEAT_COVERED`. A
  writer that starts from a row reads it without a lock, takes both locks, runs the lazy close, then
  reads it again `for update` and checks that fresh copy.
- `public.acting_requests` (`id, chapter_id, role, member_id` = stand-in, `covers, until, why,
  requested_by, created_at, closed_at, outcome`, where `outcome` is `confirmed`, `withdrawn`,
  `lapsed` or `rejected`). One open request per board seat. The chapter's board and the stand-in can read
  it, and only the RPCs write it.
- `public.acting_changes` (`id bigint generated always as identity primary key, position_id,
  chapter_id, old_until, new_until, changed_by, changed_at, note`). The chapter's board
  and the Auditor can read it.
- Both tables have row-level security on, `revoke all ... from anon, authenticated`, and `grant
  select ... to authenticated`. Their policies wrap the caller as `(select auth.uid())`. Every new
  foreign key (`positions.acting_vote`, `positions.acting_request`, `positions.covers`,
  `votes.acting_request`, `vote_electors.for_chapter`, and each member, position and chapter column
  of the two tables) gets a `<table>_<column>_idx` index, as `performance_tidy.sql` does, so
  `performance_test.sql` and Supabase's performance advisor stay clean.
- `votes.acting_request` (null unless it's an acting vote). `isRemovalVote` becomes "a chapter
  vote naming a role, and not an acting vote". `vote_electors.for_chapter` is for NEC votes. Open
  NEC votes are backfilled from the chapter of each elector's open President or VP seat, else
  their own chapter.
- App: `Position` (`types.ts:117-124`) gains optional `actingUntil`, `covers`, `actingWhy`,
  `actingVote`, `actingRequestId`, `appointedBy` and `endedReason`, mapped in `liveData.ts:317-324`. They're optional, so the ~53 test literals and
  old offline copies still load. `database.types.ts` is regenerated.

## Ending on its own, with no scheduled job

1. **Read-time check (database).** The three views above. A lapsed row has no power from Melbourne
   midnight, closed or not.
2. **Lazy close (database).** `private.close_lapsed_acting()` sets `ended_on = acting_until + 1,
   ended_reason = 'lapsed', ended_by = null` on lapsed rows, so the partial indexes are free
   again (they can't use `club_date()`). It closes requests that are past their until date or 28
   days old (`lapsed`), and those with a vote closed `lost` (`rejected`). Every
   writer above calls it first, and so do
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
  the stand-in isn't the VP, the Why is labelled "Why not Jet (VP)?". Appointing the acting person
  in full says "This ends Crank's acting". The done message is "Crank is Acting Treasurer
  until 13/12/2026." An acting seat shows "Acting until DD/MM/YYYY", "Change date", and either
  "Start a vote to end acting" or "Step down from acting" for the acting person. It has no "Start
  removal vote".
- **The away holder's Manage member page.** "Arrange cover (board vote)" starts route 3. Its
  confirm text repeats the warnings.
- **Me, for a board holder.** "Arrange cover while I'm away" lists the stand-ins this seat allows.
  Choice labels carry the person: "Jet (VP)". The `ConfirmButton` note lists what moves and what
  stays: "Jet chairs North and casts its NEC vote until 13/12/2026. You keep your seat, board vote,
  approvals and board records. You're off the NEC until then." It also lists the warnings (9.6,
  9.7, and 9.5 for a combined-duties stand-in). The holder's own open request shows with
  "Withdraw request".
- **Board tab.** Open requests show to board members who can confirm: "Smokey asked for Jet to
  cover as President until 13/12/2026: Smokey overseas", with a "Confirm cover" `ConfirmButton`.
  The holder, the stand-in ("Decline") and, until a vote on it opens, the requester see
  "Withdraw request". When the VP casts the chapter's NEC vote through the
  fallback, the chapter's board sees "Jet casts North's NEC vote without being formally Acting
  President (11.2)" with "Make Jet Acting President". That button shows only where
  `appointActingProblem` allows it.
  "Attendance and terms" lists stints apart. For empty seats: "Acting until 13/12/2026: hold the
  election at the ACM, change the date or let it end. If Crank stands, the VP or an elected person
  chairs that vote (9.9, 10.9)." For covers: "Smokey takes back the seat on 14/12/2026." Both turn
  warning colour in the last 7 days. "You act for West" and "Acting is each chapter board's"
  (`board.tsx:180-190`) become "You sit on West's board" and "Each chapter's board runs its own
  business". `termEndsOn` returns `actingUntil`.
- **The covered holder, on Me and Home.** "Jet is acting as President (North) until 13/12/2026.
  Until then Jet chairs and casts North's NEC vote. You keep your seat and board vote." Below it
  sits "I'm back" (a `ConfirmButton`). A test shows the button on the covered holder's screen.
  Their step-down confirm adds the step-down words under "How it ends".
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
    `agm` scheduled.
  - "Crank's acting runs past North's ACM on DD/MM (9.8)".
  - "Smokey's seat has been covered for more than three months in a row (9.5 review)".
  - "Jet casts North's NEC vote without being formally Acting President (11.2)", when the
    President seat is empty and the VP fallback applies. The Auditor sees it with no button,
    because the Auditor can't record a President. The button is on the chapter's Board tab. It
    doesn't fire for the Chair-and-President case, which is the follow-on.
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
    midnight without a reload; the saved copy; the four readings; a cover ending with the covered
    row.
  - `access.test.ts`: every `actingProblem` refusal and warning; caps from 30/11 and 31/01, against
    a scheduled or passed ACM (`RUN_OVER`), and across stints under and over four weeks apart; the
    route-1 VP seated before the seat fell empty; the end branches (acting person, holder, board
    without and with a vote); a full appointment over acting (only the acting person); the Auditor
    in a second seat; one stint; chair and books apart; hiatus; licence.
  - `votes.test.ts`: North keeps three board electors under a cover; acting votes leave out the
    stand-in, the holder and the Auditor; the cast-time board check; NEC ballot pass-over, none to a
    voter who started on or after the opening day but for an agreed cover or a roster claim, and the
    VP named at opening keeping it when a President is seated after; `canSeeVote` for that voter;
    no early close of acting votes; `chairOf`; `necVoterFor`; acting votes aren't removal votes.
  - `ledger.test.ts`: the Acting Treasurer keeps only the chapter's books; no acting row on the
    Club fund; the independence refusals in both orders, after a step-down or lapse too.
  - `terms`, `home` (titles, NEC rows), `audit`, `history`, `demoFresh`.
  - A source test fails on any inline open-row check (`endedOn === null`, `== null`, `!p.endedOn`)
    outside `acting.ts` and `access.ts`.
- **`npm run test:db`.** A new `supabase/tests/acting_test.sql`, with `club_date()` overridden in a
  transaction:
  - the index pair (an elected and an empty-seat acting row clash; a cover doesn't);
  - the `covers` trigger, and the covered-row-ends trigger: the covered holder steps down, the
    cover ends, and re-appointing them in full leaves one row with duties;
  - every RPC route and refusal, and the caps;
  - the lazy close;
  - a lapsed but open row losing every power (`is_board_of`, `approves_for`, `keeps_books`,
    `electors_for`, `nec_voter_for`, `chair_of`, `push_applicant`, `sees_board_of`);
  - a roster claim ending acting in its seat;
  - the seat and person locks, as two-session tests (two writers on one seat, two confirms of one
    request, a confirm racing the stand-in's other seat ending, and a confirm racing a full
    Treasurer appointment), plus a catalogue test that every seat writer calls `private.lock_seat`;
  - `club_business()` read back as the caller, with `acting_request` and `elector_chapters`.

  A catalogue test scans every function body and every policy (`pg_policies.qual` and
  `with_check`). It fails on any text that mentions `positions` unless it reads one of the three
  views or sits on a short allow-list with a one-line comment for each entry: the writers,
  `has_carried_nec_vote`'s history read, and the views themselves.
- **Parity** (`supabase/tests/parity.json`). Each case gets optional `with` (extra position rows:
  `actingUntilDays`, `covers`, `why`, `appointedBy`), `withRequests` and `withVotes` lists, inserted
  after `begin;` in `parity-sql.mts` and added in `fixtureData` on the app side. The shared 12 rows
  and the existing 1,400 answers stay as they are. New actions: `appointActing`, `requestCover`,
  `requestActing`, `withdrawActingRequest`, `confirmActing`, `setActingUntil`, `openActingVote`. A case
  can name its exact refusal (`refusal`; chat cases already use `message` for the message they act on). About 50 cases:
  - each route and each refusal, including the Auditor in a second seat;
  - ending by each person, and by the board with and without a vote;
  - a full appointment ending acting;
  - North opening a board vote with three electors while Jet covers Smokey;
  - the independence refusals, in both orders and through a request;
  - a President seated after an NEC vote opened neither taking its ballot nor taking it from the VP;
  - a lapsed row still open (`actingUntilDays: -1`) that can't `approveDebit`, can't `castBallot`,
    gets no `openVote` ballot and leaves its seat free to `appoint`. That group proves expiry
    needs no cron.

## The live SQL step

One migration, `supabase/migrations/20270870000000_acting_roles.sql` (`main` already has
`20270860000000`), contains:

- the columns, checks, two tables, triggers and the `votes`/`vote_electors` columns, with the NEC
  backfill;
- the index swap (the first `drop index` in the migrations, after its replacement exists, then a
  rename);
- the three views and `close_lapsed_acting`;
- the re-pointed helpers (`create or replace`, same signatures);
- the new RPCs (new names, so no overload to drop) and the edited ones (`appoint_position`,
  `end_position`, `cast_ballot`, `approve_debit`, `record_debit`, `open_vote`, `close_vote`,
  `has_carried_removal_vote`, `club_business` and the other writers, same signatures).

Grants follow the repo's pattern (`removal_and_gate.sql:230`). The migration runs `revoke all ...
from public, anon` on every new RPC, then grants execute to `authenticated`. It revokes `public,
anon, authenticated` on every new `private` function (helpers and trigger functions alike, since
the 2026 blanket grant at `review_fixes.sql:125-126` covered only the functions that existed then)
and on select on the three views. New readers are `stable security definer set search_path = ''`.
Every existing row gets `acting_until` null, so nothing changes except the three tightenings.

There is one paste-queue item, `build/acting_roles.sql`, byte for byte the same. Before Run, the
"Apply pending SQL in Supabase" thread checks read-only that every function the migration replaces
has a live body whose md5 matches the repo's latest definition, and that `one_holder_per_board_seat`
is still the `foundations.sql:110-113` index. That way a live hotfix never merged into the repo
isn't silently overwritten. After Run, read-only checks confirm the columns, indexes (with
`covers IS NULL` in the board-seat index), views, triggers, row-level security and grants on the
two tables, the two vote columns, and the md5 of every replaced body. Under Jeff's rule of 1 Nov
2026 Claude presses Run itself; if a guard blocks the press, Jeff gets the one press that is left.
The SQL goes first, then the changed screens are checked in the live build at 390×844, then the app
ships as an over-the-air update (no `app.json` change). An old app shows acting rows as plain titles
while the database enforces the rules.

## The empty-seats-only variant (not chosen; the fallback cut)

Jeff picked both kinds on 15/11/2026. This section stays so covers can be cut cleanly if the
build or a review shows they cost more than they give.

None of the cover attack surface either reviewer found applies here. One board member can already
fill an empty non-President seat for a full term (`audit_fixes.sql:242`). For President, only a
VP seated before the President seat fell empty is recorded without a vote, which adds the title and NEC business (8.2, 11.2) to the
chair and NEC vote that the VP fallback already gives. Otherwise empty-seat acting gives nobody a
power one board member can't give today.

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
3. Acting only in chapter roles: board seats (empty or covered) and non-board roles (no covers).
   Never national seats, Founder or titles.
4. A cover moves only the seat's own duties. The covered holder keeps board membership: ballot,
   quorum place, chapter approvals and board records (8.1, 8.5, 9.5). The stand-in must already be
   on that chapter's board.
5. Nobody acting reaches club-wide. That means no Club fund books or approvals, no shop, and no
   other chapters' private details, while an Acting President still takes part in NEC business.
   (Money and member data: Jeff's yes, question 2.)
6. The chapter board's members record acting seats, and NEC officers have no part. One board
   member records an empty seat, mirroring today's full appointment. For President that's only the
   sitting VP, seated before the seat fell empty (8.2). Anyone else as President needs a board vote (8.2, 9.8), whether or not the
   chapter has a VP.
7. An agreed cover is asked for by the holder and confirmed by a third board member. It records
   the holder's arrangement (9.5) and isn't an 8.5 Board decision.
8. A voted cover, for a holder who can't be asked, is a board majority (Jeff, question 3). The
   stand-in, the holder and the Auditor are left out of the vote (8.5). It stays open 48 hours,
   can't be closed sooner, and the holder gets a push.
9. The holder can always end a cover of their own seat, and the acting person can always step
   down. Anyone else needs a carried board-majority vote naming the acting row (the majority shape
   9.3 gives a Non-Board removal; its notice step is a known gap, as for every removal).
10. Caps run from the start of the run. An empty board seat runs to the first ACM in its run,
    held or still to come, never more than 12 months, or six months if none is saved, and stints
    under four weeks apart share one run. A non-board stint runs six months. A cover runs three months, and past that needs a
    new cover.
11. One stint per person. Chair and books stay apart (for full appointments, only against an
    acting row). Hiatus is refused for every ride-leader role. A recorded licence must last the
    stint. A reason is required.
12. 9.6 family, 9.7 licence vacancy and 9.5 combined duties are warnings, and 9.4 shows only where
    it fits.
13. A full appointment to a board seat ends empty-seat acting only for the acting person, or a
    roster claimant (17.6); anyone else waits for a step-down, a board vote or the stint's date.
    When a covered row ends, the cover ends with it.
14. Board ballots are checked when cast. NEC ballots belong to the chapter and go by rows that
    started before the opening day (an agreed cover by its holder's row, a roster claim from
    1/8/2026), so a seating after opening neither takes nor removes one.
15. Independent approvers (13.3, 9.5): no approval pairs someone with the person who put them in
    the seat, in either order, judged as each stood when they approved, and no approval comes from
    the payee's own stand-in.
16. Three tightenings for everyone: board ballots after a seat ends, NEC ballots belonging to the
    chapter, and the Auditor seating Presidents and Treasurers.
17. `ended_reason` on every ending, and a log of every date change. `ended_on` is the first day
    without the seat.
18. No cron job: a read-time check, a lazy close, and an app settle keyed on a ticking `today`.
19. Reminders go on the phone to the acting person and the covered holder.
20. The 11.2 Chair-and-President vote is a follow-on, and the VP fallback stays until then.
21. No 8.6 NEC fallback in the app: where conflicts leave fewer than three, it says to refer it to
    the NEC.
22. On acting votes the conflicts are known from the data, so the app leaves those people out (8.5,
    11.10). Other votes keep the note, as today.
23. Acting stints stay out of the hall of fame and aren't a 9.4 served term.
24. The demo seed is Crank, Acting Treasurer (North), in an empty seat.
25. Not fixed here, seen: `one_holder_per_national_role` also covers Founder, so live allows one
    open Founder row and `add_roster_position` skips a second silently. `approvesFor` lets an
    Auditor in another board seat approve chapter spending. A board member who fills an empty seat
    in full can then be that person's second approver; the independence rule covers acting only.
    `nec_voter_for`'s VP branch doesn't leave out the NEC Chair (11.2), which goes with the Chair
    follow-on. One board member can re-seat someone in full right after a 9.3 removal. Any board
    member, a conflicted one included, can close a vote (9.9); on acting votes that decides
    nothing, since none closes within 48 hours and a tie on a vote about a member is lost (10.7).
26. Readers this spec didn't name, sorted by the plan: the feedback inbox and other chapters'
    chapter chats are club-wide; `club_audit` and `assistant_status` are NEC business (duties);
    road-rules sign-off chapters and `can_designate_big4` read duties.

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

A third read (an abuse lens, a constitution lens, a database lens and a plan lens) raised 3
Critical, 26 Important and 25 Minor findings against the second draft. Each was checked against the
code and the constitution. Two are put to Jeff (questions 4 and 5), and the rest are fixed above:

- route 1 for President is the sitting VP only;
- voted routes leave out conflicted people (8.5);
- a minimum open time of 48 hours and a push to the holder;
- NEC ballots pass only to voters in place at opening;
- a full appointment replaces acting only when it records the election;
- caps run across back-to-back stints, with a 12-month ceiling and ACMs only;
- extending a voted stint needs a new vote;
- the VP-based President stint ends with the VP seat;
- independence applies in both orders and through requests;
- person locks;
- hiatus and licence checks;
- the Auditor is off acting electorates;
- chair and books apply to full appointments only against acting rows;
- `club_business()` carries the new vote fields;
- the performance and grant rules;
- pre-apply checks of the live bodies.

A fourth read (abuse, constitution and build lenses) raised 8 Important and 21 Minor findings.
Each was checked against the code and the constitution, and all hold; one (grants) needed a
narrower fix, as older `private` helpers keep their grant for policies. Fixed above:

- a full appointment ends acting only for the acting person or a roster claimant, with no meeting
  lookup, and an ACM already held never caps (the fifth read reverses this);
- only the requester, stand-in or holder withdraws a request, and only a `lost` vote rejects one;
- NEC pass-over goes by start day (before the opening day), the voter named at opening keeps
  their ballot, and an agreed cover is judged by its holder, with a warning for voted stints;
- each counted approver is judged as they stood the day they approved;
- the holder hears of every confirm, and repeated requests push once a day;
- re-recording someone within 90 days of a vote that ended their acting needs a vote, and route
  1's NEC business is named;
- the Acting VP and a VP's stand-in chair (10.9); seat checks are for board seats; citations and
  question 4 are corrected.

A fifth read (abuse, constitution and build lenses) raised 12 Important and 14 Minor findings.
Each was checked against the code and the constitution, and all hold. Three are closed by a
smaller change than the one suggested: the 48-hour floor at close instead of a closer rule, a 9.3
vote that outlasts a step-down instead of refusing acting during an open removal vote, and a strict
reading of the approval day instead of a snapshot. Fixed above:

- NEC ballots go by rows that started before the opening day, so a seating after opening neither
  takes nor removes one and the voter it moves to can see it; a roster claim is the 17.6
  exception; a cover counts as agreed only with no vote behind it; the warning names quorum;
- the route-1 VP must have been seated before the President seat fell empty;
- a 9.3 removal outlasts a step-down and re-recording and counts for `ENDED_BY_VOTE`, which a full
  board-seat appointment checks for a vote that ended acting;
- a covered holder's own row ending ends the cover, so re-election re-seats them; the conversion
  to empty-seat acting is gone;
- a run's ACM caps it even once held, and stints four weeks apart start a new run;
- acting votes can't close within 48 hours; any lost vote rejects a request, its requester waits
  28 days, and the requester withdraws only before a vote opens;
- counted approvers are read strictly on their approval day; the 13.3 alternates claim is gone;
- the open-request index covers board seats only.

## Questions for Jeff

1. **His card**: answered 15/11/2026, both kinds.
2. **Money and member data**: answered 15/11/2026, "Go as designed". Acting people do their own
   chapter's job only: no Club fund, shop or other chapters' private details, and the independence
   rule applies to approvals.
3. **A cover without the holder's say**: answered 15/11/2026, yes. A board-majority vote can cover
   a holder who can't be asked, and they end it with "I'm back".
4. **The VP for a President who can't be reached**: Claude's call, not built. Jeff's card says a
   cover comes from the holder's own request or a carried board vote, and a VP covering without
   either would widen that. Both real chapter boards have five or six members. For a President or
   Treasurer seat the stand-in, the holder and any Auditor on the board step out (8.5, 11.8), so a
   five-member board with the Auditor on it has two electors left (`SMALL_BOARD`), and one without
   has three, who must all vote (`min_quorum` is at least three, 8.5). A six-member board keeps
   three or four. Where the board can't decide, the 8.6 words refer it to the NEC. Revisit if a
   board drops below six, or the Auditor sits on a five-member board.
5. **A covered President and the NEC**: settled by Jeff's card. The design he approved said "You're
   off the NEC until then": the Acting President takes the chapter's one NEC seat and vote while the
   cover runs, so a chapter never has two NEC members (8.2, 11.2).

## Appendix A: Words

Exported constants in `access.ts`, `votes.ts` and `ledger.ts`, with the same text in SQL. The plan's tasks name them.

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
| `PRESIDENT_NEEDS_BOARD_VOTE` | Anyone but the sitting VP needs a carried board vote to act as President (8.2, 9.8). |
| `ENDED_BY_VOTE` | A carried vote ended their time in this seat in the last 90 days. Acting there again needs a new board vote. |
| `WHY_NEEDED` | Say why, in 120 characters or fewer. |
| `untilRange(cap)` | Pick an until date from today to DD/MM/YYYY. |
| `RUN_OVER` | Acting in this seat has reached its limit (its ACM, or six or twelve months), so it can’t start or run longer. Seat someone in full (9.2, 9.8). |
| `ASKED_RECENTLY` | The board voted down your request for this seat in the last 28 days. |
| `SMALL_BOARD` | Too few board members outside this can decide it in the app. Refer it to the NEC (8.6). |
| `LICENCE_ENDS` | Their recorded licence ends before the until date (9.7). |
| `RECORD_INSTEAD` | This doesn’t need a vote. Record it as acting, or ask for cover from your own seat. |
| `ACTING_VOTE_OPEN` | A vote about acting stays open for at least 48 hours, so everyone affected can answer. |
| `REPLACE_NEEDS_END` | Someone is acting in that seat. They step down first, or a carried board vote ends their acting. |
| `AUDITOR_STAYS_OUT` | The National Auditor doesn’t seat or unseat a President or Treasurer (11.8). |
| `BOARD_RECORDS_ACTING` | Only that chapter’s board can record acting here. |
| `NOT_YOURSELF` | You can’t record yourself as acting. |
| `OWN_SEAT_ONLY` | You can only ask for cover of your own board seat. |
| `NO_REQUEST` | That request isn’t open. |
| `CONFIRM_NOT_STANDIN` | The stand-in can’t confirm their own acting. |
| `CONFIRM_NOT_HOLDER` | A third board member confirms the cover you asked for (9.5). |
| `NEEDS_ACTING_VOTE` | This needs a carried board vote on the request in the last 90 days. |
| `NO_VOTE_NEEDED` | This request doesn’t need a vote. A third board member confirms it. |
| `SEAT_ENDED` | The seat they asked to cover has ended. |
| `WITHDRAW_WHO` | Only the stand-in or the holder can withdraw this, or the person who asked before a vote on it opens. |
| `NOT_ACTING` | That isn’t an acting seat. |
| `UNTIL_NOT_PAST` | Pick today or later. To end it now, step down. |
| `EARLIER_WHO` | Only the acting person or the holder can bring the date forward. |
| `LATER_WHO_EMPTY` | Only another board member can give this more time. |
| `laterWhoCover(holder)` | Only Smokey can keep this cover going longer. |
| `VOTED_NEEDS_NEW_VOTE` | The board voted for this stint, so it needs a new vote to run longer. |
| `ACTING_END_NEEDS_VOTE` | Ending someone’s acting needs a carried majority vote of the chapter board in the last 90 days (9.3). |
| `ACTING_END_SHAPE` | Ending someone’s acting is a majority vote of the chapter board (9.3). |
| `CAST_BOARD_ENDED` | Your board seat has ended, so this ballot isn’t yours now. |
| `castNecNotYours(ch)` | You don’t cast North’s NEC vote now, so this ballot isn’t yours. |
| `castNecCast(ch)` | North’s NEC ballot has already been cast. |
| `necBallotsWait(ch, n)` (warning) | North can’t cast its ballot on 2 open NEC votes while this runs, so they may close without quorum (11.2, 11.5). |
| `independentSeated(name)` | You’re acting because Penny put you there, so you can’t be the second approver on their entry (13.3). |
| `independentPlanted(name)` | Spanner is acting because you put them there, so you can’t be the second approver after them (13.3). |
| `coverPush(...)` | Crank asked for Jet to act as President (North) for you until 13/12/2026. If you’re available, tap I’m back. (On every confirm, the holder's own request included: Jet is acting as …) Titles: Cover asked for your seat (a request); Your seat is covered (a confirm). |
| `independentStandIn(name)` | You’re covering Torque’s seat, so their payment goes to the other approvers (13.3). |
| `COVERS_POINT` (trigger) | A cover must point at the open holder of the same seat. |

Existing texts are reused unchanged: the not-a-member, already-hold, board-ends-this, already-ended (also `set_acting_until` on an ended row), `hold_problem`, delete-account, `set_member_status` and `open_vote` quorum and closing texts.

## Appendix B: The `is_national` callers (21 live, in 15 of the 24 files; the other 9 hold dropped or superseded copies)

- **Member data → Club-wide** via `private.sees_every_chapter()`: `sees_board_of`'s national branch, and `chat_problem` at `family_chat.sql:45`.
- **NEC business → stays Duties:** `chat_problem` at `family_chat.sql:51, :54`, `sees_scope`, `runs_scope`, `can_moderate`, `is_any_board`, `manages_ride`, `manages_chapter_rides`, `manages_ride_category`, `manages_bus`, `manages_site_photo_crew`, `can_run_checkin`, `publish_road_rules`, `propose_contribution`, `withdraw_contribution`, `propose_chapter`, `settle_chapter_proposal`, `withdraw_chapter_proposal`, `club_audit`, `assistant_status` and `set_member_status`.
