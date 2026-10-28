# Ride planning extras (Stage 2, part 7)

**Type:** architectural. It adds tables, database actions, two screens and a phone-side notice.

This lane's migration prefix is `20270410` (agreed with the attendance thread, which takes `20270405`). Claude approved this spec on 28 Oct 2026 under Jeff's standing rule, and Jeff can veto any line. Lines marked *inferred* are the ones most worth a look.

## Goal
Six things the brief lists under Rides that need no new accounts:
1. **Fuel stops planned around the smallest tank in the pack.**
2. **A dedicated ride planner for the RC:** stops (fuel, coffee, lunch, regroup) on top of the route.
3. **Member ratings in the route library.**
4. **A one-tap "ride's off" or "postponed"** (no weather check: that needs a provider account).
5. **A hub for the Big 4 and the Not Dead Yet Run:** registrations and accommodation (no payments).
6. **Ride-role swap requests** that the other person accepts, with a phone notice (push stays held).

## Words
- **Writers** of a ride's plan, and who can call it off: the same people as the briefing (`writesBriefing`): the board, Ride Committee and NEC for that ride (`managesRide`), plus whoever holds the ride's Road Captain spot.
- **Range:** how far a bike goes on a full tank before the fuel light comes on, in whole km (30 to 1000). The member sets it on their bike. *Inferred:* range, not litres, because that's what riders know.
- **The pack:** everyone Going, plus the crew.
- **The pack's limit:** the shortest range among the pack's bikes. A member with several bikes counts their shortest non-project bike. *Inferred:* the app doesn't know which bike someone brings, so it plans for the worst.
- **Safe leg:** 90% of the pack's limit, rounded down. *Inferred:* a 10% margin on top of the fuel light.
- **Stop:** one line of a ride's plan: a kind (**Fuel**, **Coffee**, **Lunch**, **Regroup** or **Other**), a name, how far along the route it is (km, optional) and a time (24-hour `HH:MM`, optional). At most 15 stops.
- **Call:** the writer's word on a ride: **Off**, **Postponed** (with an optional new day) or **Back on**.
- **Hub:** registrations and accommodation for an overnight or big ride. It has:
  - **Members only:** when on, only FNG, Full and Nomad members can register (constitution 5.8: Supporters can't join Big 4 Club-only rides).
  - **Registrations close** on a day (optional).
  - **Group beds:** how many places the group booking has (optional).
  - **Accommodation** and **Notes** (1000 characters each).
- **Registration:** where you're staying (**With the group**, **Sorting my own**, **Camping** or **Day trip only**), whether you bring a pillion, who you'd share with (80 characters) and notes (200 characters).
- **Swap:** a crew member asks someone to take their spot. If that person already has a spot on the ride, accepting trades the two spots; otherwise they take the spot and the asker comes off the crew (still Going).

The Big 4 designation itself belongs to the attendance thread (`big4_rides`, NEC only). The hub doesn't depend on it; once that lands, the hub and the ride show its Big 4 badge.

## Rules (`src/domain/ridePlan.ts`, `fuel.ts`, `ratings.ts`, `rideCalls.ts`, `hubs.ts`, `swaps.ts`; mirrored by the database with the same words and order)

Every action starts with `Sign in first.` then `Only approved members can do that.`

### 1. Bike range (`set_bike_range`)
1. Not your bike: `That’s not your bike.`
2. Not a whole number from 30 to 1000 (or blank, which clears it): `Range is in km, from 30 to 1000.`

### 2. Fuel check (app only, nothing stored)
- Legs run from km 0 (everyone starts full; the briefing says so) through each Fuel stop with a km, in order, to the route's end.
- A leg longer than the safe leg is flagged, with "Fuel by km N" (the previous fuel km plus the safe leg) and the furthest stop of any kind, or route waypoint, before that point as a suggestion.
- Going members with no range on file are listed, so the RC can ask them.
- With no route, the card shows the pack's limit only. With no ranges, it says so.

### 3. Ride plan (`save_ride_plan`)
1. `No such ride.`
2. `That ride was cancelled.`
3. After the ride day: `The plan can’t change after the ride day.`
4. Not a writer: `Only the board, ride committee or this ride’s Road Captain can plan the ride.`
5. More than 15 stops: `That’s too many stops (15 at most).`
6. A stop's name blank or over 60 characters: `Give each stop a short name (60 characters at most).`
7. A km outside 0 to 2000: `Check the km: 0 to 2000.`
8. A time that isn't `HH:MM`: `Write times as 24-hour HH:MM, like 10:30.`
9. Saved on top of a newer plan than the one opened: `Someone else saved this plan while you were editing. Your changes aren’t saved: copy them, then open the plan again.`

Stops are saved trimmed, in km order (stops without a km keep their place after those with one). An empty plan is allowed (it clears the stops). The briefing card shows the plan's stops when there are any, and the route's waypoints otherwise.

### 4. Route ratings (`rate_route`)
1. `That route no longer exists.`
2. Archived: `That route is archived.`
3. Stars not 1 to 5: `Pick 1 to 5 stars.`
4. Comment over 280 characters: `Keep the comment to 280 characters at most.`

One rating per member per route; rating again replaces it. *Inferred:* any approved member can rate, ridden it or not, and there's no taking a rating back (change it instead). The library shows the average to one decimal and the count; the route shows everyone's stars and comments, newest first.

### 5. Calling a ride (`call_ride`)
1. `No such ride.`
2. `That ride was cancelled.` (off the club calendar)
3. After the ride day: `It’s too late to call this ride.`
4. Not a writer: `Only the board, ride committee or this ride’s Road Captain can call the ride.`
5. Off when it's already off: `The ride’s already off.` Back on when it isn't off or postponed: `The ride isn’t off or postponed.` (A postponed ride can be postponed again, to a new day.)
6. Reason over 200 characters: `Keep the reason to 200 characters at most.`
7. A new day on anything but Postponed: `Only a postponed ride takes a new day.`
8. A new day not after the ride's day, or more than 12 months on: `Pick a new day after the ride, within 12 months.`

Back on clears the reason and new day. Each call also posts a line in the ride's chat as the caller ("Ride’s off: Rain and 90 km/h winds."), making the ride's chat first if it has none yet (rides from before the chat). Answers stay open, so Going and Can't make it still work if it's back on. *Inferred:* the app doesn't move the ride in the club's Google calendar; a postponed ride says "Move it in the club calendar too" to the writer. Ride reminders skip a ride that's Off or Postponed.

Quick reasons on the screen (tap to fill): **Weather**, **Not enough riders**, **Road closures**.

### 6. Hub (`save_hub`, `register_hub`, `withdraw_hub`)
Saving a hub (opening it, or changing it):
1. `No such ride.` 2. `That ride was cancelled.` 3. After the ride day: `The hub can’t change after the ride day.`
4. Not a crew manager (`managesRide`): `Only the board, ride committee or NEC can run the hub.`
5. Group beds outside 1 to 500: `Group beds: 1 to 500, or leave it blank.`
6. Accommodation or notes over 1000: `That’s too long (1000 characters at most).`
7. A new closing day before today (Melbourne) or after the ride's day: `Pick a closing day from today up to the ride day.` A closing day already saved can stay as it is.

Registering (or changing your registration):
1. `No such ride.` 2. `That ride was cancelled.` 3. No hub: `This ride doesn’t take registrations.`
4. After the ride starts (all-day: after its first day), or after the closing day: `Registrations have closed.`
5. Members only and not FNG, Full or Nomad: `This one’s for FNG, Full and Nomad members.`
6. Share-with over 80 or notes over 200: `Keep it short: 80 characters for who you’re sharing with, 200 for notes.`
7. With the group when the group beds are taken (counting riders and pillions with the group, not counting your own current registration): `The group booking is full.`

Withdrawing: `No such ride.`, `You’re not registered.`, then `Registrations have closed.` (after the start only; the closing day doesn't stop a withdrawal).

Registering doesn't change your ride answer. *Inferred:* the hub shows "Say Going too" when you're registered but not Going. Managers see the counts (riders, pillions, with the group, own, camping, day trip) and can share the list as text for booking rooms.

### 7. Swaps (`ask_swap`, `answer_swap`, `withdraw_swap`)
Asking:
1. `No such ride.` 2. `That ride was cancelled.` 3. After the ride day: `The crew can’t change after the ride day.`
4. Not on the crew: `You’re not on this ride’s crew.`
5. Asking yourself: `Pick someone else.`
6. `That member no longer exists.`
7. They can't hold your spot: the crew eligibility words (`Only Full and Nomad members can crew a ride.`, `Members on hiatus can’t crew a ride.`, `Tail Gunners need a current first aid certificate on file.`, `They haven’t signed the Road Rules yet.`)
8. They said Can't make it: `They said they can’t make it.`
9. They already hold the same spot (two Officers): `They already have that spot.`
10. A trade where you can't hold their spot: the same eligibility words, about you.
11. You already have an open ask on this ride: `You’ve already asked someone. Withdraw that first.`
12. Note over 200: `Keep the note to 200 characters at most.`

Answering (only the person asked):
1. `No such swap.` 2. Not you: `That ask isn’t for you.` 3. Not open: `That ask has already been answered.`
A no stops here: it always closes an open ask, even on a cancelled or past ride. On a yes:
4. The ride checks (cancelled, after the ride day).
5. The asker no longer holds that spot, or (for a trade) you no longer hold the spot you had: `The crew has changed since. Ask again.`
6. The eligibility checks again, for you and (on a trade) the asker, since things may have changed.

A yes moves the spots and makes the taker Going; the asker stays Going. A no just closes it. Withdrawing: `No such swap.`, `Only whoever asked can withdraw it.`, `That ask has already been answered.`

### Phone notices
A phone-side check after each load (the same way reminders work) shows a notice, once each:
- someone asks you to swap
- your ask is answered
- a ride you're Going or Maybe on is called off, postponed or back on (with Ride changes on in notification settings), when the call was in the last 24 hours.

Asks and answers count as Ride changes too. Nothing goes to the club's push service.

## Database (`20270410000000_ride_planning_extras.sql`)
- `bikes.range_km int` (30–1000), set through `set_bike_range`.
- `ride_plans (ride_id pk, stops jsonb, updated_at, updated_by)`.
- `route_ratings (route_id, member_id, stars, comment, rated_at)`, primary key on both.
- `ride_calls (ride_id pk, state ride_call_state, reason, new_day, called_by, called_at)`.
- `ride_hubs (ride_id pk, members_only, closes_on, beds, accommodation, notes, updated_by, updated_at)` and `hub_registrations (ride_id, member_id, staying, pillion, share_with, notes, registered_at, withdrawn_at)`.
- `crew_swaps (id, ride_id, asked_by, role, asked_to, their_role, note, state, asked_at, answered_at)`.
- Approved members read them all through row-level security; nothing is written except through the actions. A swap's ride lock is the same ride row lock `set_crew` takes, so crew changes queue.
- The app reads them with their own queries, so `ride_calendar()` and `set_rsvp` are untouched.
- No `drop` and no `delete from`.

## Screens
- **Ride screen:** the call banner (Off red, Postponed amber), **Call the ride** for writers; the plan's stops and the fuel check; **Plan the ride** for writers; a hub card (Register, or your registration); a swap card for the person asked; **Ask to swap** on your own crew row.
- **Plan the ride** (new): stops editor (add from the route's waypoints or by hand, kind chips, km, time), the live fuel check, then links to the route, briefing, crew and Rusty Bus.
- **Hub** (new): accommodation and notes, your registration form, the list and counts; managers open and edit it.
- **Route library and route:** stars and counts; your rating with a comment.
- **Bike editor:** Range (km to the fuel light).

## Later
- A weather check on ride morning (needs a provider account, Jeff's call).
- Push for calls and swaps when push goes on at launch.
- Hub payments (needs the payments account).
- Which bike a member is bringing, for a tighter fuel plan.
- Fuel stations from a maps provider (needs a key).
