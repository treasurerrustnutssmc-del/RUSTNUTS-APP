# Rustnuts App: the full brief for collaborators

Written 25/10/2026 for Chris "Dysco" Dyson (GitHub `dysco54`), who is joining the build. It is also
written for Chris's own Claude Code session working from a clone of this repo, so it names real paths,
commands and rules. Read `AGENTS.md` first: it is the standing rulebook and wins over anything here.

No keys, passwords or tokens are in this file, and none should ever be added to the repo.

---

## 1. What we're building

Rustnuts SMC is getting its own app. One app the club owns that brings together what's
spread across Facebook Messenger, the club Discord and the Google Drive folders today. Chat as easy as Messenger, plus rides, members,
documents, money and the board, all in one place, built for this one club and nobody else: its real
ranks (Introduced, FNG, Full, Nomad, Supporter, Family, Legacy), its real positions and chapters
(West and North, with the NEC above them), its constitution (v4, 25/10/2026), its trademarked artwork
and its stencil typeface.

The bigger goal is to make the club fun again. Rides, photos and banter come first. The admin runs
quietly in the background, where mostly only the board sees it.

### Ground rules

- **As easy as Messenger:** chat that just works, and sharing photos, videos and links from the phone's
  own share button.
- **Fun first, admin out of the way.**
- **Four levels of access:** public, members, board and national, plus applicants. What you see depends
  on who you are, and the database enforces it, not just the screens.
- **One build, three ways in:** Android and iPhone apps from the stores, and a web build (previews now,
  board work on a laptop later).
- **In the stores but hidden:** Apple unlisted (link only), Google under an organisation account. Nobody
  gets past sign-in without board approval.
- **Owned by the club:** every account is on the club's treasurer Gmail, so the app outlives any one
  person.
- **No tracking:** ride-day live location is opt-in, switches itself off, and nothing is kept.
- **Under wraps until it's done:** no emails, invites or pushes to members until it's finished. A small
  secret test crew rides with it first.
- **The reveal is aimed at the 2027 AGM**, with Stages 1 to 6 done so that year's fees can be paid in the
  app. Quality comes before dates.

---

## 2. Where it's at, stage by stage

Status words used below:

- **Live:** merged to `main` and running on the live database (and on test phones via the preview
  channel).
- **Merged, waiting:** code is on `main`; something outside the code is still needed (an SQL paste, a
  deploy, a key, an account, a phone test).
- **Not started:** in scope, nothing built yet.

