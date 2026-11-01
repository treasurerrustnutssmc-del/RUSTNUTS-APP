# Plan: club photos on the website (task 23)

Spec: `docs/superpowers/specs/2026-11-02-website-photos-design.md`. Executed inline, test first.

1. **Domain** `src/domain/sitePhotos.ts` + `sitePhotos.test.ts`: words, limits, types, `isSitePhotoEditor`,
   `managesSitePhotoCrew`, `pickProblem`, `uploadProblem`, `answerProblem`, `removeProblem`, `crewProblem`,
   `editorListOrder`, `publicSitePhotos`. Tests fail, then pass.
2. **Database** `supabase/migrations/20270770000000_site_photos.sql` + `supabase/tests/site_photos_test.sql` +
   test-db.sh block. Run on the quick runner, then the full suite in the background.
3. **Data** `src/data/sitePhotosData.ts` (rows → types, demo samples, demo helpers) and `src/data/sitePhotos.tsx`
   (`useSitePhotos`, `useMyPhotoAsks`; live RPCs, upload into `site-media`, signed links for both buckets).
4. **Screens** `src/screens/sitePhotos.tsx`: `WebsitePhotosScreen`, `PickWebsitePhotoScreen`, `HomePhotoAskCard`,
   `WebsitePhotosRow` (on Photos). Routes in `navigation/types.ts` + `RootNavigator.tsx`. Home card on `members.tsx`.
5. **Privacy policy** line + `npm run build:privacy` + `build:site`.
6. **site-api** `_shared/siteApi.ts` GET /photos + test; `site-api/index.ts` deps; bundle for deploy (v10).
7. **Website** `app/site-api.js` photosHtml/loadPhotos, `index.html` strip, `photos.html`, nav links, `test/photos.test.js`.
8. **Checks** `npm test`, `npm run test:db`, `npx tsc --noEmit`, `npx expo lint`, website `npm test`; demo export +
   Playwright screenshots at 390×844 → `/mnt/project-files/build/website-photos/`.
9. **Review** independent subagent on the diff; fix Critical/Important.
10. **Ship** app PR, website PR, merge both (blanket rule), apply migration live (item 62), deploy site-api v10,
    verify live read-only, update docs/memory, tell Jeff with screenshots and a card.
