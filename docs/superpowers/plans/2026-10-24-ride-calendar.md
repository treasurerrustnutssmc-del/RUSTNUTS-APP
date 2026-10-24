# Ride Calendar and RSVPs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Rides tab that shows the website's calendar, colour-coded, with Going / Maybe / Can't RSVPs.

**Architecture:** An Edge Function reads the website's iCal feeds every 15 minutes. It parses them with a
pure TypeScript module shared with `npm test`, and hands the events to one SQL function that
upserts rides and cancels missing future ones. Members read rides and RSVPs under row-level
security and answer through `set_rsvp`. The demo mirrors that, and shared parity cases check that
both agree.

**Tech Stack:** Expo SDK 58 / React Native 0.88, React Navigation, Supabase (Postgres RLS,
Edge Functions on Deno, pg_cron + pg_net), node:test via tsx.

**Spec:** `docs/superpowers/specs/2026-10-24-ride-calendar-design.md`

## Global Constraints
- Times are stored as timestamptz. They are read and shown in `Australia/Melbourne`. Dates show as DD/MM/YYYY.
- Categories are exactly `north`, `west`, `club`, `supported`, `non_nuts`. Labels: North, West, Rustnuts, Supported, Non-Nuts.
- Only **approved** members (any status) can read rides and RSVPs. Nobody can write rides through the API.
- RSVP answers: `going`, `maybe`, `no`. Labels: Going, Maybe, Can't make it.
- A member answers only for themselves, only before `starts_at`, and never on a cancelled ride.
- Refusal messages are word-for-word identical in the demo and the database:
  - `Sign in first.`
  - `Only approved members can do that.`
  - `That ride has already started.`
  - `That ride was cancelled.`
  - `No such ride.`
- Feed addresses live only in `private.ride_feeds`, never in the repo or the app.
- Stencil font for titles, dates, buttons and chips. Body font only for notes and fine print. No `Alert`.
- Sync window: from the start of the current Melbourne day through 12 months ahead. Rides before today are never changed.

## Review Focus
- **All-day ride (`VALUE=DATE`)**: it shows as that date with "All day", and doesn't drift a day because of UTC. Covered by a test in Task 2.
- **Ride across midnight or with no DTEND**: it shows its start. A missing DTEND means 1 hour later for timed rides, or the same day for all-day rides. Covered by a test in Task 2.
- **Feed fetch fails or returns HTML**: no rides are cancelled. The error is stored on the feed and the old rides stay. Covered by a test in Task 3 (apply is never called with an empty set for a failed feed) and Task 5.
- **A ride moved to a new time in the calendar**: the old time is cancelled and the new one appears. RSVPs stay on the old row and the member answers again. Covered by a test in Task 3.
- **A member RSVPs on a ride whose start passes while the screen is open**: they get the friendly "already started" message, not a crash. Covered by parity cases in Task 4.

---

### Task 1: Ride types, labels, colours and pure ride helpers

**Files:**
- Modify: `src/domain/types.ts` (add types and extend `ClubData`)
- Modify: `src/domain/labels.ts`
- Modify: `src/theme.ts` (add the `rideColors` export)
- Create: `src/domain/rides.ts`, `src/domain/rides.test.ts`
- Modify: `src/data/clubContext.ts` (`EMPTY_DATA` gets `rides: []` and `rsvps: []`), and the parity fixture's `fixtureData()` (also `rides`, `rsvps`)

