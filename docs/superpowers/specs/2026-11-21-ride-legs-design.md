# Ride legs: one ride in several legs

Asked by Jeff, 21 Nov 2026 (Melbourne): "the ride is done in 3 legs and has been entered as 3
separate rides, can we maybe add a legs of the ride option?" The Big 4 Alpine Run is on the
calendar as separate rides (out, home, and so on). Size: a project (database + screens), so this
spec, then a plan. Approved by Claude under the 24 Oct rule; Jeff can veto.

## Why

Members see three unrelated rides and have to find and answer each one. The people running it
can't show it as one trip. Jeff wants it to read as one ride with legs.

## Approaches

1. **Link rides as legs of one trip (chosen).** Each leg stays a ride of its own, with its own
   start, meeting place, route, plan, crew, chat, live tracking and ride comms. A small new table
   says "this ride is leg N of that trip". The ride page and list show the legs together.
   Nothing in live rides or ride comms changes, and the rides already entered for the Big 4 can
   simply be linked, with no re-entry and no lost RSVPs.
2. **Legs inside one ride.** One ride row with a list of legs (times, places). One RSVP list and
   one crew, but routes, ride plans, live tracking and ride comms are all one-per-ride today, so a
   route per leg means reworking those, the riskiest parts of the app. Rides already entered
   would have to be merged by hand.
3. **Just a "part 2 of 3" line in the notes.** No build, but nothing links and nothing groups.

Approach 1 gives what Jeff asked for at the lowest risk to the parts riders rely on during a ride.

## Goals

- A ride manager can link rides as legs 1, 2, 3 ... of one trip, change the order, or unlink.
- From a ride, "Start the next leg" (Jeff, 21 Nov: "an easy start next leg option") opens the New ride form pre-filled (same chapter/colour, the
  day of the last leg) and links the new ride as the next leg when saved.
- Ride page: a "LEG 2 OF 3" chip at the top (Jeff asked for the leg number and count on the ride screen) and a "The legs" card listing each leg (date, time, meeting
  place) with a tap to open it.
- Rides list: each leg's card carries the "LEG N OF M" chip so the legs read as one trip.
- Members can answer every leg at once: "Going to every leg" on the legs card (one RSVP per leg,
  through the existing RSVP rules, so the going gate etc. still apply).

## Non-goals (this piece)

- Changing ride comms, live tracking, routes or crew. Each leg keeps its own.
- Counting a trip once for attendance (each leg still counts as its ride does today). Flag it in
  the follow-ups.
- The website: legs show there as the separate rides they already are.

## Anti-goals

- Anything that changes or disrupts a ride under way. The database change is additive (one new
  table, one function, one reader) and goes live only after Jeff's OK, not on a ride day.

## Rules (app `src/domain/rideLegs.ts` mirrored by `public.set_ride_legs`, same words)

- Who: someone who manages every ride in the trip (`managesRide`, same as crew: North/West need
  that chapter's board or ride committee, the rest any board seat, ride committee or NEC). Calendar
  rides can be linked too: linking doesn't change the ride itself.
- A trip has 2 to 6 legs; a ride is in at most one trip; legs are ordered by the list given (the
  form offers them in start order). Linking a single ride or none clears the trip.
- A trip can't change once its last leg is history (same "history" rule as saving a ride).
- Legs of one trip start within 14 days of the first.

## Built (21 Nov)

Ride page: "LEG 2 OF 3" chip, "The legs" card (numbered rows, this leg marked), "Going to every leg",
"Start the next leg" (New ride form titled "<first leg>, leg N", same colour, dated the day the last
leg finishes; linked on save) and "Link legs" / "Change the legs" (tick list of rides the person runs
within 14 days, numbered by start; Unlink). Rides list rows carry the leg chip. Calendar rides can be
legs; taking a calendar ride over (PR #181) keeps its leg.

## Data

`public.ride_legs (ride_id uuid primary key references rides on delete cascade, trip_id uuid not
null, leg_no smallint not null, set_by, set_at)`, unique (trip_id, leg_no). `trip_id` is a fresh id
for each linking (just a grouping key; reusing a ride id could collide with what's left of an old trip).
Relinking takes the listed rides out of their old trips; a trip left with one ride ends, the rest are
renumbered. The unique (trip_id, leg_no) is deferred so renumbering works in one statement. Approved members read it (RLS like
ride_routes); writes only through `set_ride_legs(p_rides uuid[])`. Apart from `rides` so the
calendar sync never touches it. Parity cases in `supabase/tests/parity.json`.

## Left to the builder

Exact layout of the legs card and the picker (pick from rides within 14 days that the person
manages, tick and order), following DESIGN.md and the stencil font rules; demo data for the Big 4
in the demo build.
