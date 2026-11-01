# The website reads its rides from the app: design

Date: 01/11/2026. Bounded-plus (one new read-only database function, one more route on the
existing `site-api` door, a website script change). Approved by Claude under Jeff's self-approval
rule (AGENTS.md); Jeff can veto. Jeff's tap on 01/11/2026: "Public ride feed on the site", task 6
of the website and app joining-up list.

## What it's for

The home page already lists each chapter's upcoming rides and shows the ride calendar. Today it
reads them from Chris's Cloudflare worker (`rustnuts-calendar-proxy`, on his personal account),
which proxies the club's Google Calendars. The app reads the same calendars into `public.rides`
every 15 minutes (`sync-rides`). After this change the website reads the app's copy through
`site-api`, so:

- the app is the one source the website shows, as Jeff asked (the app's rides, the app's
  cancellations, and later rides made in the app, which never reach the Google calendars);
- the website no longer depends on a worker on Chris's personal Cloudflare account;
- Chris's worker is **kept as the fallback**: if the app feed fails, the page reads the worker
  as it does today, so nothing he built is removed.

## The rule: public only what is already public

`public.public_rides()` (stable, security definer, executable by `anon`) returns rides from a
year back to two years ahead, the same window the page asks the worker for:
`id, title, starts_at, ends_at, all_day, category, location, cancelled_at`, plus `notes` only for
rides that came from the public calendars (`source = 'feed'`). A ride made in the app
(`source = 'app'`) keeps its notes to members: a road captain writing in the app expects
members-only. No RSVPs, no crew, no member data of any kind.

`GET /site-api/rides` answers `{ rides: [...] }` with `Cache-Control: public, max-age=900`,
503 with `no-store` when the database fails. No change to CORS (the list is public, like
sponsors).

## On the website

`app/site-api.js` gets `loadRides(fetchFn)` (resolves to `[]` on any failure) and
`rideToEvent(ride)`, which maps an app ride to the shape the page's calendar code already
uses (`summary`, `start`, `end`, `description` carrying `Label: West` etc., no `htmlLink`), so
the existing colour, label and list code works unchanged. Categories map to Chris's labels:
`north` → North, `west` → West, `club` → Rustnuts, `supported` → Supported Club Rides,
`non_nuts` → Non-Nuts Events. A cancelled ride's title is prefixed "CANCELLED: " so the page
shows it is off, as the app does.

`index.html`'s `fetchEvents()` tries `loadRides()` first; an empty list falls back to the
worker. Nothing else on the page changes.

## Checks

`npm test` (function route and website mapping), `npm run test:db` (`public_rides_test.sql`:
anon can call it, notes hidden for app rides, window, no RSVPs), typecheck, lint; website
`npm test`; the home page at 390×844 against the live function once deployed. Live: one SQL
paste (the migration), redeploy `site-api` (Jeff presses Deploy), then the website PR (merge =
live, Jeff's tap).
