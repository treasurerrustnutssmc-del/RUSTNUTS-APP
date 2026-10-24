# Ride briefing cards (Stage 2, part 4)

**Type:** architectural. It adds two tables, new database actions, a change to `ride_calendar`, and new screens.

This is lane A of the parallel build, so migrations use the `2026102415` prefix. Claude approved this spec on 24 Oct 2026 under Jeff's standing rule. Jeff can veto any line. The lines marked *inferred* are the ones most worth a look.

## Goal
Before each ride, the Road Captain writes a short briefing: hazards on the day, any one-off changes to the Road Rules, and anything else riders need to know. The app assembles that into one **briefing card**, together with what it already knows:
- when and where to meet
- the route, its distance and its stops
- who's on the crew, and who carries first aid
- who's in charge if something goes wrong.

Riders read the card before they leave home and tap **Got it**. At the meeting point the RC can see who hasn't read it.

This follows the constitution:
- **7.10:** "The Road Captain may vary a procedure for one ride because of immediate safety, traffic, weather, road conditions or operational need." The card's "Changes for this ride" is where those variations go.
- **7.6:** the safety authority order (Road Captain, then Sergeant-at-Arms, then Vice President, then President, then NEC) is printed on every card.

## Words
- **Briefing:** the RC's part of the card for one ride:
  - **hazards:** up to 12 short lines
  - **changes for this ride:** text
  - **notes:** text
- **Briefing card:** the whole assembled card: ride details, route, crew, the briefing, and the safety order.
- **Briefing writers:** the ride's crew managers (the same people as `managesRide`), **plus whoever holds this ride's Road Captain crew spot**. A Full member picked as RC for one ride can write that ride's briefing even without a board seat. *Inferred*, because constitution 8.2 says the Road Captain "plans and leads rides".
- **Read:** an approved member tapped Got it on the current briefing. If the briefing changes afterwards, their read shows as out of date until they tap again.

## Rules (`src/domain/briefings.ts`, mirrored by the database with the same words and order)
1. Approved members can see every briefing and every read: who has read which ride's briefing, and when. Applicants and the public see nothing.
2. **Saving a briefing** checks, in this order:
   1. `Sign in first.`
   2. `Only approved members can do that.`
   3. `No such ride.`
   4. `That ride was cancelled.`
   5. After the ride's first Melbourne day: `The briefing can’t change after the ride day.`
   6. Not a briefing writer: `Only the board, ride committee or this ride’s Road Captain can write the briefing.`
   7. More than 12 hazards: `That’s too many hazards (12 at most).` Blank hazard lines are dropped first.
   8. A hazard over 120 characters: `Keep each hazard to one short line (120 characters at most).`
   9. Changes or notes over 2000 characters: `That’s too long (2000 characters at most).`
   10. Everything empty after trimming: `Write at least one hazard, change or note.` To clear a briefing, write something like "Nothing special".
3. **Reading (Got it)** checks:
   1. sign in
   2. approved
   3. `No such ride.`
   4. `There’s no briefing for this ride yet.`
   It works at any time, including on a cancelled or past ride, and it sets your read time to now. *Inferred:* a cancelled ride's card still shows, with its Cancelled tag.
4. **Counting reads:**
   - A read counts as current when it is at or after the briefing's `updated_at`.
   - The card shows "**6 of 9 going have read it**", counting only riders whose answer is Going.
   - Briefing writers see the list of Going riders who haven't read it.
5. Texts are trimmed with the same rule as route names (JS `trim()` in the app, `private.trim_like_app` in the database), and lengths are counted in characters (code points).

## The card
On the ride screen there is a **Briefing** section between Route and Crew.
- **When there's a briefing:**
  - the first hazard line, then "+N more"
  - the read count
  - **Open briefing card**
- **When there isn't one:**
  - writers see "No briefing yet" and **Write briefing**
  - everyone else sees nothing.

