# Document library (Stage 5C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** The club's controlled documents live in the app, in the 2.2 order, each version showing the 15.5 facts, with sign-off and review cycles, and constitution v4 in from day one.

**Architecture:**
- Rules live in `src/domain/documents.ts`, the same in the demo and the database.
- Demo actions are in `src/data/documentActions.ts`. The v4 text for the demo is in `src/data/demoConstitution.ts`, made by `scripts/clean-constitution.mts` from the reference copy.
- The live read is `club_documents()` plus `document_body(version)`, mapped by `src/data/documentsLive.ts`, with SECURITY DEFINER actions in `supabase/migrations/20270101000300_documents.sql`.
- Screens are in `src/screens/documents.tsx`.

**Tech Stack:** Expo SDK 58, React Navigation, Supabase Postgres, node:test.

**Spec:** `docs/superpowers/specs/2026-10-27-stage-5c-documents-design.md`

## Global Constraints
- Migration `20270101000300_documents.sql`, add-only. No "drop", no "delete from".
- Refusal text is identical in TS and SQL. Every shared refusal gets a parity.json case.
- Dates are stored ISO and shown DD/MM/YYYY. "Today" is the Melbourne date.
- No `Alert`. Mark reviewed uses `ConfirmButton`. Stencil for titles, labels, chips and dates on cards; body font for the document text.
- Shared files (types.ts, clubContext, providers, parity files, navigation, board.tsx, me.tsx) get append-only blocks.
- The v4 text goes into live only through the paste file, for Jeff to run.

## Review Focus
1. An applicant reaching a level 3 to 5 document's text through `document_body`.
2. A version below the one in force that was never approved: it must be superseded, not awaiting, and never the shown version.
3. Signing a version that's awaiting or upcoming, or a chapter document by another chapter's member.
4. Publishing with a stale `expected_number` after someone else published: refused, typed text kept on screen.
5. Review due on the 31st, or commencement after `reviewed_on`: the later date wins and the month end rolls back.

---

### Task 1: Domain rules (`src/domain/documents.ts`)
**Files:** create `src/domain/documents.ts` and `src/domain/documents.test.ts`; append types (`ClubDocument`, `DocumentVersion`, `DocumentSignoff`, `DocumentKind`, `ApprovingBody`) and `ClubData` fields (`documents`, `documentVersions`, `documentSignoffs`) to `src/domain/types.ts`.

**Produces:**
- `authorityLevel(doc)`, `LEVEL_TITLES`, `libraryGroups(me, data)`
- `readsDocument(me, doc)`, `publishesDocument(me, doc | scope, positions)`
- `versionState(version, doc, data, today)`, `inForce(doc, data, today)`, `shownVersion(doc, data, today)`, `documentBanner(...)`
- `createDocumentProblem`, `publishVersionProblem`, `approvalFieldsProblem`, `recordApprovalProblem`, `markReviewedProblem`, `signDocumentProblem`
- `signoffBase`, `signStatus`, `askedToSignDocument`, `reviewDueOn`, `reviewState`
- `documentBlocks(body)` (reuses `rulesBlocks`), `documentContents(blocks)`, `findInDocument(blocks, query)`

- [ ] Write the tests from the spec's Tests list. Watch them fail. Implement. Run `npm test`.

### Task 2: v4 text and demo actions
**Files:**
- create `scripts/clean-constitution.mts` (drops page headers and footers, starts each clause number on a new paragraph, makes `# ` headings of section and part titles) and `src/data/demoConstitution.ts`;
- create `src/data/documentActions.ts` and `src/data/documents.test.ts`;
- append to `clubContext.ts`, `DemoClubProvider.tsx` and `demoData.ts`: the v4 Constitution (awaiting approval), a West bylaws document in force with a sign-off, and an NEC fee schedule with a review overdue.

- [ ] Tests first: each action applies its problem check and then its change.

### Task 3: Database
**Files:** create `supabase/migrations/20270101000300_documents.sql` and `supabase/tests/documents_test.sql`; append parity cases to `parity.json`, `parityFixture.testkit.ts` and `parity-sql.mts`.

- [ ] Write the SQL tests. Implement the tables, functions, `club_documents()` and `document_body()`. Run `npm run test:db` until green.

### Task 4: Live provider
**Files:** create `src/data/documentsLive.ts`; append to `LiveClubProvider.tsx` and `database.types.ts`.

- [ ] Add a mapping test to `documents.test.ts`, then wire each rpc. Bodies load on opening a version and are cached per version id.

### Task 5: Screens
**Files:** create `src/screens/documents.tsx` (Documents, Document, NewDocument, PublishDocument, DocumentApproval, DocumentSignoffs); append routes in navigation; add a row on Board and on Me.

- [ ] Read Impeccable's craft floor first. Build the screens. Check them at 390×844 in the demo. Run critique, audit and polish by hand.

### Task 6: Review and ship
- [ ] Run an independent reviewer subagent on the diff and the spec. Fix Critical and Important findings.
- [ ] Run `npm test`, `npm run test:db`, `npm run typecheck` and `npx expo lint`. Open the PR and merge it.
- [ ] Write `/mnt/project-files/build/stage-5c-documents.sql` (the migration) and `/mnt/project-files/build/v4-constitution.sql` (data only), and queue them in the Live log for Jeff's next PC session.
