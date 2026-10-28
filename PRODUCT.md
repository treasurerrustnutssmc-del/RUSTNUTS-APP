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
- **Stage 5 (meetings and votes):** board and general meetings with agendas, minutes that members read as a draft once the meeting's held and the board then confirms; action items; votes by the board or patched members, with quorum, majority, two-thirds or unanimous, secret ballots and the chair's casting vote on a tie. Patch votes start from Manage member. The rules follow the constitution (v4, Final Club Edition, 25 Oct 2026, in the project files under `reference/`): draft minutes within 7 days, quorum a third of voters (51% for the NEC; a board needs a majority and at least three), Nomads off chapter votes, one NEC vote per chapter, a chair who may cast or let a tie fall, and a patch vote needs every Full Member's yes. A vote stays open at most 60 days (inferred).
- **Stage 5B (treasurer):** each chapter and the Club keep their own fund. The treasurer (or the National Chairman or Secretary) records money in and out under the club's payment codes; spending waits for two approvals from the fund's board (the sitting Presidents for the Club fund), never the person being paid, before it's paid (13.3). Mistakes are voided, never deleted. Confirmed fee payments go in with one tap. The monthly Treasurer's Report is worked out from the ledger and presented to members, who read it from Me (13.8). The board approves each fund's budget with a carried vote (13.4), and the National Auditor can read every fund (11.8).
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

## Members and Money (Stage 4)

- **Check-ins:** a chapter's board (or the NEC for whole-club rides) opens a check-in at a meeting or ride and holds up a QR code with a six-character code under it. Members and introduced applicants scan it or type the code. The board can tick people off by hand, on the day or afterwards.
- **The way in:** an introduced applicant's three months, two meetings and one member ride are counted from the day they asked, and shown to them and their board. The board records its vote when it approves or declines.
- **FNG reviews:** at 6, 9 and 12 months, then every 3 months. Patching someone in needs nine months and a carried patch vote of the chapter's Full Members, not the board's tally. Not continuing makes them a Supporter. Carrying on past twelve months adds a one-off continuation fee of half the Full fee (Jeff, 25 Oct 2026). Only Full members pay a yearly fee; everyone else is free.
- **Constitution v4 (25 Oct 2026):** the rules follow v4, the Final Club Edition (`reference/` in the project files; audit in `docs/superpowers/specs/2026-10-25-constitution-v4-audit.md`). Only Full and Nomad members hold positions, Nomads only Non-Board ones; learner permit riders can't be FNGs; only the NEC brings someone back to Full or Nomad; meetings need 7 days' notice (14 for an Annual Chapter Meeting, a National Club meeting or the Association AGM). Family is an app-only status with no Club rights.
- **Fees (Jeff, 24 and 25 Oct 2026):** the chapter board sets the amounts for each club year, which runs from one AGM to the next (the AGM date is recorded by the National Chairman or Secretary; 1 August is assumed until it is). A full year is $360. Someone patched in partway through pays for the whole months left, to the nearest dollar. The treasurer's books stay on the financial year (1 July to 30 June). Members on hiatus don't pay. The treasurer, or the National Chairman or Secretary, raises the year's fees, records and confirms payments, and issues receipts (W26-0001). Members pay by PayID or bank transfer and tap "I've paid this"; nothing is charged by card.
- **Privacy:** a member's charges are seen by them and their chapter's board. The board's vote count and note on a decision are the board's only.
- **Reminders** are in the app only (Home and Me). No emails or pushes to members.

## Stage 3 (lane B): chat and photos

- **Chats:** the whole club, each chapter, each chapter's big table (its board), the NEC, the ride and charity committees, one chat per ride, and private chats between two people. Facebook Messenger is what the club uses now; this replaces it.
- **Who sees what:** approved members see the whole-club chat, their own chapter's chat and ride chats. Board, NEC and committee chats are for the people who sit on them. People who might join (Introduced) get the whole-club and ride chats only, and no private chats until they're FNGs.
- **Banter matters:** photos, videos, GIFs (GIPHY) and link cards are first-class. Replies, reactions, pins (moderators), reports and blocks are in.
- **Photos:** a club-wide photo feed (never private chats) and a ride wall for each ride, built from the photos posted in its chat.
- **Ride comms** (open-mic voice while riding, big connect and disconnect buttons) is Stage 6, not this stage.