**Interfaces:**
- Produces:
  - `type RideCategory = 'north' | 'west' | 'club' | 'supported' | 'non_nuts'`
  - `type RsvpAnswer = 'going' | 'maybe' | 'no'`
  - `interface Ride { id: string; title: string; startsAt: string /* ISO instant */; endsAt: string | null; allDay: boolean; location: string | null; notes: string | null; category: RideCategory; cancelledAt: string | null }`
  - `interface Rsvp { rideId: string; memberId: string; answer: RsvpAnswer; updatedAt: string }`
  - `ClubData` gains `rides: Ride[]` and `rsvps: Rsvp[]`
  - `RIDE_CATEGORY_LABEL: Record<RideCategory,string>` and `RSVP_LABEL: Record<RsvpAnswer,string>` in labels.ts
  - `rideColors: Record<RideCategory, { bg: string; fg: string }>` in theme.ts, each pair contrasting at ≥ 4.5:1
  - In `src/domain/rides.ts`:
    - `melbourneDate(iso: string): string` (YYYY-MM-DD in Melbourne)
    - `melbourneTime(iso: string): string` ("7:30 am")
    - `defaultCategories(me: Member, chapters: Chapter[]): RideCategory[]`
    - `upcomingByMonth(rides: Ride[], categories: RideCategory[], today: string): { month: string /* "November 2026" */; rides: Ride[] }[]`
    - `rsvpProblem(me: Member | null, ride: Ride | undefined, now: string): string | null`
    - `rsvpCounts(rideId: string, rsvps: Rsvp[]): Record<RsvpAnswer, number>`

- [ ] **Step 1: Write the failing tests in `src/domain/rides.test.ts`**
  - `melbourneDate('2026-11-07T14:30:00Z') === '2026-11-08'` (AEDT is +11).
  - `melbourneTime('2026-11-07T20:30:00Z') === '7:30 am'`.
  - `defaultCategories` gives a West member `['west','club','supported']`. A North member gets `north` instead of `west`.
  - `upcomingByMonth`:
    - drops rides whose Melbourne date is before `today`;
    - keeps today's rides;
    - keeps cancelled rides from today on;
    - filters by category;
    - sorts by `startsAt`;
    - groups by Melbourne month, labelled like "November 2026".
  - `rsvpProblem`, checked in this order:
    - null `me` → `'Sign in first.'`
    - pending member → `'Only approved members can do that.'`
    - undefined ride → `'No such ride.'`
    - cancelled ride → `'That ride was cancelled.'`
    - `now >= startsAt` → `'That ride has already started.'`
    - otherwise null.
  - `rsvpCounts` counts only that ride.
