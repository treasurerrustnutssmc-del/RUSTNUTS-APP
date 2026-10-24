# Road Rules sign-off (Stage 2, part 5)

**Type:** architectural. It adds two tables, new database actions and new screens, and it touches the ride screen, the briefing card and Me.

This is lane A of the parallel build, so migrations use the `2026102416` prefix. Claude approved this spec on 24 Oct 2026 under Jeff's standing rule. Jeff can veto any line. The lines marked *inferred* are the ones most worth a look.

## Goal
The constitution keeps the detailed group-riding procedures in a separate, controlled document called the **Road Rules** (7.10, 15.4). This piece puts the Road Rules in the app:
- **Members** read the current version and **sign** that they'll ride by it, once a year and again whenever the NEC publishes a version that needs a fresh sign-off.
- **Boards and the NEC** see who hasn't signed.
- **The Road Captain** sees it on the briefing card at the meeting point.

Lane D's document library (Stage 5C) may later absorb this as one of its documents. This spec doesn't wait for it.

## Words
- **Road Rules version:** one published text of the Road Rules. Its fields:
  - **number:** 1, 2, 3, and so on
  - **text:** at most 20,000 characters
  - **what changed:** a short summary, optional, at most 500 characters
  - **fresh sign-off:** a yes or no
  - **published at** and **published by**

  The **current version** is the highest number. Versions are never edited or removed: a correction is a new version.
- **Fresh sign-off:** the publisher's choice when publishing.
  - **Yes** (the default) means everyone signs again.
  - **No** is for a small fix, such as a typo, where existing sign-offs carry over.
  - Version 1 always needs one.
- **Sign-off base:** the newest version that needed a fresh sign-off.
- **Signed:** a member has signed a version at or after the sign-off base, within the last 12 months.
  - The sign-off is **good until** the same Melbourne date one year after signing. 29 February rolls to 28 February.
  - It is **due soon** in its last 30 days, the same as the licence and first-aid expiry warnings (`expiryState`).
- **Who's asked:** every approved member except Legacy. That covers riders, pillions and support drivers alike, since constitution 7.1 covers all of them.
- **Publishers:** the NEC (`isNational`: a national role or a sitting chapter President). Constitution 7.10 says changes to "Club-wide safety expectations require NEC approval", so a published version is the NEC's approved text. *Inferred:* one NEC member publishes on the committee's behalf.

## Rules (`src/domain/roadRules.ts`, mirrored by the database with the same words and order)
1. **Approved members can see** every version and every sign-off. Applicants and the public see nothing.
2. **Publishing** checks, in this order:
   1. `Sign in first.`
   2. `Only approved members can do that.`
   3. `Only the NEC can publish the Road Rules.`
   4. The current version number isn't the one the editor opened on (0 when there were none): `Someone else published a new version while you were editing. Your text isn’t saved: copy it, then open the Road Rules again.`
   5. The text is empty after trimming: `Write the Road Rules first.`
   6. The text is over 20,000 characters: `That’s too long (20000 characters at most).`
   7. What changed is over 500 characters: `Keep what changed to 500 characters at most.`

   Version 1 always records fresh sign-off as yes, whatever was asked.
3. **Signing** checks:
   1. `Sign in first.`
   2. `Only approved members can do that.`
   3. No version yet: `There are no Road Rules to sign yet.`
   4. The version on screen isn't the current one: `The Road Rules changed while you had them open. Read the new version, then sign.`

   Signing again while already signed is allowed. It moves the date, so a member can renew early.
4. **Texts** are trimmed with JS `trim()` in the app and `private.trim_like_app` in the database. Lengths count code points.
5. **Status for a member**, at a Melbourne date:
   - `none`: nothing to sign yet
   - `unsigned`: never signed since the base
   - `current`: signed
   - `due_soon`: signed, with 30 days or fewer left
   - `expired`: signed since the base, but more than 12 months ago

   `roadRulesStatus(member, data, today)` returns `{ state, goodUntil, signedVersion }`.
