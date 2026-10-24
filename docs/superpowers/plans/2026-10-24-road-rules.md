# Road Rules sign-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the NEC publishes versioned Road Rules in the app, and members sign them yearly or when a version needs a fresh sign-off. Boards see who hasn't signed, and the RC sees unsigned riders on the briefing card.

**Architecture:**
- Pure rules in `src/domain/roadRules.ts`.
- Two read-only tables with SECURITY DEFINER actions. The live app reads them with plain selects; `ride_calendar` is unchanged.
- Demo and live data layers with parity cases.
- Three new stack screens, plus small additions to Me, the ride screen and the briefing card.

**Tech Stack:** TypeScript, Expo SDK 58, React Navigation, Supabase Postgres, node:test (`npm test`), `scripts/test-db.sh` (`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-24-road-rules-design.md`

## Global Constraints
- **Refusal messages** are copied word for word from the spec, with the curly ’. They are the same in the app and the database. Each one is exported once from `roadRules.ts`, and screens import it.
- **Migration:** one new file, `supabase/migrations/20261024160000_road_rules.sql`.
  - It contains no `drop` and no `delete from`. A foreign key's `on delete cascade` or `on delete set null` is fine.
  - It does not touch `ride_calendar`, `set_rsvp`, `set_crew` or the briefing functions.
- **Shared files:** add to them, never rewrite them. The tab bar is not changed.
- **UI:**
  - no `Alert`; `ConfirmButton` for Publish
  - Rustnuts Stencil for labels, names, buttons, numbers and dates
  - theme tokens only
  - checked at 390×844
  - inline errors in a live region.
- **Dates** are DD/MM/YYYY. "Today" and the 12-month expiry use the Melbourne date.
- **Limits** count code points. The app trims with JS `trim()`; the database uses `private.trim_like_app`.

## Review Focus
1. **Carry-over:** a small-fix version (not fresh) keeps existing sign-offs current, and a fresh version makes them `unsigned` until the member signs again. This holds in both layers.
2. **Expiry edges:** a sign-off on 29/02/2028 is good until 28/02/2029. On the good-until date it's still current. The day after, it's expired. 30 days before, it's due_soon. The app and `private.road_rules_signed` agree.
3. **Version conflicts:** a publish while someone else has just published, or a sign on an older version, is refused, and the live app reloads so the newer version shows.
4. **No versions yet:** every screen behaves cleanly with zero versions. There's no nudge, Me shows nothing to sign, and publishers see Write the first version.
5. **Who's asked:** Legacy members and applicants never show in Not signed. A member who becomes Legacy drops out of the lists.

---

### Task 1: Road Rules rules in the app
**Files:**
- modify `src/domain/types.ts`
- create `src/domain/roadRules.ts` and `src/domain/roadRules.test.ts`

**Produces:**
- the types and domain names listed in the spec's App section, with exactly those names
- `RoadRulesInput { body: string; changes: string; fresh: boolean }`
- `goodUntil(signedAt: string): string`, an ISO date: the Melbourne date plus one year, with 29 Feb rolling to 28 Feb
- `roadRulesStatus` returns `{ state: 'none' | 'unsigned' | 'current' | 'due_soon' | 'expired'; goodUntil: string | null; signedVersion: number | null }`
- `signoffGroups` returns `{ notSigned: Member[]; dueSoon: Member[]; signed: Member[] }`, each in name order (`byName` from crew.ts)

**Steps:**
- [ ] Write failing tests:
  - every message in order
  - that a non-NEC board member is refused
  - version 1 forced fresh
  - base and carry-over
  - the expiry and due-soon edges from the Review Focus
  - that Legacy and unapproved members aren't asked
  - `rulesBlocks`, covering headings, bullets, paragraphs, blank-line runs and `\r\n`
- [ ] See them fail, then implement.
- [ ] Run `npm test`, typecheck and lint until they pass.
- [ ] Commit: `Road Rules: rules in the app`.

### Task 2: Road Rules in the database
**Files:**
- create the migration
- create `supabase/tests/road_rules_test.sql`
- modify `scripts/test-db.sh`, adding a `rustnuts_road_rules` block copied from the briefings block

**Produces:** the tables, RLS, `publish_road_rules(p_body text, p_changes text, p_fresh boolean, p_seen int) returns int`, `sign_road_rules(p_version int) returns void` and `private.road_rules_signed(p_member uuid) returns boolean`. Reuse `private.is_approved_member`, `private.trim_like_app` and `public.is_national()`, checking first that `is_national` matches the app's `isNational`.

**Steps:**
- [ ] Write the failing SQL test, covering everything in the spec's Tests section for the database.
- [ ] Run `npm run test:db`, see it fail, then implement until it passes.
- [ ] Run the drop/delete grep and confirm it prints nothing.
- [ ] Commit: `Road Rules: tables and actions in the database`.

### Task 3: Data layer, demo and parity (after Tasks 1 and 2)
**Files:**
- `clubContext.ts`, `demoActions.ts`, `DemoClubProvider.tsx`, `LiveClubProvider.tsx`, `liveData.ts` (+test), `database.types.ts`
- `demoData.ts`, using the spec's demo rows (dates relative to the real today where the spec's states depend on it, so Spanner stays due soon and Rusty stays expired)
- `parityFixture.testkit.ts`, `scripts/parity-sql.mts`, `parity.json`
- `src/data/demoRoadRules.test.ts`

**Produces:** `publishRoadRules(input, seen)` and `signRoadRules(version)` on the context. Live loads both tables in the same pass as the rest of the club data.

**Parity:** at least the nine cases in the spec, plus one expiry-edge sign status case if the fixture can express it.

**Steps:** write the failing tests, implement, then run all four checks until they pass. Commit: `Road Rules: demo and live actions, parity cases`.

### Task 4: Screens (after Task 3)
**Files:**
- create `src/screens/roadRules.tsx` (`RoadRulesScreen`, `EditRoadRulesScreen`, `RoadRulesSignoffsScreen`)
- modify navigation `types.ts` and `RootNavigator.tsx`
- modify `src/screens/me.tsx` (the row)
- modify `src/screens/rides.tsx` (the nudge)
- modify `src/screens/briefing.tsx` (the safety link and the writers' unsigned list)
- modify `DESIGN.md` (a short Road Rules section)

**Steps:**
- [ ] Read Impeccable's craft floor and `DESIGN.md`.
- [ ] Write tests first for any pure helpers.
- [ ] Build the screens.
- [ ] Run typecheck, lint, `npm test` and `npm run build:preview`. Take demo screenshots at 390×844 of every screen state in the spec's Tests section.
- [ ] Commit: `Road Rules: screens`.

### Task 5: Review, design passes, live (lead)
- [ ] Get an independent whole-branch review, fix what it finds, then get a scoped re-review.
- [ ] Critique pass on the screenshots.
- [ ] Merge main and run all checks.
- [ ] Go live: write a Live log line, then apply the migration, or hand Jeff the paste file if the tool refuses.
- [ ] Open the PR. Merge it once the SQL is live.
