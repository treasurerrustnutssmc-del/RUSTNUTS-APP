# Ride weather: design

Date: 29/10/2026. Approved by Claude under Jeff's self-approval rule (AGENTS.md); Jeff can veto.

## What it's for

A rider opening a ride wants to know, before answering Going: will it rain, how hard is the wind, and is it
going to be stinking hot or near freezing, for that day, at that time, along that road. The forecast sits on
the ride screen, above "Your answer".

## Source

**Open-Meteo** (`api.open-meteo.com`, `geocoding-api.open-meteo.com`). No account, no key, free for
non-commercial use, 16 days ahead, blends the BOM's ACCESS model for Australia, and answers from the phone
(CORS is open). Its data licence is CC BY 4.0, so the card says "Forecast: Open-Meteo" with a link.

The phone asks Open-Meteo directly, the same way GIF search asks GIPHY. Nothing is stored in the database,
so there is no SQL and nothing to paste live. Answers are kept in memory for 30 minutes so going back and
forth between rides doesn't re-ask.

Demo mode (the web preview) never goes to the network: it shows a made-up forecast built from the ride's
id, so the card can be seen and checked.

## Where on the road

1. **The ride has a route:** the start, each named stop on the route, and the finish. Points closer than
   15 km to one already chosen are dropped, a loop's finish folds into "Start and finish", and there are at
   most 5 points (start, up to 3 stops spread along, finish).
2. **No route, but a location:** the location is looked up by place name in Australia. Calendar locations
   are often full addresses ("Maccas, 12 Main St, Bacchus Marsh VIC 3340"), so the guesses are tried in
   order, at most six: each comma part from the last, with the state and postcode taken off and street
   addresses and state names skipped; each part whole, then without its last word ("Kilmore Bakery" →
   "Kilmore"), then without its first when that leaves two words or more. The first hit wins, unless it
   is more than 800 km from Melbourne (taken as the wrong town). It's labelled with the place found.
3. **Neither, or nothing found:** "No forecast yet: this ride has no route, and its meeting place can't be
   found on the map."

## When

- A timed ride: from its start hour to the last hour that starts before its end, or 6 hours when it has
  no end. An evening ride past midnight still goes by place, not by day.
- An all-day ride (or one longer than a day): 8 am to 5 pm on each of its days, with rows by day.
- Times are Melbourne time; Open-Meteo is asked for `timezone=Australia/Melbourne`.

The card shows:
- **Too far out** (first day more than 15 days away): "The forecast opens on Fri 23/10/2026."
- **Over or cancelled:** nothing.
- **A multi-day ride past the forecast's reach:** the days it has, and "Later days open closer to the ride."

## What it shows

- A headline for the whole ride window: the worst sky ("Showers"), with its icon, temperatures low–high,
  the highest chance of rain, and the strongest gust. Numbers and words in the stencil.
- **Heads-ups**, in warn tone, one line each, naming the point and day when it matters:
  - rain chance 50% or more ("60% chance of rain at Kinglake"),
  - gusts 60 km/h or more ("Gusts to 65 km/h at Kinglake"),
  - 35° or more ("Up to 37° at the finish"),
  - 3° or less ("Down to 2° at the start. Watch for ice.").
  These thresholds are the app's call, kept in one place in `src/domain/weather.ts`.
- One row per point (or per day, on a multi-day ride): label, sky word and icon, low–high, rain chance,
  gust.
- "Updated 7:42 am" and the Open-Meteo credit as fine print.
- While loading: a short spinner line. On any failure: "The forecast isn't answering. Try again soon." with
  Try again. An answer that doesn't read is never kept, so Try again really asks again.
- "Updated" is when Open-Meteo answered, not when the card was drawn.

## Units

- `src/domain/weather.ts` (pure, tested): picking points, the window, place-name guesses, the Open-Meteo
  addresses, reading its answers, summing up a window, the heads-ups and the "too far out" date.
- `src/data/weather.ts`: the fetches, the 30-minute memory, and the demo forecast.
- `src/screens/rideWeather.tsx`: `RideWeatherSection`, placed on the ride screen above "Your answer".

## Not now

A weather chip on the ride list, push alerts when the forecast turns, radar, and timing the forecast to
when the group actually reaches each stop.
