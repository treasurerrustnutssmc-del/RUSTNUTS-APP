# Rides made in the app, shown on the website (website-and-app task 6)

**Status:** approved by Claude under Jeff's 24 Oct rule; shown to Jeff 1 Nov 2026 (he can veto).
Jeff's calls so far: build it (tap 14:13Z); "Board ticks per ride" for what goes public (tap 14:14Z).
**Kind:** architectural. The first write path into `public.rides` from the app; a new screen; a change
to the public feed the website already reads.

## What Jeff asked for

Task 6 on the website-and-app list: make rides in the app, show them on the site. Today every ride
comes from the club's Google calendar (the `sync-rides` function every 15 minutes) and the website's
ride lists and calendar read the app's copy of those rides through `site-api /rides`. Nothing can be
made in the app. This adds the smallest complete version: the people who run rides make, change and
call off rides in the app; those rides show to members like any other; and the ones the board marks
for the website show on the site, with less detail than members see. The Google calendar keeps
working in parallel; nothing retires until the board wants it to.

## Who

**Makes, changes and calls off rides:** the same people who run a ride's crew today
(`managesRide` in `src/domain/crew.ts`): a North or West ride needs that chapter's board or ride
committee (or the NEC); a Club, Supported or Non-Nuts ride needs any board seat, ride committee seat
or the NEC. Only rides made in the app can be changed; a calendar ride is changed in the calendar.

**Sees them in the app:** every approved member, as now (RSVPs, crew, chat, briefing, plan, hub,
charity sign-ups and the Rusty Bus all hang off `public.rides` and work unchanged).

**Sees them on the website:** everyone, when the ride's "Show on the website" switch is on.

## A ride made in the app

| Field | Rule |
| --- | --- |
| title | 3–80 characters, required |
| starts | date (DD/MM/YYYY) and time (24-hour HH:MM), or all day; must be today or later when made |
| ends | optional; after the start; for an all-day ride a date on or after the start date |
| category | one of North, West, Club, Supported, Non-Nuts (the five the calendar already uses) |
| location | optional, ≤ 120 characters: the meeting place |
| notes | optional, ≤ 1,000 characters, plain text; members only |
| website | "Show on the website", default **on** |
| source | `app` (a calendar ride is `feed`) |
| created_by, updated_by, updated_at | who and when; never shown on the website |
| cancelled_at | set by "Call it off"; cleared by "Put it back on" |

Rules:
- A ride can be changed until the end of its day (Melbourne); after that it is history.
- Calling off is for rides that have not started. Putting back on is for rides called off in the app
  that have not started. A ride the calendar cancelled stays the calendar's.
- The category can change on an app ride; the person must be allowed to manage both the old and the
  new category (a West ride committee member can't move a West ride to North).
- The Big 4 flag, routes, crew and the rest are separate features and are not touched here.

## What the website shows

For a ride made in the app with the website switch on: **title, start and end, all day, category and
location**. Notes stay with members (`notes` comes back null in the feed). A ride with the switch off,
or called off after never having been on the site, is not listed. A ride that was on the site and is
then called off shows as cancelled, the same as a calendar cancellation does today, so people who
saw it learn it's off. Calendar rides are unchanged: still title, when, category, location and notes.

The website needs no change: `/rides` keeps the same shape and `rideToEvent` already handles a null
`notes`.

## Words (identical in app and database)

- NOT_RIDE_MANAGER "Only the board, ride committee or NEC can make and change rides."
- NOT_CHAPTER_RIDE_MANAGER "Only that chapter's board or ride committee can run its rides."
- RIDE_TITLE "Give the ride a title (3 to 80 characters)."
- RIDE_START "Pick a start date and time."
- RIDE_PAST "A ride starts today or later."
- RIDE_END "The end comes after the start."
- RIDE_LOCATION "Keep the meeting place to 120 characters."
- RIDE_NOTES "Keep the notes to 1,000 characters."
- RIDE_GONE "No such ride."
- CALENDAR_RIDE "This ride comes from the club calendar; change it there."
- RIDE_OVER "That ride is history; it can't change now."
- RIDE_ALREADY_OFF "That ride is already called off."
- RIDE_NOT_OFF "That ride isn't called off."

Refusal order for saving: signed in → approved → exists (when changing) → app ride → not over →
allowed for the ride's category (and, when changing, the new one) → title → start → not past (new
rides only) → end → location → notes.
Refusal order for calling off / putting back: signed in → approved → exists → app ride → not started
→ allowed → not already off / is off.

