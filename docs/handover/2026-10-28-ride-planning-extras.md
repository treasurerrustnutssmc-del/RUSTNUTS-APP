# Handover: Ride planning extras (28 Oct 2026)

- **Spec:** `docs/superpowers/specs/2026-10-28-ride-planning-extras-design.md`
- **Plan:** `docs/superpowers/plans/2026-10-28-ride-planning-extras.md`
- **Migration:** `supabase/migrations/20270410000000_ride_planning_extras.sql`. Its paste copy is `/mnt/project-files/build/ride-planning-extras.sql`.
- **Database tests:** `supabase/tests/ride_planning_extras_test.sql` (database `rustnuts_planning` in `scripts/test-db.sh`), plus about 62 shared demo/database cases in `supabase/tests/parity.json`.

## What it is
- **Fuel around the smallest tank:**
  - Each bike can carry its range (km to the fuel light, 30 to 1000). Set it under Me, on the bike (existing bikes only).
  - A ride's pack is everyone Going plus the crew. Its limit is the shortest range among their non-project bikes.
  - Every leg between Fuel stops (start full, through each Fuel stop with a km, to the route's end) must fit in 90% of that limit.
  - A long leg names the km to fuel by and the furthest stop or route waypoint before it.
  - Riders with no range on file are listed.
- **Plan the ride:**
  - Up to 15 stops: Fuel, Coffee, Lunch, Regroup or Other, each with a name, km along and time.
  - Writers are the ride's crew managers and its Road Captain, until the end of the ride day.
  - Saves are version-checked: a stale save is refused and the screen reloads.
  - The stops show on the ride (Stops and fuel) and replace the route's own stops on the briefing card.
- **Route ratings:**
  - Any approved member can rate a route 1 to 5 stars, with an optional comment of up to 280 characters. It's one rating each, and it can be changed.
  - The route screen shows your rating and everyone's ratings.
  - The library rows show "4.3 ★ · 3 ratings".
- **Ride's off / Postponed:**
  - The same writers tap **Call it off or postpone** and pick Off or Postponed. Quick reasons are Weather, Not enough riders and Road closures. A Postponed call takes an optional new day.
  - The call shows as a red or amber banner on the ride and a chip in the Rides list.
  - The ride chat gets a line from the caller.
  - Ride reminders pause. **It's back on** undoes it.
  - It doesn't move the calendar event; the banner tells writers to do that.
- **Registrations hub** (for the Big 4, the Not Dead Yet Run and the like):
  - Opened from the ride (offered on Club rides and multi-day rides) by crew managers.
  - Settings: members only (FNG, Full, Nomad), a close date, group beds, accommodation and notes.
  - Members register: where they're staying (with the group, own, camping or day trip), pillion, who they're sharing with, and notes.
  - Group beds can't be overbooked.
  - Members can withdraw and come back.
  - Managers get **Share the list** and see anyone registered but not Going.
  - No payments.
- **Crew swaps:**
  - A crew member asks someone to take their spot. If that person already has a spot, it's a trade.
  - The person asked gets **Take it** or **No thanks** on the ride. A yes moves the spots and makes them Going.
  - The asker can withdraw. One open ask per person per ride.
  - The eligibility rules are rechecked on a yes.
- **Phone alerts without push** (`src/domain/localAlerts.ts`, `src/data/localAlerts.tsx`):
  - When the app loads, it shows a phone notification for:
    - a swap ask to you
    - an answer to your ask in the last day
    - an Off, Postponed or Back on call in the last day on a ride you're Going or Maybe to, made by someone else
  - Each alert shows once; the ids are kept on the phone.
  - It follows the Ride changes setting and never asks for permission itself.
  - It's skipped on the web and in the demo.

## Live state
- **Not live yet.** Jeff pastes `/mnt/project-files/build/ride-planning-extras.sql` in the Supabase SQL editor, through the "Apply pending SQL in Supabase" thread.
- **Merge the PR only after the paste.** The live load tolerates the six missing tables, so the screens look empty, but every action would fail.
- **No dependencies on other lanes.** The 20270410 prefix sits after the attendance lane's 20270405. Social extras and merch orders were pointed at 20270415 and 20270420.
- **After the paste, check:**
  - The ten functions exist: `set_bike_range`, `save_ride_plan`, `rate_route`, `call_ride`, `save_hub`, `register_hub`, `withdraw_hub`, `ask_swap`, `answer_swap` and `withdraw_swap`.
  - anon can select and execute nothing.
  - The advisors show only the expected definer warnings.
  - Look at the ride, route and bike screens in the live build at 390×844.

## Rulings made without Jeff (he can veto any)
- **Fuel margin:**
  - Legs are kept to 90% of the smallest range.
  - The range is the member's shortest non-project bike, since we don't know which bike they'll bring.
- **Writers:** the ride's crew managers plus its Road Captain write the plan and make the call. The RC is the one on the ground.
- **Calls:**
  - A call doesn't cancel or move the ride itself; the calendar sync owns that.
  - Calls stop at the end of the ride day.
- **Hub:**
  - Members only by default.
  - Group beds count each rider and their pillion; a registration that would go over the beds is refused.
  - The hub is offered on Club category rides and multi-day rides only, to keep breakfast runs clean.
- **Swaps:**
  - A no always closes an open ask, even after the ride.
  - Taking a spot makes you Going.
  - The asker stays Going when they come off the crew.

## Still to do
- Push for calls and swaps, when push goes on at launch.
- Big 4 badge on the hub once the attendance lane's `big4_rides` lands (`isBig4` in `src/domain/big4.ts`).
- The weather check on ride morning, once there's a provider account (Jeff's call).
- Hub payments: these need the PayID decision first.
