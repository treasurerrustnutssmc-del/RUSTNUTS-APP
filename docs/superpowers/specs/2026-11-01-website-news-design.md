# Club news on the website (website-and-app task 21)

**Status:** approved by Claude under Jeff's 24 Oct rule; shown to Jeff 1 Nov 2026 (he can veto).
**Kind:** bounded-plus. A small new table and feed, following the website-enquiries and public-documents patterns exactly.

## What Jeff asked for

Task 21 on the website-and-app list: "Club news on the website, posted from the app." The idea was
"tick *Also show on the website* when posting an announcement". The app has no announcements
feature, so this adds the smallest one that does the job: a board member writes a short notice
in the app and it appears on the club website's home page.

## Who and where

- **Posting:** anyone with a board seat (chapter board or national seat; `private.is_any_board()`,
  the same gate as website enquiries). Section "Club news for the website" on the Board screen,
  under Website enquiries.
- **Reading in the app:** the board sees the current list in that section. Every member also
  sees a "Club news" card on Home (Jeff's tap, 1 Nov 12:42Z): the same five notices the website
  shows, read through `public_site_news()`. Club conversation stays the app chat.
- **Website:** a "Club news" strip on the home page, between Causes and Sponsors, hidden until
  the feed arrives and when it is empty. No page of its own, no news archive.

## A notice

| Field | Rule |
| --- | --- |
| title | 1–80 characters, required |
| body | 1–400 characters, required, plain text |
| link | optional, must start with https:// (http:// refused), ≤ 300 characters; shown as "More" |
| posted_by, created_at | who and when (never shown on the website; the site says "From the club") |
| removed_at, removed_by | set by "Take down" |

Public rule: the website shows the **newest five** notices that are not taken down and are
**less than 60 days old**. Older ones drop off on their own, so nobody has to remember to tidy.
The Board screen says so: "The newest 5 show for 60 days, or until you take them down."
Nothing personal leaves the database: the feed returns id, title, body, link, created_at only.

## Words (identical in app, database and website)

- NO_NEWS_TITLE "Give the notice a title."
- LONG_NEWS_TITLE "Keep the title to 80 characters."
- NO_NEWS_BODY "Write what members of the public should know."
- LONG_NEWS_BODY "Keep the notice to 400 characters."
- BAD_NEWS_LINK "The link must start with https://."
- NOT_NEWS_POSTER "Only the board can post club news."
- NEWS_GONE "No such notice."
- NEWS_REMOVED_ALREADY "That notice has already been taken down."

Refusal order for posting: signed in → approved member → board → title → body → link.
Refusal order for taking down: signed in → approved → board → exists → not already taken down.

## Pieces

**App (treasurerrustnutssmc-del/rustnuts-app)**
- `supabase/migrations/20270740000000_site_news.sql`: table `public.site_news`, RLS select for
  the board only; `post_site_news(p_title, p_body, p_link)` and `remove_site_news(p_id)`
  (security definer, refusals above); `list_site_news()` for the board (newest first, taken-down
  last); `public_site_news()` for anon/authenticated (the five-item public rule).
- `supabase/tests/site_news_test.sql` + a `rustnuts_site_news` block in `scripts/test-db.sh`.
- `src/domain/siteNews.ts` (+ test): words, limits, `SiteNews` type, `newsProblem`,
  `removeNewsProblem`, `publicNews(list, now)` (the website rule, for parity with the SQL),
  `boardNewsOrder`.
- `src/data/siteNews.tsx` + `siteNewsData.ts`: hook `useSiteNews()` on the enquiries pattern
  (demo: two sample notices in memory; live: the RPCs).
- `src/screens/siteNews.tsx`: `WebsiteNews({ onDone })` on the Board screen: the form (title,
  body, link), the list with a `ConfirmButton` "Take down"; `HomeNewsCard` on Home for everyone
  (`useClubNews()`, hidden when there is nothing).
- `supabase/functions/_shared/siteApi.ts`: `GET /news` → `{ news: [...] }`, cache
  `public, max-age=300`; 503 `no-store` when the database refuses (so the site stays quiet until
  the SQL is live). `site-api/index.ts`: `listNews: () => asAnon.rpc('public_site_news')`.
  Bundle to `/mnt/project-files/build/news/site-api-index.ts`; queue the SQL as paste-queue item
  57 (runs after item 56, the merch SQL).

**Website (dysco54/rustnutssmc)**
- `app/site-api.js`: `isNews`, `newsHtml(list)` (escaped; link only when https), `loadNews()`.
- `index.html`: `<section class="block news" id="news" hidden>` with `.news-grid`, wired like the
  sponsors strip; a sentence of CSS in the brand's tokens.
- `test/news.test.js`.
- Degrades gracefully: feed missing or 503 → strip stays hidden; the home page is unchanged
  until item 57 is live.

## Testing

Domain tests (words, order, 60-day/five-item rule, https check). DB test: anon cannot read the
table; a member without a seat cannot post or list; a board member posts, lists, takes down;
each refusal word; `public_site_news()` as anon returns only live items, five at most, none over
60 days, with no posted_by. Website tests: HTML escaping, http link dropped, empty list → "".
Then `npm test`, `npm run test:db`, `npx tsc --noEmit`, `npx expo lint`, website `npm test`,
phone-size screenshots of the Board section (demo) and the home strip (mock feed), and an
independent review of the diff.

## Out of scope

Pictures, scheduling, push notifications about news, an archive page. Any of these is a new task on the list.