- [ ] **Step 2: Run `npm test` and expect the rides tests to fail** (the module doesn't exist).
- [ ] **Step 3: Implement.** Melbourne conversions use `Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', … })`. The colours start from the website's key by eye: North blue, West red, Rustnuts bone/black, Supported green, Non-Nuts grey.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`, and expect both to pass.** Fix any `ClubData` literals the typecheck flags (demo data gets `rides: []` and `rsvps: []` for now).
- [ ] **Step 5: Commit** with the message `Rides: types, labels, colours and helpers`.

### Task 2: iCal reader and colour rule (shared by the sync and the tests)

**Files:**
- Create: `supabase/functions/_shared/ics.ts`. It imports nothing and uses only standard JS and `Intl`, so it runs in both Deno and Node.
- Create: `src/data/ics.test.ts`, which imports `../../supabase/functions/_shared/ics`.

**Interfaces:**
- Produces:
  - `interface FeedEvent { uid: string; startsAt: string /* ISO UTC */; endsAt: string | null; allDay: boolean; title: string; location: string | null; notes: string | null; categoryHint: string | null /* CATEGORIES or title prefix */ }`
  - `parseIcs(text: string, windowStart: string, windowEnd: string): FeedEvent[]`. It throws `Error('Not a calendar')` when there's no `BEGIN:VCALENDAR`.
  - `categoryFor(feedCategory: RideCategory | null, ev: FeedEvent): RideCategory`. A non-null `feedCategory` wins. Otherwise the title prefix decides, case-insensitive: "North:", "West:", "Rustnuts:", "Supported:", "Non-Nuts:". Otherwise `CATEGORIES`. Otherwise `club`.

- [ ] **Step 1: Write the failing tests** (iCal text inline in the test file):
  - **Folded lines:** a long SUMMARY split with CRLF plus a space reads as one line.
  - **Escaping:** `\,` `\;` `\n` `\\` are unescaped.
  - **Melbourne local time:** `DTSTART;TZID=Australia/Melbourne:20261108T083000` → `startsAt` `2026-11-07T21:30:00.000Z`.
  - **UTC:** `DTSTART:20261108T000000Z` reads as given.
  - **All-day:** `DTSTART;VALUE=DATE:20261108` → `allDay: true`, with Melbourne date 2026-11-08 (`startsAt` `2026-11-07T13:00:00.000Z`).
  - **Missing DTEND:** timed rides get 1 hour later. All-day rides get `endsAt` null.
  - **Repeating:**
    - `RRULE:FREQ=WEEKLY;COUNT=3` gives 3 events 7 days apart, with the same local time across the DST change on 5 Apr 2027.
    - `FREQ=MONTHLY;BYDAY=1SU` gives the first Sunday of each month.
    - `UNTIL` and `INTERVAL` are respected.
    - `EXDATE` drops an occurrence.
    - A `RECURRENCE-ID` override replaces its occurrence.
  - **Status:** `STATUS:CANCELLED` events are left out.
  - **Window:** only events whose start falls in [windowStart, windowEnd) come back.
  - **An unsupported RRULE** (e.g. `FREQ=HOURLY`) gives just the first occurrence. It doesn't throw.
  - **HTML input** throws `'Not a calendar'`.
  - **`categoryFor`:** the feed category wins; "West: Coffee run" → `west`; "Non-Nuts: Toy Run" → `non_nuts`; `CATEGORIES:Supported` → `supported`; nothing → `club`.
- [ ] **Step 2: Run `npm test` and expect it to fail.**
- [ ] **Step 3: Implement.**
  - TZID local → UTC: format a guess with `Intl` in that zone, then correct by the difference (two passes handle DST).
  - Only `Australia/*`, `UTC` and floating times need to work. Any other TZID is treated as Melbourne.
  - RRULE support: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (plain days for weekly, nth for monthly).
  - Each occurrence's `uid` stays the event UID. Occurrences are told apart by `startsAt`.
- [ ] **Step 4: Run `npm test` and expect it to pass.**
- [ ] **Step 5: Commit** with the message `Rides: iCal reader and colour rule`.

### Task 3: Database: rides, RSVPs, feeds, set_rsvp and apply_ride_sync

**Files:**
- Create: `supabase/migrations/20261024120000_rides.sql`
- Create: `supabase/tests/rides_test.sql`
- Modify: `scripts/test-db.sh` to run `rides_test.sql` on a fresh database, like the roster test.
- Modify: `supabase/tests/supabase_stub.sql`, only if `service_role` is missing.

**Interfaces:**
- Produces (SQL):
  - Enum: `public.ride_category`, `public.rsvp_answer`.
  - `private.ride_feeds(id uuid pk, url text not null, category ride_category null, last_ok_at timestamptz, last_error text)`. All privileges revoked from public, anon and authenticated, and RLS is on with no policies.
  - `public.rides(id uuid pk default gen_random_uuid(), source text not null default 'feed' check (source in ('feed','app')), feed_id uuid references private.ride_feeds on delete set null, external_uid text, starts_at timestamptz not null, ends_at timestamptz, all_day boolean not null default false, title text not null, location text, notes text, category ride_category not null, cancelled_at timestamptz, synced_at timestamptz not null default now(), unique (feed_id, external_uid, starts_at))`
  - `public.rsvps(ride_id uuid references public.rides on delete cascade, member_id uuid references public.members on delete cascade, answer rsvp_answer not null, updated_at timestamptz not null default now(), primary key (ride_id, member_id))`
  - RLS for select on both tables: `private.is_approved_member()`. There are no insert, update or delete policies, and those privileges are revoked from anon and authenticated.
  - `public.set_rsvp(p_ride uuid, p_answer rsvp_answer) returns void`, SECURITY DEFINER. It checks in the order and with the messages in Global Constraints, then upserts. Granted to authenticated only.
  - `public.apply_ride_sync(p_feed uuid, p_events jsonb) returns int` (rows upserted), SECURITY DEFINER. Granted to `service_role` only.
    - `p_events` is an array of `{uid, startsAt, endsAt, allDay, title, location, notes, category}`.
    - It upserts on (feed, uid, starts_at), clearing `cancelled_at` and setting `synced_at`.
    - It then sets `cancelled_at = now()` on this feed's uncancelled rides with `starts_at >= start of today in Melbourne` that weren't in `p_events`.
    - It sets the feed's `last_ok_at = now()` and `last_error = null`.
  - `public.record_ride_sync_error(p_feed uuid, p_error text) returns void`, granted to `service_role` only.

- [ ] **Step 1: Write the failing tests in `supabase/tests/rides_test.sql`** (same style as `roster_claim_test.sql`):
  - Approved members of any status, Legacy included, can select rides and RSVPs. Pending applicants, anon, and authenticated users with no member record get 0 rows.
  - authenticated and anon can't insert, update or delete `rides` or `rsvps` (`insufficient_privilege`). They also can't execute `apply_ride_sync` or `record_ride_sync_error`, and can't read `private.ride_feeds`.
  - `set_rsvp`:
    - Sets your answer, and a second call changes it, still one row.
    - Refused with the exact messages for a pending member, a missing ride, a cancelled ride and a started ride.
  - `apply_ride_sync`:
    - Inserts 2 events.
    - Re-applying with one event moved to a new start cancels the old future row, adds the new one, and leaves the RSVP on the old row.
    - Re-applying with the event back un-cancels it.
    - A past ride missing from the events is not cancelled.
    - Another feed's rides are untouched.
    - `last_ok_at` is set.
  - `record_ride_sync_error` sets `last_error` and leaves the rides alone.
- [ ] **Step 2: Run `npm run test:db` and expect it to fail** (the relation doesn't exist).
- [ ] **Step 3: Write the migration.** Start of today in Melbourne: `(private.club_date()::timestamp at time zone 'Australia/Melbourne')`.
- [ ] **Step 4: Run `npm run test:db` and expect it to pass**, with ALL DATABASE CHECKS PASSED.
- [ ] **Step 5: Commit** with the message `Rides: tables, RSVPs and sync apply in the database`.

### Task 4: Demo and live data, the RSVP action, and parity cases

**Files:**
- Modify: `src/data/demoData.ts`. Add about 8 rides across all five categories from Nov 2026 to Feb 2027 (one cancelled, one all-day), plus some RSVPs.
- Modify: `src/data/demoActions.ts`. `DemoCtx` gains an optional `now?: string` (default `new Date().toISOString()`). Add `setRsvp(ctx, rideId, answer)`, which uses `rsvpProblem` and upserts. Add a `{ action: 'rsvp'; ride: string; answer: RsvpAnswer }` case to `DemoAction` and `runDemoAction`.
- Modify: `src/data/clubContext.ts`. `ClubContextValue` gains `setRsvp(rideId: string, answer: RsvpAnswer): Promise<void>` and `ridesSyncedAt: string | null`.
- Modify: `src/data/ClubStore.tsx` (demo and live wiring), `src/data/liveData.ts` (load `rides` and `rsvps`, mapping snake_case to the Task 1 types; `ridesSyncedAt` = max `synced_at`), and `src/data/database.types.ts` (tables and the `set_rsvp` function).
- Modify: `supabase/tests/parity.json`. Add `rides` to the fixture: `future-west` starting 2030-01-01T00:00:00Z, `past-club` starting 2020-01-01T00:00:00Z, and `cancelled-north` (2030, cancelled). Add cases.
- Modify: `src/data/parityFixture.testkit.ts` and `scripts/parity-sql.mts`. Fixture rides become `rides` rows with id `md5('r:'||key)::uuid` and `source = 'app'`. Add the `rsvp` call → `public.set_rsvp(...)`.
- Test: `src/data/liveData.test.ts` (extend it), plus the parity cases.

**Interfaces:**
- Consumes: Task 1 types and `rsvpProblem`, and Task 3 `set_rsvp`.
- Produces: `useClub().setRsvp`, `useClub().ridesSyncedAt`, and `data.rides` / `data.rsvps` filled in both modes.

- [ ] **Step 1: Write the failing tests.**
  - Parity cases:
    - A member RSVPs going to `future-west`: allowed.
    - An applicant RSVPs: refused.
    - A member RSVPs to `past-club`: refused.
    - A member RSVPs to `cancelled-north`: refused.
    - A Legacy member RSVPs to `future-west`: allowed.
  - `liveData` test: rides and RSVPs are mapped (snake to camel), and `ridesSyncedAt` is the latest `synced_at`.
- [ ] **Step 2: Run `npm test` and `npm run test:db` and expect them to fail.**
- [ ] **Step 3: Implement** the demo action, context wiring and live loading. The live `setRsvp` calls `db.rpc('set_rsvp', { p_ride, p_answer })` and then `refresh()`, mapping errors the same way as the other actions.
- [ ] **Step 4: Run `npm test`, `npm run test:db` and `npm run typecheck` and expect all to pass.**
- [ ] **Step 5: Commit** with the message `Rides: demo and live data, RSVP action, shared cases`.

### Task 5: Sync Edge Function and schedule

**Files:**
- Create: `supabase/functions/sync-rides/index.ts`
- Create: `supabase/functions/_shared/syncRides.ts`. It holds the testable core, with fetch and the database injected.
- Create: `src/data/syncRides.test.ts`
- Create: `supabase/migrations/20261024120100_ride_sync_schedule.sql`.
  - It runs `create extension if not exists pg_cron` and `pg_net`.
  - It adds `private.ride_sync_url()`, which reads the project URL from `private.app_settings`. If that table doesn't exist, create it with `key text pk, value text` and give it no grants.
  - It schedules `cron.schedule('sync-rides', '*/15 * * * *', $$select net.http_post(url := private.ride_sync_url(), body := '{}'::jsonb)$$)`, guarded so it does nothing when the URL is null.

**Interfaces:**
- Consumes: `parseIcs` and `categoryFor` (Task 2), and `apply_ride_sync` / `record_ride_sync_error` (Task 3).
- Produces: `syncAllFeeds(deps: { feeds: { id: string; url: string; category: RideCategory | null }[]; fetchText: (url: string) => Promise<string>; apply: (feedId: string, events: object[]) => Promise<void>; recordError: (feedId: string, msg: string) => Promise<void>; now: Date }): Promise<{ ok: number; failed: number }>`

- [ ] **Step 1: Write the failing tests** in `syncRides.test.ts`:
  - Two feeds, one OK and one throwing: `apply` is called once with the parsed and categorised events, `recordError` once with the message, and the result is `{ok:1, failed:1}`.
  - A feed returning HTML → `recordError('Not a calendar')`, and `apply` is **not** called.
  - The window passed to `parseIcs` runs from the start of today in Melbourne to plus 12 months.
- [ ] **Step 2: Run `npm test` and expect it to fail.**
- [ ] **Step 3: Implement** `syncAllFeeds`, then `index.ts`.
  - It creates a service-role client from `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
  - It reads the feeds through a `public.ride_feeds_for_sync()` SECURITY DEFINER function granted to service_role. Add it to the Task 5 migration.
  - It calls `syncAllFeeds` and returns the JSON result.
  - `fetchText` has a 20 s timeout.
  - Deploy with `verify_jwt: false`. A call can only trigger a sync of the configured feeds.
- [ ] **Step 4: Run `npm test`, `npm run test:db` (the schedule migration must apply cleanly on the stub; stub `cron`/`net` if needed) and `npm run typecheck`, and expect all to pass.**
- [ ] **Step 5: Commit** with the message `Rides: sync function and 15-minute schedule`.

### Task 6: Rides tab and Ride screen

**Files:**
- Create: `src/screens/rides.tsx`, with `RidesScreen` and `RideDetailScreen`.
- Modify: `src/navigation/types.ts`. Replace `Chapters` with `Rides` in `TabParams` and add `RideDetail: { rideId: string }` to `RootParams`.
- Modify: `src/navigation/RootNavigator.tsx`. Add the Rides tab (icon `calendar` / `calendar-outline`) in Chapters' place, and the `RideDetail` stack screen. `ChaptersScreen` becomes a stack screen called `Chapters`.
- Modify: `src/screens/members.tsx`. Add a "Chapters" row or link at the top of the Members screen that opens `Chapters`.
- Modify: `src/ui/primitives.tsx`, only if a `RideChip` (category colour chip) is needed. Reuse `Chip` where possible.

**Interfaces:**
- Consumes: `useClub()` (`data.rides`, `data.rsvps`, `setRsvp`, `ridesSyncedAt`, `me`, `today`), plus `upcomingByMonth`, `defaultCategories`, `rsvpCounts`, `rsvpProblem`, `melbourneDate` and `melbourneTime`.

- [ ] **Step 1: Read Impeccable's craft floor** (by hand in the cloud), `PRODUCT.md` and `DESIGN.md` if they exist, and the existing screens' patterns in `members.tsx`.
- [ ] **Step 2: Build `RidesScreen`.**
  - Filter chips across the top: the five categories, toggles, defaulting to `defaultCategories`.
  - Month headers in stencil.
  - Rows:
    - a stencil date block (day number and weekday);
    - the title (`type.name`);
    - the time ("All day" for all-day rides) and the location;
    - the category chip;
    - "N going";
    - your own answer, if you've given one.
  - A cancelled ride is struck through and marked "Cancelled".
  - Empty state: "No rides coming up."
  - Fine print at the bottom: "Updated <d/m/yyyy h:mm am> from the club calendar" (live mode only).
- [ ] **Step 3: Build `RideDetailScreen`.**
  - Title, `DD/MM/YYYY`, the time range, and the location. Tapping the location opens `https://maps.google.com/?q=<encoded>` through `Linking`.
  - Notes in the body font.
  - Three stencil choice buttons: Going, Maybe, Can't make it. The current answer is highlighted. When `rsvpProblem` returns a message, the buttons are disabled and the message shows as a `Notice`.
  - Sections for Going and Maybe that list members by `displayName`.
- [ ] **Step 4: Run `npm run typecheck` and `npx expo lint`, and expect both to be clean.**
- [ ] **Step 5: Run `npm run build:preview`**, then take Playwright screenshots at 390×844 of the Rides tab and a ride (demo build, signed in as Member and as Board). Run the critique, audit and polish passes by hand, and fix what they find.
- [ ] **Step 6: Commit** with the message `Rides: Rides tab and ride screen`.

### Task 7: Review, ship and handover
- [ ] **Step 1:** A fresh reviewer subagent gets the branch diff and the spec. Fix every Critical and Important finding, with a test first.
- [ ] **Step 2:** Run all the checks (`npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`) and show the output.
- [ ] **Step 3:** Apply both migrations live, and check the privileges live as Task 3 does.
  - Deploy `sync-rides`.
  - Set `private.app_settings('ride_sync_url')` to the function URL.
  - Load no feeds until Dysco answers.
  - Regenerate `database.types.ts` from live.
- [ ] **Step 4:** Open a PR, merge it to `main` (EAS Update publishes the preview), and update `docs/handover/`.
- [ ] **Step 5:** When Dysco's answer arrives: insert the feed row(s) with Jeff's OK (that's real club data), run the function by hand, and check the rides in the live app.
