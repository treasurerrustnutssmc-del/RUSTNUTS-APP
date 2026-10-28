# Attendance rules, Big 4 rides, terms and the membership card

**Date:** 28 Oct 2026 · **Kind:** architectural (new tables, new rules, screens in three places) · **Approved by:** Claude (self-approval, Jeff can veto) · **Branch:** `claude/project-thread-m363rl` · **Migration prefix:** `20270405` (agreed with the ride planning extras thread, which takes `20270410`)

**Source:** Constitution v4 (25 Oct 2026): 2.4, 4.6, 4.12, 5.2–5.5, 5.7, 5.8, 5.11, 9.2, 11.3, 11.6, 11.8, 12.7, 17.6. This is items 1–3 of "Not built yet" in `2026-10-25-constitution-v4-audit.md`, plus a digital membership card.

## What Jeff gets

- The NEC marks a ride as a **Big 4** ahead of time, for the whole club or one chapter.
- Every Full Member, Nomad and FNG sees **where they stand** this year: meetings against 80% (or two in three, or 50%), Big 4 rides against two (or one), with plain "On track", "To go" or "Behind" chips. The board sees the same for every member of its chapter on one screen.
- Meeting check-ins are **classified when they're opened** (ordinary monthly meeting, special or annual meeting, other event), so the right ones count.
- The board can **excuse** a member from one meeting or ride (4.12, 5.3, 5.11). An excused activity drops out of that member's count.
- Before a Big 4, a member sees whether they've made **two of the last three meetings** (5.4). Supporters see they can't join (5.8).
- Every position shows **when its term ends**, and the board sees terms that have ended or end within 60 days.
- A **membership card** on the Me screen: logo, name, status, chapter, member since, patched on, member disc for Full and Nomad only, this club year and whether dues are paid.

Nothing here changes anyone's status, charges anyone or messages anyone. A shortfall is information for the Secretary (5.5 says a status change needs 14 days' notice and a board decision, which stays a person's job).

## 1. Big 4 designation (5.11, 12.7)

**Table** `public.big4_rides`: `ride_id uuid primary key references rides on delete cascade`, `chapter_id uuid null references chapters` (null = every chapter), `designated_by uuid references members on delete set null`, `designated_at timestamptz default now()`. Readable by approved members. A separate table, not a column on `rides`, because the calendar sync rewrites ride rows.

**Actions** `designate_big4(p_ride, p_chapter)` (insert or change the chapter) and `undesignate_big4(p_ride)`.

**Who:** the NEC as v4 defines it (11.2): the National Chairperson or a Chapter President, plus the National Secretary who keeps Club records (11.7). *Inferred; Jeff can veto.*

