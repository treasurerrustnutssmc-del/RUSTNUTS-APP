# Handover: Road Rules sign-off (lane A, 25 Oct 2026)

- **Spec:** `docs/superpowers/specs/2026-10-24-road-rules-design.md`
- **Plan:** `docs/superpowers/plans/2026-10-24-road-rules.md`
- **Branch:** this ships in the same PR as briefing cards (PR #20), because lane A has one working branch.

## What it is
- **Publishing:** the NEC publishes versioned Road Rules in the app (constitution 7.10 and 15.4). Versions are never edited. A correction is a new version, marked either "everyone signs again" or "small fix, sign-offs carry over".
- **Signing:** every approved member except Legacy signs. A sign-off is good for 12 months, and it also lapses when a fresh version is published.
- **Who's signed:** boards and the NEC see who has and hasn't signed, from the Board screen or from Me.
- **Reminders in the app:**
  - an unsigned or expired rider sees a nudge on the ride screen
  - the RC sees unsigned Going riders on the briefing card
  - Me shows your status.

## Live state
- **Not live yet.** The session's safety check refuses live database changes, so `20261024160000_road_rules.sql` is at `/mnt/project-files/build/road-rules.sql` for Jeff to paste.
- **Paste order:**
  1. `ride-crew-actions.sql`
  2. `ride-briefings.sql`
  3. `road-rules.sql`
- **Merge only after all three are live.** The live load reads the Road Rules tables, so loads break until they exist.
- **After pasting, check:**
  - `publish_road_rules` has 4 args and `sign_road_rules` has 1
  - members can select both tables and anon gets nothing
  - the advisors show only the expected definer warnings
  - a look at the screens in the live build at 390×844, including the two no-version states: "The NEC hasn't published…" and "Write the first version".
- **Out-of-order prefix:** the prefix sorts before later migrations already in the repo, the same caveat as briefings and Stage 4.

## Rulings made without Jeff (he can veto any)
- **~~Not a gate.~~ Now a gate (25 Oct 2026).** Jeff answered the decision card: "yes block them if they dont sign with a prompt to sign it". A member who's asked to sign and is unsigned or expired can't say Going, or be put on a crew, until they sign; the ride screen shows "Sign the Road Rules to say Going." with **Read and sign** above the answers, Going is off, and Maybe and Can't make it still work. Due soon still counts, nothing published means no gate, and answers and crew spots given before stay (the briefing card's list still shows them to the RC). The database side is `20261025180000_going_needs_road_rules.sql` (set_rsvp and set_crew, using `private.road_rules_signed`), for Jeff to paste after `road-rules.sql`. Design: `docs/superpowers/specs/2026-10-25-road-rules-going-gate-design.md`.
- **Who publishes:** one NEC member (a national role or a sitting President) publishes on the NEC's behalf.
- **The good-until date:** on that date the sign-off is still signed and shows as due soon. The day after, it has run out. A sign-off made on 29 February is good until 28 February.
- **Version pinning:** Road Rules and the briefing card keep the version they opened on.
  - When a newer one arrives, a notice offers to show it.
  - Signing or Got it sends the version on screen, so an outdated one is refused.
  - Your own save or publish switches straight to the new version.
- **Board access:** board members who aren't on the NEC see only their own chapter in Who's signed. The NEC also gets Whole club.
- **Wording:**
  - a sign-off from before a fresh version reads "Signed an older version"
  - an expired one reads "Ran out DD/MM/YYYY".
- **Demo sample:** the demo's Road Rules are a labelled sample. The real text comes from the NEC publishing it in the app; nothing was loaded for them.

## Checks at hand-off
- `npm test`: 894 pass
- `npm run test:db`: all checks pass, and 357 parity cases agree
- typecheck and lint: clean
- the drop/delete grep: empty
- whole-branch review: two passes, ready to merge

## Still open
- Jeff's three SQL pastes, then the merge, then the live-build look.
- Jeff's paste of the Going gate migration, after `road-rules.sql`.
- **Later:**
  - reminders before a sign-off runs out (lane E's push)
  - chapter-local Road Rules
  - moving into lane D's document library (5C) once that exists.
