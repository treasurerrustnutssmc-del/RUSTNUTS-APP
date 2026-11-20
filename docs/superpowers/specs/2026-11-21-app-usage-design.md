# App usage: which screens members reach, where they get stuck (design)

Asked by Jeff, 21/11/2026 (on the Big 4 ride): "now that we have a few users, where we monitor what
everyone gets to and make usability a lot more easier". Architectural (new table, new client hook,
privacy and store-label change). Claude approves its own spec under the 24 Oct rule; Jeff can veto,
and the privacy choice (anonymous or named) is his card.

## What it answers

1. Which screens get used, and which nobody finds (views per screen, last 7 and 30 days).
2. Where people give up: the screen an app visit ended on, and short "started but didn't finish"
   paths for the jobs that matter (ask to join, sign in, RSVP, new ride, feedback, pay fees, merch order).
3. Where things break: which screens show errors, and what kind (connection, not allowed, form to fix, other).
4. What changed after a fix: the same numbers week on week.

## How it works

- **Client** (`src/data/usage.ts`): the NavigationContainer's `onStateChange` already fires on every
  screen change. It adds `{ kind: 'screen', name: <route name> }` to a small in-memory queue. Error
  messages shown through the shared error text, and the finish of each tracked job, add
  `{ kind: 'error' | 'done', name, detail }`. The queue flushes every 30 seconds and when the app goes
  to the background, in one RPC call (`app_usage_record(events jsonb)`), at most 50 events per call.
  A failed flush is dropped, never retried in a loop and never shown to the member.
- **Visit id**: a random id made each time the app opens, kept only in memory. It joins one visit's
  screens together (so "last screen" and "started but didn't finish" can be counted) and nothing else.
- **Demo build**: records nothing.
- **Off switch**: the Me tab, Privacy, "Help improve the app" (on by default). Off means
  nothing is queued.

## Storage (Supabase, free)

`public.app_usage_events(id, at, visit_id uuid, kind, name, detail, tier, platform, app_version)`.
`name` must be a known route or job name (checked against a list, like site_visits' page check);
`detail` is only for errors and only one of four kinds (connection, not-allowed, form, other): the
words of a message are never sent, because some quote people ("No from <name>"). Red notices that
aren't errors (support's emergency box, a Declined status) opt out with `notAnError`. `tier` is member / family / board / public.
RLS on, no grants; `app_usage_record` is security definer, signed-in or signed-out callers, only the
first 50 events of a call looked at, 200 per visit, 5,000 a day of which signed-out visits share 1,000
(soft caps). Rows older than 90 days are swept by the record call that wins an advisory lock. **No member id, no name, no email, no IP, no device id.** Jeff chose anonymous (21/11/2026). A new
visit id starts when someone else signs in on the same phone.

`app_usage_summary(days int)` (board only, like site_visit_summary) returns each visit's screens in
order (no time, tier or platform per visit, which could point at someone) and error kinds per screen
with counts. The app works out views, where visits ended and journeys from that.

## Where it shows

- Board › **App usage** card next to "Website visits": top screens, least-used screens, jobs with the
  biggest drop-off, errors this week. Stencil numbers per DESIGN.md.
- **Weekly usability note**: a scheduled cloud task, Sunday evening Melbourne, reads the summary
  (read-only SQL), writes 3 to 5 plain-English problems with a suggested fix each, and posts them to
  this project for Jeff to tap "build it" or "leave it". Free apart from Claude usage.

## Privacy and store labels (must change together, before the switch is turned on)

- `src/domain/privacyPolicy.ts`: replace "no analytics of the club's own" with a paragraph on app
  usage counts (what, why, 90 days, the off switch), bump PRIVACY_UPDATED_ON, rebuild the site copy.
- Google Play Data safety: App activity › App interactions gains **Analytics** (collected, not shared);
  App info and performance › Crash logs / Diagnostics: collected by the club, for Analytics.
  Needs a Play Console edit and review (outward-facing: Claude enters it, Jeff's yes first).
- Apple privacy labels: Usage Data › Product Interaction and Diagnostics › Other Diagnostic Data,
  purpose Analytics, **Not linked to you** (option A) or **Linked to you** (option B). Edit in App
  Store Connect before the App Store release.
- `docs/store/privacy-answers.md` updated in the same PR.

## Cost

A$0: one table on the existing Supabase project (a few thousand rows a week at 37 members), no new
service, no native module (ships over the air).

## Tests

`npm test`: name cleaning, queue limits, summary maths (drop-off, last screen), off switch, demo
records nothing. `npm run test:db`: record caps, unknown names dropped, summary board-only, 90-day
sweep, no member id column (option A).

## Rollout (ride weekend)

Built and reviewed on a branch now. Held until Jeff is off the bike: the SQL, the store-label edits,
the merge and the over-the-air update.
