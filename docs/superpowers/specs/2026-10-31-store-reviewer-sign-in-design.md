# Store reviewer sign-in

31/10/2026. Bounded, but it touches sign-in, so it gets a written design. Approved by Claude (Jeff's
standing call), shown to Jeff, who can veto.

## The problem

Sign-in is an emailed code. Apple and Google reviewers can't read our emails, so the stores reject an
app they can't get into. Both ask for a working demo login in the review notes. The reviewer must not
see real members' names, phones, bikes, emergency contacts or money, and must not post into real chats.

## Choice: a review login that opens the demo, never the live database

Considered:

1. **A real reviewer account in the live database, fenced off by row-level security.** Every one of the
   ~60 migrations' policies would need a "not the reviewer" rule, now and for every future table. One
   miss leaks real member data to an outsider. Needs SQL pastes, a password or fixed-code switch in the
   Supabase dashboard, and an auth user we have to keep alive. Rejected: too much surface, and the
   failure mode is the exact thing we're guarding against.
2. **A review login that switches this phone into the built-in demo.** The app already has a full demo
   (made-up West and North members, chats, rides, money, board, national) that applies the same rules
   the database does (`parity.test.ts`). The reviewer types a fixed email and code on the normal
   sign-in screen; the app recognises them on the phone and opens the demo instead of the live club.
   Nothing is sent to Supabase: no auth user, no SQL, no dashboard switch. **Chosen.**

Because the review login only ever unlocks made-up data that already ships inside every build, the
code is not a secret. Anyone who finds it sees the same fake club the reviewers do.

## How it works

- `src/domain/reviewer.ts`: the review email (`review@rustnutssmc.com.au`) and code (`201977`), and
  `isReviewerEmail` (ignores case and spaces).
- `src/data/appMode.ts`: whether this phone is in review mode. Kept on the phone (AsyncStorage) so
  it survives the app being closed, the same as members staying signed in. `liveDataOn()` is
  `USE_LIVE_DATA && !reviewing`, and replaces the build-time `USE_LIVE_DATA` everywhere the app picks
  live or demo (club, chats, social, sponsors, live ride).
- `supabase()` refuses to start in review mode, so no screen can reach the live database by accident.
- Sign-in (live build): "Email me a code" with the review email sends nothing and goes straight to the
  code step. The right code turns review mode on; a wrong one says so. Every other email works as now.
- `App.tsx` waits for the saved mode (alongside the fonts) and remounts the providers when it changes,
  so nothing from the live side lingers.
- In review mode the demo opens signed in as Spanner (Full member, West Tail Gunner). The demo strip
  stays across the top, labelled **Review demo**, so the reviewer can view the app as an applicant,
  family, board, national or auditor.
- Signing out from Me ends review mode and returns to the real sign-in screen.

## Review notes for the stores

> Sign in with email `review@rustnutssmc.com.au`, tap "Email me a code", then enter code `201977`.
> This opens a demo club with made-up members. The strip across the top switches between member,
> board and national views. Real club data needs board approval and isn't available to reviewers.

## Tests

- `reviewer.test.ts`: email matching (case, spaces, look-alikes), code check.
- `appMode.test.ts`: starts live, start/end review persists and survives a reload, `liveDataOn()` is
  false while reviewing, a broken store falls back to live.

## Not in scope

Account deletion (its own thread; it will need a demo version too), privacy policy, Play account.
