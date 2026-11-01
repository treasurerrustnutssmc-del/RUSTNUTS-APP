# Plan: rides made in the app, shown on the website (task 6)

Spec: `docs/superpowers/specs/2026-11-01-app-made-rides-design.md`. Executed inline by Claude on
1 Nov 2026, test first at each step, one commit per step.

1. **Rules.** `src/domain/types.ts`: `Ride.source`, `Ride.website`. `src/domain/newRide.ts`: words,
   limits, `RideInput`, `cleanRideInput`, `managesCategory`, `saveRideProblem`, `callOffProblem`,
   `putBackProblem`. Tests `src/domain/newRide.test.ts`. Demo data gains `source`/`website` on every
   ride; the Christmas ride (r-4) is the one made in the app.
2. **Database.** `supabase/migrations/20270760000000_app_rides.sql`: columns, `private.manages_ride_category`,
   `save_ride`, `set_ride_called_off`, `public_rides` change. `supabase/tests/app_rides_test.sql`,
   cases added to `public_rides_test.sql`, block in `scripts/test-db.sh`. `scripts/parity-sql.mts`
   inserts `website`; new case kinds `saveRide`, `setRideCalledOff`.
3. **Data.** `src/data/rideActions.ts` (demo, mirrors the SQL), `src/data/rideLive.ts` (rpc args),
   `clubContext.ts` actions, `DemoClubProvider`, `LiveClubProvider`, `liveData.ts` mapping,
   `demoActions.ts` parity dispatch, `supabase/tests/parity.json` cases, `database.types.ts` rows.
4. **Screens.** `src/screens/editRide.tsx` (`EditRideScreen`), Rides tab "New ride" button, Ride
   detail "Change" / "Call it off" / "Put it back on" and the source line; navigation types and
   `RootNavigator`.
5. **Checks.** `npm test`, `npm run test:db`, `npx tsc --noEmit`, `npx expo lint`; demo web export
   screenshots at 390×844; independent review; app PR; SQL item 60 via Supabase MCP; merge; live
   read-only check of `public_rides()`; website `npm test`.
