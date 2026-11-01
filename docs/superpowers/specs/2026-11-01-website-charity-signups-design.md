# Charity ride sign-ups from the club website (1 Nov 2026)

Self-approved by Claude under Jeff's standing rule (24 Oct 2026). Jeff can veto any ruling below.
Task 10 of the website-and-app joining-up list.

**Kind of work:** architectural-lite. It adds one public feed and one public door to `site-api`, a new
table, a tick on the existing charity sign-up sheet, and a page on the website. It follows the shape
of the join-enquiry door (`site_enquiries`, `2026-11-01-website-sponsors-and-enquiries-design.md`)
and sits on top of the members' charity sign-ups (`2026-10-29-charity-ride-signups-design.md`).

## What it's for

The club's charity runs (Ride for Kids, the Toy Run, the breast cancer ride) take riders and helpers
from outside the club: friends, families, other clubs. Today those people reach the organisers through
Facebook messages and a head count on the day. The app already has the sign-up sheet for members.
This lets the public sign up to the **same sheet** from the website, so the organisers see one list.

## What it is

**In the app (organisers):** the Run sign-ups screen gets one tick, **Take sign-ups from the website**
(off by default). With it on, the ride's title, day, meeting place, cause, about, helper jobs, closing
day and places left show on the club website, and people who aren't in the app can sign up there.
Their name, email, phone and answers go only to the people who run that ride's sign-ups (its crew
managers and the Charity Committee); every approved member sees the numbers. Organisers can
**Remove** a website sign-up (a mistake, a duplicate, a robot). The ride's Share the list text gains a
"From the website" section.

**On the website:** a **Charity rides** page (`charity.html`, linked from the nav) lists the charity
rides that are taking website sign-ups, soonest first, with a sign-up form under each: name, email,
phone (optional), I'm riding, bringing a pillion, guests (0 to 10) and their names, helping with (one
of the ride's jobs), notes. The same email signing up again for the same ride replaces its earlier
answer, so people can fix a mistake without emailing the club. A closed or full ride shows why and no
form. No rides: "No charity rides are taking sign-ups just now. Keep an eye on the calendar."

**What stays private:** members' sign-ups never appear on the website; the website sees only the
numbers (places left). Website sign-ups never appear to ordinary members; only the organisers see
them. The feed only shows rides whose organiser ticked the box, so a ride made in the app that Jeff
hasn't made public elsewhere stays private unless its organiser chooses to show it.

**Privacy policy:** one line under "What we collect" covering the website forms (join enquiries and
charity sign-ups): what's kept, who sees it, that it's deleted with the ride or when handled. Both
copies (`src/domain/privacyPolicy.ts` and `site/privacy.html`) say the same thing.

## Rules

Shared words live in `src/domain/websiteSignups.ts`; `site-api` and the database use the same words
in the same order (a test in `src/data/siteApi.test.ts` keeps them equal).

`website_signup(ride, name, email, phone, riding, pillion, guests, guest_names, job, notes)` (service
role only, called by `site-api` after the same checks):
1. No ride, no charity sheet, website tick off, or ride cancelled: `This ride isn’t taking sign-ups from the website.`
2. `Sign-ups have closed.` (the ride has started, or the closing day has passed, as for members).
3. `Tell us your name.` / `Keep your name to 80 characters.` / `That email address does not look right.` /
   `Keep the phone number to 30 characters.`
4. The members' sign-up rules, same words: `Say you’re riding, or pick a job to help with.` /
   `A pillion needs a rider: say you’re riding too.` / `Guests: 0 to 10.` / `That job isn’t on the list.` /
   `Keep it short: 200 characters for guests’ names, 200 for notes.`
5. Spam: the same email at most five sign-ups a day (across rides), at most thirty an hour from
   everyone: `Too many sign-ups just now. Try again later, or email the club.`
6. Places: everyone on bikes (members' sign-ups plus website sign-ups, less this email's own earlier
   answer for this ride) plus this answer over the limit: `The ride’s full.` A helper bringing nobody fits.
7. Keep it: insert, or replace the row with the same ride and email (`updated_at` moves).

`remove_website_signup(id)` (signed-in): `Sign in first.` / `Only approved members can do that.` /
`No such sign-up.` (also when the caller doesn't run that ride, as the app says "No such enquiry" to
outsiders) / after the ride day: `Sign-ups can’t change after the ride day.` Deletes the row.

