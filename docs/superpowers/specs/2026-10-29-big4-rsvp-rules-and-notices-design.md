# Big 4 RSVP rules and the 5.5 notice

**Date:** 29 Oct 2026 · **Kind:** architectural (two new tables, a changed `set_rsvp` and `set_crew`, three screens) · **Approved by:** Claude (self-approval, Jeff can veto) · **Branch:** `claude/project-thread-9usowo` · **Migration prefix:** `20270510`

**Source:** Constitution v4 (25 Oct 2026): 4.12, 5.1, 5.4, 5.5, 5.8, 14.6A. Follows `2026-10-28-attendance-big4-terms-card-design.md`, whose "Next steps" listed these.

## What Jeff gets

- On a Big 4 ride, **Going** is only for FNGs, Full Members and Nomads who've made two of the last three official meetings of their chapter (5.4), or whom their board has excused for this ride. Supporters can't say Going (5.8), and nor can anyone else without Club status (introduced, family, Legacy). Maybe and Can't make it always work, the same as the Road Rules gate.
- A manager can't put an ineligible member on a Big 4's crew either.
- The board can **excuse a member from 5.4 for one Big 4** (work, family, health, injury or distance), from the ride screen, where it sees which of its members aren't eligible yet.
- The Secretary (or another board officer) can give a member a **5.5 notice**: the record, the proposed consequence and a respond-by date at least 14 days out. The member sees it on Me and can reply in the app. The board can withdraw it any time, and can only record that it has decided once the respond-by date has passed.

Nothing here changes anyone's status, charges anyone or sends a push. A notice is shown in the app only; push for notices waits for Jeff's OK.

## 1. Who can say Going on a Big 4 (5.4, 5.8)

Applies to every Big 4, whichever chapter it was designated for (it's still a Big 4 Club-only ride; *inferred, Jeff can veto*). Checked in `set_rsvp` after its existing checks (sign-in, approved, ride, cancelled, started, answer, Road Rules), and only for Going. Existing answers stay; a member who said Going and then stops being eligible sees the warning on the ride, not a removal.

Refusals, same words in app and database:
- Supporter: "Supporters can’t join Big 4 Club-only rides (5.8)." (already in `big4.ts`)
- Any status but FNG, Full or Nomad: "Big 4 rides are for FNGs, Full Members and Nomads (5.4)."
- Not eligible and not excused: "You need 2 of the last 3 meetings to ride a Big 4 (5.4). Your board can excuse work, family, health, injury or distance." (the number is `needed` and `of`, so "1 of the last 1 meetings" reads "the last meeting"; see `big4.ts`)

`set_crew` on a Big 4 refuses an ineligible target: "They need 2 of the last 3 meetings to ride this Big 4 (5.4)." (crew is Full and Nomad only already). In the live app, a manager who isn't the target's chapter board can't read their meetings or excuses, so the app leaves that one check to `set_crew`.

**Eligibility** stays `big4Eligibility` (three most recent ordinary or special meetings of the home chapter, held before the ride's date and by today, excused ones skipped, two needed or all if fewer). One change: meetings on the same day are ordered with the ones the member attended first, so the demo and database pick the same three whatever their ids. The database gets `private.big4_eligible(member, ride)` with the same rules.

## 2. Excusing someone from 5.4 for one Big 4 (5.4, 4.12)

**Table** `public.big4_waivers`: `ride_id` (cascade), `member_id` (cascade), `ground text check in ('work','family','health','injury','distance')`, `granted_by`, `granted_at`; primary key (ride, member). Readable by the member and their chapter's board (as exemptions).

**Action** `set_big4_waiver(p_ride, p_member, p_ground)`: a ground excuses, null clears.
- "That ride isn’t a Big 4."
- "That ride was cancelled."
- "That ride has already started."
- "Only their chapter’s board can excuse them." (`is_board_of`, as `set_exemption`)
- "Someone else on the board has to excuse you."
- "Pick work, family, health, injury or distance (5.4)."

UI: on the ride's Big 4 card, a board member sees "Not eligible yet" (their chapter's FNG, Full and Nomad members who aren't eligible) with **Excuse** (pick the ground), and "Excused" with **Clear**.

## 3. The 5.5 notice

**Table** `public.status_notices`: `id`, `member_id` (cascade), `chapter_id` (the member's when given), `about text check in ('attendance','dues')`, `record text` (1–2000), `proposal text` (1–500), `given_on date`, `respond_by date`, `given_by`, `response text` (≤2000, empty when none), `responded_at`, `outcome text null check in ('withdrawn','decided')`, `outcome_note` (≤500), `closed_on`, `closed_by`. Readable by the member and their chapter's board.

**Actions**
- `give_status_notice(p_member, p_about, p_record, p_proposal, p_respond_by)`: the board of the member's chapter (5.5's "Secretary or an appointed Officer"; the app can't see appointments, so any of that board; *inferred*), not yourself, to an approved FNG, Full, Nomad or Supporter. Respond-by at least 14 days after today. One open notice per member per kind.
  - "Only their chapter’s board can give them notice (5.5)."
  - "Someone else on the board has to give you notice."
  - "Notice is for FNGs, Full Members, Nomads and Supporters."
  - "Say what it’s about: attendance or dues."
  - "Set out the record." / "Say what’s proposed." (and length limits: "Keep the record under 2000 characters." / "Keep the proposal under 500 characters.")
  - "Give them at least 14 days to respond (5.5)."
  - "They already have an open notice about that."
- `respond_to_notice(p_notice, p_response)`: the member only, while open; replaces their reply. "No such notice.", "Only the member can reply to their notice.", "That notice is closed.", "Write your reply." / "Keep your reply under 2000 characters."
- `close_status_notice(p_notice, p_outcome, p_note)`: the member's chapter board, not the member. Withdraw any time; Decided only after respond-by ("The board decides after DD/MM/YYYY (5.5)."). A decision is recorded as a conduct record of kind Attendance (14-day review, 14.6A) and the status change made as today; the app links to both, it doesn't do them.

A notice stays with the chapter the member was in when it was given: if they move, their old board closes it (rare; a new notice can be given by the new board).

**No gate on status changes.** `set_member_status` isn't blocked by a missing notice: a member can ask to step down, and section 14 outcomes don't use 5.5. The board screen shows open notices instead. *Jeff can ask for a hard gate later.*

**Screens:** "Notices (5.5)" on Board → Attendance with each open notice and a **Give notice** button on each member (attendance or dues; an attendance notice is pre-filled from their standing lines); a `StatusNotice` screen (read, reply, withdraw, decided); a card on Me when you have an open notice. A ConfirmButton for Withdraw and Decided.

## 4. Not in this change

- The board-set FNG activity list (4.6): each meeting check-in is already classified in advance (ordinary, special, event); a per-year list is a bigger feature with its own spec.
- Push for notices (held until Jeff says).

## 5. Testing

- `npm test`: `big4.test.ts` (who can say Going, waivers, tie order), `notices.test.ts`, demo actions; written first, seen failing.
- `npm run test:db`: `supabase/tests/big4_rsvp_notices_test.sql` (RLS on the new tables, nothing written except through actions) and parity cases `rsvp` on a Big 4, `crew`, `setBig4Waiver`, `giveNotice`, `respondNotice`, `closeNotice`.
- Typecheck, lint, an independent reviewer, the ride screen, Attendance, StatusNotice and Me at 390×844 in the demo build.

## 6. Live

One paste file, `/mnt/project-files/build/big4-rsvp-notices.sql`, identical to the migration, through the "Apply pending SQL in Supabase" thread.
