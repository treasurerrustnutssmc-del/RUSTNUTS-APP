# Plan: Feedback & issues

Spec: docs/superpowers/specs/2026-11-01-app-feedback-design.md. Each step is test first.

1. Rules in `src/domain/feedback.ts` (keepers, send/answer refusals, who sees what, labels, device line, mailto) with `feedback.test.ts`.
2. Migration `20270700000000_app_feedback.sql` and `supabase/tests/app_feedback_test.sql` (added to `scripts/test-db.sh`): table, RLS, bucket, three functions, push triggers, account-deletion clean-up.
3. Notification taps: `feedback` → Feedback screen, `feedback-sent` → Board tab (`src/domain/notifications.ts`).
4. Data: `src/data/feedbackData.ts` (rows, demo samples, demo send/answer) with its test; `src/data/feedback.tsx` (one shared list, live or demo, screenshot upload, app details).
5. Screens: `src/screens/feedback.tsx` (Me row, Feedback screen, Board section), wired into Me, Family Me, Board and the navigator.
6. Checks: `npm test`, `npm run test:db`, typecheck, lint, demo screenshots at 390×844; independent review; paste-queue item 53; PR.
