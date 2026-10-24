# Ride briefing cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a per-ride briefing written by the RC, assembled into a briefing card with the ride, route, crew and safety order, plus a "Got it" read that the RC can track.

**Architecture:**
- Pure rules in `src/domain/briefings.ts`.
- In the database: SECURITY DEFINER actions over read-only tables, and `ride_calendar` returns the new rows.
- Demo and live data layers with parity cases.
- Two new stack screens, plus a Briefing section on the ride screen.

**Tech Stack:** TypeScript, Expo SDK 58, React Navigation, Supabase Postgres, node:test (`npm test`), `scripts/test-db.sh` (`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-24-ride-briefings-design.md`

## Global Constraints
- **Refusal messages:** every one is copied word for word from the spec (with the curly ’) and is identical in the app and the database. Export each message from `briefings.ts` once; screens import them and never retype them.
- **Migration:** one new file, `supabase/migrations/20261024150000_ride_briefings.sql`.
  - It must contain no `drop` and no `delete from`. Foreign-key `on delete cascade` / `on delete set null` is fine.
  - `ride_calendar()` keeps the body from `20261024140000_ride_routes.sql` exactly, and only adds `briefings` and `briefing_reads`.
  - `set_rsvp` is not touched.
- **Shared and parallel files:** add to shared files only; never rewrite them. The tab bar is not changed.
- **UI:**
  - no `Alert`
  - Rustnuts Stencil for labels, names, buttons, numbers and times
  - theme tokens only
  - 390×844
  - inline errors in a live region.
- **Formats:** dates are DD/MM/YYYY; times like "7:42 am", matching the rides screens.
- **Counting:** limits count code points (`[...s].length`), and the app trims with JS `trim()`.

## Review Focus
1. **The RC crew member as writer:** a Full member who holds this ride's RC crew spot but no board seat can save, in both the app and the database. Losing the spot removes the right.
2. **Stale reads:** a briefing saved after someone read it shows "Updated since you read it", and that person appears in the unread list again.
3. **Blank lines:** hazards made only of spaces are dropped before counting. A briefing that is empty after trimming is refused.
4. **Cancelled or past rides:** saving is refused after the ride day and on a cancelled ride, but reading still works and the card still shows.
5. **Missing pieces:** a ride with no route and no TG still produces a clean card, with the route section hidden and "No Tail Gunner yet" in amber.

---

### Task 1: Briefing rules in the app
**Files:**
- modify `src/domain/types.ts`, adding `Briefing`, `BriefingRead`, `ClubData.briefings?` and `ClubData.briefingReads?` as in the spec
- create `src/domain/briefings.ts`
- create `src/domain/briefings.test.ts`

**Produces** (the exact names in the spec's App section):
- the message constants
- `MAX_HAZARDS = 12`, `MAX_HAZARD = 120`, `MAX_TEXT = 2000`
- `SAFETY_ORDER` (5 labels)
- `cleanBriefing(input) → { hazards, changes, notes }`, which trims and drops blank hazards
- `writesBriefing(me, ride, data)`: `managesRide`, or `spotOf(ride.id, me.id, data.crew) === 'road_captain'`
- `saveBriefingProblem(me, ride, input, data, now)`, checking in the spec's order, using `endOfFirstDay`
- `readBriefingProblem(me, ride, data)`
- `briefingOf`
- `readState`
- `readCount`, which counts Going riders only
- `unreadGoing`, which returns Going members with no read or a stale read, in name order

**Steps:**
- [ ] Write failing tests for every message in order. Include a board writer, a non-board RC crew writer, and an RC who stepped down (refused). Cover the code-point limits, blank-line dropping, and read states with stale versus current at an equal timestamp (equal counts as current).
- [ ] Watch the tests fail, then implement.
- [ ] Run `npm test`, typecheck and lint until green.
- [ ] Commit: `Briefings: rules in the app`.

### Task 2: Briefings in the database
**Files:**
- create the migration `20261024150000_ride_briefings.sql`
- create `supabase/tests/ride_briefings_test.sql`
- modify `scripts/test-db.sh` to add a `rustnuts_briefings` block, copied from the routes block

**Produces:**
- the two tables and their RLS
- `save_briefing(p_ride uuid, p_hazards text[], p_changes text, p_notes text) returns void`
- `read_briefing(p_ride uuid) returns void`
- `ride_calendar()` with `briefings` (each row: `ride_id, hazards, changes, notes, updated_by, updated_at`) and `briefing_reads` (each row: `ride_id, member_id, read_at`), both for shown rides
- reuse `private.trim_like_app` and `private.manages_ride`

**Steps:**
- [ ] Write the failing SQL test. Cover every message in order, the crew-RC writer, an ex-RC refused, blank hazards dropped, code-point limits, the ride-row lock (`pgrowlocks`, as in the crew test), no API writes, anon and applicants reading nothing, and the calendar returning all six data keys.
- [ ] Run `npm run test:db`, see it fail, then implement until it is green.
- [ ] Check that `grep -niE 'drop|delete' <migration> | grep -viE 'on delete (cascade|set null)'` prints nothing.
- [ ] Commit: `Briefings: tables and actions in the database`.

### Task 3: Data layer, demo and parity (after Tasks 1 and 2)
**Files:**
- `clubContext.ts`, `demoActions.ts`, `DemoClubProvider.tsx`, `LiveClubProvider.tsx`, `liveData.ts` (+test), `database.types.ts`
- `demoData.ts`, using the spec's demo rows
- `parityFixture.testkit.ts`, `scripts/parity-sql.mts`, `parity.json`
- `src/data/demoBriefings.test.ts`

**Produces:** `saveBriefing(rideId, input): Promise<void>` and `readBriefing(rideId): Promise<void>` on the context.
- Both actions check the app rules first, and live then calls `rpc`.
- Live maps `briefings` and `briefing_reads` with `?? []`.

**Parity:** at least 8 cases, both allowed and refused:
- a crew-RC writer
- an ex-RC
- a past ride
- a cancelled ride
- too many hazards
- empty
- a read with no briefing
- an allowed read on a cancelled ride

**Steps:** write the failing tests, implement, then run all four checks until green. Commit: `Briefings: demo and live actions, parity cases`.

### Task 4: Screens (after Task 3)
**Files:**
- create `src/screens/briefing.tsx` (`BriefingScreen`, `EditBriefingScreen`)
- modify `src/screens/rides.tsx` to add the Briefing section between Route and Crew
- modify navigation `types.ts` and `RootNavigator.tsx`
- modify `DESIGN.md` to add a short Briefing section
- reuse `OpenInMapsButton` and the stop list from `src/ui/RouteBits.tsx`, and the crew labels from `labels.ts`

**Steps:**
- [ ] Read Impeccable's craft floor and `DESIGN.md`.
- [ ] Write tests first for any pure formatting helpers.
- [ ] Build the screens.
- [ ] Run typecheck, lint, `npm test` and `npm run build:preview`.
- [ ] Commit: `Briefings: briefing card and editor`.

### Task 5: Review, design passes, live (lead)
- [ ] Get an independent whole-branch review, fix its findings, then get a scoped re-review.
- [ ] Take 390×844 demo screenshots and do a critique pass.
- [ ] Merge main and run all checks.
- [ ] Add a Live log line, apply the migration live, and smoke-check that the calendar returns its keys.
- [ ] Open the PR and merge it.
