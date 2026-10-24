This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- This project uses **React Navigation** (native stack + bottom tabs), not Expo Router. The web build is previewed inside a page whose URL path the app doesn't control, and Expo Router picks the screen from the URL. Keep navigation state-based (no `linking` on web). Native deep links can be added with a `linking` config limited to iOS/Android.
- Screens live in `src/screens/`, navigators in `src/navigation/`, shared UI in `src/ui/`, rules in `src/domain/`, data in `src/data/`.

## How every change is made (standing rule from Jeff)

Every piece of work on this app goes through **Superpowers** and **Impeccable**. No exceptions, no "too small to bother".

Superpowers (process):
- Brainstorm first and say whether the work is a spike, bounded or architectural. Jeff approves the design before any code: a short design in chat for bounded work, a written spec in `docs/superpowers/specs/` (then a plan in `docs/superpowers/plans/`) for architectural work.
- Test first: write the failing test, watch it fail, then write the code (`npm test` for app rules, `npm run test:db` for database rules, including the shared demo/database cases in `supabase/tests/parity.json`).
- An independent reviewer (a fresh subagent given only the diff and the requirements) checks every major piece before it ships. Fix Critical and Important findings first.
- Never say something is done without running the checks and showing the result: `npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`, and a look at the changed screens.
- Work on a branch; merge to `main` when the review is clean.

Impeccable (design):
- `PRODUCT.md` (what the app is for, who uses it) and `DESIGN.md` (the design system) are the design authority. Keep them current.
- Before any UI edit, read Impeccable's craft floor. After UI changes, run its critique, audit and polish passes on the changed screens, and check them at phone size (390×844) in both the demo and live builds.
- Impeccable's helper program can't run in the cloud workspace, so its reference rules are followed by hand there.

## Brand rules

- The RUSTNUTS stencil wordmark and the EST 2019 logo are the club's trademarks (the registration covers the logo without the Australian flag). The club uses the logo **with** the flag, so the app does too. Always use the real artwork; never retype "RUSTNUTS" as styled text to imitate it, never redraw or recolour it.
- The club typeface is **Rustnuts Stencil** (a heavier, renamed version of the open-licence Stardos Stencil; its OFL licence file ships with it). Use it as much as possible: screen titles, headings, names, buttons, tab labels, chips, badges, numbers and dates on cards. The plain body font is only for running sentences, typed input and fine print, where a stencil stops being readable.
- The member disc (round "MEMBER" patch) is earned at Full membership, and Nomads keep it. Never show it on anyone who isn't Full or Nomad.
- The Rusty Bus (the club van) is used for charity rides and vehicle recovery.

## Project rules

- Access rules live in `src/domain/access.ts` and are mirrored by row-level security in `supabase/migrations`. Change both together and run `npm test` and `npm run test:db`.
- Dates are stored as ISO `YYYY-MM-DD` and shown as `DD/MM/YYYY`.
- Colours and fonts live in `src/theme.ts`. The logo in `assets/logo.png` is the club's real logo; don't redraw or recolour it.
- No pop-up dialogs (`Alert`): use `ConfirmButton` for anything destructive, since the web preview can't show them.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