| Stage | What it covers | Status |
|---|---|---|
| Paperwork | D-U-N-S, Apple and Google developer accounts in the club's name | **Not started:** blocked on `apps@rustnutssmc.com.au` (needs Chris's DNS job) |
| 1 Foundations | Sign-in by emailed code, profiles, bikes, regos, emergency contacts, approvals, ranks, positions, chapters, access levels, the look, claimable roster | **Live** (24/10/2026) |
| 2 Rides | Calendar from the club's Google calendar, RSVPs, ride crew, locked GPX routes, briefing cards, Road Rules sign-off and Going gate, Rusty Bus booking | **Live**, except the ride-colour labels (needs a `sync-rides` redeploy, Chris's job) |
| 3 Chat and feed | Whole-club, NEC, committee, chapter, board, ride and private chats; photos, videos, GIFs, link previews, reactions; ride wall albums | **Live** |
| 4 Members and money | Join process, FNG tracker, QR check-in and attendance, fees and reminders, club-year fees ($360 Full, pro rata) | **Live**, except club-year fees (SQL queued for Jeff's Run) and PayID (Jeff calling the bank) |
| 5A Meetings and votes | Agendas, minutes, action items, every vote type, quorum, tie-breaks, constitution v4 rules | **Live** |
| 5B Treasurer | Ledger with payment codes, two-approver rule, funds (Club, West, North), cash float, budgets, monthly report; FY26–27 books loaded | **Live** |
| 5C Document library | Constitution, Road Rules, bylaws with versions, review dates, member sign-off | **Not started** (next on the Stage 5 thread) |
| 5D National | Chapter contributions, new chapter setup, term limits, disciplinary records | **Not started** |
| 6 Phone superpowers | Live ride mode, emergency and dropped-out buttons, offline cache, share a ride out, share into the app, notifications and push, ride comms voice (LiveKit) | **Merged, waiting:** code all merged; push held until launch; real-phone tests outstanding |
| Reveal | Everyone gets the link | Aimed at the 2027 AGM |
| 7 Fun and wild ones | Garage builds, badges, shout-outs, swap-and-sell, AI assistant, meeting minutes from a recording, catch-ups, ride replays, public site, auto-posting | **Not started** (after the main stages; mostly after launch) |

---

## 3. The whole ambition, item by item

Everything in this section is in scope. Each line says where it stands today.

### Rides

| Feature | Status |
|---|---|
| Colour-coded ride calendar read from the same Google calendar as the website, synced every 15 minutes | **Live.** The labels (North, West, Rustnuts, Supported Club Rides, Non-Nuts) are merged (PR #25) but need a `sync-rides` redeploy |
| RSVPs (Going, Maybe, Can't make it) | **Live** |
| Ride roles: RC, Tail Gunner, Assistant TG, Officers per ride | **Live.** Swap requests that the other person accepts wait on notifications; today a swap is one person stepping down and another stepping in |
| Locked GPX routes: once published only the RC or board can change them | **Live.** "Pings everyone signed up when it changes" waits on push |
| One-tap open in nav that follows the route (OsmAnd, MyRoute-app) | **Live** (GPX hand-off). Garmin not done |
| Route library | **Live.** Member ratings not started |
| Ride planner for the RC: route, fuel, coffee and lunch stops | **Partly:** routes and the briefing card's stops are live; a dedicated planner is not started |
| Fuel stops planned around the smallest tank in the pack | **Not started** |
| Weather check on ride morning, one-tap "ride's off" or "postponed" | **Not started** (weather needs a provider account, Jeff's call) |
| Pre-ride briefing card: route, stops, hazards, who's TG, changes for this ride | **Live** |
| Road Rules sign-off, board sees who's outstanding | **Live.** Unsigned members can't say Going or be crewed (Jeff: "no exempt") |
| Rusty Bus booking (charity rides and vehicle recovery) | **Live.** Later: editing, driver warnings, keys, odometer and running costs |
| Live ride mode (opt-in, ride day only): rider list, split-group alerts, regroup pins | **Merged, waiting** on real-phone tests. No map yet (Google Maps key is Jeff's call) |
| "I've dropped out" button to the TG and RC | **Merged, waiting** on phone tests |
| Emergency button: emergency contacts, one-tap 000, location | **Merged, waiting** on phone tests |
| Ride-day headcount check-in | **Live** (QR check-in plus the leader ticking people off) |
| Ride comms: open-mic voice built for the bike (hands-free, wind and engine noise suppression), headset mute | **Merged, waiting.** LiveKit project and key are set up and the token check answers; needs a two-phone ride test, and the Cardo/Sena headset button is unproven |
| Big 4 and Not Dead Yet Run (formerly President's Run) hub: registrations, accommodation, payments | **Not started.** Needs a Big 4 flag on rides first |

### Social

| Feature | Status |
|---|---|
| Messenger-easy chat: chapter, board, committee, ride and private chats, reactions, GIFs (GIPHY), link previews | **Live** |
| Voice notes | **Not started** |
| A chat for each ride that tidies itself away afterwards | **Live** |
| Photos and videos, ride wall album after every ride | **Live** |
| Share into the app from the phone's share button | **Merged, waiting** on phone tests |
| Share a ride out of the app | **Merged** |
| Garage profiles | **Live** (bikes on profiles). Build threads for project bikes not started |
| Birthday and patch-anniversary shout-outs | **Not started** |
| Badges: Big 4s completed, states ridden, kms logged | **Not started** |
| Bragging-rights votes: ride of the year, best photo, best breakdown story | **Not started** |
| "On this day" photos | **Not started** |
| Club history and hall of fame | **Not started** |
| Swap-and-sell for parts and gear | **Not started** |
| "Who can help fix this?" and a trusted mechanics list | **Not started** |
| Family access with limited views | **Partly:** Family is a status with its own access; tailored family views not started |
| Twist the Throttle podcast and the Support page | **Not started** |

### Membership

| Feature | Status |
|---|---|
| Online join: introduction phase, application, board vote | **Live** |
| FNG tracker: 6-month feedback, 12-month review, rolling 3-month reviews, continuation fee | **Live** (to constitution v4) |
| Member profiles: licence and rego with expiry reminders, emergency contacts, first-aid cert | **Live.** Push reminders wait on push |
| Claimable roster: the real roster is preloaded and links to a person when they first sign in by email | **Live.** West and North loaded silently; phone, emergency contact and bike come across at first sign-in |
| QR check-in at meetings and rides | **Live** |
| Attendance rules worked out automatically (FNG 50% per category, Full 80% of meetings plus two Big 4s, Nomads two of three) | **Not started** (top of the v4 audit's later list) |
| Status levels that change what each person sees (Full, FNG, Nomad, Supporter, Family, Legacy, hiatus) | **Live** |
| Fees: $360 a year for Full, AGM to AGM, pro rata for patch-ins; FNG continuation fee $180 after 12 months; everyone else free | **Merged, waiting** on Jeff's SQL Run. Charges nobody until a treasurer presses Raise fees |
| Pay by PayID | **Waiting** on Jeff's PayID details |
| Pay by card, receipts | **Not started** (needs a payments account, Jeff's call) |
| Digital membership card for partner discounts | **Not started** |

### Board and admin

| Feature | Status |
|---|---|
| Board room: private board chat, agendas, minutes, action items | **Live** |
| Minutes and notice on the constitution's timelines (draft in 7 days, notice 7/14/21 days) | **Live** (rules enforced; automatic sending waits on push/email) |
| Votes: majority, two-thirds, unanimous, secret ballot, quorum check, chair's casting or declined tie | **Live** |
| Document library with versions, review periods, member sign-off | **Not started** (5C, next) |
| Disciplinary records that delete themselves after 12 months, appeal deadlines | **Not started** (5D) |
| Treasurer ledger, budgets, monthly report, two approvers | **Live.** FY26–27 books loaded and match the sheet; new entries go in the app, not the sheet |
| Read-only access for the National Auditor | **Partly:** the auditor can read the ledger; v4 says the auditor should see records but not run chapters, which needs its own spec |
| Term limits and role rules checked automatically | **Partly:** who may hold which position is enforced; term end dates not started |
| National level: NEC, contributions from member numbers, new chapter setup | **Partly:** the NEC exists and votes; contributions and new chapter setup not started (5D) |
| NEC reinstatement vote (5.6) | **Live** |
| Merch orders and sizes, logo and merch approvals | **Not started** (the ledger has merch codes) |

### Public face

| Feature | Status |
|---|---|
| Public welcome page and "Ask to join" | **Live** |
| Public site: who we are, charity rides, gallery, join enquiries | **Not started** (the existing website does this today) |
| Charity ride sign-ups and donations | **Not started** (a charity committee role exists) |
| Auto-posting to Facebook and Instagram (the weekly post rule) | **Not started** |
| Merch shop | **Not started** |
| Sponsors page | **Not started** |
| "Get the app" link on the club website | **Not started on purpose:** goes up after launch |

### The wild ones

| Feature | Status |
|---|---|
| Offline mode for country rides with no signal | **Merged** (cached club data, offline banner, alerts queue until signal returns) |
| AI club assistant ("when's the next ride?", "what does the constitution say about X?") | **Not started** |
| Record a meeting, get the minutes and attendance written | **Not started** |
| "Catch me up" summaries of missed chats | **Not started** |
| Ride replay video of the day's route for socials | **Not started** |
| Invites to and from other clubs for public events | **Not started** |
| A space for the sister club | **Not started** |

---

## 4. The stack and the accounts

**Code**

- Expo SDK 58, React Native 0.88, React 19.3, TypeScript. React Navigation (native stack + bottom tabs),
  **not** Expo Router, because the web preview runs inside a page whose URL the app doesn't control.
- Supabase: Postgres with row-level security on everything, Realtime for chat, Storage for media, Edge
  Functions in Deno, pg_cron for schedules.
- EAS: builds, submit, and over-the-air updates. Every push to `main` runs
  `.github/workflows/preview-update.yml`, which tests, typechecks and publishes to the `preview`
  channel, so test phones pick up changes without a reinstall.
- LiveKit Cloud for ride comms voice, plus a local native module in `modules/ride-comms` (Kotlin/Swift).
- GIPHY for GIFs (key is a GitHub Actions secret, never in the repo).

**Accounts** (all on the club's treasurer Gmail unless noted; ask Jeff for access, never share
credentials in chat or commits)

| What | Where |
|---|---|
| Code | GitHub `treasurerrustnutssmc-del/rustnuts-app` (private). Chris is a collaborator |
| Live database | Supabase project "Rustnuts", ref `mfhbvsybudneimgbfjpy` (Sydney). Chris is invited. A spare "Rustnuts app" project in Singapore is unused |
| Builds and updates | Expo account `rustnutssmc`, org `rustnutssmcs-team`, project `rustnutssmc`. Chris is invited |
| Voice | LiveKit Cloud project "Rustnuts"; its secret is already in Supabase's Edge Function secrets |
| Sign-in emails | Supabase custom SMTP through the treasurer Gmail (about 500 a day). Move to a proper sender on the club domain before launch |
| Ride calendar | Google calendar "Rustnuts Rides" (the same one the website reads through Chris's Cloudflare Worker) |
| Domain | `rustnutssmc.com.au`, DNS at Quantum Core. Chris holds the login. Website on GitHub Pages (`dysco54.github.io`) |
| Still to make | Apple Developer and Google Play org accounts (need D-U-N-S and `apps@` email), Firebase (Android push), payments account (card fees), a weather provider, a Google Maps key |

Jeff pays the running costs himself.

---

## 5. How the build works

### Claude threads and lanes

Jeff runs the build through Claude in a Claude project. Each piece of work gets its own thread, and
each thread has its own branch named `claude/project-thread-<id>`. On 24/10/2026 the remaining stages
were split into parallel lanes so they could be built at the same time. The lane rules live in the
project's `build/parallel-stages.md`; the parts that matter in the repo are:

| Lane | Stage | Migration file prefix |
|---|---|---|
| A | 2, rides | `2026102413`–`20261031` |
| B | 3, chat (owns the tab bar) | `20261101` |
| C | 4, members and money | `20261201` |
| D | 5, board and documents | `20270101` |
| E | 6, phone superpowers | `20270201` |
| Cross-cutting (constitution v4, roster, fees) | | `20270301` |

### Superpowers and Impeccable (Jeff's standing rule, in `AGENTS.md`)

Every change, however small:

1. Say whether it's a spike, bounded or architectural, and write the design first: a short design for
   bounded work, a spec in `docs/superpowers/specs/` then a plan in `docs/superpowers/plans/` for
   architectural work. Claude approves its own designs and shows Jeff, who can veto. Accounts, money,
   real member data, going public and anything irreversible still need Jeff's yes.
2. Test first. App rules in `src/domain/*.test.ts` (`npm test`); database rules in
   `supabase/tests/*.sql` (`npm run test:db`, a throwaway local Postgres); shared who-can-do-what cases
   in `supabase/tests/parity.json` run against both the demo and the database so they can't drift.
3. An independent reviewer (a fresh subagent given only the diff and requirements) checks every major
   piece. Fix Critical and Important findings first.
4. Show the checks before calling it done: `npm test`, `npm run test:db`, `npm run typecheck`,
   `npx expo lint`, and a look at the changed screens at 390×844 in demo and live.
5. Design follows `PRODUCT.md` and `DESIGN.md` ("Stencilled on Steel"), using the Impeccable skill in
   `.claude/skills/impeccable`.

### The live database routine (paste and Run)

Claude is blocked by safety checks from running changes against the live Supabase database by every
route (the Supabase tool, Remote Control, pressing Run in Chrome). So:

1. A lane merges its PR, and copies its new migration into the project's `build/<name>.sql`, identical
   to the file in `supabase/migrations/`.
2. One thread ("Apply pending SQL in Supabase") drives Jeff's Chrome, loads the file into the SQL
   editor and checks it byte for byte.
3. **Jeff presses Run.** Then the thread runs read-only checks to verify it landed.

Only one lane goes live at a time, logged in the Live log of `build/parallel-stages.md`. Because files
are pasted, **most migrations are not recorded in `supabase_migrations.schema_migrations`**, so don't
run `supabase db push` or `supabase migration repair` against live without checking with Jeff first:
it would try to re-apply files that are already live.

Also: the Supabase tool's confirm prompt fires on SQL containing `drop` or `delete from`, and that
prompt never reaches Jeff, so lanes keep those words out of anything applied live, and never disguise
them to get past the prompt.

Edge Functions: Claude is also blocked from deploying them. Chris, with Supabase CLI access, can.

---

## 6. Open items

### Jobs for Chris (from Jeff)

1. **Club email forwarding (Quantum Core DNS for `rustnutssmc.com.au`).** Apple needs a club-domain
   email for the developer account. Free forwarding via ImprovMX (no Google Workspace needed); Jeff
   does the ImprovMX sign-up with alias `apps@` forwarding to the treasurer Gmail. In Quantum Core:
   - delete MX `0 rustnutssmc.com.au`
   - add MX `mx1.improvmx.com` priority 10
   - add MX `mx2.improvmx.com` priority 20
   - add TXT `v=spf1 include:spf.improvmx.com ~all`
   - leave the website records alone.
   Test: an email to `apps@rustnutssmc.com.au` should land in the treasurer Gmail.
2. **Redeploy `sync-rides`** so ride labels (Supported Club Rides, Non-Nuts and so on) come through.
   From an up-to-date `main`:
   `supabase functions deploy sync-rides --no-verify-jwt --project-ref mfhbvsybudneimgbfjpy`
   Then tell Jeff, and a Claude thread will check the colours in the app.
3. **Google site verification** (a TXT record or HTML file) once Google sends it.
4. **Bare-domain redirect:** make `rustnutssmc.com.au` (no www) redirect to the www address without a
   certificate warning.

### Waiting on Jeff

- Run `club-year-fees.sql` (queued; needs him at the PC with Chrome).
- PayID details (calling the bank). This year's AGM date (1 August assumed). Fee due date (31/12/2026
  assumed).
- Real-phone tests for Stage 6 on a development build (live ride, notifications, share-in, ride comms).
- Accounts: D-U-N-S, Apple, Google Play, Firebase (to turn push on at launch), payments, weather, maps.
- Good Standing: should overdue fees stop someone voting?

### Built-in "later" list (from the v4 audit and handovers)

Attendance percentages and the Big 4 flag; board terms and expiry flags; splitting NEC powers from the
National Secretary and Auditor (touches row-level security everywhere, needs its own spec); a National
Treasurer role; status-change fairness (14 days to respond); licence loss vacating positions; v4's
extra registers (conflicts, patch directions, club property, IP, amendments); meeting procedure
details; new chapter and closure; naming the Not Dead Yet Run; storage cleanup for removed uploads;
proxying link-card images; Rusty Bus editing and running costs.

---

## 7. How Chris can help without clashing

**Safe to pick up now**

- The four website and DNS jobs above. They unblock the store accounts, which is the critical path to
  launch.
- Deploying Edge Functions Claude can't (`sync-rides` now; `send-push` when push goes on at launch).
- Reviewing PRs, and running the app on a real phone (Chris's phone counts towards the Stage 6 phone
  tests in the project's `build/lane-e/real-phone-tests.md`).
- Website side: the ride calendar source, and later the "Get the app" link (after launch, not before).
- A Stage 7 item that no lane owns, after telling Jeff so a Claude thread doesn't start the same thing.

**Rules for code changes**

1. Branch from the latest `origin/main`, named for you (for example `dysco/<topic>`). Never push to
   `main` or to anyone's `claude/project-thread-*` branch. Open a PR.
2. **Migrations:** only add new files, never edit an existing one. Use a prefix later than every file in
   `supabase/migrations/` (today the last is `20270301000300`), for example `20270401…`. Don't depend
   on a lane's tables until they're on `main`. Keep `drop` and `delete from` out where you can.
3. **Never apply anything to the live database yourself without Jeff's say-so,** and tell him first so it
   goes in the Live log. Read-only queries are fine.
4. **Your own files:** new rules in `src/domain/<topic>.ts` with `<topic>.test.ts` beside it, screens in
   `src/screens/<topic>.tsx`. In shared files (`src/domain/types.ts`, `labels.ts`,
   `src/data/liveData.ts`, `demoData.ts`, `database.types.ts`, `src/navigation/RootNavigator.tsx`,
   `supabase/tests/parity.json`, `PRODUCT.md`, `DESIGN.md`) only add, in one block, so rebases stay easy.
   New `ClubData` fields are optional.
5. **Access rules** live in `src/domain/access.ts` and are mirrored by row-level security in
   `supabase/migrations`. Change both together, and add parity cases.
6. **The tab bar** (Home, Chats, Rides, Members, Board, Me) belongs to lane B; reach new screens from an
   existing screen or row.
7. Run `npm test`, `npm run test:db`, `npm run typecheck` and `npx expo lint`, all green, before asking
   for a merge. First ready, first merged; rebase on `origin/main` first.

**Things that always need Jeff's yes:** accounts, passwords, keys or tokens, paying, agreeing to terms,
sending anything as him or to members, going public, loading real member data, and anything
irreversible. And nothing goes to members until the app is finished.

---

## 8. Notes for Chris's Claude (working in a clone)

- Start with `AGENTS.md`, then `PRODUCT.md`, `DESIGN.md` and `README.md`. The design and the decisions
  behind each feature are in `docs/superpowers/specs/`, the steps in `docs/superpowers/plans/`, and the
  "what was decided and what's left" notes in `docs/handover/`.
- **Expo has changed since your training data.** Read `expo` in `package.json` (58) and fetch
  `https://docs.expo.dev/versions/v58.0.0/` before touching any Expo or React Native API. Use
  `npx expo install <package>`, never plain npm add.
- Folders: `src/screens/` screens, `src/navigation/` navigators, `src/ui/` shared UI, `src/domain/`
  rules (pure, tested), `src/data/` data (demo and live providers, Supabase calls), `supabase/migrations`
  schema and RLS, `supabase/functions` Edge Functions (shared logic in `_shared/`), `supabase/tests` SQL
  tests and parity cases, `modules/ride-comms` native module, `scripts/` tooling.
- The app has a **demo build** (made-up members, a strip to view as each access level) and a **live
  build** (the real database). Every feature works in both, which is why `parity.json` exists.
- `npm run test:db` needs a local PostgreSQL (`initdb`, `pg_ctl`, `psql` under
  `/usr/lib/postgresql/*/bin`). It applies every migration in order to a throwaway database.
- Conventions: dates stored as ISO `YYYY-MM-DD`, shown as `DD/MM/YYYY`, Melbourne time. Colours and
  fonts only from `src/theme.ts`. No `Alert` pop-ups (the web preview can't show them): use
  `ConfirmButton` for anything destructive.
- Brand: always use the real artwork in `assets/` (logo with the flag, member disc, skull, flannel).
  Never retype "RUSTNUTS" in a lookalike font. Rustnuts Stencil (`assets/fonts/`) for titles, names,
  buttons, tabs, chips, numbers and dates; the plain font only for sentences, input and fine print. The
  MEMBER disc shows only on Full members and Nomads.
- `ios/` and `android/` are generated. Configure native behaviour in `app.json` and config plugins.
  Anything with native code needs a development build (`eas build --profile development`), not Expo Go.
- Never commit secrets. The publishable Supabase key in `eas.json` is meant to ship; everything else
  goes in GitHub Actions secrets or Supabase Edge Function secrets.
