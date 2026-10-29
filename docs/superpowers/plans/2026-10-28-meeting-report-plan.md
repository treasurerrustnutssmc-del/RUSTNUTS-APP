# Treasurer's Report for a meeting: plan

Spec: `docs/superpowers/specs/2026-10-28-meeting-report-design.md`. Claude approved both on 28 Oct 2026.

1. Domain, test first: `src/domain/meetingReport.test.ts` (figures, 1 July opening, checks, month labels, read-out, rules,
   default period, who builds it, prepared-by line), then `src/domain/meetingReport.ts`.
2. Acceptance: Jeff's October lines (fy26-27-books.sql) through `meetingFigures` give his figures to the cent.
3. Database, test first: `supabase/tests/meeting_reports_test.sql` (same fixture and numbers), then
   `supabase/migrations/20270430000000_meeting_reports.sql`; wire into `scripts/test-db.sh`. The October lines through
   `private.meeting_report` give the same figures.
4. Parity: `reportPeriod` figures check and four `saveMeetingReport` cases in `supabase/tests/parity.json`.
5. Data: demo actions in `ledgerActions.ts`, `toMeetingReports` in `ledgerLive.ts`, `meeting_reports()` in `liveData.ts`,
   the three actions in both providers. Tests in `src/data/meetingReports.test.ts`.
6. Print: `src/domain/meetingReportHtml.ts` (tested), `src/data/reportPdf.ts` (expo-print + share sheet) and
   `reportPdf.web.ts` (print dialog). Render the October report to PDF and compare it with Jeff's.
7. Screen: `src/screens/meetingReport.tsx`, a row on Treasury, a "For meetings" list on Club finances, demo data.
8. Checks: npm test, npm run test:db, typecheck, lint, the screens at 390×844 as treasurer and member. Independent review.
9. Queue the migration for Jeff's next paste session.
