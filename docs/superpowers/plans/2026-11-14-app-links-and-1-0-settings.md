# Plan: website links that open the app, and the 1.0 build settings

Spec: `docs/superpowers/specs/2026-11-14-app-links-and-1-0-settings-design.md`.

1. Test first: `src/domain/appLinks.test.ts` (parse, targets, junk, other pages stay web, share
   text) and new `src/appConfig.test.ts` cases (intent filter, associated domain, no iPad,
   manifest rows). Watch them fail.
2. `src/domain/appLinks.ts`: `APP_LINK_ORIGIN`, `rideLink(id)`, `appLinkTarget(url)`.
3. `src/domain/share.ts`: ride share text ends with the ride link.
4. `src/data/appLinks.tsx`: module-level inbox (cold-start URL, `url` events, `openAppLink` from
   inside the app) with a 5-minute freshness rule; `<AppLinks />` opens a waiting link once.
   Mount beside `<NotificationTaps />` in MainTabs and FamilyTabs.
5. `src/ui/openLink.ts`: app links go to `openAppLink` instead of a browser (not on web).
6. `app.json`: Android intent filter, iOS associated domain, `supportsTablet: false`, manifest
   rows. Update `docs/store/privacy-answers.md`.
7. Website repo: `_config.yml` include `.well-known`, `open/index.html`, `test/open-links.test.js`.
8. Checks: `npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`, website tests,
   `npx expo config` (iOS + Android resolve), a look at the fallback page at 390x844.
9. Independent review of both diffs; fix Critical/Important.
10. Push, draft PRs, hand Jeff one press at a time.
