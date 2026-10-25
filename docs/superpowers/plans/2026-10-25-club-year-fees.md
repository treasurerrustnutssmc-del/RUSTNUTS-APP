# Club-year fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fees run AGM to AGM, and Full members patched partway through a year pay pro rata.

**Architecture:** A pure domain module (`src/domain/clubYear.ts`) holds the club-year rules. The demo and the database (`private.club_year_of`, `private.pro_rata`, a status trigger) apply them the same way, checked by shared parity cases.

**Tech Stack:** TypeScript, node:test via tsx, Postgres/Supabase.

**Spec:** docs/superpowers/specs/2026-10-25-club-year-fees-design.md

## Global Constraints

- Default AGM date when none is recorded: `08-01` (1 August).
- Pro rata: whole months from the patch month up to (not including) the next AGM's month, clamped to 1..12. Rounded to the nearest dollar (`Math.round(amount * months / 12 / 100) * 100`). Patched on or before the year's AGM: the full amount.
- Label: `2026–27` (en dash).
- Refusal text: `Only the National Chairman or Secretary records the AGM.`
- The treasurer's books stay on `fyOf` (financial year). Do not change ledger.ts or treasury.tsx.
- Dates shown as DD/MM/YYYY. No `Alert`. Stencil font for numbers and dates on cards.

## Review Focus

- A recorded AGM later than 1 August: dates between 1 August and the AGM belong to the previous club year.
- A patch-in when that year's fees haven't been set: no charge.
- A patch-in when the member already has a fee charge for that year: no second charge.
- Nomad to Full (or Full to Nomad and back): no charge, since they were already patched.
- Members on hiatus patched in: no charge.

---

### Task 1: Domain rules

**Files:** Create `src/domain/clubYear.ts` and `src/domain/clubYear.test.ts`. Modify `src/domain/types.ts`, adding `Agm { year: number; heldOn: string }` and `ClubData.agms?: Agm[]`.

**Produces:**
- `agmOn(year, agms): string`
- `agmAssumed(year, agms): boolean`
- `clubYearOf(iso, agms): number`
- `clubYearLabel(y): string`
- `proRata(amountCents, patchedOn, year, agms): { cents: number; months: number }`, where months is 12 for a full year
- `patchInCharge(member, before, data, today): Omit<Charge,'id'|'createdAt'> | null`
- `recordAgmProblem(me, positions): string | null`

- [ ] Write the failing tests: Oct→Aug gives 10 months and 30000 from 36000; patched on the AGM day gives 12; a recorded AGM on 20/08/2026 puts 10/08/2026 in club year 2025; rounding 36000×7/12 gives 21000; no rate gives null; already charged gives null; Nomad to Full gives null; on hiatus gives null.
- [ ] Implement; tests pass; commit.

### Task 2: Demo

**Files:** `src/data/demoStage4.ts` (raiseFees pro rata, recordFngReview patch-in, recordAgm, fyOf → clubYearOf for fees), `src/data/demoActions.ts` (approve and setStatus add the patch-in charge), `src/data/demoData.ts` (agms: [], fees by club year), `clubContext.ts`, `DemoClubProvider.tsx`, `LiveClubProvider.tsx` (`recordAgm(heldOn)`), and `liveData.ts` (load `agms` from members_money).

- [ ] Write the failing demo tests (raise pro rata, patch-in once, recordAgm refused for a treasurer), implement, commit.

### Task 3: Database

**Files:** Create `supabase/migrations/20270301000300_club_year_fees.sql`. Extend `supabase/tests/members_money_test.sql`, `parity.json` and `scripts/parity-sql.mts` (recordAgm action).

- Table `agms`, with RLS letting approved members read it.
- `private.agm_on(int)`, `private.club_year_of(date)` and `private.pro_rata(int, date, int)` returning months.
- `public.record_agm(date)`.
- `raise_fees` and `record_fng_review` (continuation) use club_year_of. `raise_charge` uses club_year_of.
- `members_money()` adds `agms`.
- Trigger `members_patch_in_fee` after update of status.

- [ ] Write the failing SQL tests, then the migration; `npm run test:db` passes; commit.

### Task 4: Screens and docs

**Files:** `src/screens/fees.tsx` (labels, AGM card, pro rata description), `checkin.tsx`, `fng.tsx`, PRODUCT.md, DESIGN.md if needed, and the handover note.

- [ ] Change the screens; check them at 390×844; run all four checks; independent review; merge; write the live SQL file (the migration plus Full $360 per chapter for 2026, due 2026-12-31).
