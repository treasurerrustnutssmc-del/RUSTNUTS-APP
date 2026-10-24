# Handover: second session, 24 Oct 2026

What Jeff ("El Jefe", Rusted Old Viking) decided or asked for in this session that isn't fully captured in the
code. No passwords, tokens or keys are in this file, and none should ever be added.

## Done in this session (now on main)

- **Brand pass:** real club artwork in `assets/` (logo, skull, flannel, member disc), skull-on-black app icons,
  flannel as an accent only, `hasEarnedDisc()` so the MEMBER disc only shows for Full and Nomad members.
- **Roster roles:** Founder (national title, no powers), Ride Committee, Assistant Tail Gunner, and an
  `on_hiatus` flag on members. Applied to the live Supabase database (migrations `20261024030000`, `20261024030100`).
- **Founder seed:** `supabase/seed/founder.sql` makes Jeff the first approved member.
- **EAS preview:** `.github/workflows/preview-update.yml` publishes every push to main to the `preview` channel.
  `app.json` is linked to Expo project `rustnutssmcs-team/rustnutssmc` with the SDK runtime so Expo Go can open it.

## Set up outside the code (done in the dashboards)

- **Supabase sign-in emails:** custom SMTP is on and sends through the treasurer Gmail (smtp.gmail.com, port 465,
  using a Gmail app password Jeff created after turning on 2-Step Verification). The **Magic link or OTP** and
  **Confirm sign up** templates now send the 6-digit `{{ .Token }}` code, subject "Your Rustnuts code".
  Gmail limits sending to about 500 a day, and Supabase warns that a personal mailbox can hurt deliverability.
  Move to a proper sender (Resend, Brevo or similar on the club domain) before launch.
- **Expo:** account `rustnutssmc` (Google sign-in, treasurer Gmail), organisation `rustnutssmcs-team`,
  project `rustnutssmc`. An Expo access token is stored as the GitHub Actions secret `EXPO_TOKEN`.
  The first two preview publishes succeeded.
- **GitHub in Jeff's Chrome** was signed in as his personal account `lxxvii77jeff-dev`. The repo owner is
  `treasurerrustnutssmc-del`; repo settings only open under that account.
- **Claude in Chrome** connects to Jeff's Windows PC. Jeff signs in to sites himself; Claude never types passwords
  or handles tokens.

## Unfinished: next steps

1. **Jeff's first sign-in.** He was sent steps to install Expo Go on his Samsung (Galaxy S25 Ultra), open the
   `rustnutssmc` project's `preview` update, and sign in with the treasurer Gmail code. That also tests the new
   SMTP emails end to end. **Not yet confirmed.**
2. **Make Jeff El Jefe.** After his first sign-in, run `supabase/seed/founder.sql`. It gives him Founder,
   National Chairman (`nec_chair`), and Treasurer for **both** West and North. His home chapter was assumed to be
   **West**; he hasn't confirmed it. Re-check the file against the current schema and position rules first,
   because a later session tightened who can hand out national roles.
3. **Roster load: decision pending.** A card asked whether to preload the real 28-member FY26–27 roster
   (names, club names, chapter, patched/FNG, positions only, no contacts). Options were preload, everyone asks to
   join, or build an auto-link-by-email feature now and load data later (recommended). **Jeff hasn't answered.**
   `members.id` must be an auth user, so preloading needs a claimable-roster table that links on first sign-in by
   email, and that needs the email column from the sheet. Don't load real member data without his explicit yes.
4. **Stage 2** hasn't started: ride calendar, RSVPs, locked GPX routes, and booking the Rusty Bus.
5. **Impeccable** design skill: Jeff wanted everything run through Superpowers and Impeccable. Installing
   Impeccable needs his explicit "yes, run Impeccable".
6. **Spare Supabase project** "Rustnuts app" (`cixtzadwjexmnxvvwayy`, Singapore) is unused. Jeff can delete it;
   the live one is "Rustnuts" (`mfhbvsybudneimgbfjpy`, Sydney).

## Open questions for Jeff

- **Kilroy's real name:** Clint Lindley or Kilroy Cain?
- **Tractor's role:** Ride Committee, or Assistant Tail Gunner (under review, subject to First Aid and Board approval)?
- **Nicknames:** Sylo has asked to become PROOF; is Just In "Just In" or "Juzzy"?
- **Hacker (Justin Borg), Jack P, Treesburger:** current members? Which chapter?
- **Home chapter** for Jeff (assumed West).

## Brand and font notes

- **Original brand artwork** lives in the project's shared folder under `brand/` (`/mnt/project-files/brand/`):
  flannel pattern, member disc, skull mascot, EST 2019 logo with the flag (white and dark versions), Rusty Bus photo.
  Don't use the group photo of members. Screenshots Jeff shared that show passwords were deliberately not saved.
- **Flag:** this session painted the flag out of the logo (`assets/logo.png`), because the trademark registration
  covers the flagless version. A later session recorded in `AGENTS.md` that **the club uses the logo with the
  flag, so the app does too**. That's newer and wins. Reconciled on 24 Oct by the third session: `assets/logo.png`, the README
  and the Logo comment now use the with-flag logo.
- **Wordmark font:** the RUSTNUTS wordmark is set in classic **Stencil** (Gerry Powell, 1937), sold commercially as
  Stencil Std through Adobe Fonts and Fontspring. The free open-licence near match is **Stardos Stencil**; a later
  session built "Rustnuts Stencil" from it (see `AGENTS.md`). The wordmark itself must always be the real artwork.
- MEMBER disc: earned at Full membership. Nomads keep it.
- Flannel is an accent only. Lists and forms stay plain dark so they read in the sun.

## Working with Jeff

- He has ADHD. He brain-dumps; you turn that into decisions with one recommended pick. Keep replies short and
  don't moralise.
- He mostly works from his Samsung, so give tappable links and copy-paste boxes.
- He has given **blanket approval** for build, design and tech calls. Only come back to him for creating accounts,
  passwords, pasting keys or tokens, paying, agreeing to terms, sending messages as him, going public, loading
  real member data, and anything irreversible.