## Pieces

**Database (`supabase/migrations/20270760000000_app_rides.sql`, paste-queue item 60)**
- `public.rides` gains `website boolean not null default true`, `created_by uuid`, `updated_by uuid`,
  `updated_at timestamptz`. Existing rows keep `website = true` (calendar rides are public already;
  the column only matters for `source = 'app'`).
- `private.manages_ride_category(p_category)`: the `managesRide` rule in SQL (board or ride
  committee of the chapter whose slug is the category, or any board / ride committee / NEC for the
  rest), using the existing `private.is_any_board()` and position helpers.
- `public.save_ride(p_id uuid, p_title text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_all_day boolean, p_category public.ride_category, p_location text, p_notes text, p_website boolean)
  returns uuid`: insert when `p_id` is null, else update an app ride; the refusals above; sets
  `source = 'app'`, `synced_at = now()`, who and when. The existing triggers do the rest: the ride
  gets its chat (`rides_get_a_chat`), members who asked for new-ride pushes hear about it
  (`rides_push_added`), and a moved start pushes to those going (`rides_push_changed`).
- `public.set_ride_called_off(p_id uuid, p_off boolean)`: sets or clears `cancelled_at`; the
  cancellation push fires through `rides_push_changed` as it does for calendar cancellations.
- `public.public_rides()` changes its `where` to `(source = 'feed' or website)` and returns
  `case when source = 'app' then null else notes end as notes`.
- `public.ride_calendar()` is unchanged (it already returns every column, so `source` and `website`
  reach the app).
- Grants: the two new functions to `authenticated` only. No new table grants; writes stay behind the
  functions.
- `supabase/tests/app_rides_test.sql` + a block in `scripts/test-db.sh`; `public_rides_test.sql`
  gains the app-ride cases (switch on → listed without notes; switch off → not listed; called off
  after being on → listed as cancelled).

**Domain (`src/domain/newRide.ts`, tests beside it)**
- `RideInput` and `saveRideProblem(me, existing, input, data, now)`, `callOffProblem`,
  `putBackProblem`, `cleanRideInput`, the words above, the limits, `isAppRide`.
- `src/domain/types.ts`: `Ride` gains `source: 'feed' | 'app'`, `website: boolean`.
- `supabase/tests/parity.json`: cases for save, change, call off and put back across a West ride
  committee member, a North member, the NEC and a plain member.

**Data**
- `ClubStore`: `saveRide(input, id?)`, `setRideCalledOff(id, off)`.
- `src/data/rideActions.ts` (demo) + `rideLive.ts` (rpc args) following `charityActions.ts` /
  `charityLive.ts`; demo data marks one upcoming ride as made in the app.
- `LiveClubProvider` maps `source` and `website`; `siteApi.ts`'s `PublicRide` is unchanged.

**Screens**
- Rides tab: a "New ride" button at the top for anyone who can manage any category.
- `EditRide` screen (new and change): title, date, time, all-day toggle, optional end, category
  chips (only the ones the person may manage), meeting place, notes, "Show on the website" toggle
  with the line "The site shows the title, when, chapter and meeting place. Notes stay in the app."
- Ride detail: for an app ride the manager sees "Change", and `ConfirmButton` "Call it off" /
  "Put it back on". A small line under the title says "Made in the app" or "From the club calendar".
  Members already see a cancelled banner.
- Stencil typeface for titles, chips, buttons and dates as the brand rules say; no `Alert`.

**Website** — no change. Checked by the existing site-api tests plus one new case: an app ride in
the feed carries no notes.

## Not in this piece

- Retiring the Google calendar or writing app rides back to it.
- Changing calendar rides from the app.
- Photos, routes or crew in the form (they attach afterwards, as today).
- A "members only" view of app rides on the website.

## Checks before it ships

`npm test`, `npm run test:db` (new and changed blocks), `npm run typecheck`, `npx expo lint`;
phone-size screenshots of the Rides tab, the New ride form and a ride made in the app, in the demo
build; an independent reviewer over the diff; website `npm test` unchanged and green.
