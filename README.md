# Rustnuts App

The Rustnuts SMC members' app: rides, chat, members and club business in one place,
owned by the club. One codebase builds the iPhone app, the Android app and a website.

## Where it's up to

**Stage 1, Foundations: built, running on made-up demo data.**

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

## Next: connect the real database

1. Create a free Supabase account with the club's treasurer Gmail and make a project
   (Sydney region).
2. In the project's SQL editor, run `supabase/migrations/20261024000000_foundations.sql`.
3. Put the project URL and its public key in a `.env` file:
   `EXPO_PUBLIC_SUPABASE_URL=...` and `EXPO_PUBLIC_SUPABASE_ANON_KEY=...`
   (never the secret "service role" key).
4. Swap the demo store for the Supabase one. That's the first job of the next session.

## Commands

```bash
npm install
npm start               # run it; scan the QR code with Expo Go on your phone
npm test                # access rules, dates, profile checks
npm run test:db         # database security checks on a throwaway Postgres
npm run typecheck
npx expo lint
npm run build:preview   # one-file web preview in preview/
```

## How it's laid out

| Folder | What's in it |
| --- | --- |
| `src/domain` | Club rules: types, access levels, dates, profile checks |
| `src/data` | The data store and the demo members |
| `src/screens` | Every screen |
| `src/ui` | Shared building blocks (buttons, cards, chips) |
| `src/navigation` | Tabs and screen stack |
| `supabase` | Database tables, security rules and their tests |
| `assets` | The club logo and app icons made from it |

The look (colours, Saira Stencil One headings) comes from rustnutssmc.com.au.