`save_charity` gains `p_website boolean default false`; the app's `CharityInput.website`. The old
six-argument signature is dropped (the database, the app, the demo and the tests all move together).

`sign_up_charity` (members) counts website people towards the places too, so the two lists share one
limit. `signup_counts()` gains `website_riding, website_pillions, website_guests, website_helping,
website_people`.

`public_charity_rides()` (anon, like `public_rides()`): rides with the website tick, not cancelled,
starting within the next year or in the last day, soonest first: `ride_id, title, starts_at, all_day,
location, cause, about, closes_on, jobs, places, places_left, open`. `places_left` is null with no
limit; `open` is false once sign-ups have closed. No member data, no counts of who is who.

## Database

`20270710000000_website_charity_signups.sql` (after app feedback’s 20270700000000):
- `alter table charity_rides add column website boolean not null default false`.
- `website_signups (id uuid pk, ride_id → charity_rides on delete cascade, name, email, phone, riding,
  pillion, guests, guest_names, job, notes, created_at, updated_at, unique (ride_id, email))`, with
  the same checks as `charity_signups`. RLS: select for approved members who `runs_charity(ride_id)`;
  anon nothing; no API writes. Index on `(email, created_at)` and `(created_at)` for the spam limits.
- The functions above. `signup_counts()` is dropped and recreated (its row type changes).
- Tests: `supabase/tests/website_signups_test.sql` (the door as service role, each refusal in order,
  the shared places limit both ways, the feed as anon, who can read rows, remove) and a
  `rustnuts_website_signups` block in `scripts/test-db.sh`. The charity parity cases keep passing.

## Edge Function `site-api`

- `GET /charity-rides` → `{ rides: [...] }` from `public_charity_rides()` as anon, cached five
  minutes (`public, max-age=300`); 503 `no-store` when the database fails.
- `POST /charity-signup` → the enquiry pattern: club origins only, honeypot `website` field, the
  checks above in the function, then `website_signup()` with the service role; 400 with the word for a
  refusal, 429 for the spam limit, 503 with the club email for anything else, 200 `{ ok: true }`.
- Handled in `_shared/siteApi.ts` with new deps `listCharityRides` and `websiteSignup`; tests beside
  the existing ones. Redeploy: Claude loads it in Chrome, Jeff presses Deploy.

## App

- `src/domain/websiteSignups.ts`: words, limits, `WebsiteSignup` type, `websiteSignupProblem(ride,
  charity, input, now, today)` (pure, the function's order), `websiteCounts`, `removeWebsiteSignupProblem`.
- `src/domain/charity.ts`: `CharityInput.website`; places take website people into account (from the
  counts row, else the rows); `countsLine` adds "· 3 from the website" when any; `charityListText`
  gets a "From the website" section (name, phone or email, extras, job, notes) for the organisers.
- Data: `charityLive` loads `website_signups` (missing-table tolerant) and passes `p_website`;
  `liveData` reads the new count columns; `clubContext` gets `removeWebsiteSignup`; demo actions mirror
  it; `database.types.ts` updated.
- Screens: `EditCharity` gets the Toggle; `Charity` gets an "On the website" chip, the website numbers
  in the counts line, and (organisers only) a **From the website** section with each sign-up and a
  Remove `ConfirmButton`. No new screens.

## Website

- `charity.html`: the page above, in the site's style (nav, footer, stencil headings). A nav link
  "Charity rides" on all pages.
- `app/site-api.js`: `loadCharityRides`, `charitySignupProblem`, `sendCharitySignup`,
  `charityRideHtml` (escaped), `SIGNUP_WORDS`; tests in `test/site-api.test.js`.
- Goes live on merge, so it needs Jeff's yes; nothing on it mentions the app stores.

## Not in this build

- Email confirmations to people who sign up (no sending from the app yet).
- A public withdraw link (sign up again, or email the club; organisers can remove).
- Donations (waits on payments, Jeff's yes).
- Website sign-ups for rides without the tick, and app-made rides on the public calendar (Jeff's call).

## Order of work

1. Database migration and tests (red, then green), then the parity run.
2. `siteApi.ts` and its tests; `site-api/index.ts`; bundle for deploy.
3. Domain and data in the app with tests; screens; checks (`npm test`, typecheck, lint).
4. Website page, module and tests; screenshots at phone size.
5. Independent review of the diff; fix Critical and Important; PRs for both repos; SQL to the paste queue.
