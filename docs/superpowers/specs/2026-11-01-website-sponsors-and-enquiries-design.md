# The website reads sponsors from the app, and sends join enquiries into it: design

Date: 01/11/2026. Architectural (one new table, one new Edge Function, a board section, website
changes). Approved by Claude under Jeff's self-approval rule (AGENTS.md); Jeff can veto. Jeff's tap
on 01/11/2026: "Go live, then sponsors + join", tasks 7 and 9 of the website and app joining-up list.

## What it's for

- **Sponsors.** The board keeps the club's sponsors in the app (name, blurb, link, logo). The club
  website shows the same list in an "Our sponsors" strip on the home page, so a sponsor gets public
  exposure without anyone typing it twice. Members' deals stay in the app.
- **Join enquiries.** Someone who finds the website and wants to ride with the club fills in a short
  form (name, email, which chapter, a line about themselves). It lands in the app as an enquiry the
  chapter board sees on their Board screen, with an email button to answer and a "Handled" tick.
  Replaces the "email us" dead end. After Apple approves, the same section also sends people to the
  app's "Ask to join".

## The rule: one public door, read-only except for enquiries

The app's database never opens a table to the open internet. One Edge Function, `site-api`,
deployed with JWT checks off, is the only thing the website talks to:

```
website ── GET  /site-api/sponsors ──▶ list_sponsors() as anon (no deals), signed logo URLs (1 h)
website ── POST /site-api/enquiry  ──▶ site_enquiry(...) with the service role, after checks
```

- `/sponsors` answers with `Cache-Control: public, max-age=900`, so a busy day costs one call per
  15 minutes per visitor's cache. Logos are signed URLs from the private `sponsor-logos` bucket,
  valid an hour, which is longer than the cache.
- `/enquiry` takes `{ name, email, chapter, about, website }`. `website` is a honeypot: a filled
  one is dropped with a 200 and nothing kept. Checks, in order, with the same words as
  `src/domain/enquiries.ts`: name (1 to 80), a plausible email (at most 200), chapter one of
  `west`, `north`, `either`, about (at most 600). Then the database's `site_enquiry` applies the
  spam limits: the same email at most 3 a day, and at most 30 enquiries an hour overall; over the
  limit it says "Too many enquiries just now. Try again later, or email the club." Nothing else is
  stored (no IP).
- CORS allows `https://www.rustnutssmc.com.au` and `https://rustnutssmc.com.au` only.

## Data (one migration)

- `public.site_enquiries`: `id`, `name`, `email`, `chapter_slug` (`west`, `north`, `either`),
  `about`, `created_at`, `handled_at`, `handled_by`, `note` (at most 300).
- RLS: the board reads them (`private.is_any_board()`), scoped the same way the Board screen is:
  a chapter board sees its chapter's and `either`; the NEC officers (Chairman, Secretary,
  `private.is_nec_officer()`) see all. Nobody writes through the API.
- `public.site_enquiry(name, email, chapter_slug, about)`: security definer, executable by
  `service_role` only (the function calls it with the service role). Applies the limits above.
- `public.list_site_enquiries()`: the board's list, open ones first.
- `public.handle_site_enquiry(id, note)`: marks it handled by the caller; refusals in the same
  words as the app ("Only the board can see website enquiries.", "No such enquiry.",
  "That enquiry has already been handled.").

## In the app

- Board screen: a "Website enquiries" section between "Waiting for approval" and "Needs
  attention", with a count. Each card: name, chapter chip, when (DD/MM/YYYY), the about line,
  **Email** (opens the mail app with a subject) and a **Handled** ConfirmButton with an optional
  note. Nothing in the demo build but a couple of sample enquiries, so the screen can be looked at.
- Rules in `src/domain/enquiries.ts` with tests; live loading in `src/data/enquiries.tsx`, the same
  shape as sponsors.

## On the website (separate PR, after the function is deployed)

- Home page: an "Our sponsors" strip under Causes that reads `/sponsors`; hidden when the list is
  empty or the call fails.
- The "Ride With Us" section gets the enquiry form (name, email, chapter, about, honeypot) posting
  to `/enquiry`, with a thank-you line and the error text from the function. The Facebook,
  Instagram and email links stay.

## Out of scope

Public charity sign-ups (task 10), rides feed (task 6), Discord shop link (needs Chris), any change
to Chris's Jotform or Make.com order automation.

## Checks

`npm test` (domain and function rules), `npm run test:db` (the new `site_enquiries_test.sql`),
typecheck, lint, the Board screen at 390×844 in the demo build, the website at 390×844 with
Playwright against a stubbed function. Live: one SQL paste, one function deploy (Jeff presses
Deploy), then the website PR.