The **Briefing card** screen is one tall card meant to be read at a glance in a car park, in big stencil type. From top to bottom:
1. **Ride:** title, date, meeting time, meeting place, and a Cancelled tag if cancelled.
2. **Route:** name, distance and climb, numbered stops, and **Open in maps app** (the route screen's button). It is hidden if the ride has no route.
3. **Hazards:** each one on its own line with a warning icon.
4. **Changes for this ride:** shown only if there are any. It has a strong amber edge and the label "The RC has changed these Road Rules for this ride".
5. **Notes.**
6. **Crew:**
   - RC, TG, ATG and Officers, with names
   - "First aid: <TG name>" when there's a TG
   - "No Tail Gunner yet" in amber when there isn't one.
7. **If something goes wrong:** "Safety calls, in order: Road Captain → Sergeant-at-Arms → Vice President → President → NEC (constitution 7.6)." Then: "Stopped rider? The TG stops with them. An Officer takes the rear."
8. **Got it:** a big button, or "You read this at 7:42 am" with a quiet **Read again**. It shows "Updated since you read it" when the read is out of date.
9. **For writers:**
   - **Edit**
   - the unread list: names of Going riders who haven't read it, or whose read is out of date.

The **Edit briefing** screen has:
- a hazards list: one field per line, with **Add hazard** and a remove ✕ on each line
- the changes and notes as multiline fields
- **Save**, with errors shown inline in a live region.

No Alert dialogs are used. The edit screen has nothing destructive, because clearing means editing.

## Data (new migration `20261024150000_ride_briefings.sql`)
- **`public.ride_briefings`:**
  - `ride_id`: primary key, references rides, cascade
  - `hazards text[] not null default '{}'`
  - `changes text`
  - `notes text`
  - `updated_by`: references members, on delete set null
  - `updated_at`
  - check constraints that mirror the limits
- **`public.ride_briefing_reads`:**
  - `ride_id` and `member_id`: primary key; both reference their tables, cascade
  - `read_at`
- **Row-level security:** approved members can select both tables. There are no writes through the API.
- **Actions** (SECURITY DEFINER, `search_path = ''`, authenticated only):
  - **`save_briefing(p_ride uuid, p_hazards text[], p_changes text, p_notes text)`**
    - It locks the ride row `for no key update` first, as `set_crew` does.
    - Writer check: `private.manages_ride(p_ride)` or a `ride_crew` row for (ride, me, `road_captain`).
    - It trims, drops blank hazards, checks the limits in the rules' order, then upserts and sets `updated_at = now()`.
  - **`read_briefing(p_ride uuid)`:** upserts your read with `read_at = now()`.
- **`ride_calendar()`** gains `briefings` (rows for the shown rides) and `briefing_reads` (rows for the shown rides). It keeps `rides`, `rsvps`, `crew`, `ride_routes` and `synced_at` exactly. Body as in `20261024140000_ride_routes.sql`, plus the two keys.
- **No `drop` and no `delete from` anywhere in the migration.** Foreign-key `on delete` clauses are fine.

## App
- **Types:**
  - `Briefing { rideId; hazards: string[]; changes: string; notes: string; updatedAt; updatedBy: string | null }`
  - `BriefingRead { rideId; memberId; readAt }`
  - `ClubData.briefings?` and `ClubData.briefingReads?`
- **Context actions:**
  - `saveBriefing(rideId, { hazards, changes, notes })`
  - `readBriefing(rideId)`
- Demo and live both copy how routes are built. Live maps the two new calendar keys, with `?? []`.
- **Domain helpers** (`src/domain/briefings.ts`):
  - `writesBriefing(me, ride, data)`
  - `saveBriefingProblem(me, ride, input, data, now)`
  - `readBriefingProblem(me, ride, data)`
  - `briefingOf(rideId, data)`
  - `readState(me, rideId, data)`, which returns `'none' | 'current' | 'stale'`
  - `readCount(ride, data)`, which returns `{ read, going }`
  - `unreadGoing(ride, data)`
  - `safetyOrder`, a constant
- **Navigation:** `Briefing { rideId }` and `EditBriefing { rideId }` stack screens.
- **Demo data:**
  - r-1 (West breakfast run) has a briefing with 3 hazards, a change ("Single file through Myrniong, no staggered formation") and a note. Spanner has read it; Diesel's read is out of date.
  - r-2 has none.

## Tests
- **`npm test`:**
  - `briefings.test.ts`: every message and its order; the writer rule, including a non-board RC crew member; trimming; the limits counted in code points; read states, counts and the unread list.
  - Demo actions.
  - Live mapping.
- **`npm run test:db`** (`supabase/tests/ride_briefings_test.sql`):
  - the same rules
  - no API writes
  - applicants and anon read nothing
  - `ride_calendar` returns `briefings` and `briefing_reads`, plus `crew` and `ride_routes`
  - the ride-row lock.
- **`parity.json`:** `saveBriefing` and `readBriefing` cases, allowed and refused, including the crew-RC writer.
- **Screens:** the ride screen's Briefing section, the Briefing card and Edit briefing, at 390×844 in the demo build, followed by the Impeccable passes.

## Not in this spec
- Road Rules sign-off. It comes next: the club-wide Road Rules document and each member's yearly acknowledgement. Once it exists, the card can link to it.
- Push reminders ("Read the briefing for tomorrow's ride"). Lane E owns push.
- Weather. That needs a weather provider, which means Jeff's say-so on an account.
- Hazard pins on the route shape. Hazards are text lines for now.
