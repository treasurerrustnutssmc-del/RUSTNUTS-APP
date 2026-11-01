# Website visitor counts (website-and-app task 30)

**Status:** approved by Claude under Jeff's 24 Oct rule; Jeff tapped "Cookie-free visitor counts" 1 Nov 12:55Z and was shown the choice (own counter recommended).
**Kind:** bounded-plus, on the website-enquiries pattern.

## What

The club website has no visitor numbers. Each page sends one "page viewed" ping into the app's
database, kept only as a **count per day per page**. No cookies, no IP address, no user agent, no
referrer, nothing about the person. The ping is skipped when the browser says Do Not Track or
Global Privacy Control. The board sees "Website visits" on the Board screen. After launch the
same counter tallies "Get the app" taps (page `get-the-app`). No third party.

## Rules (identical in app, database and website)

- A page is a site path: `/`, `/charity.html`, `/app/privacy.html` … `^/[a-z0-9/._-]*$`, at most
  80 characters; `/index.html` and `` count as `/`. Anything else is dropped silently.
- At most 200 distinct pages per day are kept (a flood of made-up paths stops at 200).
- The feed for the board: the last 30 days, day + page + hits. Board = `private.is_any_board()`.
- The website pings with `navigator.sendBeacon` (or `fetch keepalive`), never waits, never throws.

## Pieces

**App:** `supabase/migrations/20270750000000_site_visits.sql` (table `public.site_visits(day, page,
hits)`, no API reads except `site_visit_summary()` for the board; `site_visit(p_page)` for the
service role: upsert +1); `supabase/tests/site_visits_test.sql`; `src/domain/siteVisits.ts`
(+ test: `cleanVisitPage`, `visitTotals`, `topPages`); `src/data/siteVisits.tsx` (board hook, demo
numbers); `src/screens/siteVisits.tsx` `WebsiteVisits` card on the Board screen under Website
enquiries; `siteApi.ts` `POST /visit` (origin check, 204, never an error to the page) and
`site-api/index.ts`; one line in the privacy policy ("The club website counts page views …");
`sitePage.ts` adds the ping to the generated app/*.html pages.
**Website:** `app/site-api.js` `recordVisit(path, fetchFn)`; every page calls it from a two-line
module; `test/visits.test.js`.
**Live:** paste-queue item 59 (after 57 news and 58 Road Rules), site-api v10 (v9 is the Road Rules
thread's if it needs one; else v9).

## Out of scope

Unique visitors, countries, devices, referrers, time on page. If the club ever wants those it is a
third-party tool and a new decision.
