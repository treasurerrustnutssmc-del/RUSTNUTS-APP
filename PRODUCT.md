<!-- impeccable:product-schema 1 -->

# Rustnuts SMC app

Facts come from Jeff (founder, National Chairman and treasurer) unless marked *(inferred)*. Inferred lines are Claude's reading of the club and the build so far; Jeff can veto any of them.

## Platform

adaptive

One Expo codebase ships to Android and iPhone through the stores (Apple unlisted, Google under an organisation account), with a web build used for previews. Android comes first in practice: Jeff works from a Samsung Galaxy S25 Ultra.

## Users

- **Members of Rustnuts SMC**, a social motorcycle club in Melbourne with two chapters, West and North. There are about 30 people on the roster: Full members, Nomads, FNGs (prospects), Supporters, Family, and Legacy (members who left in good standing). They open the app to see who's riding, when, and where, and to answer whether they're coming.
- **The board and officers**: presidents, VPs, sergeants-at-arms, secretaries, road captains, tail gunners and the ride committee. They also approve people, set ranks, appoint positions, and later lock routes and run ride briefings. Admin stays in the background, so members open the app for the fun stuff.
- **People applying to join** (Introduced). They see the public face of the club and apply, and see nothing members-only until they're approved.
- *(inferred)* Most use is on a phone, often outdoors at a servo or beside the bike, in bright light, sometimes with gloves on and in a hurry before kick-off.

## Product Purpose

The club's own private app. It holds who's who (ranks, chapters, positions, bikes, emergency contacts), lets the board approve and manage members, and runs the ride calendar with RSVPs, fed from the same calendar as the club website. Stage 2 adds ride roles, locked GPX routes handed off to OsmAnd or MyRoute, briefing cards, Road Rules sign-off and booking the Rusty Bus. Success means members use it as *the* place the club lives, and the board stops running the club out of spreadsheets and group chats. Nobody in the club sees it until it's finished; the reveal is aimed at the 2027 AGM.

## Positioning

It is built for this one club and nobody else. It knows the club's real ranks (Introduced → FNG → Full, with Nomad and Legacy), its real positions and chapters, its website calendar's colour key, its trademarked artwork and its typeface. A generic club or event app couldn't truthfully claim that.

## Operating Context

- **Chapters:** West and North. The NEC (El Jefe, plus the two chapter presidents) sits above both.
- **Ride calendar:** comes from the club website's Ride Calendar (www.rustnutssmc.com.au, largely built by Dysco). Its colour key is North, West, Rustnuts (whole club), Supported Club Rides and Non-Nuts.
- **Member records:** the roster started as chapter spreadsheets and was loaded silently. A member's record links to them the first time they sign in with their email.
- **The member disc:** the round MEMBER patch is earned at Full membership, and Nomads keep it.
- **The Rusty Bus:** the club van, used for charity rides and vehicle recovery.
- **Times:** dates are shown DD/MM/YYYY. Times are Melbourne time.

## Capabilities and Constraints

- **Built so far:** sign-in by emailed code; member profiles, bikes, regos and emergency contacts; approvals, ranks, hiatus, Legacy and positions; a claimable roster; the ride calendar and RSVPs, synced every 15 minutes.
- **Stage 5 (meetings and votes):** board and general meetings with agendas, minutes and minute approval; action items; votes by the board or patched members, with quorum, majority, two-thirds or unanimous, secret ballots and the chair's casting vote on a tie. Patch votes start from Manage member. The rules follow the constitution (29 Jul 2026 draft, in the project files under `reference/`): minutes within 7 days, quorum a third of voters (51% for the NEC), Nomads off chapter votes, one NEC vote per chapter, and a patch vote needs every Full Member's yes. A vote stays open at most 60 days (inferred).
- **Access rules:** these live in `src/domain/access.ts` and are mirrored by row-level security. Every approved member, Legacy included, sees the same members-only areas.
- **No pop-up dialogs.** The web preview can't show them, so anything destructive uses a two-tap confirm.
- **Navigation:** state-based React Navigation. No URL routing on the web build.
- **No messages to members** (emails, invites, pushes) until the app is finished.
- **Live ride location** (not built yet): ride day only, opt-in, switches itself off, nothing kept.
- **Undecided:** the store listing copy, and exactly when the website's "Get the app" link goes up (after launch).

## Brand Commitments

- **Wordmark and logo:** the RUSTNUTS stencil wordmark and the EST 2019 logo are the club's trademarks. The club uses the logo with the Australian flag, so the app does too. Always use the real artwork in `assets/`. Never retype "RUSTNUTS" in a lookalike font, never redraw it and never recolour it.
- **Typeface:** Rustnuts Stencil (a heavier, renamed Stardos Stencil under the OFL licence) is the club's typeface. Use it as much as possible: titles, headings, names, buttons, tabs, chips, badges, numbers and dates. Use the plain body font only for running sentences, typed input and fine print.
- **Member disc:** shown only on Full members and Nomads.
- **Flannel:** an accent only (welcome, waiting screen, Home greeting, the disc moment).
- **Icons:** the app icon is the skull mascot on black.
- **Voice:** plain Australian English, short and direct. Club words are used as the club uses them (FNG, patch, Nomad, El Jefe).
- **Imagery:** don't use the group photo of the men.

## Evidence on Hand

- **Brand files:**
  - `assets/logo.png` (the logo with the flag)
  - `assets/member-disc.png`
  - `assets/skull.png` and the app icons
  - `assets/flannel.jpg`
  - `assets/fonts/RustnutsStencil-Regular.ttf` with `OFL.txt`
  - Brand originals in the project files under `brand/`.
- **Demo data:** the demo build uses made-up members and rides (`src/data/demoData.ts`). The real roster is live in the database only.
- **No quotes from members, testimonials or photos of rides yet.** Don't invent them.

## Product Principles

1. **The club's own, not a template.** Every rank, role, colour and word is the club's real one. When in doubt, use what the club already says and shows.
2. **Members first, admin out of the way.** The things a rider opens the app for come first. Board tools are there for those who hold the positions, and quiet for everyone else.
3. **Private by default.** What's members-only stays members-only, live location is opt-in and short-lived, and nothing goes out to anyone without Jeff's yes.
4. **Quick to read beside the bike** *(inferred)*. Big targets, high contrast and the answer up top, because it gets used in a hurry, outdoors, on a phone.
5. **Earned marks stay earned.** The disc, the patch and the ranks mean something in the club, and the app never hands them out loosely.

## Accessibility & Inclusion

- **Touch and contrast:** touch targets of at least 44pt, and text contrast of at least 4.5:1 (3:1 for large stencil headings). Every ride colour pair already passes.
- **Screen readers:** each list row reads as one clear label.
- *(inferred)* Expect older eyes and bright sunlight. Don't go below 13pt for anything a member needs to read, and never carry meaning by colour alone. Ride colours always come with their name.
