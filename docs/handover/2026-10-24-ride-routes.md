# Handover: locked ride routes (lane A, 24 Oct 2026)

Merged as PR #19 (68d68bb). Spec: `docs/superpowers/specs/2026-10-24-ride-routes-design.md`. Plan: `docs/superpowers/plans/2026-10-24-ride-routes.md`.

## Live state
- Migration `ride_routes` (repo file `20261024140000_ride_routes.sql`) applied to the live project on 24 Oct at about 17:29 UTC, before the merge, because the live load now reads `public.routes`.
- Smoke check:
  - all 4 actions exist
  - `ride_calendar` returns `crew` and `ride_routes`
  - members can't select `gpx`
  - anon gets nothing
- Security advisors show only the expected "definer function callable by authenticated" warnings.
- Not tried on a phone yet. The native file picker and share sheet need a development build.

## Rulings made without Jeff (he can veto any)
- **Missing route:** a route that's gone says `That route no longer exists.`, everywhere.
- **Check order, app and database alike:** sign in, then approved, then missing route, then manager, then name, and only then the file checks (size, well-formed with a `gpx` root, at least 2 track points), then the summary caps.
- **Archived routes** can still be edited. They can't be newly chosen, and rides that use them keep them.
- **App versus database reader:** the app's GPX reader may be stricter than the database, never looser. Examples of stricter: a bad lat/lon, exponent numbers, route points used only when there's no track. Every malformed-XML case libxml2 refuses, the app refuses too.
- **Limits:** at most 100 stops and a line of at most 300 points, enforced in the database as well. Distance counts the hop between track segments.
- **Name length** counts characters, not UTF-16 units. Names are trimmed of every kind of whitespace (`private.trim_like_app`).
- **A BOM** at the start of a file is skipped by the app, and stripped and not stored by the database.
- **Button label:** phones say "Open in maps app" (share sheet). The web says "Download GPX", because it saves a file.
- **Route library filter** starts on your own chapter plus Whole club, like Rides.
- **Database delete behaviour:** `ride_routes` goes with its ride (cascade). Who-did-it columns are set to null if a member is removed.

## Gotcha (also in memory)
Supabase `apply_migration` accepts `on delete cascade` / `on delete set null` foreign-key clauses. Only `delete from` and `drop` statements raise the confirm prompt, and that prompt never reaches Jeff.

## Still open in lane A
- **Ride crew actions:** Jeff needs to paste `/mnt/project-files/build/ride-crew-actions.sql` (set_crew, leave_crew and the new set_rsvp) into the Supabase SQL editor. Until then, the crew buttons on live fail. The file doesn't touch `ride_calendar`.
- **Next pieces:** briefing cards (they'll show the route's stops), Road Rules sign-off, and Rusty Bus booking. Each gets its own spec.
- **Nice later:**
  - a live round trip with a file near 5 MB (to test the API gateway's size limit)
  - map tiles behind the shape, which needs a map provider account and Jeff's yes.
