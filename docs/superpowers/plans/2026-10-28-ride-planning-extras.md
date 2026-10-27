# Plan: ride planning extras

Spec: `docs/superpowers/specs/2026-10-28-ride-planning-extras-design.md`. Branch `claude/project-thread-pcidyc`.

1. **Database, test first.** Write `supabase/tests/ride_planning_extras_test.sql` (each refusal in order, the happy paths, RLS: anon nothing, applicants nothing, no direct writes). Watch it fail. Write `supabase/migrations/20270410000000_ride_planning_extras.sql`. Wire it into `scripts/test-db.sh`.
2. **Rules, test first.** `src/domain/fuel.ts` (route km of points, the pack's limit, legs and suggestions), `ridePlan.ts`, `ratings.ts`, `rideCalls.ts`, `hubs.ts`, `swaps.ts`, each with a `.test.ts`. Words exported as constants and shared with the screens.
3. **Types and data.** Append the new records to `types.ts` and optional `ClubData` fields; `bikes.rangeKm`. Demo actions in `demoActions.ts` (one block), demo data (a plan, ratings, a postponed ride, a hub with registrations, an open swap). Parity cases for every action in `parity.json`, run by `parity.test.ts` and `scripts/parity-sql.mts`.
4. **Live.** `liveData.ts` loads the six tables (a missing table loads as empty); `LiveClubProvider` runs the app's rules first, then the action, then reloads. `database.types.ts` gets the rows.
5. **Screens.** Ride screen additions, `PlanRide`, `Hub`, route stars, bike range. Impeccable pass by hand at 390×844 in the demo build.
6. **Phone notices.** `src/domain/localAlerts.ts` (what to show, tested) and `src/data/localAlerts.tsx` (shows each once, remembered on the phone), mounted beside `ReminderSync`. Reminders skip called rides.
7. **Checks and review.** `npm test`, `npm run test:db`, typecheck, lint, the drop/delete grep; an independent review of the whole diff; fixes; paste file `/mnt/project-files/build/ride-planning-extras.sql`; PR.
