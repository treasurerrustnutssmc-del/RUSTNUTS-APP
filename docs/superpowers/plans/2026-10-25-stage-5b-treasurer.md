# Treasurer (Stage 5B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Treasurers keep the club's ledger, budgets and monthly report in the app, under constitution v4 section 13.

**Architecture:**
- Rules live in `src/domain/ledger.ts`, the same in the demo and the database.
- Demo actions are in `src/data/ledgerActions.ts`.
- The live read is `club_ledger()`, mapped by `src/data/ledgerLive.ts`, with SECURITY DEFINER actions in `supabase/migrations/20270101000200_treasurer.sql`.
- Screens are in `src/screens/treasury.tsx`.

**Tech Stack:** Expo SDK 58, React Navigation, Supabase Postgres, node:test.

**Spec:** `docs/superpowers/specs/2026-10-25-stage-5b-treasurer-design.md`

## Global Constraints
- Migration prefix `20270101`, add-only. No "drop", no "delete from".
- Refusal text is identical in TS and SQL. Every shared refusal gets a parity.json case.
- Dates are stored ISO and shown DD/MM/YYYY. Money is whole cents, shown with `formatCents`.
- No `Alert`. Void uses `ConfirmButton`. Stencil font for codes, amounts and dates on cards.
- Shared files (types.ts, clubContext, providers, parity files, navigation) are append-only blocks.

## Review Focus
1. A payee who is also an approver: the recorder's auto-approval must not count when they're the payee.
2. A void entry or an unpaid debit leaking into balances or the report.
3. A report month in July, which must open from the FY openings with no carry from June's FY.
4. A member who can't read the ledger getting entry lines through `club_ledger()`.
5. A budget approved with a carried vote from the wrong scope or electorate, or with a lost vote.

---

### Task 1: Domain rules (`src/domain/ledger.ts`)
**Files:** create `src/domain/ledger.ts` and `src/domain/ledger.test.ts`; append types to `src/domain/types.ts`.

**Produces:**
- `LEDGER_CODES`, `codeDirection(code)`
- `keepsBooks(me, chapterId, positions)`, `approvesFor(...)`, `seesLedger(...)`
- `creditProblem`, `debitProblem`, `approveProblem`, `payProblem`, `voidProblem`, `addFeeProblem`, `openingProblem`, `floatProblem`, `budgetProblem`, `approveBudgetProblem`, `reopenBudgetProblem`, `presentProblem`
- `bankedLate(receivedOn, entryOn)`
- `fundBalance(fund, upTo, data)`
- `monthReport(month, data): MonthReport`
- `budgetLines(fund, fy, data)`
- `feesToAdd(chapterIds, data)`

- [ ] Write the tests from the spec's Tests list. Watch them fail. Implement. Run `npm test`.

### Task 2: Demo actions and wiring
**Files:**
- create `src/data/ledgerActions.ts` and `src/data/ledger.test.ts`;
- append to `clubContext.ts`, `DemoClubProvider.tsx` and `demoData.ts`, adding a few demo entries, an opening, a float and a budget.

- [ ] Tests first: each action applies its problem check and then its change.

### Task 3: Database
**Files:** create `supabase/migrations/20270101000200_treasurer.sql` and `supabase/tests/treasurer_test.sql`; append parity cases to `parity.json`, `parityFixture.testkit.ts` and `parity-sql.mts`.

- [ ] Write the SQL tests. Implement the tables, the functions and `club_ledger()`. Run `npm run test:db` until green.

### Task 4: Live provider
**Files:** create `src/data/ledgerLive.ts`; append to `LiveClubProvider.tsx` and `database.types.ts`.

- [ ] Add a mapping test to `ledger.test.ts`, then wire up each rpc.

### Task 5: Screens
**Files:**
- create `src/screens/treasury.tsx` (Treasury, LedgerEntry, NewEntry, MonthReport, Budget, ClubFinances);
- append routes in navigation;
- add a row on the Board screen and on Me.

- [ ] Read Impeccable's craft floor first. Build the screens. Check them at 390×844 in the demo. Run critique, audit and polish by hand.

### Task 6: Review and ship
- [ ] Run an independent reviewer subagent on the diff and the spec. Fix Critical and Important findings.
- [ ] Run `npm test`, `npm run test:db`, `npm run typecheck` and `npx expo lint`. Open the PR, merge it, and write the paste file `/mnt/project-files/build/stage-5b-treasurer.sql`. Then log the live turn.
