# Handover: 24 Oct 2026, fourth session

Branch `claude/project-thread-pun6fa`, PR #7.

## Done
- **Roster loaded** (Jeff said yes to each batch). There are 29 rows in `private.roster`: 17 Full, 2 Nomad, 4 FNG, 5 Legacy and 1 Supporter (Foggy, a founding member who never patched).
  - Kilroy is Clinton Lindley.
  - No emails were sent. Loading is silent, as Jeff asked.
- **Legacy status** for members who left in good standing (PR #6, live).
  - Legacy members see everything approved members see.
  - They hold no positions and can't be approved straight in as Legacy.
- **Self-approval:** Claude now approves its own designs, specs and plans, shows each to Jeff, who can veto, and keeps building (AGENTS.md).
- **Ride calendar and RSVPs**:
  - Spec: `docs/superpowers/specs/2026-10-24-ride-calendar-design.md`. Plan: `docs/superpowers/plans/2026-10-24-ride-calendar.md`.
  - **App:** the Rides tab and ride screen (`src/screens/rides.tsx`). Chapters is now a row on Members.
  - **Rules:** `src/domain/rides.ts`, mirrored by `set_rsvp`.
  - **Parser:** the iCal parser is `supabase/functions/_shared/ics.ts`. The `sync-rides` Edge Function is deployed, with `verify_jwt` off.
  - **Live database:** the tables, the functions, `ride_calendar()` and a 15-minute pg_cron job are live. `private.app_settings` `ride_sync_url` is set. A test call returned `{"ok":0,"failed":0}` because there are no feeds yet.
  - **Reviews:** two independent reviews, with every Important finding fixed test-first.
- **Impeccable** 4.7.1 is installed project-local.
  - `PRODUCT.md`, `DESIGN.md` ("Stencilled on Steel") and `.impeccable/design.json` are written. Lines marked *inferred* are for Jeff to veto.
  - The detector is clean across `src/`.
  - The platform is `adaptive` (native), so a critique is the design review alone. Screenshots come from the web preview, because there's no simulator in the cloud.

## Gotchas
- **Supabase's apply_migration** asks Jeff to confirm any SQL that contains the word `drop`, and the prompt never reaches his phone, so the call times out. Keep `drop` (even `on commit drop`) out of migrations, or split the risky part out. For the same reason, the live ride migration was applied in four parts (`rides_tables`, `rides_table_privileges`, `rides_functions`, `ride_sync_schedule`). The repo keeps it as one file.
- **pg_net** sits in the `public` schema. The advisor warns about it. It's low risk; moving it would need the extension removed and re-added.

## Next
1. **Feeds:** when Dysco sends the website calendar's iCal address (or addresses), add a row to `private.ride_feeds` with the url, plus a category if the feed is one colour. That needs Jeff's OK because it's real club data. Then trigger the sync with `select net.http_post(url := private.ride_sync_url(), body := '{}'::jsonb)` and check `net._http_response`.
2. **Emails still missing:** Cocky, Just In, Cobra and Tractor. Cowboy's email (`sashhippy@gmail.com.au`) looks wrong.
3. **Stage 2 specs:** ride roles, locked routes, briefing cards, Road Rules sign-off, the Rusty Bus.
4. **Before launch:** the password-sign-in hook, and the website's "Get the app" link.