6. **Not a gate.** An unsigned rider can still say Going and still be put on the crew. The app nudges them on the ride screen and the RC sees them on the briefing card. *Inferred, and asked:* Jeff may prefer a hard gate on Going. That would be a later change to `set_rsvp`.

## Screens
- **Road Rules** (stack screen `RoadRules`). It's reached from Me, from the ride-screen nudge, from the briefing card's safety section, and from the board sign-off list. From top to bottom:
  1. "Version N", the published date (DD/MM/YYYY) and who published it.
  2. A "What changed" box when the version has one.
  3. The text, in readable body type. Lines starting with `# ` become stencil headings, lines starting with `- ` become bullets, and blank lines separate paragraphs. Nothing else is formatted.
  4. **The sign box:**
     - when not signed: "I’ve read the Road Rules and will ride by them" and a big **Sign the Road Rules** button
     - when signed: "Signed on DD/MM/YYYY. Good until DD/MM/YYYY.", with a quiet **Sign again**, which becomes the big button when due soon or expired.
  5. **For publishers:**
     - **Publish a new version**
     - a **Who's signed** link
     - a version list with dates (older versions open read-only).

  With no version yet, members see "The NEC hasn't published the Road Rules in the app yet." Publishers see that message and **Write the first version**.
- **Publish Road Rules** (stack screen `EditRoadRules`):
  - a large multiline text field, prefilled with the current version's text
  - a What changed field
  - an "Everyone signs again" switch, on by default, and hidden for version 1
  - **Publish version N**, using `ConfirmButton`:
    - its confirm text says "Everyone will be asked to sign again" when the switch is on
    - errors show inline in a live region.
- **Who's signed** (stack screen `RoadRulesSignoffs`), for publishers and anyone with a board seat:
  - A chapter filter like Rides, starting on your own chapter. The NEC also gets Whole club.
  - Three groups, in name order: **Not signed** (unsigned and expired), **Due soon**, and **Signed**. Each row shows the name and "Good until DD/MM/YYYY", or "Never signed", or "Ran out DD/MM/YYYY".
  - A count at the top: "18 of 23 signed".
- **Me:** a Road Rules row: "Signed until DD/MM/YYYY", "Due 10/11/2026" in amber, or "Not signed" in red. It opens Road Rules.
- **Ride screen:** when a version exists and your state is unsigned or expired, a banner above Your answer: "Sign the Road Rules before you ride", with **Read and sign**. It stays hidden for none, current and due_soon.
- **Briefing card:**
  - The safety section gains "Road Rules: version N" as a link to Road Rules.
  - Writers see a second list under Not read yet: **Road Rules not signed**, the Going riders whose state is unsigned or expired, in name order.

No Alert dialogs, Rustnuts Stencil for labels, names, buttons, numbers and dates, and theme tokens only. Everything is checked at 390×844.

## Data (new migration `20261024160000_road_rules.sql`)
- **`public.road_rules_versions`:**
  - `number int primary key check (number >= 1)`
  - `body text not null`, with a check that it is ≤ 20000 characters and not blank
  - `changes text`, with a check that it is ≤ 500 characters
  - `fresh boolean not null`
  - `published_by`, referencing members, on delete set null
  - `published_at timestamptz not null default now()`
- **`public.road_rules_signoffs`:**
  - `member_id` (references members, on delete cascade) as the primary key: one row per member, holding their latest sign-off
  - `version int not null`, referencing `road_rules_versions`
  - `signed_at timestamptz not null`
- **Row-level security:** approved members can select both tables. There are no writes through the API.
- **Actions** (SECURITY DEFINER, `search_path = ''`, authenticated only):
  - **`publish_road_rules(p_body text, p_changes text, p_fresh boolean, p_seen int)`**
    - It takes `pg_advisory_xact_lock` on a fixed key first, so two publishes queue.
    - It checks in the rules' order, then inserts `max(number) + 1`, with `fresh` forced true for 1.
    - It returns the new number.
  - **`sign_road_rules(p_version int)`:** checks, then upserts your row with the version and `now()`.
