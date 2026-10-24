# Rustnuts App

The Rustnuts SMC members' app: rides, chat, members and club business in one place,
owned by the club. One codebase builds the iPhone app, the Android app and a website.

## Where it's up to

**Stage 1, Foundations: built and connected to the live club database.**

- Welcome page, sign in, and "Ask to join" with chapter, introducer and bike
- Waiting-for-approval screen with the introduction-phase steps from the constitution
- Home: profile checklist, rego and licence reminders, board alerts, club numbers
- Members directory with search and chapter filter
- Member profiles: garage, contact, licence, first aid, regos, emergency contacts
- Chapters, board line-ups and the NEC
- Board tab: approve or decline applicants, renewals due, missing emergency contacts, FNG reviews
- Manage a member: change status, appoint to or end positions
- Me: edit profile, bikes, emergency contacts, phone sharing

Four access levels (public, member, board, national) plus applicants. The rules are in
`src/domain/access.ts` and the same rules are enforced by the database in
`supabase/migrations/`, so the app can never show more than the server hands over.

The demo build has a strip across the top to view the app as each level. Demo changes
reset when you reload. Nobody in the demo data is a real person.

## Live database

- Supabase project **Rustnuts** (Sydney, `ap-southeast-2`), owned by the RUSTNUTS SMC organisation
  (treasurer Gmail). Tables, security rules and actions are in `supabase/migrations/`, applied in order.
- With `.env` filled in (copy `.env.example`), the app signs people in with an emailed code and
  reads and writes the real data. Without it, or with `EXPO_PUBLIC_FORCE_DEMO=1`, it runs on the
  made-up demo members. The phone preview page is always the demo.
- Sign-in emails must carry the code: in Supabase, Authentication → Emails, the **Magic Link**
  and **Confirm signup** templates need `{{ .Token }}` in them.
- Before launch: set up a proper email sender (Supabase's built-in one only reaches the project's
  own team and sends a few emails an hour).
- The first member (the founder) is approved and given positions directly in the database;
  everyone after that goes through Ask to join and the Board tab.

## Commands

```bash
npm install
npm start               # run it; scan the QR code with Expo Go on your phone
npm test                # access rules, dates, profile checks
npm run test:db         # database security checks on a throwaway Postgres
npm run check:live      # can this build reach the club database, and is it locked down?
npm run typecheck
npx expo lint
npm run build:preview   # one-file web preview in preview/
```

## How it's laid out

| Folder | What's in it |
| --- | --- |
| `src/domain` | Club rules: types, access levels, dates, profile checks |
| `src/data` | Demo and live data sources, the Supabase connection |
| `src/screens` | Every screen |
| `src/ui` | Shared building blocks (buttons, cards, chips) |
| `src/navigation` | Tabs and screen stack |
| `supabase` | Database tables, security rules and their tests |
| `assets` | The club logo and app icons made from it |

The look (colours, Saira Stencil One headings) comes from rustnutssmc.com.au.

## Brand rules

- The RUSTNUTS stencil wordmark and the EST 2019 logo (the version **without** the flag) are the club's
  trademarks. Show the real artwork (`assets/logo.png`, `assets/skull.png`); never type "RUSTNUTS" in a lookalike font.
- The MEMBER disc (`assets/member-disc.png`) is earned at full membership: only shown when `hasEarnedDisc()` says so.
- Flannel (`assets/flannel.jpg`) is an accent only: welcome, waiting screen, Home greeting and the disc moment.
  Lists and forms stay plain dark so they read in the sun.
- App icons use the skull on black. Original artwork is kept in the project files under `brand/`.
