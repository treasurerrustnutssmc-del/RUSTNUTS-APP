# Member content rules (Guideline 1.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass App Review Guideline 1.2: terms members agree to (with a server-side gate on posting), Report on every kind of member post with one board queue, Block from a message, and a board action that suspends a member's app access in one step.

**Architecture:** Rules in `src/domain` (postingRules.ts, reports.ts, access.ts, chat.ts, social/*.ts) mirrored by `supabase/migrations/20270600000000_member_content_rules.sql`; demo actions beside the live providers; one gate screen, one shared `ReportBox` UI piece used on five screens; parity cases in `supabase/tests/parity.json`.

**Tech Stack:** Expo SDK 58 / React Native 0.88 / TypeScript; Supabase Postgres; node:test via `npm test`; SQL via `npm run test:db`.

**Spec:** `docs/superpowers/specs/2026-10-31-member-content-rules-design.md`

## Tasks

- [ ] 1. Domain: `postingRules.ts` (text, URL, `postingRulesProblem`), tests; thread the check into `postProblem`, `listingProblem`, `buildPostProblem`, `nominationProblem`, `mechanicProblem`, profile save; `Member.postingRulesAcceptedOn`.
- [ ] 2. Domain: `reports.ts` (kinds, `reportContentProblem`, `canActOnContentReport`, `resolveContentReportProblem`, `findReportTarget`) with tests; `access.ts` suspend/restore rules with tests.
- [ ] 3. SQL migration: column, `accept_posting_rules`, redefined posting functions, `content_reports` + RLS, `report_content`, `content_reports`, `resolve_content_report`, `my_open_reports`, `suspend_member_access`, `restore_member_access`; `member_content_rules_test.sql`; hook into `scripts/test-db.sh`.
- [ ] 4. Parity: fixture (`postingRulesAgreed`, `benched`), `rulesNotAgreed` flag, new actions in the testkit, `parity-sql.mts` and the demo runners; cases in `parity.json`.
- [ ] 5. Data: live and demo providers (club: accept, suspend, restore; social: report, list, resolve, my reports; chat: my reports, combined count), `liveData` mapping, demo seed (Spanner not agreed; one open report).
- [ ] 6. Screens: `PostingRulesScreen` + navigator gate; Me row; Pending copy for suspended; `ReportBox` on listing, build update, nomination, workshop, member; Block chip and tappable author line in chat; Reports screen with both kinds; Manage member suspend/restore.
- [ ] 7. Site page: `renderPolicyPage` shared with the privacy page, `site/posting-rules.html`, build script and test.
- [ ] 8. Checks: `npm test`, `npm run test:db`, `npm run typecheck`, `npx expo lint`; screenshots at 390×844 (gate, report box, reports queue, suspend); independent review; PR; paste file + queue item; tell the iOS thread the text path.
