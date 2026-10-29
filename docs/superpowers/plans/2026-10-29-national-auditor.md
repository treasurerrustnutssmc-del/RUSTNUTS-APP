# Plan: the National Auditor in full

Spec: `docs/superpowers/specs/2026-10-29-national-auditor-design.md`. Branch `claude/project-thread-yft2cz`.
Each step is test first: write the failing test, watch it fail, then the code.

1. **NEC split (app).** `access.ts`: `isNational` and `isNecOfficer` drop `nec_auditor`; add
   `isAuditor` (moved from ledger.ts, re-exported) and `reviewsChapter`; `meetings.ts` adds
   `reviewsScope`. Update tests that assumed the Auditor runs things.
2. **Reads (app).** `canSeeMember` (pending), `canSeeFees`, `canSeeMeeting`, minutes, action items,
   `canSeeVote`, merch item/order reads, document sign-offs and attendance reads take the Auditor.
3. **Appointment (app).** `openVoteProblem` accepts the auditor appointment vote; `appointProblem`
   needs a carried one in 90 days; renewal rule `renewAuditorProblem`.
4. **Requests, reports, checks (app).** `src/domain/audit.ts` + types in `types.ts`.
5. **Database.** `supabase/migrations/20270535000000_national_auditor.sql`; `supabase/tests/auditor_test.sql`
   wired into `scripts/test-db.sh`; shared cases in `parity.json` via `scripts/parity-sql.mts`.
6. **Wiring.** Demo actions (`src/data/auditActions.ts`), live (`src/data/auditLive.ts`), context,
   `database.types.ts`, a demo Auditor.
7. **Screens.** `src/screens/audit.tsx` (home, records, request, new request, report), nav, Me card,
   Board row, Appoint screen's Renew.
8. **Finish.** Independent review, fixes, `npm test`, `npm run test:db`, typecheck, lint, phone-size
   screenshots, PR, paste file to `/mnt/project-files/build/national-auditor.sql`.
