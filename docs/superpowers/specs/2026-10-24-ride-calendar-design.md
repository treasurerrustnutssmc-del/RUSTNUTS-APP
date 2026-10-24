# Ride calendar and RSVPs (Stage 2, part 1)

**Type:** architectural (new tables, a background sync job, a new tab). Jeff chose on 24 Oct 2026
to **read the website's calendar** while the app is still secret. Stage 2 is split up: this spec
covers only the calendar and RSVPs. Ride roles, locked routes, briefing cards and Road Rules
sign-off each get their own spec afterwards.

## Goal
Members open a **Rides** tab and see every upcoming ride, colour-coded the same way as the club
website. They tap a ride and answer Going, Maybe or Can't make it, and they can see who else is
going. Nobody types a ride in twice: the rides come from the calendar that already feeds
www.rustnutssmc.com.au (built by Dysco).

## What we know and what we're waiting on
- The website's Ride Calendar has five colours: **North**, **West**, **Rustnuts** (whole club),
  **Supported Club Rides** and **Non-Nuts** events.
- Where its rides come from couldn't be read from the cloud. Jeff has asked Dysco. The design
  assumes the answer is one or more Google Calendars, each with a public iCal (`.ics`) address.
  - **Several calendars, one per colour:** each feed is tagged with its colour, which is the
    simplest case.
  - **One calendar:** iCal doesn't carry Google's event colours. Each ride's colour then comes
    from a rule agreed with Dysco, such as a title prefix ("West:") or a word in the description.
    That rule is one small function with its own tests.
  - **Anything else** (a spreadsheet, a page on the site): only the sync's "fetch and read" step
    changes. Everything after it stays the same.

## Design

### Data (new migration)
- `public.ride_category` enum: `north`, `west`, `club`, `supported`, `non_nuts`.
- `public.rides`:
  - `id`, `source` (`feed` now, and `app` after the reveal), `feed_id`, `external_uid`.
  - `starts_at` and `ends_at` (timestamptz), `all_day`.
  - `title`, `location`, `notes`, `category`.
  - `cancelled_at`, `synced_at`.
  - Unique on (`feed_id`, `external_uid`, `starts_at`), so a repeating ride gets one row per date.
- `public.rsvps`: `ride_id`, `member_id`, `answer` (`going`, `maybe`, `no`) and `updated_at`.
  The primary key is (`ride_id`, `member_id`).
- `private.ride_feeds`: `id`, `url`, `category` (null for the one-calendar case), `last_ok_at`
  and `last_error`. An admin sets this up once by SQL. The feed address stays out of the app and
  the repo.

### Access (mirrored in `src/domain/access.ts`, with shared demo/database cases)
- Every **approved** member, whatever their status, can see rides and who's going.
  Applicants and the public see nothing yet. The public side waits for the reveal.
- A member answers only for themselves, and only until the ride starts.
- Rides can't be written through the API at all, because only the sync writes them.
  Editing a ride in the app is part of the reveal flip, not this spec.
- RSVPs are written only through a `set_rsvp(ride, answer)` database action that checks the rules
  above. It works like the rest of the app's actions: row-level security plus SECURITY DEFINER.

### Sync (Supabase Edge Function `sync-rides`)
- Runs every **15 minutes** on a schedule (`pg_cron` + `pg_net`), and can also be run by hand.
- For each feed:
  1. Fetch the `.ics`.
  2. Read its events, expanding repeating rides for the next 12 months.
  3. Work out each ride's colour.
  4. Upsert the rows.
- A future ride that has gone from the feed is marked **cancelled**, never deleted, so RSVPs
  aren't lost. If it comes back, it is un-cancelled. Past rides are never touched.
- If a feed fails, the last good copy stays. The error is recorded on the feed row, and the
  Rides tab shows "Last updated <time>" so a stale calendar is obvious.
- All times are read and shown in Melbourne time. Dates show as DD/MM/YYYY.
- The iCal reading and the colour rule are plain TypeScript in `supabase/functions/_shared/`,
  with no Deno-only code, so `npm test` can test them directly.

### Screens
- **Rides tab.** It replaces the Chapters tab, which keeps the bar at five tabs. Chapters
  moves to a link on the Members screen.
  - The list is grouped by month, which reads better on a phone than a month grid.
  - Each row has the date block in stencil, the title, the time and place, a colour chip, the
    number going, and your own answer.
  - Filter chips at the top for the five colours. The default is your chapter, Rustnuts and
    Supported.
  - A cancelled ride stays in the list, struck through, until its date passes.
- **Ride screen.**
  - Title, date and time, and the place (tapping it opens the phone's maps app).
  - Notes from the calendar.
  - Three big stencil buttons: Going, Maybe, Can't make it.
  - Who's going and who's a maybe, by road name.
- Colours: the five website colours become tokens in `src/theme.ts`, with text contrast checked.
  Until Dysco confirms the exact shades they're picked from the site by eye.
- The demo build gets sample rides in all five colours, so the screens can be checked at
  390×844 without the live feed.

## Tests
- **`npm test`**
  - Reading iCal: single and all-day events, time zones, a repeating ride, cancelled
    occurrences, escaped text, and a broken file.
  - The colour rule.
  - Month grouping and the default filter.
  - The RSVP rules in `access.ts`.
- **`npm run test:db`**
  - Approved members can read rides and RSVPs. Applicants, the public and the anon key can't.
  - Nobody can write rides through the API.
  - `set_rsvp` works for yourself and is refused for someone else, after the start, for an
    applicant, and on a cancelled ride.
  - The sync's upsert and cancel logic run against fixed rows.
- **Shared demo/database cases** (`parity.json`): RSVP allowed and refused.
- A look at the Rides and Ride screens at phone size in the demo and live builds, plus the
  Impeccable passes.

## Not in this spec
- Ride roles, locked GPX routes, briefing cards, Road Rules sign-off, and booking the Rusty Bus.
  These come next, each with its own spec.
- Push notifications (Stage 6), and the per-ride chat (Stage 3).
- Entering or editing rides in the app, and the website reading from the app. Both are the
  reveal flip.

## Before it can go live
- Dysco's answer, plus the feed address(es) loaded into `private.ride_feeds`. The rest can be
  built and tested on sample feeds before then.
- `pg_cron` and `pg_net` switched on in the live project. They're free Supabase extensions,
  turned on by migration.
