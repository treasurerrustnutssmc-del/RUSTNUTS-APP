# Handover: ride briefing cards (lane A, 24 Oct 2026)

- **Spec:** `docs/superpowers/specs/2026-10-24-ride-briefings-design.md`. It includes an amendment made after the final review.
- **Plan:** `docs/superpowers/plans/2026-10-24-ride-briefings.md`.

## What it is
Before a ride, the Road Captain (or the board or ride committee) writes a short briefing:
- hazards on the day
- one-off changes to the Road Rules
- notes.

The app combines that with the ride, the route and its stops, the crew with who carries first aid, and the safety order from constitution 7.6, and shows it all as one **briefing card**.

Riders tap **Got it**. Writers see who's going but hasn't read the current version.

## Live state
- **Not live yet.** The Supabase tool refused to apply `20261024150000_ride_briefings.sql` as a production change.
- The same file is at `/mnt/project-files/build/ride-briefings.sql` for Jeff to paste into the SQL editor.
- Until it's applied:
  - live `ride_calendar` has no `briefings` or `briefing_reads` keys. The app treats them as empty, so nobody sees a briefing.
  - Save and Got it fail with "function not found".
- **The PR is held until the SQL is live**, so main and the live database stay in step.
- **After pasting, check that:**
  - `save_briefing` has 5 arguments and `read_briefing` has 2
  - the calendar returns `crew`, `ride_routes`, `briefings` and `briefing_reads`
  - anon gets nothing
  - security advisors show only the expected definer warnings.
- **The migration has no `drop` and no `delete from`.** Its foreign keys use `on delete cascade` / `on delete set null`, and those clauses don't raise `apply_migration`'s confirm prompt (proved with ride_crew and routes). This time the refusal came from the session's own safety check, not that prompt. The Stage 4 handover is right that Stage 4 needs a paste too.
- **Out-of-order prefix:** the file sorts before main's `20261101…`, `20261201…` and `20270201…` migrations. A fresh replay is fine (test-db proves it). `supabase db push` would flag it as out of order, the same caveat as Stage 4.

## Rulings made without Jeff (he can veto any)
- **Writers:**
  - the ride's crew managers (`managesRide`)
  - **plus whoever holds this ride's Road Captain crew spot**, even with no board seat (constitution 8.2: the RC "plans and leads rides")
  - an ended RC seat gives nothing.
- **Got it records the version seen.** The app sends the `updated_at` that was on screen.
  - If the RC has saved since, it's refused with `The briefing changed while you had it open. Read the new version, then tap Got it.`
  - The live app reloads the calendar, so the new version shows.
- **Saving records the version the editor opened on.** A save on top of someone else's newer save is refused with `Someone else saved this briefing while you were editing. Your changes aren’t saved: copy them, then open the briefing again.` The typed text stays in the fields.
- **Tolerance:** both version checks allow 1 ms, because the app holds milliseconds and Postgres holds microseconds.
- **A save also marks the writer's own read**, so writers never see their own update as unread.
- **Reading works any time,** on cancelled and past rides too. A cancelled ride's card still shows, with its tag. Saving stops at the end of the ride's first Melbourne day.
- **Clearing:** there is no "clear", because clearing means editing. An empty briefing is refused.
- **"Changes for this ride"** has a 2px amber border all round with a warm tint. DESIGN.md bans thick side stripes.
- **Read time:** "You read this at 7:42 am" on the same Melbourne day, and "You read this on 24/10/2026 at 7:42 am" on a later one.
- **Who sees reads:** every approved member sees the read count. Only writers see the unread names.

## Checks at merge time
- `npm test`: 732 pass
- `npm run test:db`: all database checks pass, and 299 parity cases agree
- typecheck and lint: clean
- the drop/delete grep: empty
- whole-branch review: two passes, ready to merge.

## Still open
- **Jeff pastes two files** into https://supabase.com/dashboard/project/mfhbvsybudneimgbfjpy/sql/new:
  - `ride-crew-actions.sql`, still waiting from the crew work
  - `ride-briefings.sql`.

  Until the crew file is in, nobody can be put in an RC spot live, so only board and ride committee can write briefings there.
- **Live-build look** at 390×844 once the SQL is in. Only the demo build has been checked.
- **Web only:** a hazard field grows as you type but doesn't shrink when you delete. Phones do both.
- **Later, each with its own say-so:**
  - push reminders (lane E)
  - weather (needs a provider account)
  - hazard pins on the route
  - a link to Road Rules once sign-off exists.
