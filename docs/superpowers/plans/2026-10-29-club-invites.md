# Plan: invites to and from other clubs

Spec: `docs/superpowers/specs/2026-10-29-club-invites-design.md`. Executed inline in the thread
"Handle invites to and from other clubs", branch `claude/project-thread-rhgyey`.

1. **Domain, test first.** `src/domain/invites.test.ts` (refusals for all six actions, calendar
   state and suggestions, share texts, lists), then `src/domain/invites.ts`.
2. **Demo actions.** Extend `SocialData` with `otherClubs` and `invites`; actions in
   `demoSocialActions.ts` with a test; demo data in `demoSocialData.ts`.
3. **Parity.** Fixture rows (`otherClubs`, `invites`, one Supported ride) and cases in
   `supabase/tests/parity.json`; mappings in `parityFixture.testkit.ts` and `scripts/parity-sql.mts`.
4. **Database.** `supabase/migrations/20270545000000_club_invites.sql`, then
   `supabase/tests/club_invites_test.sql` added to `scripts/test-db.sh`. `npm run test:db` green.
5. **Live.** Row mapping and calls in `liveSocial.ts` (+ test), wiring in `LiveSocialProvider.tsx`,
   `DemoSocialProvider.tsx`, `socialContext.ts`.
6. **Screens.** `src/screens/invites.tsx`; routes in `RootNavigator.tsx` and `navigation/types.ts`;
   the Rides tab row and the ride screen section in `rides.tsx`.
7. **Checks.** `npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`, screenshots
   at 390×844 in the demo build, Impeccable passes by hand.
8. **Review.** Independent reviewer subagent on the diff; fix Critical/Important.
9. **Ship.** Paste file to `/mnt/project-files/build/club-invites.sql`, PR, queue the SQL with
   the "Apply pending SQL in Supabase" thread, update PRODUCT.md/DESIGN.md/brief, memory.