**Refusals, same words in app and database:**
- "Only the NEC designates Big 4 rides (5.11)."
- "No such ride."
- "That ride was cancelled."
- "Big 4 rides are Club-only: pick a club, North or West ride." (supported and non-Nuts rides can't be Big 4)
- "A Big 4 is designated before the ride, not after (5.11)." (the ride's Melbourne date must be after today; undesignating has the same limit, so nobody's past count changes)

Shape agreed with the ride planning extras thread: app type `Big4Ride { rideId, chapterId, designatedBy, designatedAt }`, `ClubData.big4Rides?`, helper `isBig4(rideId, data)` in `src/domain/big4.ts`. Loaded with its own query, so `ride_calendar()` isn't redefined.

## 2. Meeting categories (4.6, 5.2)

`checkin_sessions` gets `meeting_type text null check in ('ordinary', 'special', 'event')`, null for rides. Existing meeting check-ins have none and count as **ordinary** (they were the monthly meetings). A six-argument `open_checkin(..., p_meeting_type)` sits beside the original five-argument one (no defaults, so every call names which; replacing the old one would need the word live files keep out). It opens and classifies in one go, so a bad kind opens nothing. The app uses it for anything but an ordinary meeting. `set_meeting_type(p_session, p_type)` changes the kind, only before the day it's held. Refusals: "That check-in no longer exists.", "Only that chapter’s board can run this check-in.", "Only a meeting check-in has a kind.", "Pick what kind of meeting it is.", "A meeting’s kind is set before the day it’s held (4.6)." The Open a meeting check-in screen gets three choices: **Monthly meeting** (ordinary; an Annual Chapter Meeting held with it counts once, as this), **Special or annual**, **Other event**. Classified in advance (4.6), and changeable only until the day it's held.

The new column is read with a plain select (column grant), so `members_money()` isn't redefined.

## 3. Excusing someone (4.12, 5.3, 5.11)

**Table** `public.attendance_exemptions`: `session_id` (cascade), `member_id` (cascade), `reason text not null`, `granted_by`, `granted_at`; primary key (session, member). Readable by the member and their chapter's board (same as decisions; an excuse can be personal, e.g. health).

**Action** `set_exemption(p_session, p_member, p_reason)`: a non-empty reason excuses, null or empty clears it.
- "Only their chapter’s board can excuse them." (board of the member's chapter)
- "Someone else on the board has to excuse you." (not yourself)
- "They checked in, so there’s nothing to excuse."
- "That check-in no longer exists."

UI: on the Run check-in screen, a board member sees an **Excused** section (with Clear) and can switch the member list between **Tick off** and **Excuse**; Excuse asks for the reason. Before the day, the list takes apologies only.

## 4. Where a member stands (`src/domain/standing.ts`)

All counts use 2.4: the smallest whole number that meets the percentage (`ceil(held × p)` with integer maths). A category with nothing held has no shortfall.

| Who | Window | Meetings | Big 4 |
|---|---|---|---|
| **Full** (5.2, 5.11) | this club year, from the later of its AGM and the patch date, up to today | ordinary meetings of the home chapter: 80% | min(2, applicable Big 4s from the window start to the year's end) |
| **Nomad** (5.7) | same | ordinary meetings of the home chapter (its nominated chapter): two in three | min(1, applicable) |
| **FNG** (4.6) | from the FNG start date to today (the trial, not the club year) | three lines, 50% each: rides (home chapter's and whole-club ride check-ins), ordinary meetings, other events (home chapter) | none |
| Anyone else, or on hiatus | none | none | none |

- **Held** means a check-in was opened for it, dated in the window, on or before today. A meeting nobody opened check-in for can't be counted for or against anyone.
- **Excused** activities leave that member's held count, unless they came after all: turning up always counts.
- **Today's meeting** counts once it's closed, or for someone already checked in.
- **Applicable Big 4:** designated for every chapter or the member's chapter, not cancelled, not excused for them. A past Big 4 with no check-in drops out (nobody can show they went; "if fewer are held, the requirement reduces", 5.11). A future one counts as still to come.
- **States:** Met (attended ≥ needed); for Big 4, **To go** (not met but enough Big 4s are still on the calendar); otherwise **Behind**. Meetings are judged on the year so far, so they're Met or Behind.
- **On hiatus:** no requirement shown ("On hiatus" note). *Inferred: hiatus works as standing relief under 4.12; Jeff can veto.*

**Big 4 eligibility (5.4)** `big4Eligibility(member, rideDate, data, today)`: the three most recent official meetings (ordinary or special) of the home chapter held before the ride's date and already held, skipping ones the member was excused from; they need two (or all of them if fewer than two were held). Shown on the ride for an FNG, Full or Nomad: "Eligible: 2 of the last 3 meetings" or "Needs 2 of the last 3 meetings (you’ve made 1). The board can excuse work, family, health, injury or distance." A Supporter sees "Supporters can’t join Big 4 Club-only rides (5.8)." This change shows it; it does not block an RSVP (that's `set_rsvp`, which lane A and the Going gate own; listed as next step).

**Screens**
- **Me** and a member's profile (the member and their board only): an "Attendance rules" card with the requirement lines and chips, under the existing "Turned up" counts.
- **FNG tracker** (`fng.tsx`): the three 50% lines.
- **Board → Attendance** (new screen `Attendance`, from the board's Check-ins card): the chapter's Full, Nomad and FNG members, Behind first, each with their lines. Board of that chapter or national only (the same people who see attendance records today).
- **Ride detail:** a Big 4 chip; the 5.4 line for the viewer; for the NEC, "Make this a Big 4" / "Not a Big 4" (`ConfirmButton` for removal), with "Whole club" or a chapter.

## 5. Terms (9.2, 11.3, 11.6, 11.8, 17.6) (`src/domain/terms.ts`)

`termEndsOn(position)`:
- Chapter Board and Non-Board roles, National Chairperson, National Secretary: two years from the start. A term recorded as starting before 1 Aug 2026 is treated as starting then (17.6 preserves the terms that began 1 Aug 2026).
- National Auditor: twelve months from the start (11.8).
- Founder (an honour): no term.

`termState(position, today)`: `ended` (past the end, still not ended in the app), `ending` (within 60 days), `running`. Board screen and member profile show "Term ends DD/MM/YYYY" with a chip when ending or ended. Board screen gets a "Terms" note listing ended or ending terms in that chapter. Renewing a term is "End term" then appoint again (re-election makes a new record); v4 sets no limit on renewals, so the app sets none. No database change.

## 6. Membership card (`src/screens/card.tsx`, `src/domain/card.ts`)

A "Membership card" row on Me opens a card: the real logo (`assets/logo.png`), name and road name in Rustnuts Stencil, status, chapter, "Member since" (joined), "Patched" (Full/Nomad), the member disc image only for Full and Nomad (brand rule), "On hiatus" when so, the club year label, and dues: **Paid** (this club year's annual charge settled or waived), **Due DD/MM/YYYY**, or nothing when there's no charge. Only your own card (nobody else's dues). No QR code: nothing scans it yet (YAGNI).

## 7. Testing

- `npm test`: `big4.test.ts`, `standing.test.ts`, `terms.test.ts`, `card.test.ts`, exemption and meeting-type rules in `attendance.test.ts`, demo actions; written first, seen failing.
- `npm run test:db`: `supabase/tests/attendance_rules_test.sql` (who can designate and excuse, the refusals, RLS on the two tables, meeting type), plus parity cases `designateBig4`, `undesignateBig4`, `setMeetingType`, `setExemption`.
- Typecheck, lint, an independent reviewer on the diff, Impeccable checks by hand on Me, Attendance, Run check-in, Open meeting, ride detail, Board and the card at 390×844 in the demo build.

## 8. Live

One paste file, `/mnt/project-files/build/attendance-big4.sql`, identical to the migration, queued through the coordinator for the "Apply pending SQL in Supabase" thread. No real data loaded, nothing designated.

## Next steps (not in this change)

- Excusing someone from a Big 4 ahead of time (an excuse needs the ride's check-in, opened on the day).
- Changing a Big 4's chapter from the ride screen (the action supports it; today it's take off and designate again).
- Who can excuse: the chapter board plus everyone the app counts as national, which includes the National Auditor and other chapters' Presidents (inherited from `is_board_of`). The NEC powers split in the v4 audit should narrow this.

- Block a Going RSVP on a Big 4 for Supporters and for members without 5.4 eligibility (needs `set_rsvp`, owned by lane A).
- Status-change fairness (5.5): the 14-day notice workflow from an attendance shortfall.
- Board-set designated FNG activity list per club year (4.6) beyond the three categories.
