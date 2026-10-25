# Constitution v4: audit of the app, and the fixes

**Date:** 25 Oct 2026 · **Kind:** architectural (touches rules, database and screens across lanes) · **Approved by:** Claude (self-approval, Jeff can veto)

**Source:** Rustnuts SMC Constitution v4, Final Club Edition (published 25 Oct 2026). Copies: `/mnt/project-files/reference/Rustnuts SMC Constitution v4 2026-10-25.pdf` and `.txt`. It replaces the 29 Jul 2026 draft the app was built against. Section numbers below are v4's.

v4's big new idea is the split between **internal Club business** (this constitution: patches, chapter roles, rides) and **Association business** (the CAV Registered Rules: legal membership, the statutory AGM, legal discipline, proxies). The app runs internal Club business. Where v4 hands something to the Association Committee, the app records it but doesn't decide it.

## 1. What already matches v4

| Rule | v4 | Where in the app |
|---|---|---|
| Introduction phase: 3 months, 2 meetings, 1 ride | 4.2 | `joining.ts` `INTRO` |
| FNG reviews at 6 months, from 9, at 12, then every 3 | 4.7, 4.10 | `joining.ts` `fngDue` |
| Patch vote: confidential, every eligible Home Chapter Full Member votes yes, only the result kept | 4.8, 4.9 | `votes.ts`, `close_vote` |
| Patch vote opens no earlier than 9 months | 4.6, 4.7 | `votes.ts` `patchVoteTooEarly` |
| One vote each, Nomads only on national votes, no proxies | 10.7 | `votes.ts` `electorsFor` |
| Chapter quorum a third of eligible Full Members; NEC 51% of filled chapter seats | 10.6, 11.5 | `votes.ts` `defaultQuorum` |
| NEC: one vote per chapter by its President (acting President if the President chairs the NEC); the Chair only breaks ties | 11.2 | `votes.ts` `necVoterFor` |
| Chair: President, then VP; National Chairperson for national and NEC | 10.9 | `votes.ts` `chairOf` |
| Majority means more than half of votes cast; abstentions aren't votes cast | 2.4 | `votes.ts` `decide` |
| Draft minutes due within 7 days | 10.8 | `meetings.ts` `MINUTES_DUE_DAYS` |
| Board is the six offices; Officer, Tail Gunner, Social Media Officer are Non-Board | 8.1, 8.2 | `labels.ts` `BOARD_ROLES`, `CLUB_ROLES` |
| Extra Non-Board roles (Ride Committee, Club Coach, Charity Committee, Assistant Tail Gunner) | 8.3 | allowed as chapter-created roles |
| Tail Gunner must hold current First Aid | 8.2 table | `crew.ts` `eligibilityProblem` |
| Only Full and Nomad members crew a ride | 8.2, 9.1 | `crew.ts` |
| Ride-safety order: RC, SAA, VP, President, NEC | 7.6 | `briefings.ts` `SAFETY_ORDER` |
| Road Rules: RC one-ride change, NEC publishes | 7.10 | `roadRules.ts`, briefing "Changes for this ride" |
| Financial year 1 July to 30 June | 13.5 | `fees.ts` `fyOf` |
| Nobody handles money on their own fees | 13.3 spirit | `fees.ts` `NOT_YOUR_OWN` |
| Member disc only on Full and Nomad | brand rule, 6.4 | `src/ui` |

## 2. Gaps fixed in this change (branch `claude/project-thread-et6ovu`)

Each one: the rule, what the app did, what it does now. Domain and database change together, with shared parity cases.

**A. Who can hold a Club Position (4.6, 5.8, 9.1, 11.6, 11.8).** FNGs, Supporters and anyone not patched can't hold any internal office. Nomads can hold Non-Board roles only, not a Chapter Board or national seat. Every NEC holder must be a Full Member. The National Auditor can't also be a Chapter President, Chapter Treasurer or National Treasurer.
*Before:* `appointProblem` / `appoint_position` only refused Legacy members.
*Now:* appointing refuses with: "Only Full and Nomad members hold Club positions (4.6, 5.8).", "Nomads can’t hold a board or national seat (9.1)." (which also keeps national roles to Full Members, 11.6), and "The National Auditor can’t also be a President or Treasurer (11.8)." (checked both ways). Manage member hides roles they can’t hold and says why.
*Not enforced, shown instead:* the two-year Full rule for board nominees (9.1) and the full-term rule for President and VP (9.4). Both have exemptions (founding officers, a two-thirds NEC waiver) the app can't see, so the Appoint screen shows a warning line rather than refusing.

