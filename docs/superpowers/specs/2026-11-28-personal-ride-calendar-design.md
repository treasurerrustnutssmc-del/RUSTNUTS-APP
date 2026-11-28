# Personal ride calendar link

Jeff, 28 Nov 2026: "Is there a way for any rides I click going to be added to a personal calendar,
either Gmail or Outlook or any other calendar people might personally use?" He tapped **Personal
calendar link** (over a phone-calendar module, which needs a new native build, and a one-off
"Add to calendar" button, which goes stale).

Bounded piece with a database part: one table, three functions, one server function, one screen.
Approved by Claude under the 24 Oct rule; Jeff can veto.

## What a member gets

Me › Settings › **Rides in my calendar**. The screen explains it in two sentences and offers:

- **Add to Google Calendar**: opens `calendar.google.com/calendar/r?cid=<webcal link>`. On a phone it
  opens in the browser; once added it shows in the Google Calendar app too.
- **Add to Outlook**: opens `outlook.live.com/calendar/0/addfromweb?url=…&name=Rustnuts rides`, with a
  smaller **Outlook for work or school** for `outlook.office.com`.
- **Add to Apple Calendar** (not shown on Android): opens the `webcal://` link, which Apple Calendar subscribes to.
- **Share the link**: the phone's share sheet (React Native `Share`, no new native module), for any
  other calendar app. The link also shows as selectable text, for where sharing doesn't work.
- **Make a new link** (ConfirmButton): the old link stops working, for a link that got passed on.

Every ride they mark **Going** shows up. Change to Maybe or Not going and it goes. A ride moved or
changed in the app or the club calendar moves in theirs. A called-off ride stays, titled
"CALLED OFF: …" and no longer marked busy, so nobody turns up (no STATUS:CANCELLED: Google and Outlook
hide those in subscribed calendars). A club-calendar ride whose start moves comes back from the sync as
a new row with the old one called off; the feed shows the live row from the same calendar entry within
3 days instead, so the ride moves rather than showing called off. Each leg of a trip is its own entry with
"Leg 2 of 3" in the notes. Calendars fetch on their own schedule (Google every few hours, Outlook
similar, Apple as set), so changes aren't instant; the screen says so.

## How it works

- `private.calendar_links (member_id pk → members on delete cascade, token text unique, made_at)`.
  Token: two random UUIDs without dashes (244 random bits), no pgcrypto needed.
- `public.my_calendar_link()` (authenticated, approved members): the member's token, made on first ask.
- `public.new_calendar_link()` (authenticated, approved members): a fresh token; the old one stops.
- `public.calendar_feed(p_token)` (service_role only): the rides the token's member answered Going,
  while that member is still an approved, non-Family member (the is_approved_member test), from 60 days back onward, with leg number and leg count.
  An unknown token returns nothing and the server function answers 404. A member who is no longer
  approved gets an empty calendar, so their subscription empties rather than errors.
- Server function `calendar-feed` (verify_jwt off, like site-api: calendar apps can't sign in; the
  unguessable token is the key). `GET /calendar-feed/<token>.ics` → `text/calendar`. The calendar
  text is built in `supabase/functions/_shared/rideCalendarFeed.ts`, tested by `npm test`.
- Times go out in UTC (`…Z`); all-day rides go out as Melbourne dates with an exclusive end date.
  `UID` is `<ride id>@rustnutssmc.com.au`, so an update replaces the entry rather than adding one.
  `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` ask for hourly refreshes (calendars may ignore it).
- Notes in the entry: location, the members-only notes (it's the member's own calendar), the leg line,
  and "From the Rustnuts app".

## Privacy

The link shows only that member's own Going rides, no other member's names. Anyone holding the link
can see those rides, which is why the screen says not to post it and offers a new one.

## Ships

SQL (one paste-queue item), deploy `calendar-feed` with JWT off, then an OTA. No native build.

## Not in this piece

Writing into the phone's own calendar; one-off "Add to calendar" per ride; rides the member marked
Maybe.