- **Status in the database:** `private.road_rules_signed(p_member uuid)` returns a boolean, the same rule as the app's current or due_soon. It's for later use, such as a gate. Nothing calls it yet.
- **Loading:** the live app reads both tables with plain selects, because RLS allows it. There's no change to `ride_calendar`.
- **No `drop` and no `delete from`** anywhere in the migration.

## App
- **Types:**
  - `RoadRulesVersion { number; body; changes: string; fresh; publishedAt; publishedBy: string | null }`
  - `RoadRulesSignoff { memberId; version; signedAt }`
  - `ClubData.roadRules?` and `ClubData.roadRulesSignoffs?`
- **Context actions:**
  - `publishRoadRules({ body, changes, fresh }, seen): Promise<void>`
  - `signRoadRules(version): Promise<void>`

  Both check the app rules first. Live then calls `rpc` and reloads, and after a version refusal it reloads and then rethrows.
- **Domain:**
  - message constants
  - `MAX_RULES_TEXT = 20000` and `MAX_RULES_CHANGES = 500`
  - `currentRoadRules(data)`
  - `signoffBase(data)`
  - `publishesRoadRules(me, data)`
  - `publishProblem(me, input, seen, data)`
  - `signProblem(me, version, data)`
  - `roadRulesStatus(member, data, today)`
  - `goodUntil(signedAt)`
  - `askedToSign(data)`
  - `signoffGroups(members, data, today)`
  - `rulesBlocks(body)`, which returns `{ kind: 'heading' | 'bullet' | 'para'; text }[]`
- **Demo data:**
  - Version 1, published 01/07/2025 with fresh sign-off.
  - Version 2, published 01/10/2026 as a small fix (not fresh), with a What changed line.
  - The text is a clearly labelled sample, built from constitution 7 and plain group-riding practice. Its first line reads "# Sample Road Rules (demo only)".
  - Sign-offs:
    - Torque signed version 2 recently.
    - Spanner signed version 1 on 15/11/2025, so they're due soon in late October 2026.
    - Diesel has never signed.
    - Rusty signed on 01/09/2025, so theirs has run out.
- **Navigation:** `RoadRules { version?: number }`, `EditRoadRules` and `RoadRulesSignoffs`.

## Tests
- **`npm test`:**
  - `roadRules.test.ts`: every message and its order; that version 1 is always fresh; base and carry-over; the 12-month expiry including 29 February; the due-soon edge; who's asked; the groups; and `rulesBlocks`.
  - Demo actions.
  - Live mapping.
- **`npm run test:db`** (`supabase/tests/road_rules_test.sql`):
  - the same rules and order
  - that a non-NEC board member is refused
  - the version-seen conflict
  - no API writes
  - that applicants and anon read nothing
  - the advisory lock
  - that `road_rules_signed` agrees with the app on the expiry edges.
- **`parity.json`:**
  - publish cases: allowed, a non-NEC writer, a conflict, empty, too long
  - sign cases: allowed, a stale version, no versions, an applicant.
- **Screens:**
  - Road Rules (unsigned, signed and due soon, as a publisher)
  - Publish
  - Who's signed
  - the Me row
  - the ride-screen nudge
  - the briefing card additions

  All at 390×844 in the demo build, then the Impeccable passes.

## Not in this spec
- **A gate on Going or on crew spots.** It was asked of Jeff and can be added later with `road_rules_signed`.
- **Chapter-local Road Rules** (permanent local changes need Board approval under 7.10). One club-wide document for now.
- **The real Road Rules text.** The NEC publishes it in the app once this is live. Nothing is loaded for them.
- **Reminders** before a sign-off runs out. That's push, which belongs to lane E.
- **A PDF copy.** That's for 5C's document library.