**B. Status changes can't skip the patch vote (4.9, 5.6).**
*Before:* a board could set an FNG straight to Full from Manage member, and the "Patch" review outcome only needed the board's own tally (one for, none against).
*Now:*
- FNG to Full (by status change or by a "Patch" review) needs the member's patch vote to have closed Carried: "Full membership needs a carried patch vote of the chapter’s Full Members (4.9)." The board's tally on the review is still recorded but no longer decides it.
- Supporter, Legacy, Family or Introduced back to Full or Nomad is a reinstatement or transfer the NEC authorises (5.6). Jeff's call (25 Oct 2026): it needs NEC approval, not one NEC member. So it needs a carried NEC majority vote about the member, closed in the last 90 days (inferred, so an old yes doesn't linger), and then their chapter's board (or the NEC) makes the change: "Coming back to Full or Nomad needs a carried NEC vote (5.6)." A club-wide vote with a subject is that reinstatement vote (NEC, majority, on a Supporter, Legacy, Family or Introduced member); a chapter one is still a patch vote. Manage member offers "Start NEC vote" to the NEC. Migration `20270301000100_nec_reinstatement.sql`.
- Moving someone to a status that can't hold office (FNG, Supporter, Family, Introduced) needs their positions ended first, as Legacy already did; moving to Nomad needs their board and national seats ended first.

**C. Learner riders can't become FNGs (3.2, 6.1).** Approving an applicant as FNG, or changing someone to FNG, refuses when their licence on file is a learner permit: "A learner permit rider can’t become an FNG yet (3.2)." No licence on file doesn't block (the board checks).

**D. The continuation fee is half the annual fee, paid once (4.11).**
*Before:* each chapter typed a continuation amount per year, and it could be charged again in a later year.
*Now:* it's worked out as 50% of the chapter's FNG fee for the year (rounded down to the cent) and charged once per member, ever. The separate "FNG continuation" amount field goes; `set_continuation_fee` refuses with "The continuation fee is half the FNG fee (4.11), so the app works it out."

**E. Meeting kinds and notice (10.2, 10.3, 10.4, 11.5).**
*Labels:* a chapter's "AGM" is an **Annual Chapter Meeting** (not the statutory AGM); the whole club's "AGM" is the **Association AGM**; the whole club's "General meeting" is a **National Club meeting**; a chapter's "General meeting" is a **Chapter meeting**.
*Notice:* a new meeting (or one moved earlier) must start at least this many days away: chapter meeting and special meeting 7; Annual Chapter Meeting, National Club meeting and Association AGM 14 (v4 10.4 and Registered Rule 33). Board meetings have no notice rule in v4. NEC meetings ordinarily need 7 days but an urgent one may go ahead on shorter notice with a majority's agreement (11.5), so the app warns instead of refusing. A meeting dated in the past is a record of one already held and isn't checked.
*Refusal:* "An Annual Chapter Meeting needs 14 days’ notice (10.4)." and so on.

**F. Section numbers and wording.** Comments, hints and PRODUCT.md cite v4's numbers (the old draft's 3.2, 5.2, 5.4, 9.1, 11, 13, 15.5 references move to 4.2, 4.7, 4.10, 8.1, 8.2, 11.2, 11.8).

## 3. Handed to the Stage 5 thread (it owns votes, minutes and Business)

Agreed with the "Build Stage 5 board and documents" thread on 25 Oct 2026:
- Board votes need at least three board members; quorum max(3, majority) (8.5). *In progress there.*
- The chair can decline a casting vote, and the motion is lost (9.10). *In progress there.*
- No casting vote on elections, discipline, Full Membership or amendments (9.10, 10.7). Needs a vote purpose.
- Some two-thirds rules count everyone eligible, not votes cast: national policy (16.2), expulsion recommendation (14.4A).
- National quorum also needs 51% of Active Chapters represented (10.6).
- The vote's subject and conflicted people stay out of the vote and the quorum (8.5, 11.10).
- The National Chairperson runs a patch vote when the President can't (4.8).
- Draft minutes circulated within 7 days, marked Draft, confirmed at the next applicable meeting (10.8). Today drafts are hidden and "approve" can happen any time.
- Treasurer (5B): two approvers other than the payee for every payment (13.3), deposit within 5 working days (13.1).
- Documents (5C): every controlled document shows title, version, approving body, approval date and commencement date (15.5); v4 itself goes in the library, free to members (15.7).
- Discipline (5D): two paths. Formal suspension or expulsion is the Association Committee's (appeal 7 days after the vote, hearing within 21 days of the appeal). Internal reviews of patch, ride and attendance decisions: request within 14 days of written notice, three impartial people, heard within 21 days, written decision within 14 (14.6A, 14.6B). A board expulsion recommendation is only a referral (14.4A).