## Stage 7: social extras

- **Why:** the small reasons to open the app on a day with no ride. Design in `docs/superpowers/specs/2026-10-27-social-extras-design.md`, built one piece at a time.
- **Shout-outs:** birthdays and patch anniversaries this week, on Home. Birthdays are opt-in from Me and keep the day and month only, never the year. Anniversaries are for members who are Full or Nomad now, from one year patched. "Say g'day" opens a private chat; the app never posts for anyone.
- **On this day:** photos and videos posted on today's date in earlier years, on Home, by the photo feed's rules (group chats you can read, never private chats, nothing removed, nobody you've blocked).
- **Who can help?:** on the Members tab. Members say what they can lend a hand with (servicing, tyres, electrics and so on) from Me; pick a skill to see who can help, your own chapter first. Below that, the club's trusted mechanics: anyone approved can add a workshop, whoever added it or the board can change it or take it off the list, and members tap "I've used them" so the list shows who's been there. Nothing is ever deleted.
- **Swap and sell:** on the Members tab. Approved members list parts and gear for sale (whole dollars), to swap, free, or wanted, with up to six photos. Open listings newest first, with filters, and what sold in the last 30 days below. "Message the seller" opens a private chat; the app never writes the message. The seller changes it, marks it sold (or found) and back on; the seller or the board takes it down, and it's kept, never deleted. Nothing from anyone you've blocked, and a suspended seller's listings disappear.
- **Garage builds:** on the Members tab. The owner of a project bike (switched on in their garage) posts updates with words and up to four photos; members follow the most recently updated builds first and can message the owner. No comments. The poster or the board takes an update down, and it's kept. A bike that stops being a project keeps its thread to look back on.
- **History and hall of fame:** on the Members tab, in the Chapters card. A timeline of the club's story, oldest first, headed by its founding (from the founder positions), and a hall of fame: founders, honours (life members, awards, a member or someone typed in), and past office holders from ended positions. Any board member or the NEC adds, changes and takes off entries and honours (kept, archived); every approved member reads them.

## Attendance rules, Big 4 rides, terms and the card (28 Oct 2026)

- **Big 4 rides:** the NEC (the Chair, a Chapter President, or the National Secretary) marks a club, North or West ride as a Big 4 ahead of time, for the whole club or one chapter (5.11). It can't be added or taken off once the ride's day has come.
- **Meeting kinds:** a meeting check-in is opened as a monthly meeting, a special or annual meeting, or another event, so the right ones count (4.6, 5.2).
- **Where you stand:** Full Members see their monthly meetings against 80% and their Big 4 rides against two; Nomads two in three and one Big 4; FNGs half of each of rides, monthly meetings and other events since their trial began. Only activities that had a check-in count. The member and their board see it; the board's Attendance screen lists the chapter, Behind first. It never changes anyone's status: that's still the board's decision after the 14-day notice (5.5).
- **Excused:** the member's chapter board can excuse them from one check-in with a reason (work, family, health, injury, distance). It drops out of their count. Only the member and their board see the reason.
- **Before a Big 4:** members see whether they've made two of the last three meetings (5.4); Supporters see they can't join (5.8). It's shown, not enforced, for now.
- **Terms:** each position shows when its term ends (two years; the National Auditor twelve months; terms recorded before 1 August 2026 run from then, 17.6). The Board screen lists terms that have ended or end within 60 days. Re-elected means end the term and appoint again.
- **Membership card:** on Me, with the real logo, name, status, chapter, member since, patched (Full and Nomad, with the disc), the club year and whether this year's dues are paid.
