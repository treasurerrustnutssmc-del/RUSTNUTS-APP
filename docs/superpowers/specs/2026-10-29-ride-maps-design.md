# Ride maps

**Type:** bounded. One native module (`expo-maps`), new UI, no database change. Claude approved this design on 29 Oct 2026 under Jeff's standing rule; Jeff can veto any line.

## Goal
Show a ride's locked route, and on a live ride the riders, on a real map inside the app, and let a rider hand off to the maps app they like.

## Decisions
- **The phone's own map, through `expo-maps`** (the Expo-recommended module): Apple Maps on iPhone, Google Maps on Android. No map account is needed for iPhones.
- **Android needs a Google Maps key.** `app.config.ts` reads it at build time from the EAS environment variable `GOOGLE_MAPS_ANDROID_KEY` and sets `extra.androidMaps`. The key never sits in the repo. The key is restricted to Maps SDK for Android and to `au.com.rustnutssmc.app` with the EAS signing SHA-1.
- **Builds and over-the-air updates must agree.** The key also sets `extra.androidMaps`, which reaches the app in the update manifest, and the runtime version is a fingerprint of the config. So the key lives in the EAS project's environment variables (preview, production and development), not on one build profile, and `eas update` runs with `--environment` so it sees the same value.
- **Fallback.** Where a map can't be drawn, the existing drawn route shape shows instead: the web preview, iPhones before iOS 17 (`expo-maps` needs 17 for Apple Maps), and Android builds without the key. The app's minimum iOS doesn't change.
- **What's on the map:**
  - the route line (club red)
  - a start flag and a finish flag
  - the route's stops
  - on a live ride: each sharing rider's latest fix only (never a trail), the regroup pin, and who needs help.
- **Pin rules** (`riderPins`): help wins, then you, then stale (over 5 minutes), then split off, then leader, then rider. A key under the map names only the kinds shown.
- **Camera.** It fits the route and every pin, rounded down a zoom level so nothing is cut off. A "fit" button puts it back after panning.
- **Navigate** opens choices in place, with no pop-up:
  - Apple Maps (iPhone only), Google Maps and Waze, each heading to one spot: the start, the regroup pin, or a rider who raised an alert
  - with a route, the locked GPX through the share sheet for OsmAnd or MyRoute, which follow the route itself.
  - It replaces "Open in maps" on the ride, route, briefing and live-ride screens.
- **Live location rules are unchanged:** ride day only, opt-in, switches itself off, nothing kept. The map only draws what the live ride screen already had.

## Tests
- `src/domain/rideMap.test.ts` covers:
  - when a map is available
  - camera fitting
  - the bounds
  - Navigate links per platform
  - pin tones and their order.
- `npm test`, `npm run test:db`, typecheck, lint, and the screens at 390×844 in the web build (which shows the fallback).

## Not in this
- Turn-by-turn navigation inside the app.
- A rider trail or history.
- An iOS Google Maps option inside the app.