## 4. Not built yet (later work, in priority order)

1. **Attendance rules.** FNGs need 50% of each designated category separately: rides, ordinary meetings, other events (4.6). Full Members need 80% of ordinary Home Chapter meetings and two Big 4 rides a Club Year (5.2, 5.11, part-year capped). Nomads: two of every three meetings and one Big 4 (5.7). Before a Big 4, two of the last three meetings (5.4). Needs: a Big 4 flag on rides (NEC-designated, in advance), activity categories on check-ins, exemptions, and the Club Year (AGM to AGM).
2. **Big 4 and Supporters.** Supporters can't join Big 4 Club-only rides (5.8). Needs the Big 4 flag.
3. **Terms.** Board terms are two years from the Annual Chapter Meeting; the current terms began 1 Aug 2026 (9.2, 17.6). Non-Board appointments run up to two years (9.2). Show "term ends" and flag expired terms.
4. **NEC powers.** v4's NEC is the Chair and the Chapter Presidents (11.2). Today the National Secretary and National Auditor get the NEC's full powers in the app (they count as "national"), including approving applicants in any chapter. The Auditor should see records (11.8), not run chapters. This touches row-level security everywhere, so it gets its own spec. There's also no National Treasurer role (11.2, 11.6).
5. **Status-change fairness (5.5).** Before an attendance-based status change, the member gets the record and 14 days to respond, then a board decision with written reasons and the review right.
6. **Licence loss vacates positions (9.7).** Flag a position holder whose licence has expired or isn't on file.
7. **Good Standing (2, 10.7).** Voting Members must be in Good Standing (dues current or an arrangement). The app doesn't stop someone with overdue fees voting. Question for Jeff before it's enforced.
8. **Records v4 adds:** vest and patch directions with a 12-month breach record (6.9), ride safety directions (7.9), conflict register (11.10), return of Club property within 28 days (13.7), Club IP approvals (15.1), amendment register (16.6).
9. **Meeting procedure:** adjourned meetings (10.11), motion deadlines 10/21/28 days (10.10), special meeting requests by three Voting Members or 10% nationally (10.5), the "last week of the month" default (10.1).
10. **New chapter and closure:** 5 patched members incl. Nomads, majority NEC (12.1); closure two-thirds of Presidents plus two-thirds national vote on 21 days' notice (17.2).
11. **Naming:** the annual signature run is the **Not Dead Yet Run**, formerly the President's Run (12.6). Nothing in the app names it yet.

## 5. Questions for Jeff (the app keeps working on the default meanwhile)

- **Family status.** v4 has no Family category (and says family alone doesn't make someone a Supporter, 5.8). The app's Family status is for partners and kids who use the app with no Club rights. *Default: keep it as an app-only label.*
- **Good Standing.** Should overdue fees take someone off a ballot automatically? *Default: no, until you say.*
- **12-month review outcomes.** v4 allows continuing as FNG, Supporter, or ending the trial (4.10). The app offers continue, patch, or Supporter. *Default: add "End the trial" later with the attendance work.*

## 6. Testing

- `npm test`: domain tests for A–E written first and seen failing.
- `npm run test:db`: new `supabase/tests/constitution_v4_test.sql`, plus parity cases in `parity.json` for appoint, setStatus, decideApplication, fngReview, setContinuationFee and saveMeeting.
- Typecheck, lint, an independent reviewer on the diff, and Impeccable checks on the changed screens (Appoint, Manage member, FNG review, Fees, meeting kinds) at 390×844.
- Live database: the migration goes to the live-DB thread as a paste file, `build/constitution-v4-members.sql`.
